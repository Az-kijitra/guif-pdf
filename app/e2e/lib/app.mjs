// Starts the real app for E2E runs with its settings and writes confined to temporary folders.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Cdp, listTargets, sleep } from "./cdp.mjs";

export const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EXE = path.join(APP_DIR, "src-tauri", "target", "debug", "guif-pdf.exe");
const CDP_PORT = 9347;

export async function until(what, check, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    try {
      last = await check();
      if (last) return last;
    } catch (e) {
      last = e;
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what} (last: ${last})`);
    await sleep(100);
  }
}

export class App {
  constructor(child, cdp, errPath) {
    this.child = child;
    this.cdp = cdp;
    this.errPath = errPath;
    this.exited = false;
    child.on("exit", () => (this.exited = true));
  }

  status = () => this.cdp.ev(`document.querySelector(".status-bar").innerText`);
  dialogText = () => this.cdp.ev(`document.querySelector(".confirm-card")?.innerText ?? ""`);

  clickButton(text) {
    return this.cdp.ev(`(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.innerText.includes(${JSON.stringify(text)}));
      if (!b) throw new Error("no button: " + ${JSON.stringify(text)});
      b.click();
    })()`);
  }

  /** Waits until page `n` has been painted, and returns whether it shows anything. */
  async waitForPainted(n = 1) {
    const expression = `(() => {
      const c = document.querySelector('[data-page-number="${n}"] canvas');
      if (!c || !c.width) return false;
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 128) return true;
      return false;
    })()`;
    return until(`page ${n} to be painted`, () => this.cdp.ev(expression));
  }

  /** Drags across the page surface with the current tool, in fractions of the page. */
  async drag(n, from, to) {
    const rect = await this.cdp.ev(`(() => {
      const el = document.querySelector('[data-page-number="${n}"] .page-surface');
      el.scrollIntoView({ block: "start" });
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    })()`);
    await sleep(300);
    const at = ([fx, fy]) => ({ x: rect.x + rect.w * fx, y: rect.y + rect.h * fy });
    const a = at(from);
    const b = at(to);
    const mouse = (type, p, buttons) =>
      this.cdp.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", buttons, clickCount: 1 });
    await mouse("mouseMoved", a, 0);
    await mouse("mousePressed", a, 1);
    await mouse("mouseMoved", b, 1);
    await mouse("mouseReleased", b, 0);
  }

  /** Sends WM_CLOSE, as the window's X button does. */
  requestClose() {
    spawnSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${this.child.pid}).CloseMainWindow() | Out-Null`]);
  }

  invoke(command, args) {
    return this.cdp.ev(
      `window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)})
        .then(() => "ok", (e) => "error: " + e)`
    );
  }

  /** Runtime exceptions, console errors, and CSP or other browser-reported violations seen so far. */
  async problems() {
    return this.cdp.takeErrors();
  }

  close() {
    this.cdp.close();
    if (!this.exited) this.child.kill();
  }
}

export async function launch(root, args) {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "guif-pdf-e2e-cfg-"));
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "guif-pdf-e2e-wv-"));
  const errPath = path.join(cfgDir, "stderr.log");
  const errFd = fs.openSync(errPath, "w");
  const child = spawn(EXE, args, {
    stdio: ["ignore", "ignore", errFd],
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
      WEBVIEW2_USER_DATA_FOLDER: userData,
      GUIF_PDF_CONFIG_DIR: cfgDir,
      GUIF_PDF_E2E_FS_SCOPE: root,
    },
  });

  try {
    // The guard: not a single input before the app has confirmed both overrides.
    await until("the override lines on stderr", () => {
      const err = fs.readFileSync(errPath, "utf8");
      return err.includes(`[config] override dir: ${cfgDir}`) && err.includes(`E2E fs scope active: ${root}`);
    });
    const target = await until("the page target", async () => {
      const targets = await listTargets(CDP_PORT);
      return targets.find((t) => t.type === "page");
    });
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl);
    await until("the app to mount", () => cdp.ev(`Boolean(document.querySelector(".status-bar"))`));
    return new App(child, cdp, errPath);
  } catch (e) {
    child.kill();
    throw e;
  }
}
