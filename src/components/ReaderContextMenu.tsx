"use client";

import type { ReactNode } from "react";

// The readers' right-click menu for plain page surface (right-clicking
// a highlight or a text selection opens the more specific popovers
// instead — see each reader's contextmenu handler). Purely
// presentational: the readers own the state and pass the entries.
//
// Same floating conventions as the popover trio in HighlightPopover:
// fixed positioning at viewport coords the caller translated, clamped
// away from the edges, stopPropagation so the readers' one-shot
// outside-click dismiss doesn't eat the click that uses the menu.

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  disabled?: boolean;
  /** Render as the currently-active choice (e.g. the current flow mode). */
  active?: boolean;
}

export type ContextMenuEntry = ContextMenuItem | "divider";

const MENU_WIDTH = 208;
const ITEM_HEIGHT = 30;

export function ReaderContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  const height = items.reduce(
    (acc, it) => acc + (it === "divider" ? 9 : ITEM_HEIGHT),
    12,
  );
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - height - 8));

  return (
    <div
      role="menu"
      aria-label="Reader menu"
      style={{ position: "fixed", left, top, width: MENU_WIDTH, zIndex: 60 }}
      className="rounded-md border border-zinc-800 bg-zinc-900 py-1.5 shadow-xl"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((entry, i) =>
        entry === "divider" ? (
          <div key={`d${i}`} className="my-1 h-px bg-zinc-800" aria-hidden />
        ) : (
          <button
            key={entry.label}
            role="menuitem"
            disabled={entry.disabled}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition-colors disabled:cursor-default disabled:opacity-40 ${
              entry.active
                ? "text-amber-400"
                : "text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
            }`}
          >
            <span className="text-zinc-500">{entry.icon}</span>
            {entry.label}
          </button>
        ),
      )}
    </div>
  );
}
