import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const targets = [
  {
    src: path.join(rootDir, "node_modules", "pdfjs-dist", "cmaps"),
    dest: path.join(rootDir, "static", "pdfjs", "cmaps"),
  },
  {
    src: path.join(rootDir, "node_modules", "pdfjs-dist", "standard_fonts"),
    dest: path.join(rootDir, "static", "pdfjs", "standard_fonts"),
  },
];

for (const { src, dest } of targets) {
  if (!fs.existsSync(src)) {
    console.warn(`[copy-pdfjs-assets] Source not found: ${src}`);
    continue;
  }
  fs.mkdirSync(dest, { recursive: true });
  fs.cpSync(src, dest, { recursive: true, force: true });
}

console.log("[copy-pdfjs-assets] Synced cmaps and standard_fonts to static/pdfjs/");
