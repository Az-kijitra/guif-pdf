export type ToolMode =
  | "select" // テキスト選択・注釈選択移動
  | "highlight" // ハイライト（テキスト選択＆矩形ドラッグ両対応）
  | "text" // テキスト直接書き込み（日本語対応）
  | "sticky" // 付箋メモ（コメントポップアップ付き）
  | "rect" // 四角枠
  | "line" // 直線
  | "arrow" // 矢印
  | "pen"; // 手書きペン（フリーハンド）

export type ViewLayoutMode = "continuous" | "single" | "grid";

export type SidebarTab = "pages" | "annotations" | "outline" | "folder";

export interface NormalizedRect {
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
}

export interface NormalizedPoint {
  x: number; // 0..1
  y: number; // 0..1
}

export interface PdfAnnotation {
  id: string;
  pageId: string;
  kind: "highlight" | "text" | "sticky" | "rect" | "line" | "arrow" | "pen";
  color: string; // Hex e.g. "#facc15"
  strokeWidth: number; // px at 100% scale (e.g. 2, 3, 4)
  opacity: number; // 0..1
  // Highlight (1 or multiple rects for multi-line text selection) or Rect/Text/Sticky bounding box
  rects: NormalizedRect[];
  // For line, arrow, pen
  points: NormalizedPoint[];
  // For text & sticky note
  text?: string;
  fontSize?: number; // pt at 100% scale (e.g. 14, 18, 24)
  bgFill?: boolean; // Whether text box has opaque background
  createdAt: number;
}

export interface VirtualPage {
  id: string;
  /** 0-based index in the currently loaded source PDF */
  sourcePageIndex: number;
  /** Original 1-based page number when file was opened */
  originalPageNumber: number;
  /** Intrinsic rotation in source PDF (0, 90, 180, 270) */
  baseRotation: number;
  /** User-added rotation delta (0, 90, 180, 270) */
  addedRotation: number;
  /** Unrotated width in PDF points */
  widthPt: number;
  /** Unrotated height in PDF points */
  heightPt: number;
}

export interface OutlineItem {
  title: string;
  pageNumber: number | null;
  children: OutlineItem[];
}

export interface LaunchTarget {
  initial_file: string | null;
  initial_dir: string;
}

export interface FolderEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size_bytes: number;
  modified: string;
}

export interface FolderListing {
  current_dir: string;
  parent_dir: string | null;
  entries: FolderEntry[];
  error: string | null;
}

export interface PdfFilePayload {
  file_path: string;
  file_name: string;
  dir_path: string;
  size_bytes: number;
  base64_data: string;
}

export interface SaveResult {
  saved_path: string;
  size_bytes: number;
}

export interface BatchPdfOutput {
  path: string;
  base64_data: string;
}

export interface PdfResumeInfo {
  page: number;
  zoom: number;
}

export interface MergeQueueItem {
  id: string;
  filePath: string;
  fileName: string;
  sizeBytes: number;
  totalPages: number;
  /** Page range expression e.g. "all" or "1-5, 8" */
  pageSpec: string;
  /** Additional rotation applied to pages from this file (0, 90, 180, 270) */
  addedRotation: number;
  base64Data: string;
}

export interface SplitGroupPreview {
  index: number;
  label: string;
  pages: number[]; // 1-based display page numbers
  suggestedFileName: string;
}
