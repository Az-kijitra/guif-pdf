import type { SplitGroupPreview } from "./types";

export interface ParsedPageSpec {
  /** Sorted unique 1-based page numbers */
  pages: number[];
  /** 1-based page numbers in the exact sequence specified (with exclusions applied) */
  orderedPages: number[];
  /** Human-readable validation error if invalid */
  error: string | null;
}

/**
 * Normalize Japanese full-width digits, hyphens, commas, and spaces so users can
 * type page specifications even when Japanese IME is active.
 */
export function normalizeSpecInput(raw: string): string {
  return raw
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[Ａ-Ｚａ-ｚ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[、，]/g, ",")
    .replace(/；/g, ";")
    .replace(/[ー−–—―〜～]/g, "-")
    .replace(/！/g, "!")
    .replace(/＾/g, "^")
    .replace(/　/g, " ")
    .trim();
}

function parseEndpoint(token: string, totalPages: number): number | null {
  const t = token.trim().toLowerCase();
  if (t === "end" || t === "last" || t === "末尾" || t === "最後" || t === "$") {
    return totalPages;
  }
  if (t === "start" || t === "first" || t === "先頭" || t === "最初") {
    return 1;
  }
  if (!/^\d+$/.test(t)) {
    return null;
  }
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n < 1 || n > totalPages) {
    return null;
  }
  return n;
}

function expandRangeToken(
  token: string,
  totalPages: number
): { pages: number[]; error: string | null } {
  const lower = token.trim().toLowerCase();
  if (!lower) {
    return { pages: [], error: null };
  }

  if (lower === "all" || lower === "*" || lower === "すべて" || lower === "全て" || lower === "全") {
    const pages: number[] = [];
    for (let i = 1; i <= totalPages; i++) pages.push(i);
    return { pages, error: null };
  }

  if (lower === "odd" || lower === "奇数") {
    const pages: number[] = [];
    for (let i = 1; i <= totalPages; i += 2) pages.push(i);
    return { pages, error: null };
  }

  if (lower === "even" || lower === "偶数") {
    const pages: number[] = [];
    for (let i = 2; i <= totalPages; i += 2) pages.push(i);
    return { pages, error: null };
  }

  if (lower.includes("-")) {
    const parts = lower.split("-");
    if (parts.length !== 2) {
      return { pages: [], error: `範囲指定「${token}」の書式が正しくありません（例: 1-5, 10-end）` };
    }
    const rawStart = parts[0].trim();
    const rawEnd = parts[1].trim();
    if (!rawStart && !rawEnd) {
      return { pages: [], error: `範囲指定「${token}」にページ番号がありません` };
    }

    const start = rawStart === "" ? 1 : parseEndpoint(rawStart, totalPages);
    const end = rawEnd === "" ? totalPages : parseEndpoint(rawEnd, totalPages);

    if (start === null) {
      const num = Number.parseInt(rawStart, 10);
      if (!Number.isNaN(num) && (num < 1 || num > totalPages)) {
        return {
          pages: [],
          error: `ページ番号 ${rawStart} は範囲外です（1〜${totalPages}）`,
        };
      }
      return { pages: [], error: `開始ページ「${rawStart}」を解釈できません` };
    }

    if (end === null) {
      const num = Number.parseInt(rawEnd, 10);
      if (!Number.isNaN(num) && (num < 1 || num > totalPages)) {
        return {
          pages: [],
          error: `ページ番号 ${rawEnd} は範囲外です（1〜${totalPages}）`,
        };
      }
      return { pages: [], error: `終了ページ「${rawEnd}」を解釈できません` };
    }

    const pages: number[] = [];
    if (start <= end) {
      for (let i = start; i <= end; i++) pages.push(i);
    } else {
      for (let i = start; i >= end; i--) pages.push(i);
    }
    return { pages, error: null };
  }

  // Single page number
  if (/^\d+$/.test(lower)) {
    const n = Number.parseInt(lower, 10);
    if (n < 1 || n > totalPages) {
      return {
        pages: [],
        error: `ページ番号 ${n} は範囲外です（1〜${totalPages}）`,
      };
    }
    return { pages: [n], error: null };
  }

  const ep = parseEndpoint(lower, totalPages);
  if (ep !== null) {
    return { pages: [ep], error: null };
  }

  return {
    pages: [],
    error: `指定「${token}」を解釈できません（例: 1-5, 8, 12-end, odd, even, !3）`,
  };
}

/**
 * Parse a rich page specification string into 1-based page numbers.
 * Examples:
 * - "1-5, 8, 11-15"
 * - "10-" or "10-end" (page 10 to last page)
 * - "odd" / "even" / "all"
 * - "1-20, !5, !10-12" (pages 1..20 except 5 and 10..12)
 * - "!1" (if starting with exclusion, implicitly starts from all pages and excludes page 1)
 */
export function parsePageSpec(rawSpec: string, totalPages: number): ParsedPageSpec {
  if (totalPages <= 0) {
    return { pages: [], orderedPages: [], error: null };
  }

  const normalized = normalizeSpecInput(rawSpec);
  if (!normalized) {
    return { pages: [], orderedPages: [], error: null };
  }

  const tokens = normalized
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  if (tokens.length === 0) {
    return { pages: [], orderedPages: [], error: null };
  }

  const orderedList: number[] = [];
  const excludedSet = new Set<number>();
  let hasInclusionToken = false;

  for (let idx = 0; idx < tokens.length; idx++) {
    const token = tokens[idx];
    const isExclusion = token.startsWith("!") || token.startsWith("^");
    const body = isExclusion ? token.slice(1).trim() : token;

    if (!body) {
      return {
        pages: [],
        orderedPages: [],
        error: `除外指定「${token}」の対象ページが指定されていません`,
      };
    }

    const expanded = expandRangeToken(body, totalPages);
    if (expanded.error) {
      return { pages: [], orderedPages: [], error: expanded.error };
    }

    if (isExclusion) {
      // If the very first token is an exclusion (e.g. "!1"), implicitly populate all pages first
      if (idx === 0 && !hasInclusionToken) {
        hasInclusionToken = true;
        for (let i = 1; i <= totalPages; i++) {
          orderedList.push(i);
        }
      }
      for (const p of expanded.pages) {
        excludedSet.add(p);
      }
    } else {
      hasInclusionToken = true;
      for (const p of expanded.pages) {
        excludedSet.delete(p);
        orderedList.push(p);
      }
    }
  }

  const filteredOrdered = orderedList.filter((p) => !excludedSet.has(p));
  const uniqueSorted = Array.from(new Set(filteredOrdered)).sort((a, b) => a - b);

  return {
    pages: uniqueSorted,
    orderedPages: filteredOrdered,
    error: null,
  };
}

/**
 * Compress a collection of 1-based page numbers into a canonical range string,
 * e.g. [1, 2, 3, 5, 8, 9, 10] -> "1-3, 5, 8-10"
 */
export function formatPageSet(pages: Iterable<number>): string {
  const sorted = Array.from(new Set(pages))
    .filter((n) => Number.isInteger(n) && n >= 1)
    .sort((a, b) => a - b);

  if (sorted.length === 0) return "";

  const parts: string[] = [];
  let rangeStart = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i];
    if (cur === prev + 1) {
      prev = cur;
    } else {
      parts.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);
      rangeStart = cur;
      prev = cur;
    }
  }
  parts.push(rangeStart === prev ? `${rangeStart}` : `${rangeStart}-${prev}`);

  return parts.join(", ");
}

function makeSplitFileName(baseStem: string, partIndex: number, pages: number[]): string {
  const numStr = String(partIndex).padStart(2, "0");
  if (pages.length === 0) {
    return `${baseStem}_part${numStr}.pdf`;
  }
  const first = pages[0];
  const last = pages[pages.length - 1];
  const rangeLabel = pages.length === 1 ? `p${first}` : `p${first}-${last}`;
  return `${baseStem}_part${numStr}_${rangeLabel}.pdf`;
}

/**
 * Split Mode 1: Semicolon or newline separated range groups, e.g. "1-5; 6-10; 11-end"
 */
export function parseSplitRangeGroups(
  rawGroupsSpec: string,
  totalPages: number,
  baseStem: string
): { groups: SplitGroupPreview[]; error: string | null } {
  const normalized = normalizeSpecInput(rawGroupsSpec);
  const segments = normalized
    .split(/[;\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (segments.length === 0) {
    return {
      groups: [],
      error: "分割するページ範囲を入力してください（例: 1-5; 6-10; 11-end）",
    };
  }

  const groups: SplitGroupPreview[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const parsed = parsePageSpec(seg, totalPages);
    if (parsed.error) {
      return { groups: [], error: `パート ${i + 1} (${seg}): ${parsed.error}` };
    }
    if (parsed.orderedPages.length === 0) {
      return { groups: [], error: `パート ${i + 1} (${seg}) に該当するページがありません` };
    }
    const partIndex = i + 1;
    groups.push({
      index: partIndex,
      label: formatPageSet(parsed.pages),
      pages: parsed.orderedPages,
      suggestedFileName: makeSplitFileName(baseStem, partIndex, parsed.orderedPages),
    });
  }

  return { groups, error: null };
}

/**
 * Split Mode 2: Split after specific page numbers (breakpoints), e.g. "5, 12, 20"
 * Splits a 25-page PDF into: 1-5, 6-12, 13-20, 21-25.
 */
export function computeSplitByBreakpoints(
  breakpointsSpec: string,
  totalPages: number,
  baseStem: string
): { groups: SplitGroupPreview[]; error: string | null } {
  if (totalPages <= 1) {
    return { groups: [], error: "分割には2ページ以上のPDFが必要です。" };
  }

  const parsed = parsePageSpec(breakpointsSpec, totalPages);
  if (parsed.error) {
    return { groups: [], error: parsed.error };
  }

  // Filter valid split-after points (1 .. totalPages - 1)
  const splitAfterPoints = parsed.pages.filter((p) => p >= 1 && p < totalPages);
  if (splitAfterPoints.length === 0) {
    return {
      groups: [],
      error: `分割位置として 1〜${totalPages - 1} のページ番号を指定してください（指定ページの直後で分割されます）`,
    };
  }

  const groups: SplitGroupPreview[] = [];
  let startPage = 1;
  let partIndex = 1;

  for (const bp of splitAfterPoints) {
    const pages: number[] = [];
    for (let p = startPage; p <= bp; p++) pages.push(p);
    groups.push({
      index: partIndex,
      label: formatPageSet(pages),
      pages,
      suggestedFileName: makeSplitFileName(baseStem, partIndex, pages),
    });
    startPage = bp + 1;
    partIndex++;
  }

  if (startPage <= totalPages) {
    const pages: number[] = [];
    for (let p = startPage; p <= totalPages; p++) pages.push(p);
    groups.push({
      index: partIndex,
      label: formatPageSet(pages),
      pages,
      suggestedFileName: makeSplitFileName(baseStem, partIndex, pages),
    });
  }

  return { groups, error: null };
}

/**
 * Split Mode 3: Split every N pages evenly
 */
export function computeSplitEveryN(
  chunkSize: number,
  totalPages: number,
  baseStem: string
): { groups: SplitGroupPreview[]; error: string | null } {
  if (!Number.isInteger(chunkSize) || chunkSize < 1) {
    return { groups: [], error: "1以上のページ数を指定してください。" };
  }
  if (totalPages <= 0) {
    return { groups: [], error: "PDFが読み込まれていません。" };
  }

  const groups: SplitGroupPreview[] = [];
  let partIndex = 1;
  for (let start = 1; start <= totalPages; start += chunkSize) {
    const end = Math.min(totalPages, start + chunkSize - 1);
    const pages: number[] = [];
    for (let p = start; p <= end; p++) pages.push(p);
    groups.push({
      index: partIndex,
      label: formatPageSet(pages),
      pages,
      suggestedFileName: makeSplitFileName(baseStem, partIndex, pages),
    });
    partIndex++;
  }

  return { groups, error: null };
}
