// Keyboard-shortcut predicates shared by both readers (EPUB + PDF). Pure —
// they inspect a KeyboardEvent-shaped object and never touch the DOM beyond
// the event's own target, so the undo-gesture rules stay unit-testable and
// identical across the two readers.

/** Minimal KeyboardEvent surface the predicates need (testable without a DOM). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

// Ctrl+Z (or Cmd+Z on mac keyboards). Shift/Alt variants are deliberately NOT
// matched: Ctrl+Shift+Z is redo in most apps, and claiming it here would make
// the reader feel wrong without actually offering redo.
export function isUndoShortcut(e: KeyLike): boolean {
  return (
    (e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === "z"
  );
}

// True when the event originated in a text-editing element (note editors,
// search fields). There the browser's own text undo must keep working, so the
// reader's highlight undo stands down.
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}
