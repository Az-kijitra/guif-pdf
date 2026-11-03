import type { NormalizedPoint, NormalizedRect, PdfAnnotation } from "./types";

function normalizeQuarterTurn(delta: number): 0 | 90 | 180 | 270 {
  const d = ((delta % 360) + 360) % 360;
  return d === 90 || d === 180 || d === 270 ? d : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function rotateNormalizedPoint(p: NormalizedPoint, delta: number): NormalizedPoint {
  switch (normalizeQuarterTurn(delta)) {
    case 90:
      return { x: 1 - p.y, y: p.x };
    case 180:
      return { x: 1 - p.x, y: 1 - p.y };
    case 270:
      return { x: p.y, y: 1 - p.x };
    default:
      return { ...p };
  }
}

export function rotateNormalizedRect(r: NormalizedRect, delta: number): NormalizedRect {
  switch (normalizeQuarterTurn(delta)) {
    case 90:
      return { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w };
    case 180:
      return { x: 1 - r.x - r.w, y: 1 - r.y - r.h, w: r.w, h: r.h };
    case 270:
      return { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w };
    default:
      return { ...r };
  }
}

/**
 * Text and sticky cards stay upright on screen, so only their center follows the page;
 * the card keeps its size in points (the normalized size changes when the page's width and height swap).
 */
function rotateUprightCard(
  r: NormalizedRect,
  delta: number,
  displayW: number,
  displayH: number
): NormalizedRect {
  const center = rotateNormalizedPoint({ x: r.x + r.w / 2, y: r.y + r.h / 2 }, delta);
  const swapped = normalizeQuarterTurn(delta) % 180 !== 0;
  const newW = swapped ? displayH : displayW;
  const newH = swapped ? displayW : displayH;
  const w = Math.min(1, (r.w * displayW) / newW);
  const h = Math.min(1, (r.h * displayH) / newH);
  return {
    x: clamp(center.x - w / 2, 0, 1 - w),
    y: clamp(center.y - h / 2, 0, 1 - h),
    w,
    h,
  };
}

/**
 * Annotations are stored in normalized display coordinates, so turning a page must move them
 * too or they would drift away from the content they mark.
 * `displayW` / `displayH` are the page's displayed size before the turn.
 */
export function rotateAnnotationWithPage(
  ann: PdfAnnotation,
  delta: number,
  displayW: number,
  displayH: number
): PdfAnnotation {
  const upright = ann.kind === "text" || ann.kind === "sticky";
  return {
    ...ann,
    rects: ann.rects.map((r) =>
      upright ? rotateUprightCard(r, delta, displayW, displayH) : rotateNormalizedRect(r, delta)
    ),
    points: ann.points.map((p) => rotateNormalizedPoint(p, delta)),
  };
}
