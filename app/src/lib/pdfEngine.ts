import { degrees, LineCapStyle, PDFDocument, rgb } from "pdf-lib";
import { base64ToUint8Array, uint8ArrayToBase64 } from "./api";
import { parsePageSpec } from "./pageRangeParser";
import type {
  MergeQueueItem,
  NormalizedRect,
  PdfAnnotation,
  SplitGroupPreview,
  VirtualPage,
} from "./types";

export function hexToRgbColor(hex: string) {
  const clean = hex.replace("#", "").trim();
  if (clean.length === 3) {
    const r = Number.parseInt(clean[0] + clean[0], 16) / 255;
    const g = Number.parseInt(clean[1] + clean[1], 16) / 255;
    const b = Number.parseInt(clean[2] + clean[2], 16) / 255;
    return rgb(r || 0, g || 0, b || 0);
  }
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  return rgb(
    Number.isFinite(r) ? r : 1,
    Number.isFinite(g) ? g : 0.85,
    Number.isFinite(b) ? b : 0
  );
}

/**
 * Convert normalized display coordinates (0..1, top-left origin in rotated view)
 * to unrotated PDF page coordinates (bottom-left origin in points).
 */
export function displayNormToPdfPoint(
  nx: number,
  ny: number,
  unrotatedW: number,
  unrotatedH: number,
  totalRotation: number
): { x: number; y: number } {
  const rot = ((totalRotation % 360) + 360) % 360;
  switch (rot) {
    case 90:
      return {
        x: ny * unrotatedW,
        y: nx * unrotatedH,
      };
    case 180:
      return {
        x: (1 - nx) * unrotatedW,
        y: ny * unrotatedH,
      };
    case 270:
      return {
        x: (1 - ny) * unrotatedW,
        y: (1 - nx) * unrotatedH,
      };
    case 0:
    default:
      return {
        x: nx * unrotatedW,
        y: (1 - ny) * unrotatedH,
      };
  }
}

export function displayRectToPdfBox(
  rect: NormalizedRect,
  unrotatedW: number,
  unrotatedH: number,
  totalRotation: number
): { x: number; y: number; width: number; height: number } {
  const p1 = displayNormToPdfPoint(
    rect.x,
    rect.y,
    unrotatedW,
    unrotatedH,
    totalRotation
  );
  const p2 = displayNormToPdfPoint(
    rect.x + rect.w,
    rect.y + rect.h,
    unrotatedW,
    unrotatedH,
    totalRotation
  );
  return {
    x: Math.min(p1.x, p2.x),
    y: Math.min(p1.y, p2.y),
    width: Math.max(1, Math.abs(p2.x - p1.x)),
    height: Math.max(1, Math.abs(p2.y - p1.y)),
  };
}

/**
 * Render a Japanese-capable text annotation or sticky note onto a high-DPI offscreen canvas
 * and return PNG Uint8Array for embedding into pdf-lib.
 */
async function renderTextOrStickyToPngBytes(
  ann: PdfAnnotation,
  displayWidthPt: number,
  displayHeightPt: number,
  totalRotation: number
): Promise<{ pngBytes: Uint8Array; rectNorm: NormalizedRect } | null> {
  if (typeof document === "undefined") {
    return null;
  }

  const baseRect = ann.rects[0] ?? { x: 0.1, y: 0.1, w: 0.25, h: 0.08 };
  const textContent = (ann.text ?? "").trim();
  if (!textContent) return null;

  const dpiScale = 3; // 3x supersampling for crisp CJK typography
  const fontSizePt = ann.fontSize ?? (ann.kind === "sticky" ? 12 : 15);
  const lines = textContent.split(/\r?\n/);
  const lineHeightPt = fontSizePt * 1.38;
  const padX = ann.kind === "sticky" ? 10 : 6;
  const padY = ann.kind === "sticky" ? 10 : 5;
  const headerHeightPt = ann.kind === "sticky" ? 18 : 0;

  // Measure required width/height in points using offscreen 2D context
  const measureCanvas = document.createElement("canvas");
  const mCtx = measureCanvas.getContext("2d");
  if (!mCtx) return null;

  const fontSpec = `${ann.kind === "sticky" ? "500" : "600"} ${fontSizePt}px "BIZ UDGothic", "Yu Gothic UI", "Meiryo", sans-serif`;
  mCtx.font = fontSpec;

  let maxLineWidthPt = 60;
  for (const line of lines) {
    const w = mCtx.measureText(line).width;
    if (w > maxLineWidthPt) maxLineWidthPt = w;
  }

  const boxWidthPt = Math.max(
    baseRect.w * displayWidthPt,
    maxLineWidthPt + padX * 2 + 4
  );
  const boxHeightPt = Math.max(
    baseRect.h * displayHeightPt,
    headerHeightPt + lines.length * lineHeightPt + padY * 2
  );

  const normW = Math.min(1 - baseRect.x, boxWidthPt / displayWidthPt);
  const normH = Math.min(1 - baseRect.y, boxHeightPt / displayHeightPt);
  const finalNormRect: NormalizedRect = {
    x: baseRect.x,
    y: baseRect.y,
    w: Math.max(0.02, normW),
    h: Math.max(0.02, normH),
  };

  // Draw unrotated card first
  const cardCanvas = document.createElement("canvas");
  cardCanvas.width = Math.max(12, Math.round(boxWidthPt * dpiScale));
  cardCanvas.height = Math.max(12, Math.round(boxHeightPt * dpiScale));
  const ctx = cardCanvas.getContext("2d");
  if (!ctx) return null;

  ctx.scale(dpiScale, dpiScale);

  if (ann.kind === "sticky") {
    // Sticky note card style
    ctx.fillStyle = "rgba(254, 249, 195, 0.96)";
    ctx.strokeStyle = ann.color || "#eab308";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(1, 1, boxWidthPt - 2, boxHeightPt - 2, 5);
    ctx.fill();
    ctx.stroke();

    // Header bar
    ctx.fillStyle = ann.color || "#eab308";
    ctx.fillRect(1, 1, boxWidthPt - 2, headerHeightPt);

    ctx.fillStyle = "#1f2937";
    ctx.font = `bold 10px "BIZ UDGothic", "Yu Gothic UI", sans-serif`;
    ctx.textBaseline = "middle";
    ctx.fillText("NOTE / メモ", padX, headerHeightPt / 2 + 1);

    // Body text
    ctx.fillStyle = "#111827";
    ctx.font = fontSpec;
    ctx.textBaseline = "top";
    lines.forEach((line, idx) => {
      ctx.fillText(line, padX, headerHeightPt + padY + idx * lineHeightPt);
    });
  } else {
    // Direct text box annotation
    if (ann.bgFill) {
      ctx.fillStyle = "rgba(255, 255, 255, 0.90)";
      ctx.strokeStyle = ann.color || "#2563eb";
      ctx.lineWidth = 1.2;
      ctx.fillRect(0.5, 0.5, boxWidthPt - 1, boxHeightPt - 1);
      ctx.strokeRect(0.5, 0.5, boxWidthPt - 1, boxHeightPt - 1);
    }
    ctx.fillStyle = ann.color || "#dc2626";
    ctx.font = fontSpec;
    ctx.textBaseline = "top";
    lines.forEach((line, idx) => {
      ctx.fillText(line, padX, padY + idx * lineHeightPt);
    });
  }

  // If the page is rotated (90, 180, 270), counter-rotate the bitmap so when placed in
  // the unrotated PDF page coordinate system it reads upright in the viewer.
  const rot = ((totalRotation % 360) + 360) % 360;
  let outputCanvas = cardCanvas;

  if (rot !== 0) {
    const rotCanvas = document.createElement("canvas");
    if (rot === 90 || rot === 270) {
      rotCanvas.width = cardCanvas.height;
      rotCanvas.height = cardCanvas.width;
    } else {
      rotCanvas.width = cardCanvas.width;
      rotCanvas.height = cardCanvas.height;
    }
    const rCtx = rotCanvas.getContext("2d");
    if (rCtx) {
      rCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
      // PDF page rotation is clockwise, so counter-rotate by -rot in canvas Y-down space
      rCtx.rotate(((-rot * Math.PI) / 180));
      rCtx.drawImage(
        cardCanvas,
        -cardCanvas.width / 2,
        -cardCanvas.height / 2
      );
      outputCanvas = rotCanvas;
    }
  }

  const dataUrl = outputCanvas.toDataURL("image/png");
  const base64Part = dataUrl.split(",")[1] ?? "";
  if (!base64Part) return null;

  return {
    pngBytes: base64ToUint8Array(base64Part),
    rectNorm: finalNormRect,
  };
}

/**
 * Draw all annotations belonging to a given VirtualPage onto a target pdf-lib PDFPage.
 */
async function bakePageAnnotations(
  pdfDoc: PDFDocument,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdfPage: any,
  vPage: VirtualPage,
  pageAnnotations: PdfAnnotation[]
): Promise<void> {
  if (!pageAnnotations || pageAnnotations.length === 0) return;

  const { width: unrotatedW, height: unrotatedH } = pdfPage.getSize();
  const totalRotation = ((vPage.baseRotation + vPage.addedRotation) % 360 + 360) % 360;
  const isSwapped = totalRotation === 90 || totalRotation === 270;
  const displayW = isSwapped ? unrotatedH : unrotatedW;
  const displayH = isSwapped ? unrotatedW : unrotatedH;

  for (const ann of pageAnnotations) {
    const color = hexToRgbColor(ann.color);

    if (ann.kind === "highlight") {
      for (const r of ann.rects) {
        const box = displayRectToPdfBox(r, unrotatedW, unrotatedH, totalRotation);
        pdfPage.drawRectangle({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          color,
          opacity: ann.opacity ?? 0.36,
        });
      }
    } else if (ann.kind === "rect") {
      for (const r of ann.rects) {
        const box = displayRectToPdfBox(r, unrotatedW, unrotatedH, totalRotation);
        pdfPage.drawRectangle({
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          borderColor: color,
          borderWidth: ann.strokeWidth || 2,
          borderOpacity: ann.opacity ?? 0.95,
        });
      }
    } else if (ann.kind === "line" || ann.kind === "arrow") {
      if (ann.points.length >= 2) {
        const start = displayNormToPdfPoint(
          ann.points[0].x,
          ann.points[0].y,
          unrotatedW,
          unrotatedH,
          totalRotation
        );
        const end = displayNormToPdfPoint(
          ann.points[ann.points.length - 1].x,
          ann.points[ann.points.length - 1].y,
          unrotatedW,
          unrotatedH,
          totalRotation
        );
        const thickness = ann.strokeWidth || 2.5;
        pdfPage.drawLine({
          start,
          end,
          thickness,
          color,
          opacity: ann.opacity ?? 0.95,
          lineCap: LineCapStyle.Round,
        });

        if (ann.kind === "arrow") {
          const angle = Math.atan2(end.y - start.y, end.x - start.x);
          const headLen = Math.max(9, thickness * 4);
          const wingAngle = Math.PI / 6;
          const wing1 = {
            x: end.x - headLen * Math.cos(angle - wingAngle),
            y: end.y - headLen * Math.sin(angle - wingAngle),
          };
          const wing2 = {
            x: end.x - headLen * Math.cos(angle + wingAngle),
            y: end.y - headLen * Math.sin(angle + wingAngle),
          };
          pdfPage.drawLine({
            start: end,
            end: wing1,
            thickness,
            color,
            opacity: ann.opacity ?? 0.95,
            lineCap: LineCapStyle.Round,
          });
          pdfPage.drawLine({
            start: end,
            end: wing2,
            thickness,
            color,
            opacity: ann.opacity ?? 0.95,
            lineCap: LineCapStyle.Round,
          });
        }
      }
    } else if (ann.kind === "pen") {
      if (ann.points.length >= 2) {
        const thickness = ann.strokeWidth || 2.5;
        for (let i = 0; i < ann.points.length - 1; i++) {
          const pA = displayNormToPdfPoint(
            ann.points[i].x,
            ann.points[i].y,
            unrotatedW,
            unrotatedH,
            totalRotation
          );
          const pB = displayNormToPdfPoint(
            ann.points[i + 1].x,
            ann.points[i + 1].y,
            unrotatedW,
            unrotatedH,
            totalRotation
          );
          pdfPage.drawLine({
            start: pA,
            end: pB,
            thickness,
            color,
            opacity: ann.opacity ?? 0.95,
            lineCap: LineCapStyle.Round,
          });
        }
      }
    } else if (ann.kind === "text" || ann.kind === "sticky") {
      const rendered = await renderTextOrStickyToPngBytes(
        ann,
        displayW,
        displayH,
        totalRotation
      );
      if (rendered) {
        const pngImage = await pdfDoc.embedPng(rendered.pngBytes);
        const box = displayRectToPdfBox(
          rendered.rectNorm,
          unrotatedW,
          unrotatedH,
          totalRotation
        );
        pdfPage.drawImage(pngImage, {
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
        });
      }
    }
  }
}

/**
 * Build a PDF document from the current VirtualPage list (or a subset of 1-based display page numbers),
 * applying page deletions, rotations, and baking annotations.
 */
export async function buildPdfFromVirtualPages(
  sourcePdfBytes: Uint8Array,
  virtualPages: VirtualPage[],
  annotationsByPageId: Record<string, PdfAnnotation[]>,
  includeAnnotations = true
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(sourcePdfBytes, {
    ignoreEncryption: true,
  });
  const outDoc = await PDFDocument.create();

  if (virtualPages.length === 0) {
    throw new Error("出力対象のページが1ページもありません。");
  }

  const indicesToCopy = virtualPages.map((vp) => vp.sourcePageIndex);
  const copiedPages = await outDoc.copyPages(srcDoc, indicesToCopy);

  for (let i = 0; i < copiedPages.length; i++) {
    const page = copiedPages[i];
    const vp = virtualPages[i];
    const totalRot = ((vp.baseRotation + vp.addedRotation) % 360 + 360) % 360;
    page.setRotation(degrees(totalRot));
    outDoc.addPage(page);

    if (includeAnnotations) {
      const anns = annotationsByPageId[vp.id] ?? [];
      if (anns.length > 0) {
        await bakePageAnnotations(outDoc, page, vp, anns);
      }
    }
  }

  return outDoc.save();
}

/**
 * Split the current working PDF into multiple PDF byte arrays according to SplitGroupPreview[].
 */
export async function buildSplitPdfFiles(
  sourcePdfBytes: Uint8Array,
  allVirtualPages: VirtualPage[],
  annotationsByPageId: Record<string, PdfAnnotation[]>,
  groups: SplitGroupPreview[],
  outputDir: string,
  includeAnnotations = true
): Promise<Array<{ path: string; base64_data: string }>> {
  const results: Array<{ path: string; base64_data: string }> = [];
  const cleanDir = outputDir.replace(/[\\/]+$/, "");
  const sep = cleanDir.includes("/") ? "/" : "\\";

  for (const group of groups) {
    const selectedVirtualPages: VirtualPage[] = [];
    for (const pNum of group.pages) {
      const vp = allVirtualPages[pNum - 1];
      if (vp) selectedVirtualPages.push(vp);
    }
    if (selectedVirtualPages.length === 0) continue;

    const pdfBytes = await buildPdfFromVirtualPages(
      sourcePdfBytes,
      selectedVirtualPages,
      annotationsByPageId,
      includeAnnotations
    );
    results.push({
      path: `${cleanDir}${sep}${group.suggestedFileName}`,
      base64_data: uint8ArrayToBase64(pdfBytes),
    });
  }

  return results;
}

/**
 * Merge multiple PDF files with per-file page range specification and per-file rotation.
 */
export async function mergePdfQueue(items: MergeQueueItem[]): Promise<Uint8Array> {
  if (items.length === 0) {
    throw new Error("結合するPDFファイルを追加してください。");
  }

  const outDoc = await PDFDocument.create();
  let totalAddedPages = 0;

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    const bytes = base64ToUint8Array(item.base64Data);
    const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pageCount = srcDoc.getPageCount();

    const specStr = item.pageSpec.trim() || "all";
    const parsed = parsePageSpec(specStr, pageCount);
    if (parsed.error) {
      throw new Error(`「${item.fileName}」のページ指定エラー: ${parsed.error}`);
    }
    if (parsed.orderedPages.length === 0) {
      throw new Error(`「${item.fileName}」から結合するページが選択されていません。`);
    }

    const zeroBasedIndices = parsed.orderedPages.map((p) => p - 1);
    const copied = await outDoc.copyPages(srcDoc, zeroBasedIndices);

    for (const page of copied) {
      if (item.addedRotation !== 0) {
        const currentRot = page.getRotation().angle;
        const newRot = ((currentRot + item.addedRotation) % 360 + 360) % 360;
        page.setRotation(degrees(newRot));
      }
      outDoc.addPage(page);
      totalAddedPages++;
    }
  }

  if (totalAddedPages === 0) {
    throw new Error("結合結果のページ数が0ページです。");
  }

  return outDoc.save();
}

/**
 * Inspect page count of a base64-encoded PDF using pdf-lib.
 */
export async function getPdfPageCountFromBase64(base64Data: string): Promise<number> {
  const bytes = base64ToUint8Array(base64Data);
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return doc.getPageCount();
}
