/// <reference types="node" />
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkVersions, readVersions } from "../scripts/release/versions.mjs";
import { resolveKeyCommand } from "./lib/keyCommands";

const APP = resolve(__dirname, "..");
const ROOT = resolve(APP, "..");
const read = (...p: string[]) => readFileSync(join(...p), "utf-8");
const conf = JSON.parse(read(APP, "src-tauri", "tauri.conf.json"));

describe("release configuration", () => {
  it("every file agrees on the version", () => {
    expect(checkVersions(readVersions(APP))).toBe(conf.version);
  });

  it("checkVersions names a file that disagrees", () => {
    expect(() => checkVersions({ "tauri.conf.json": "1.0.0", "package.json": "1.0.1" })).toThrow("package.json");
    expect(() => checkVersions({ "tauri.conf.json": "1.0" })).toThrow("MAJOR.MINOR.PATCH");
  });

  it("installs where the documented guif registration expects it", () => {
    expect(conf.productName).toBe("guif-pdf");
    expect(conf.mainBinaryName).toBe("guif-pdf");
    expect(conf.bundle.targets).toEqual(["nsis"]);
    expect(conf.bundle.windows.nsis.installMode).toBe("currentUser");
  });

  it("all configured icons exist", () => {
    for (const icon of conf.bundle.icon) {
      expect(existsSync(join(APP, "src-tauri", icon)), icon).toBe(true);
    }
  });

  it("ships the license and the notices", () => {
    expect(Object.keys(conf.bundle.resources)).toEqual(
      expect.arrayContaining(["../../LICENSE", "../../THIRD_PARTY_NOTICES.md"])
    );
    expect(existsSync(join(ROOT, "LICENSE"))).toBe(true);
    const notices = read(ROOT, "THIRD_PARTY_NOTICES.md");
    for (const name of ["pdfjs-dist", "pdf-lib", "tauri", "Adobe", "LICENSE_FOXIT", "LICENSE_LIBERATION"]) {
      expect(notices).toContain(name);
    }
  });

  it("the production CSP stays strict", () => {
    const csp: string = conf.app.security.csp;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp.split(";").find((d) => d.includes("script-src"))).not.toContain("unsafe-inline");
    expect(csp).not.toMatch(/https?:\/\/(?!ipc\.localhost)/);
  });

  it("the window has only the permissions it needs", () => {
    const capability = JSON.parse(read(APP, "src-tauri", "capabilities", "default.json"));
    expect(capability.permissions).toEqual(["core:default", "core:window:allow-destroy"]);
  });

  it("no PDF is loaded past the encryption check", () => {
    const engine = read(APP, "src", "lib", "pdfEngine.ts");
    expect(engine.match(/PDFDocument\.load\(/g)).toHaveLength(1);
    expect(engine).toContain("if (doc.isEncrypted)");
  });

  it("public documents do not contain a personal path", () => {
    for (const file of ["README.md", "CONTRIBUTING.md", "docs/user_manual.md"]) {
      expect(read(ROOT, file), file).not.toMatch(/C:\\+Users\\+/i);
    }
  });
});

describe("the documented shortcuts match the implementation", () => {
  function runsCommand(label: string): boolean {
    const parts = label.split("+");
    const key = parts.pop()!;
    const names: Record<string, string> = { Space: " ", Esc: "Escape" };
    const named = names[key] ?? key;
    const shift = parts.includes("Shift");
    const ctrl = parts.includes("Ctrl");
    const letter = named.length === 1 && /[A-Z]/.test(named);
    // A letter is written in capitals in the documents; R and Shift+R are different keys.
    const pressed = letter ? (shift ? named : named.toLowerCase()) : named;
    return (
      resolveKeyCommand(
        { key: pressed, ctrlKey: ctrl, metaKey: false, altKey: false, shiftKey: shift },
        { inputFocused: false, modalOpen: false }
      ) !== null
    );
  }

  it("every key in the manual's shortcut table works", () => {
    const manual = read(ROOT, "docs", "user_manual.md").replace(/\r\n/g, "\n");
    const section = manual.split("## 4. キーボードショートカット")[1].split("\n---")[0];
    const rows = section.split("\n").filter((l) => l.startsWith("| `"));
    const keys = rows.flatMap((row) => [...row.split("|")[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]));
    expect(keys.length).toBeGreaterThan(25);
    for (const key of keys) {
      expect(runsCommand(key), key).toBe(true);
    }
  });

  it("every key in the in-app help works", () => {
    const help = read(APP, "src", "lib", "components", "ShortcutHelpModal.svelte");
    const keys = [...help.matchAll(/<kbd>([^<]+)<\/kbd>/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) {
      expect(runsCommand(key), key).toBe(true);
    }
  });

  it("the manual documents every single-letter command", () => {
    const manual = read(ROOT, "docs", "user_manual.md");
    for (const letter of "JKRVHTNBALPWF") {
      if (resolveKeyCommand(
        { key: letter.toLowerCase(), ctrlKey: false, metaKey: false, altKey: false, shiftKey: false },
        { inputFocused: false, modalOpen: false }
      )) {
        expect(manual, letter).toContain(`\`${letter}\``);
      }
    }
  });
});
