import { describe, expect, it } from "vitest";
import { resolveKeyCommand, type KeyInput } from "./keyCommands";

function press(
  key: string,
  mods: Partial<KeyInput> = {},
  ctx: { inputFocused?: boolean; modalOpen?: boolean } = {}
) {
  return resolveKeyCommand(
    { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods },
    { inputFocused: false, modalOpen: false, ...ctx }
  );
}

describe("resolveKeyCommand", () => {
  it.each([
    ["j", "next-page"],
    ["PageDown", "next-page"],
    ["k", "prev-page"],
    ["PageUp", "prev-page"],
    ["Home", "first-page"],
    ["End", "last-page"],
    [" ", "toggle-page-select"],
    ["r", "rotate-right"],
    ["R", "rotate-left"],
    ["v", "tool-select"],
    ["h", "tool-highlight"],
    ["t", "tool-text"],
    ["n", "tool-sticky"],
    ["b", "tool-rect"],
    ["a", "tool-arrow"],
    ["l", "tool-line"],
    ["p", "tool-pen"],
    ["w", "fit-width"],
    ["f", "fit-page"],
    ["?", "toggle-help"],
    ["Delete", "delete-annotation"],
    ["Backspace", "delete-annotation"],
    ["Escape", "escape"],
    ["F2", "toggle-page-bar"],
    ["F3", "toggle-annotation-bar"],
  ])("%s runs %s", (key, command) => {
    expect(press(key)).toBe(command);
  });

  it("handles the Ctrl shortcuts", () => {
    expect(press("s", { ctrlKey: true })).toBe("save-as");
    expect(press("S", { ctrlKey: true, shiftKey: true })).toBe("save-overwrite");
    expect(press("f", { ctrlKey: true })).toBe("toggle-search");
    expect(press("b", { ctrlKey: true })).toBe("toggle-sidebar");
    expect(press("z", { ctrlKey: true })).toBe("undo");
    expect(press("Z", { ctrlKey: true, shiftKey: true })).toBe("redo");
    expect(press("y", { ctrlKey: true })).toBe("redo");
  });

  it.each(["a", "c", "v", "p", "x", "h", "w", "n", "t", "l"])(
    "Ctrl+%s does not trigger the single-letter command",
    (key) => {
      expect(press(key, { ctrlKey: true })).toBeNull();
    }
  );

  it.each(["f", "e", "v", "p", "a", "h"])(
    "Alt+%s is left to the menu bar",
    (key) => {
      expect(press(key, { altKey: true })).toBeNull();
    }
  );

  it("blocks the WebView's reload keys, even inside a dialog or a text field", () => {
    expect(press("F5")).toBe("block-reload");
    expect(press("r", { ctrlKey: true })).toBe("block-reload");
    expect(press("R", { ctrlKey: true, shiftKey: true })).toBe("block-reload");
    expect(press("F5", {}, { modalOpen: true })).toBe("block-reload");
    expect(press("F5", {}, { inputFocused: true })).toBe("block-reload");
  });

  it("lets text fields keep their keys", () => {
    const ctx = { inputFocused: true };
    for (const key of ["j", "r", "h", " ", "Delete", "Backspace", "Home", "?", "Escape"]) {
      expect(press(key, {}, ctx)).toBeNull();
    }
    expect(press("z", { ctrlKey: true }, ctx)).toBeNull();
    expect(press("y", { ctrlKey: true }, ctx)).toBeNull();
    expect(press("s", { ctrlKey: true }, ctx)).toBe("save-as");
  });

  it("keeps the page behind an open dialog from reacting", () => {
    const ctx = { modalOpen: true };
    for (const key of ["j", "r", "h", " ", "Delete", "F2", "F3", "?"]) {
      expect(press(key, {}, ctx)).toBeNull();
    }
    expect(press("s", { ctrlKey: true }, ctx)).toBeNull();
    expect(press("z", { ctrlKey: true }, ctx)).toBeNull();
  });

  it("closes a dialog with Escape", () => {
    expect(press("Escape", {}, { modalOpen: true })).toBe("close-modal");
    expect(press("Escape", {}, { modalOpen: true, inputFocused: true })).toBe("close-modal");
  });

  it("ignores unknown keys and names inherited from Object", () => {
    expect(press("q")).toBeNull();
    expect(press("constructor")).toBeNull();
    expect(press("toString")).toBeNull();
  });
});
