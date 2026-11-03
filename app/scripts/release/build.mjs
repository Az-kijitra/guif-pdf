// Builds the installer and prints its path and SHA-256: `npm run release:build`. Node built-ins only.

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkVersions, readVersions } from "./versions.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

const version = checkVersions(readVersions(APP));
execSync("npm run tauri -- build", { cwd: APP, stdio: "inherit" });

const installer = join(APP, "src-tauri", "target", "release", "bundle", "nsis", `guif-pdf_${version}_x64-setup.exe`);
if (!existsSync(installer)) {
  console.error(`installer not found: ${installer}`);
  process.exit(1);
}
const bytes = readFileSync(installer);
console.log(`\ninstaller: ${installer}`);
console.log(`size:      ${(statSync(installer).size / 1048576).toFixed(1)} MB`);
console.log(`sha256:    ${createHash("sha256").update(bytes).digest("hex")}`);
