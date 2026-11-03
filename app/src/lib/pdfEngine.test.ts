import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { uint8ArrayToBase64 } from "./api";
import {
  buildPdfFromVirtualPages,
  displayNormToPdfPoint,
  displayRectToPdfBox,
  mergePdfQueue,
} from "./pdfEngine";
import type { PdfAnnotation, VirtualPage } from "./types";

async function createSamplePdfBytes(pageCount: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i++) {
    const p = doc.addPage([600, 800]);
    p.drawText(`Sample Page ${i + 1}`, { x: 50, y: 700, size: 20 });
  }
  return doc.save();
}

describe("pdfEngine", () => {
  it("converts normalized display coords to PDF points across rotations", () => {
    // 0 deg: top-left (0, 0) -> (0, 800)
    expect(displayNormToPdfPoint(0, 0, 600, 800, 0)).toEqual({ x: 0, y: 800 });
    expect(displayNormToPdfPoint(0.5, 0.25, 600, 800, 0)).toEqual({ x: 300, y: 600 });

    // rect box at 0 deg
    const box = displayRectToPdfBox({ x: 0.1, y: 0.2, w: 0.5, h: 0.1 }, 600, 800, 0);
    expect(box.x).toBeCloseTo(60);
    expect(box.width).toBeCloseTo(300);
    expect(box.height).toBeCloseTo(80);
  });

  it("builds edited PDF with page subset, rotation, and vector annotations", async () => {
    const srcBytes = await createSamplePdfBytes(5);
    const virtualPages: VirtualPage[] = [
      {
        id: "vp-2",
        sourcePageIndex: 1,
        originalPageNumber: 2,
        baseRotation: 0,
        addedRotation: 90,
        widthPt: 600,
        heightPt: 800,
      },
      {
        id: "vp-4",
        sourcePageIndex: 3,
        originalPageNumber: 4,
        baseRotation: 0,
        addedRotation: 0,
        widthPt: 600,
        heightPt: 800,
      },
    ];

    const annotations: Record<string, PdfAnnotation[]> = {
      "vp-2": [
        {
          id: "ann-1",
          pageId: "vp-2",
          kind: "highlight",
          color: "#facc15",
          strokeWidth: 2,
          opacity: 0.35,
          rects: [{ x: 0.1, y: 0.1, w: 0.4, h: 0.05 }],
          points: [],
          createdAt: Date.now(),
        },
        {
          id: "ann-2",
          pageId: "vp-2",
          kind: "arrow",
          color: "#ef4444",
          strokeWidth: 3,
          opacity: 0.95,
          rects: [],
          points: [
            { x: 0.2, y: 0.2 },
            { x: 0.6, y: 0.5 },
          ],
          createdAt: Date.now(),
        },
      ],
    };

    const outBytes = await buildPdfFromVirtualPages(
      srcBytes,
      virtualPages,
      annotations,
      true
    );
    const outDoc = await PDFDocument.load(outBytes);
    expect(outDoc.getPageCount()).toBe(2);
    expect(outDoc.getPage(0).getRotation().angle).toBe(90);
    expect(outDoc.getPage(1).getRotation().angle).toBe(0);
  });

  it("merges multiple PDFs with per-file page specifications and rotations", async () => {
    const pdfA = uint8ArrayToBase64(await createSamplePdfBytes(4));
    const pdfB = uint8ArrayToBase64(await createSamplePdfBytes(6));

    const mergedBytes = await mergePdfQueue([
      {
        id: "m1",
        filePath: "A.pdf",
        fileName: "A.pdf",
        sizeBytes: 1000,
        totalPages: 4,
        pageSpec: "1, 3-4", // 3 pages
        addedRotation: 0,
        base64Data: pdfA,
      },
      {
        id: "m2",
        filePath: "B.pdf",
        fileName: "B.pdf",
        sizeBytes: 1000,
        totalPages: 6,
        pageSpec: "even", // 2, 4, 6 -> 3 pages
        addedRotation: 180,
        base64Data: pdfB,
      },
    ]);

    const mergedDoc = await PDFDocument.load(mergedBytes);
    expect(mergedDoc.getPageCount()).toBe(6);
    expect(mergedDoc.getPage(0).getRotation().angle).toBe(0);
    expect(mergedDoc.getPage(3).getRotation().angle).toBe(180);
  });
});
