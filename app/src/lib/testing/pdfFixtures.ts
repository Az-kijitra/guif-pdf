/// <reference types="node" />
import { createHash } from "node:crypto";
import { PDFDict, PDFDocument, PDFName, PDFString, type PDFPage, type PDFRef } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { VirtualPage } from "../types";

export const PAGE_W = 600;
export const PAGE_H = 800;

export function virtualPage(sourceIndex: number, addedRotation = 0, baseRotation = 0): VirtualPage {
  return {
    id: `vp-${sourceIndex}`,
    sourcePageIndex: sourceIndex,
    originalPageNumber: sourceIndex + 1,
    baseRotation,
    addedRotation,
    widthPt: PAGE_W,
    heightPt: PAGE_H,
  };
}

export async function plainPdf(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([PAGE_W, PAGE_H]).drawText(`PAGE-${i + 1}`, { x: 50, y: 700, size: 20 });
  }
  return doc.save();
}

/** Adds a bookmark tree: one bookmark per entry, children one level below their parent. */
export function addOutline(
  doc: PDFDocument,
  entries: Array<{ title: string; page: PDFPage; children?: Array<{ title: string; page: PDFPage }> }>
): void {
  const ctx = doc.context;
  const rootRef = ctx.register(ctx.obj({ Type: "Outlines" }));
  const link = (
    parentRef: PDFRef,
    items: Array<{ title: string; page: PDFPage; children?: Array<{ title: string; page: PDFPage }> }>
  ): number => {
    const refs = items.map((item) =>
      ctx.register(
        ctx.obj({
          Title: PDFString.of(item.title),
          Parent: parentRef,
          Dest: [item.page.ref, "Fit"],
        })
      )
    );
    let total = items.length;
    items.forEach((item, i) => {
      const dict = ctx.lookup(refs[i], PDFDict);
      if (i > 0) dict.set(PDFName.of("Prev"), refs[i - 1]);
      if (i < refs.length - 1) dict.set(PDFName.of("Next"), refs[i + 1]);
      if (item.children?.length) total += link(refs[i], item.children);
    });
    const parent = ctx.lookup(parentRef, PDFDict);
    parent.set(PDFName.of("First"), refs[0]);
    parent.set(PDFName.of("Last"), refs[refs.length - 1]);
    parent.set(PDFName.of("Count"), ctx.obj(total));
    return total;
  };
  link(rootRef, entries);
  doc.catalog.set(PDFName.of("Outlines"), rootRef);
}

/** A one-page PDF with an owner password only: viewers open it freely, its streams are RC4 encrypted. */
export function ownerPasswordPdf(text = "SECRET-TEXT-OK"): Uint8Array {
  const rc4 = (key: Uint8Array, data: Uint8Array) => {
    const s = Array.from({ length: 256 }, (_, i) => i);
    let j = 0;
    for (let i = 0; i < 256; i++) {
      j = (j + s[i] + key[i % key.length]) & 255;
      [s[i], s[j]] = [s[j], s[i]];
    }
    let a = 0;
    let b = 0;
    return data.map((x) => {
      a = (a + 1) & 255;
      b = (b + s[a]) & 255;
      [s[a], s[b]] = [s[b], s[a]];
      return x ^ s[(s[a] + s[b]) & 255];
    });
  };
  const md5 = (...parts: Uint8Array[]) =>
    new Uint8Array(createHash("md5").update(Buffer.concat(parts)).digest());
  const fromHex = (h: string) => new Uint8Array(Buffer.from(h, "hex"));
  const toHex = (b: Uint8Array) => Buffer.from(b).toString("hex").toUpperCase();

  const pad = fromHex("28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A");
  const ownerBytes = new Uint8Array(Buffer.from("ownerpwd"));
  const ownerKey = md5(new Uint8Array([...ownerBytes, ...pad].slice(0, 32))).slice(0, 5);
  const O = rc4(ownerKey, pad);
  const id = fromHex("00112233445566778899AABBCCDDEEFF");
  const P = -44;
  const key = md5(pad, O, new Uint8Array(new Int32Array([P]).buffer), id).slice(0, 5);
  const U = rc4(key, pad);

  const objectKey = md5(key, new Uint8Array([4, 0, 0, 0, 0])).slice(0, 10);
  const stream = rc4(
    objectKey,
    new Uint8Array(Buffer.from(`BT /F1 24 Tf 72 700 Td (${text}) Tj ET`))
  );

  const chunks: Buffer[] = [];
  const offsets: number[] = [];
  let pos = 0;
  const write = (b: string | Uint8Array) => {
    const chunk = typeof b === "string" ? Buffer.from(b, "latin1") : Buffer.from(b);
    chunks.push(chunk);
    pos += chunk.length;
  };
  const bodies: Array<() => void> = [
    () => write("<</Type/Catalog/Pages 2 0 R>>"),
    () => write("<</Type/Pages/Kids[3 0 R]/Count 1>>"),
    () =>
      write(
        `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${PAGE_W} ${PAGE_H}]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>`
      ),
    () => {
      write(`<</Length ${stream.length}>>stream\n`);
      write(stream);
      write("\nendstream");
    },
    () => write("<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>"),
    () => write(`<</Filter/Standard/V 1/R 2/O<${toHex(O)}>/U<${toHex(U)}>/P ${P}>>`),
  ];
  write("%PDF-1.4\n");
  bodies.forEach((body, i) => {
    offsets.push(pos);
    write(`${i + 1} 0 obj\n`);
    body();
    write("\nendobj\n");
  });
  const xref = pos;
  write(`xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`);
  offsets.forEach((o) => write(`${String(o).padStart(10, "0")} 00000 n \n`));
  write(
    `trailer<</Size ${bodies.length + 1}/Root 1 0 R/Encrypt 6 0 R/ID[<${toHex(id)}><${toHex(id)}>]>>\nstartxref\n${xref}\n%%EOF\n`
  );
  return new Uint8Array(Buffer.concat(chunks));
}

/** What another PDF reader (PDF.js) actually sees in a file. */
export async function readWithPdfJs(bytes: Uint8Array) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0 }).promise;
  const pages: Array<{
    text: string;
    rotate: number;
    view: number[];
    translations: number[][];
  }> = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const ops = await page.getOperatorList();
    pages.push({
      text: content.items.map((it) => ("str" in it ? it.str : "")).join(""),
      rotate: page.rotate,
      view: [...page.view],
      translations: ops.fnArray
        .map((fn, idx) => (fn === pdfjs.OPS.transform ? (ops.argsArray[idx] as number[]) : null))
        .filter((args): args is number[] => args !== null),
    });
  }
  const outline = (await doc.getOutline()) ?? [];
  const metadata = await doc.getMetadata();
  const fields = (await doc.getFieldObjects()) ?? {};
  return {
    pages,
    outline: outline.map((o) => ({ title: o.title, children: o.items.map((c) => c.title) })),
    title: (metadata.info as { Title?: string }).Title,
    author: (metadata.info as { Author?: string }).Author,
    encrypted: Boolean((metadata.info as { EncryptFilterName?: string }).EncryptFilterName),
    fieldNames: Object.keys(fields),
  };
}
