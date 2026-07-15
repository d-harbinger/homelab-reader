// READER-SHORTCUTS-01 — the shared undo-gesture predicates both readers use.
// Pure logic; the DOM half of isEditableTarget needs a browser and is covered
// by the readers' e2e flows, but its no-DOM guard is exercised here (the tests
// run in a node environment where HTMLElement does not exist).

import { describe, it, expect } from "vitest";
import { isUndoShortcut, isEditableTarget } from "@/lib/reader-shortcuts";

function key(over: Partial<Parameters<typeof isUndoShortcut>[0]>) {
  return {
    key: "z",
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...over,
  };
}

describe("isUndoShortcut", () => {
  it("matches Ctrl+Z and Cmd+Z, either case", () => {
    expect(isUndoShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isUndoShortcut(key({ metaKey: true }))).toBe(true);
    expect(isUndoShortcut(key({ ctrlKey: true, key: "Z" }))).toBe(true);
  });

  it("rejects plain z and other modified combos", () => {
    expect(isUndoShortcut(key({}))).toBe(false);
    // Ctrl+Shift+Z is redo territory — deliberately unclaimed.
    expect(isUndoShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isUndoShortcut(key({ ctrlKey: true, key: "y" }))).toBe(false);
  });
});

describe("isEditableTarget", () => {
  it("is false for null and for any target when no DOM exists", () => {
    expect(isEditableTarget(null)).toBe(false);
    // node environment: HTMLElement is undefined, so nothing is editable.
    expect(isEditableTarget({} as EventTarget)).toBe(false);
  });
});
