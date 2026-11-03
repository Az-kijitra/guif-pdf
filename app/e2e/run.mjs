// End-to-end tests against the real app (debug binary + WebView2) over the Chrome DevTools Protocol.
//
//   npm run e2e:build   builds src-tauri/target/debug/guif-pdf.exe with the production frontend and CSP
//   npm run e2e         runs every scenario; `npm run e2e -- keys` runs the scenarios whose name contains "keys"
//
// Needs Node 22.18+ (it imports the TypeScript fixtures) and a Windows desktop session: each scenario briefly
// opens a window. Real user data stays untouched:
//   - settings go to a temporary GUIF_PDF_CONFIG_DIR, and the backend refuses writes outside GUIF_PDF_E2E_FS_SCOPE
//     (both are read by debug builds only);
//   - no input is sent until the app has confirmed both on stderr;
//   - after the run, the real settings folder must be unchanged.

import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument } from "pdf-lib";
import { addOutline, ownerPasswordPdf, readWithPdfJs } from "../src/lib/testing/pdfFixtures.ts";
import { EXE, launch, until } from "./lib/app.mjs";
import { MOD, sleep } from "./lib/cdp.mjs";

const REAL_CONFIG_DIR = path.join(process.env.APPDATA ?? "", "dev.guif.pdf");

function snapshot(dir) {
  if (!fs.existsSync(dir)) return "absent";
  return fs
    .readdirSync(dir)
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return `${name}:${stat.mtimeMs}:${stat.size}`;
    })
    .join("|");
}

async function makeFixtures(dir) {
  const rich = await PDFDocument.create();
  rich.setTitle("E2E Title");
  const pages = [1, 2, 3].map((n) => {
    const p = rich.addPage([600, 800]);
    p.drawText(`PAGE-${n}`, { x: 50, y: 700, size: 20 });
    return p;
  });
  rich.getForm().createTextField("field_1").addToPage(pages[0], { x: 50, y: 500, width: 200, height: 30 });
  addOutline(rich, [
    { title: "Chapter 1", page: pages[0] },
    { title: "Chapter 2", page: pages[1] },
  ]);
  fs.writeFileSync(path.join(dir, "rich.pdf"), await rich.save());
  fs.writeFileSync(path.join(dir, "encrypted.pdf"), ownerPasswordPdf());
  fs.writeFileSync(path.join(dir, "note.txt"), "not a pdf");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const scenarios = {
  async "opening a PDF from the command line paints it under the production CSP"({ root }) {
    const app = await launch(root, [path.join(root, "rich.pdf")]);
    try {
      await until("the open message", async () => (await app.status()).includes("全 3 ページ"));
      assert(await app.waitForPainted(1), "page 1 is blank");
      await sleep(500);
      const problems = await app.problems();
      assert(problems.length === 0, `page reported errors: ${problems.join(" / ")}`);
    } finally {
      app.close();
    }
  },

  async "a folder argument lists its PDFs, a non-PDF argument opens nothing"({ root }) {
    let app = await launch(root, [root]);
    try {
      const names = await until("the folder list", async () => {
        const text = await app.cdp.ev(`document.querySelector(".folder-list")?.innerText ?? ""`);
        return text.includes("rich.pdf") ? text : false;
      });
      assert(!names.includes("note.txt"), "non-PDF file listed");
    } finally {
      app.close();
    }
    await sleep(500);
    app = await launch(root, [path.join(root, "note.txt")]);
    try {
      await until("the folder list", async () =>
        (await app.cdp.ev(`document.querySelector(".folder-list")?.innerText ?? ""`)).includes("rich.pdf")
      );
      assert(!(await app.status()).includes("開きました"), "a non-PDF was opened");
    } finally {
      app.close();
    }
  },

  async "saving keeps bookmarks, form and title and adds the annotation"({ root }) {
    const file = path.join(root, "save-as.pdf");
    fs.copyFileSync(path.join(root, "rich.pdf"), file);
    const app = await launch(root, [file]);
    try {
      await app.waitForPainted(1);
      await app.cdp.key("b");
      await app.drag(1, [0.2, 0.2], [0.6, 0.4]);
      await until("the annotation", () => app.cdp.ev(`document.querySelector(".menubar-root").innerText.includes("●")`));
      await app.cdp.key("s", MOD.Ctrl);
      await until("the save dialog", () => app.cdp.ev(`Boolean(document.querySelector(".btn-primary"))`));
      await app.clickButton("別名で保存を実行");
      const out = path.join(root, "save-as_edited.pdf");
      await until("the saved file", () => fs.existsSync(out));
      const seen = await readWithPdfJs(new Uint8Array(fs.readFileSync(out)));
      assert(seen.title === "E2E Title", `title: ${seen.title}`);
      assert(seen.outline.length === 2, `outline: ${JSON.stringify(seen.outline)}`);
      assert(seen.fieldNames.includes("field_1"), `fields: ${seen.fieldNames}`);
      const before = await readWithPdfJs(new Uint8Array(fs.readFileSync(file)));
      assert(seen.pages[0].translations.length > before.pages[0].translations.length, "annotation was not baked");
      assert(!fs.readdirSync(root).some((n) => n.endsWith(".tmp")), "temp file left behind");
    } finally {
      app.close();
    }
  },

  async "overwrite asks first, then replaces the file without a temp file"({ root }) {
    const file = path.join(root, "overwrite.pdf");
    fs.copyFileSync(path.join(root, "rich.pdf"), file);
    const original = fs.readFileSync(file);
    const app = await launch(root, [file]);
    try {
      await app.waitForPainted(1);
      await app.cdp.key("r");
      await app.cdp.key("S", MOD.Ctrl | MOD.Shift);
      await until("the confirmation", async () => (await app.dialogText()).includes("上書き"));
      assert(fs.readFileSync(file).equals(original), "written before confirming");
      await app.clickButton("上書き保存を実行");
      await until("the overwrite", () => !fs.readFileSync(file).equals(original));
      const seen = await readWithPdfJs(new Uint8Array(fs.readFileSync(file)));
      assert(seen.pages[0].rotate === 90, `rotate: ${seen.pages[0].rotate}`);
      assert(seen.outline.length === 2, "outline lost on overwrite");
    } finally {
      app.close();
    }
  },

  async "an encrypted PDF opens read-only and nothing can write it"({ root }) {
    const file = path.join(root, "encrypted.pdf");
    const original = fs.readFileSync(file);
    const app = await launch(root, [file]);
    try {
      await app.waitForPainted(1);
      await until("the read-only marker", async () => (await app.status()).includes("閲覧のみ"));
      await app.cdp.key("r");
      await until("the refusal", async () => (await app.status()).includes("暗号化"));
      assert(
        !(await app.cdp.ev(`document.querySelector(".rot-pill") !== null`)),
        "the page was rotated"
      );
      await app.cdp.key("s", MOD.Ctrl);
      await app.cdp.key("S", MOD.Ctrl | MOD.Shift);
      await sleep(300);
      assert(!(await app.cdp.ev(`Boolean(document.querySelector(".btn-primary, .confirm-card"))`)), "a save dialog opened");
      assert(fs.readFileSync(file).equals(original), "the file changed");
    } finally {
      app.close();
    }
  },

  async "unsaved edits are not lost silently"({ root }) {
    const app = await launch(root, [path.join(root, "rich.pdf")]);
    try {
      await app.waitForPainted(1);
      await app.cdp.key("r");

      // Closing the window: Cancel keeps the app open, confirming ends it.
      app.requestClose();
      await until("the close confirmation", async () => (await app.dialogText()).includes("終了"));
      await app.clickButton("キャンセル");
      await sleep(300);
      assert(!app.exited, "the app quit despite Cancel");
      assert(await app.cdp.ev(`document.querySelector(".menubar-root").innerText.includes("●")`), "edit lost");

      app.requestClose();
      await until("the close confirmation", async () => (await app.dialogText()).includes("終了"));
      app.clickButton("保存せずに続行").catch(() => {}); // the page goes away with the window
      await until("the app to quit", () => app.exited);
    } finally {
      app.close();
    }
  },

  async "keys: modifiers and dialogs do not trigger single-letter commands"({ root }) {
    const app = await launch(root, [path.join(root, "rich.pdf")]);
    try {
      await app.waitForPainted(1);
      const tool = async () => (await app.status()).match(/ツール: (\w+)/)?.[1];

      await app.cdp.key("p", MOD.Alt);
      await app.cdp.key("Escape");
      assert((await tool()) === "SELECT", `Alt+P changed the tool to ${await tool()}`);
      await app.cdp.key("a", MOD.Ctrl);
      assert((await tool()) === "SELECT", `Ctrl+A changed the tool to ${await tool()}`);
      await app.cdp.key("r", MOD.Ctrl);
      assert(!(await app.cdp.ev(`document.querySelector(".rot-pill") !== null`)), "Ctrl+R rotated the page");

      await app.cdp.ev(`window.__notReloaded = true`);
      await app.cdp.key("F5");
      await sleep(500);
      assert(await app.cdp.ev(`window.__notReloaded === true`), "F5 reloaded the page");

      await app.cdp.key("?", MOD.Shift);
      await until("the help", () => app.cdp.ev(`document.body.innerText.includes("ページ番号指定書式")`));
      await app.cdp.key("h");
      assert((await tool()) === "SELECT", "a key reached the page behind the dialog");
      await app.cdp.key("Escape");
      await app.cdp.key("h");
      assert((await tool()) === "HIGHLIGHT", "the tool key does not work after closing the dialog");
    } finally {
      app.close();
    }
  },

  async "perf: a 500-page, 50 MB document opens and saves in reasonable time"({ root }) {
    const big = await PDFDocument.create();
    for (let n = 1; n <= 500; n++) {
      const page = big.addPage([595, 842]);
      for (let line = 0; line < 40; line++) {
        page.drawText(`Page ${n} line ${line} of the performance test document.`, { x: 40, y: 800 - line * 19, size: 11 });
      }
    }
    await big.attach(randomBytes(50 * 1048576), "payload.bin", { mimeType: "application/octet-stream" });
    const file = path.join(root, "big.pdf");
    fs.writeFileSync(file, await big.save());
    const sizeMb = (fs.statSync(file).size / 1048576).toFixed(1);

    const started = Date.now();
    const app = await launch(root, [file]);
    try {
      await until("the open message", async () => (await app.status()).includes("全 500 ページ"), 120000);
      const opened = Date.now() - started;
      await app.waitForPainted(1);
      const painted = Date.now() - started;

      const saveStart = Date.now();
      await app.cdp.key("s", MOD.Ctrl);
      await until("the save dialog", () => app.cdp.ev(`Boolean(document.querySelector(".btn-primary"))`));
      await app.clickButton("別名で保存を実行");
      await until("the saved file", () => fs.existsSync(path.join(root, "big_edited.pdf")), 120000);
      console.log(
        `      ${sizeMb} MB: opened ${opened} ms (launch included), first page ${painted} ms, saved ${Date.now() - saveStart} ms`
      );
      assert(opened < 60000, `opening took ${opened} ms`);
    } finally {
      app.close();
    }
  },

  async "the backend refuses writes outside the test folder and non-PDF targets"({ root }) {
    const app = await launch(root, []);
    try {
      const outside = path.join(os.tmpdir(), `guif-pdf-e2e-outside-${process.pid}.pdf`);
      const refused = await app.invoke("write_pdf_base64", {
        path: outside,
        base64Data: "AAAA",
        allowOverwrite: false,
      });
      assert(refused.includes("E2E scope"), `outside write: ${refused}`);
      assert(!fs.existsSync(outside), "file created outside the scope");

      const nonPdf = await app.invoke("write_pdf_base64", {
        path: path.join(root, "evil.exe"),
        base64Data: "AAAA",
        allowOverwrite: false,
      });
      assert(nonPdf.includes(".pdf"), `non-PDF write: ${nonPdf}`);
      assert(!fs.existsSync(path.join(root, "evil.exe")), "non-PDF file created");
    } finally {
      app.close();
    }
  },
};

async function main() {
  if (!fs.existsSync(EXE)) {
    console.error(`${EXE} not found: run "npm run e2e:build" first`);
    process.exit(2);
  }
  const filter = process.argv[2] ?? "";
  const realBefore = snapshot(REAL_CONFIG_DIR);
  let failed = 0;

  for (const [name, run] of Object.entries(scenarios)) {
    if (!name.includes(filter)) continue;
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "guif-pdf-e2e-")));
    await makeFixtures(root);
    try {
      await run({ root });
      console.log(`PASS  ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL  ${name}\n      ${e.message}`);
    }
    await sleep(800); // let WebView2 release the debugging port
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  if (snapshot(REAL_CONFIG_DIR) !== realBefore) {
    failed++;
    console.log(`FAIL  the real settings folder changed: ${REAL_CONFIG_DIR}`);
  }
  console.log(failed === 0 ? "all scenarios passed" : `${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

await main();
