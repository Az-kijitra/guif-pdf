import { PDFDocument, PDFName, PDFString, degrees } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { uint8ArrayToBase64 } from "./api";
import {
  ENCRYPTED_PDF_MESSAGE,
  buildEditedDocument,
  buildPdfFromVirtualPages,
  getPdfPageCountFromBase64,
  getVisibleBox,
  mergePdfQueue,
} from "./pdfEngine";
import {
  PAGE_H,
  PAGE_W,
  addOutline,
  ownerPasswordPdf,
  plainPdf,
  readWithPdfJs,
  virtualPage,
} from "./testing/pdfFixtures";
import type { PdfAnnotation, VirtualPage } from "./types";

async function richPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Original Title");
  doc.setAuthor("Original Author");
  const pages = [1, 2, 3, 4].map((n) => {
    const p = doc.addPage([PAGE_W, PAGE_H]);
    p.drawText(`PAGE-${n}`, { x: 50, y: 700, size: 20 });
    return p;
  });
  const form = doc.getForm();
  form.createTextField("on_page_1").addToPage(pages[0], { x: 50, y: 500, width: 200, height: 30 });
  form.createTextField("on_page_2").addToPage(pages[1], { x: 50, y: 500, width: 200, height: 30 });
  addOutline(doc, [
    { title: "Chapter 1", page: pages[0] },
    {
      title: "Chapter 2",
      page: pages[1],
      children: [{ title: "Section 2.1", page: pages[2] }],
    },
    { title: "Chapter 4", page: pages[3] },
  ]);
  return doc.save();
}

const allPages = (n: number): VirtualPage[] => Array.from({ length: n }, (_, i) => virtualPage(i));

function highlight(pageId: string, x: number, y: number, w: number, h: number): PdfAnnotation {
  return {
    id: `h-${pageId}`,
    pageId,
    kind: "highlight",
    color: "#facc15",
    strokeWidth: 2,
    opacity: 0.36,
    rects: [{ x, y, w, h }],
    points: [],
    createdAt: 0,
  };
}

describe("saving the whole document keeps the document intact", () => {
  it("keeps title, author, bookmarks and form fields", async () => {
    const out = await buildEditedDocument(await richPdf(), allPages(4), {});
    const seen = await readWithPdfJs(out);
    expect(seen.title).toBe("Original Title");
    expect(seen.author).toBe("Original Author");
    expect(seen.outline).toEqual([
      { title: "Chapter 1", children: [] },
      { title: "Chapter 2", children: ["Section 2.1"] },
      { title: "Chapter 4", children: [] },
    ]);
    expect(seen.fieldNames.sort()).toEqual(["on_page_1", "on_page_2"]);
  });

  it("keeps them while rotating, reordering and annotating", async () => {
    const pages = [virtualPage(3), virtualPage(0, 90), virtualPage(2), virtualPage(1)];
    const out = await buildEditedDocument(await richPdf(), pages, {
      "vp-0": [highlight("vp-0", 0.1, 0.1, 0.2, 0.1)],
    });
    const seen = await readWithPdfJs(out);
    expect(seen.pages.map((p) => p.text)).toEqual(["PAGE-4", "PAGE-1", "PAGE-3", "PAGE-2"]);
    expect(seen.pages[1].rotate).toBe(90);
    expect(seen.outline.map((o) => o.title)).toEqual(["Chapter 1", "Chapter 2", "Chapter 4"]);
    expect(seen.fieldNames).toHaveLength(2);
  });

  it("omits annotations on request", async () => {
    const annotations = { "vp-0": [highlight("vp-0", 0, 0, 0.5, 0.5)] };
    const baked = await readWithPdfJs(await buildEditedDocument(await plainPdf(1), allPages(1), annotations));
    const plain = await readWithPdfJs(await buildEditedDocument(await plainPdf(1), allPages(1), annotations, false));
    expect(baked.pages[0].translations.length).toBeGreaterThan(plain.pages[0].translations.length);
  });

  it("rejects an empty page list", async () => {
    await expect(buildEditedDocument(await plainPdf(1), [], {})).rejects.toThrow("1ページもありません");
  });
});

describe("deleting pages", () => {
  const remaining = [virtualPage(0), virtualPage(3)]; // pages 2 and 3 deleted

  it("removes bookmarks and fields of deleted pages but keeps the others", async () => {
    const seen = await readWithPdfJs(await buildEditedDocument(await richPdf(), remaining, {}));
    expect(seen.pages.map((p) => p.text)).toEqual(["PAGE-1", "PAGE-4"]);
    expect(seen.outline).toEqual([
      { title: "Chapter 1", children: [] },
      { title: "Chapter 4", children: [] },
    ]);
    expect(seen.fieldNames).toEqual(["on_page_1"]);
  });

  it("keeps a bookmark as a heading while one of its children survives", async () => {
    const pages = [virtualPage(0), virtualPage(2), virtualPage(3)]; // page 2 deleted
    const seen = await readWithPdfJs(await buildEditedDocument(await richPdf(), pages, {}));
    expect(seen.outline.map((o) => o.title)).toEqual(["Chapter 1", "Chapter 2", "Chapter 4"]);
    expect(seen.outline[1].children).toEqual(["Section 2.1"]);
  });

  it("does not leave the deleted page's data inside the file", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([PAGE_W, PAGE_H]);
    const secret = doc.addPage([PAGE_W, PAGE_H]);
    secret.node.set(PDFName.of("Marker"), doc.context.register(PDFString.of("DELETED-PAGE-DATA")));
    const out = await buildEditedDocument(await doc.save(), [virtualPage(0)], {});

    const reloaded = await PDFDocument.load(out);
    const dump = reloaded.context
      .enumerateIndirectObjects()
      .map(([, obj]) => obj.toString())
      .join("\n");
    expect(dump).not.toContain("DELETED-PAGE-DATA");
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("shrinks the file when the deleted page held the bulk of the data", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([PAGE_W, PAGE_H]);
    const heavy = doc.addPage([PAGE_W, PAGE_H]);
    for (let i = 0; i < 400; i++) heavy.drawText(`line ${i} ${Math.random()}`, { x: 10, y: i, size: 8 });
    const src = await doc.save();
    const out = await buildEditedDocument(src, [virtualPage(0)], {});
    expect(out.length).toBeLessThan(src.length / 2);
  });
});

describe("encrypted PDFs are refused instead of being written blank", () => {
  const encrypted = ownerPasswordPdf();

  it("the fixture is readable and flagged as encrypted", async () => {
    const seen = await readWithPdfJs(encrypted);
    expect(seen.encrypted).toBe(true);
    expect(seen.pages[0].text).toBe("SECRET-TEXT-OK");
  });

  it("refuses every way of producing output", async () => {
    await expect(buildEditedDocument(encrypted, allPages(1), {})).rejects.toThrow(ENCRYPTED_PDF_MESSAGE);
    await expect(buildPdfFromVirtualPages(encrypted, allPages(1), {})).rejects.toThrow(ENCRYPTED_PDF_MESSAGE);
    const base64 = uint8ArrayToBase64(encrypted);
    await expect(getPdfPageCountFromBase64(base64)).rejects.toThrow(ENCRYPTED_PDF_MESSAGE);
    await expect(
      mergePdfQueue([
        {
          id: "m",
          filePath: "a.pdf",
          fileName: "a.pdf",
          sizeBytes: 1,
          totalPages: 1,
          pageSpec: "all",
          addedRotation: 0,
          base64Data: base64,
        },
      ])
    ).rejects.toThrow(ENCRYPTED_PDF_MESSAGE);
  });
});

describe("extracting pages", () => {
  it("keeps document properties but not document-wide structures", async () => {
    const out = await buildPdfFromVirtualPages(await richPdf(), [virtualPage(1)], {});
    const seen = await readWithPdfJs(out);
    expect(seen.title).toBe("Original Title");
    expect(seen.author).toBe("Original Author");
    expect(seen.pages.map((p) => p.text)).toEqual(["PAGE-2"]);
    expect(seen.outline).toEqual([]);
  });

  it("can repeat a page", async () => {
    const out = await buildPdfFromVirtualPages(await plainPdf(2), [virtualPage(1), virtualPage(1)], {});
    expect((await readWithPdfJs(out)).pages.map((p) => p.text)).toEqual(["PAGE-2", "PAGE-2"]);
  });
});

describe("annotations land where the viewer showed them", () => {
  async function bakedHighlightOrigin(
    setup: (doc: PDFDocument) => void,
    vp: VirtualPage = virtualPage(0)
  ): Promise<number[]> {
    const doc = await PDFDocument.create();
    doc.addPage([PAGE_W, PAGE_H]);
    setup(doc);
    const out = await buildEditedDocument(await doc.save(), [vp], {
      [vp.id]: [highlight(vp.id, 0, 0, 0.5, 0.5)],
    });
    const seen = await readWithPdfJs(out);
    const origin = seen.pages[0].translations[0];
    return origin!.slice(4, 6);
  }

  it("on a plain page", async () => {
    expect(await bakedHighlightOrigin(() => {})).toEqual([0, 400]);
  });

  it("on a page with a CropBox", async () => {
    const origin = await bakedHighlightOrigin((d) => d.getPage(0).setCropBox(100, 100, 400, 600));
    expect(origin).toEqual([100, 400]); // visible area: x 100..500, y 100..700
  });

  it("on a page whose MediaBox does not start at the origin", async () => {
    const origin = await bakedHighlightOrigin((d) => d.getPage(0).setMediaBox(100, 100, 600, 800));
    expect(origin).toEqual([100, 500]);
  });

  it("uses the same visible area as PDF.js", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([PAGE_W, PAGE_H]);
    page.setCropBox(-50, 100, 400, 2000); // sticks out of the MediaBox
    const box = getVisibleBox(page);
    const seen = await readWithPdfJs(await doc.save());
    expect([box.x, box.y, box.x + box.width, box.y + box.height]).toEqual(seen.pages[0].view);
  });

  it("keeps a page that was already rotated in the source", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([PAGE_W, PAGE_H]).setRotation(degrees(90));
    const out = await buildEditedDocument(await doc.save(), [virtualPage(0, 0, 90)], {});
    expect((await readWithPdfJs(out)).pages[0].rotate).toBe(90);
  });
});
