// Checks that every file carrying the version agrees: `npm run release:check`. Node built-ins only.
// Adapted from guif's scripts/release/versions.mjs.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SEMVER = /^\d+\.\d+\.\d+$/;
const CARGO_PACKAGE = "guif-pdf";

/** @param {string} text */
function cargoTomlVersion(text) {
  const m = /^\[package\][\s\S]*?^version\s*=\s*"([^"]*)"/m.exec(text);
  return m ? m[1] : null;
}

/** @param {string} text */
function cargoLockVersion(text) {
  const m = new RegExp(`name\\s*=\\s*"${CARGO_PACKAGE}"\\s*\\r?\\nversion\\s*=\\s*"([^"]*)"`).exec(text);
  return m ? m[1] : null;
}

/**
 * @param {string} appDir
 * @returns {Record<string, string | null>}
 */
export function readVersions(appDir) {
  const tauri = join(appDir, "src-tauri");
  const json = (/** @type {string} */ p) => JSON.parse(readFileSync(p, "utf-8"));
  const lock = json(join(appDir, "package-lock.json"));
  return {
    "tauri.conf.json": json(join(tauri, "tauri.conf.json")).version ?? null,
    "package.json": json(join(appDir, "package.json")).version ?? null,
    "package-lock.json": lock.version ?? null,
    'package-lock.json packages[""]': lock.packages?.[""]?.version ?? null,
    "Cargo.toml": cargoTomlVersion(readFileSync(join(tauri, "Cargo.toml"), "utf-8")),
    "Cargo.lock": cargoLockVersion(readFileSync(join(tauri, "Cargo.lock"), "utf-8")),
  };
}

/**
 * Returns the agreed version, or throws an error naming each offending file.
 * @param {Record<string, string | null>} versions
 */
export function checkVersions(versions) {
  const expected = versions["tauri.conf.json"];
  const errors = [];
  if (typeof expected !== "string" || !SEMVER.test(expected)) {
    errors.push(`tauri.conf.json: "${expected}" is not MAJOR.MINOR.PATCH`);
  }
  for (const [file, version] of Object.entries(versions)) {
    if (version !== expected) errors.push(`${file}: "${version}" differs from tauri.conf.json "${expected}"`);
  }
  if (errors.length > 0) throw new Error(errors.join("\n"));
  return expected;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  try {
    console.log(`version ${checkVersions(readVersions(appDir))}: all files agree`);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  }
}
