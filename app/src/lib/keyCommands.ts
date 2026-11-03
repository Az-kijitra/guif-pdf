export type KeyCommand =
  | "block-reload"
  | "toggle-page-bar"
  | "toggle-annotation-bar"
  | "save-as"
  | "save-overwrite"
  | "toggle-search"
  | "toggle-sidebar"
  | "undo"
  | "redo"
  | "delete-annotation"
  | "next-page"
  | "prev-page"
  | "first-page"
  | "last-page"
  | "toggle-page-select"
  | "rotate-right"
  | "rotate-left"
  | "tool-select"
  | "tool-highlight"
  | "tool-text"
  | "tool-sticky"
  | "tool-rect"
  | "tool-arrow"
  | "tool-line"
  | "tool-pen"
  | "fit-width"
  | "fit-page"
  | "toggle-help"
  | "close-modal"
  | "escape";

export interface KeyInput {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface KeyContext {
  inputFocused: boolean;
  /** A dialog is open: the page behind it must not react to keys. */
  modalOpen: boolean;
}

const PLAIN_KEYS: Record<string, KeyCommand> = {
  j: "next-page",
  J: "next-page",
  PageDown: "next-page",
  k: "prev-page",
  K: "prev-page",
  PageUp: "prev-page",
  Home: "first-page",
  End: "last-page",
  " ": "toggle-page-select",
  r: "rotate-right",
  R: "rotate-left",
  v: "tool-select",
  V: "tool-select",
  h: "tool-highlight",
  H: "tool-highlight",
  t: "tool-text",
  T: "tool-text",
  n: "tool-sticky",
  N: "tool-sticky",
  b: "tool-rect",
  B: "tool-rect",
  a: "tool-arrow",
  A: "tool-arrow",
  l: "tool-line",
  L: "tool-line",
  p: "tool-pen",
  P: "tool-pen",
  w: "fit-width",
  W: "fit-width",
  f: "fit-page",
  F: "fit-page",
  "?": "toggle-help",
  Delete: "delete-annotation",
  Backspace: "delete-annotation",
  Escape: "escape",
};

/** Maps a key press to an app command. Single-letter commands fire only without Ctrl / Alt / Meta. */
export function resolveKeyCommand(e: KeyInput, ctx: KeyContext): KeyCommand | null {
  const ctrl = e.ctrlKey || e.metaKey;
  const lower = e.key.toLowerCase();

  // The WebView's reload would silently throw away unsaved edits.
  if (e.key === "F5" || (ctrl && lower === "r")) return "block-reload";

  if (ctx.modalOpen) return e.key === "Escape" ? "close-modal" : null;

  if (e.key === "F2") return "toggle-page-bar";
  if (e.key === "F3") return "toggle-annotation-bar";

  if (ctrl) {
    if (lower === "s") return e.shiftKey ? "save-overwrite" : "save-as";
    if (lower === "f") return "toggle-search";
    if (lower === "b") return "toggle-sidebar";
    if (!ctx.inputFocused && lower === "z") return e.shiftKey ? "redo" : "undo";
    if (!ctx.inputFocused && lower === "y") return "redo";
    return null;
  }

  // Alt+<letter> belongs to the menu bar.
  if (e.altKey || ctx.inputFocused) return null;

  return Object.hasOwn(PLAIN_KEYS, e.key) ? PLAIN_KEYS[e.key] : null;
}
