import { describe, expect, it } from "vitest";
import {
  rotateAnnotationWithPage,
  rotateNormalizedPoint,
  rotateNormalizedRect,
} from "./annotationRotation";
import { displayNormToPdfPoint } from "./pdfEngine";
import type { PdfAnnotation } from "./types";

const W = 600;
const H = 800;

function annotation(patch: Partial<PdfAnnotation>): PdfAnnotation {
  return {
    id: "a",
    pageId: "p",
    kind: "rect",
    color: "#000000",
    strokeWidth: 2,
    opacity: 1,
    rects: [],
    points: [],
    createdAt: 0,
    ...patch,
  };
}

describe("rotateNormalizedPoint", () => {
  // The point must keep marking the same spot of the page content after the turn.
  it.each([
    [0, 90],
    [90, 180],
    [180, 270],
    [270, 360],
    [90, 0],
    [0, -90],
    [180, 360],
  ])("stays on the same PDF coordinate when the page turns from %i to %i", (from, to) => {
    const delta = to - from;
    const before = { x: 0.2, y: 0.7 };
    const after = rotateNormalizedPoint(before, delta);
    const a = displayNormToPdfPoint(before.x, before.y, W, H, from);
    const b = displayNormToPdfPoint(after.x, after.y, W, H, to);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
  });

  it("four quarter turns are the identity", () => {
    let p = { x: 0.3, y: 0.9 };
    for (let i = 0; i < 4; i++) p = rotateNormalizedPoint(p, 90);
    expect(p.x).toBeCloseTo(0.3);
    expect(p.y).toBeCloseTo(0.9);
  });
});

describe("rotateNormalizedRect", () => {
  it.each([90, 180, 270, -90])("covers the same corners after a turn of %i", (delta) => {
    const r = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    const turned = rotateNormalizedRect(r, delta);
    const expected = [
      rotateNormalizedPoint({ x: r.x, y: r.y }, delta),
      rotateNormalizedPoint({ x: r.x + r.w, y: r.y + r.h }, delta),
    ];
    expect(turned.x).toBeCloseTo(Math.min(expected[0].x, expected[1].x));
    expect(turned.y).toBeCloseTo(Math.min(expected[0].y, expected[1].y));
    expect(turned.x + turned.w).toBeCloseTo(Math.max(expected[0].x, expected[1].x));
    expect(turned.y + turned.h).toBeCloseTo(Math.max(expected[0].y, expected[1].y));
  });
});

describe("rotateAnnotationWithPage", () => {
  it("turns the rectangles of a highlight and the points of a line", () => {
    const highlight = annotation({ kind: "highlight", rects: [{ x: 0.1, y: 0.2, w: 0.3, h: 0.1 }] });
    expect(rotateAnnotationWithPage(highlight, 90, W, H).rects[0]).toEqual(
      rotateNormalizedRect(highlight.rects[0], 90)
    );
    const line = annotation({ kind: "line", points: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }] });
    expect(rotateAnnotationWithPage(line, 90, W, H).points).toEqual(
      line.points.map((p) => rotateNormalizedPoint(p, 90))
    );
  });

  it("keeps a text card upright: same size in points, center follows the page", () => {
    const rect = { x: 0.2, y: 0.3, w: 0.25, h: 0.1 };
    const text = annotation({ kind: "text", rects: [rect], text: "メモ" });
    const turned = rotateAnnotationWithPage(text, 90, W, H).rects[0];

    // After a quarter turn the page displays as 800 x 600.
    expect(turned.w * H).toBeCloseTo(rect.w * W);
    expect(turned.h * W).toBeCloseTo(rect.h * H);
    const center = rotateNormalizedPoint({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, 90);
    expect(turned.x + turned.w / 2).toBeCloseTo(center.x);
    expect(turned.y + turned.h / 2).toBeCloseTo(center.y);
  });

  it("keeps a card near the edge on the page", () => {
    const sticky = annotation({ kind: "sticky", rects: [{ x: 0.76, y: 0, w: 0.24, h: 0.1 }], text: "x" });
    const r = rotateAnnotationWithPage(sticky, 270, W, H).rects[0];
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  });

  it("does not modify the original", () => {
    const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
    const original = annotation({ rects: [rect] });
    rotateAnnotationWithPage(original, 90, W, H);
    expect(original.rects[0]).toBe(rect);
    expect(rect.x).toBe(0.1);
  });
});
