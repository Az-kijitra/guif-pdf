// Regenerates the README screenshot from a generated sample document:
//   npm run e2e:build && npm run docs:screenshot

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { APP_DIR, launch } from "./lib/app.mjs";
import { sleep } from "./lib/cdp.mjs";

const OUTPUT = path.resolve(APP_DIR, "..", "docs", "images", "main.png");

const PARAGRAPHS = [
  "Keep the original safe. Saving under a new name is the default,",
  "and overwriting asks first. A failed save leaves the file untouched.",
  "",
  "Pick pages by checkbox or by typing a page specification such as",
  "1-5, 8, !2. Both stay in sync. Extract, split, merge and rotate work",
  "on the pages you picked.",
  "",
  "Highlights, text, sticky notes, shapes and pen strokes are written",
  "into the page when you save.",
];

async function sampleDocument(file) {
  const doc = await PDFDocument.create();
  const heading = await doc.embedFont(StandardFonts.HelveticaBold);
  const body = await doc.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= 6; n++) {
    const page = doc.addPage([595, 842]);
    page.drawText(`Chapter ${n}`, { x: 60, y: 760, size: 26, font: heading, color: rgb(0.1, 0.15, 0.3) });
    let y = 715;
    for (let block = 0; block < 3; block++) {
      for (const line of PARAGRAPHS) {
        page.drawText(line, { x: 60, y, size: 12, font: body, color: rgb(0.15, 0.15, 0.15) });
        y -= 19;
      }
      y -= 12;
    }
  }
  fs.writeFileSync(file, await doc.save());
}

const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "guif-pdf-shot-")));
const file = path.join(root, "sample.pdf");
await sampleDocument(file);

const app = await launch(root, [file]);
try {
  await app.cdp.setViewport(1280, 840);
  await app.waitForPainted(1);
  await app.cdp.key("F2");
  await app.cdp.key("F3");
  await app.cdp.key("h");
  await app.drag(1, [0.09, 0.15], [0.72, 0.195]);
  await app.cdp.key("b");
  await app.drag(1, [0.08, 0.33], [0.75, 0.42]);
  await app.cdp.key("v");
  await app.cdp.ev(`document.querySelector('[data-page-number="1"]').scrollIntoView({ block: "start" })`);
  await sleep(800);
  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, await app.cdp.screenshot());
  console.log(`wrote ${OUTPUT}`);
} finally {
  app.close();
  await sleep(800);
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
