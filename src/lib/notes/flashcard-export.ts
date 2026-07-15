// Render a book's highlights into an Anki-importable text file, using the
// book's color key as the category structure: a highlight's color looks up
// its meaning ("yellow = key terms") and that meaning becomes the card's tag
// — so a color-coded read-through of a textbook falls out as a sorted,
// filterable deck.
//
// PURE and target-agnostic, exactly like markdown-export.ts alongside it:
// plain data in, one string out — no Prisma, no fs, no network, fully
// unit-testable in-VM.
//
// Card shape (one card per highlight, ordered by position in the book):
//   Front  the highlighted passage
//   Back   the note attached to the highlight, if any; otherwise the color's
//          meaning from the key (so an unnoted "key term" still gets a usable
//          recognition card); otherwise empty, left for editing in Anki
//   Tags   book title + the color's meaning, slugified into Anki tags
//
// File format: Anki's plain-text import with file-header directives
// (https://docs.ankiweb.net/importing/text-files.html). Fields are
// tab-separated; a field containing a tab, newline, or quote is quoted
// CSV-style (wrapped in double quotes, inner quotes doubled), which Anki's
// importer understands.

import { notesByHighlight } from "@/lib/annotations";
import type { ColorKeyMap } from "@/lib/highlight-colors";
import { byLocatorThenCreated, deriveLocator } from "./markdown-export";

/** Minimal book shape — only the title feeds the deck (as a tag). */
export interface FlashcardBook {
  title: string;
}

/** Minimal Highlight shape (subset of the Prisma model). */
export interface FlashcardHighlight {
  id: string;
  text: string;
  color: string;
  /** JSON string, same anchor blob the schema documents. */
  anchor: string;
  createdAt: Date;
}

/** Minimal Note shape — enough to pair a note with its highlight. */
export interface FlashcardNote {
  id: string;
  body: string;
  /** JSON string anchor (CFI pairing fallback for pre-FK notes). */
  anchor: string;
  highlightId?: string | null;
}

export interface FlashcardInput {
  book: FlashcardBook;
  highlights: FlashcardHighlight[];
  notes: FlashcardNote[];
  /** The user's color key for this book; colors without a label yield no tag. */
  colorKey: ColorKeyMap;
}

// An Anki tag: no spaces (space separates tags), lowercase for stability.
// "Key terms" → "key-terms". Empty after slugging → no tag.
export function slugifyTag(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Quote a field CSV-style when it contains a separator-significant character.
function escapeField(s: string): string {
  if (/[\t\n\r"]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseCfi(anchor: string): { cfi?: string } {
  try {
    const a = JSON.parse(anchor) as { cfi?: unknown };
    return typeof a?.cfi === "string" ? { cfi: a.cfi } : {};
  } catch {
    return {};
  }
}

/**
 * Render highlights (+ their paired notes and the color key) into Anki's
 * plain-text import format. Deterministic: cards are ordered by position in
 * the book, then creation time, then id.
 */
export function exportFlashcards(input: FlashcardInput): string {
  const { book, highlights, notes, colorKey } = input;

  // Pair notes to highlights with the shared rule (structural FK first, CFI
  // fallback) — the same pairing every annotation surface uses.
  const paired = notesByHighlight(
    highlights.map((h) => ({ id: h.id, anchor: parseCfi(h.anchor) })),
    notes.map((n) => ({
      id: n.id,
      body: n.body,
      highlightId: n.highlightId,
      anchor: parseCfi(n.anchor),
    })),
  );

  const bookTag = slugifyTag(book.title);

  const cards = highlights
    .map((h) => ({ ...h, sortKey: deriveLocator(h.anchor)?.sortKey ?? "9:" }))
    .sort(byLocatorThenCreated)
    .map((h) => {
      const note = paired.get(h.id);
      const meaning =
        (colorKey as Partial<Record<string, string>>)[h.color] ?? null;
      const back = note?.body ?? meaning ?? "";
      const tags = [bookTag, meaning ? slugifyTag(meaning) : ""]
        .filter(Boolean)
        .join(" ");
      return [escapeField(h.text), escapeField(back), escapeField(tags)].join(
        "\t",
      );
    });

  const header = ["#separator:tab", "#html:false", "#tags column:3"];
  return [...header, ...cards].join("\n") + "\n";
}
