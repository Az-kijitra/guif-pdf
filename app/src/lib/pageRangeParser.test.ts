import { describe, expect, it } from "vitest";
import {
  computeSplitByBreakpoints,
  computeSplitEveryN,
  formatPageSet,
  parsePageSpec,
  parseSplitRangeGroups,
} from "./pageRangeParser";

describe("pageRangeParser", () => {
  it("parses single pages and ranges", () => {
    const res = parsePageSpec("1-3, 5, 8-10", 15);
    expect(res.error).toBeNull();
    expect(res.pages).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });

  it("normalizes Japanese full-width input", () => {
    const res = parsePageSpec("１ー３、５，８〜end", 10);
    expect(res.error).toBeNull();
    expect(res.pages).toEqual([1, 2, 3, 5, 8, 9, 10]);
  });

  it("supports open-ended ranges and keywords (all, odd, even)", () => {
    expect(parsePageSpec("8-", 10).pages).toEqual([8, 9, 10]);
    expect(parsePageSpec("-3", 10).pages).toEqual([1, 2, 3]);
    expect(parsePageSpec("odd", 6).pages).toEqual([1, 3, 5]);
    expect(parsePageSpec("even", 6).pages).toEqual([2, 4, 6]);
    expect(parsePageSpec("all", 4).pages).toEqual([1, 2, 3, 4]);
  });

  it("supports exclusions (!p and !a-b)", () => {
    const res = parsePageSpec("1-10, !3, !6-8", 20);
    expect(res.error).toBeNull();
    expect(res.pages).toEqual([1, 2, 4, 5, 9, 10]);

    // Implicit all when starting with !
    const res2 = parsePageSpec("!1, !5", 5);
    expect(res2.error).toBeNull();
    expect(res2.pages).toEqual([2, 3, 4]);
  });

  it("preserves reverse range order in orderedPages", () => {
    const res = parsePageSpec("5, 3-1", 10);
    expect(res.error).toBeNull();
    expect(res.orderedPages).toEqual([5, 3, 2, 1]);
    expect(res.pages).toEqual([1, 2, 3, 5]);
  });

  it("returns error for out-of-bounds page numbers", () => {
    const res = parsePageSpec("1-5, 25", 20);
    expect(res.error).toContain("25");
  });

  it("formats page set into compact range string", () => {
    expect(formatPageSet([1, 2, 3, 5, 8, 9, 10])).toBe("1-3, 5, 8-10");
    expect(formatPageSet([])).toBe("");
  });

  it("computes split groups by breakpoints, range groups, and every N pages", () => {
    const bp = computeSplitByBreakpoints("3, 7", 10, "doc");
    expect(bp.error).toBeNull();
    expect(bp.groups.map((g) => g.label)).toEqual(["1-3", "4-7", "8-10"]);

    const rg = parseSplitRangeGroups("1-4; 5-end", 8, "doc");
    expect(rg.error).toBeNull();
    expect(rg.groups.map((g) => g.pages)).toEqual([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
    ]);

    const every = computeSplitEveryN(4, 10, "doc");
    expect(every.error).toBeNull();
    expect(every.groups.map((g) => g.label)).toEqual(["1-4", "5-8", "9-10"]);
  });
});
