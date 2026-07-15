// Render a book's highlights + notes into a single portable Markdown document.
//
// PURE and target-agnostic: plain data in, a Markdown string out — no Prisma,
// no DB, no fs, no network. Delivery (Obsidian vault write, Notion API, Logseq
// blocks) is a separate, decision-blocked concern that wires *around* this; the
// Markdown itself never assumes a destination. Keeping it pure also makes it
// fully unit-testable in-VM (no browser, no container).
//
// Anchors mirror the JSON shapes the schema documents on Note/Highlight.anchor:
//   Highlight → { type:"epub-cfi-range", cfiStart, cfiEnd } | { type:"pdf-rect", page, rects }
//   Note      → { type:"epub-cfi", cfi }                    | { type:"pdf-point", page, x, y }
// We parse `anchor` defensively (it's a stored string) and derive the locator
// from whichever fields are present rather than trusting `type` blindly.
//
// Note: the schema does NOT link a Note to a Highlight (no highlightId), so all
// notes are standalone and rendered in their own "## Notes" section. If that
// link is ever added, attach matching notes beneath their highlight here.

/** Minimal book shape — declared locally so the module stays Prisma-free. */
export interface ExportBook {
  title: string;
  /** Either plain names or Prisma's Author rows ({ name }). */
  authors: (string | { name: string })[];
  isbn?: string | null;
  format: string; // "epub" | "pdf"
}

/** Minimal Highlight shape (subset of the Prisma model). */
export interface ExportHighlight {
  id: string;
  text: string;
  /** JSON string, see header. */
  anchor: string;
  createdAt: Date;
}

/** Minimal Note shape (subset of the Prisma model). */
export interface ExportNote {
  id: string;
  body: string;
  /** JSON string, see header. */
  anchor: string;
  context?: string | null;
  createdAt: Date;
}

export interface ExportInput {
  book: ExportBook;
  highlights: ExportHighlight[];
  notes: ExportNote[];
}

export interface Locator {
  /** "Page: 12" or "CFI: /6/2" — the human line emitted under an annotation. */
  label: string;
  /** Stable, comparable key for deterministic ordering. */
  sortKey: string;
}

function authorNames(authors: ExportBook["authors"]): string[] {
  return authors
    .map((a) => (typeof a === "string" ? a : a?.name))
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

function parseAnchor(anchor: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(anchor);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

// Zero-pad numeric segments so CFI/path strings sort in document order rather
// than lexically ("/6/2" before "/6/14"). Non-numeric chars pass through.
function cfiSortKey(cfi: string): string {
  return cfi.replace(/\d+/g, (n) => n.padStart(8, "0"));
}

// Derive the human locator line + a stable sort key from an anchor blob. Falls
// back gracefully when fields are missing so a malformed anchor can't crash the
// export — it just yields no locator line (sortKey keeps it deterministic).
// Exported for the flashcard export, which orders cards the same way.
export function deriveLocator(anchor: string): Locator | null {
  const a = parseAnchor(anchor);

  if (typeof a.page === "number") {
    return {
      label: `Page: ${a.page}`,
      sortKey: `1:${String(a.page).padStart(8, "0")}`,
    };
  }
  const cfi =
    typeof a.cfiStart === "string"
      ? a.cfiStart
      : typeof a.cfi === "string"
        ? a.cfi
        : null;
  if (cfi) {
    return { label: `CFI: ${cfi}`, sortKey: `0:${cfiSortKey(cfi)}` };
  }
  return null;
}

// Quote every line of `text` so multiline selections stay inside the block.
function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`.replace(/[ \t]+$/, ""))
    .join("\n");
}

function escapeYamlString(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildFrontmatter(book: ExportBook): string {
  const lines: string[] = ["---"];
  lines.push(`title: "${escapeYamlString(book.title)}"`);

  const names = authorNames(book.authors);
  if (names.length > 0) {
    lines.push("authors:");
    for (const name of names) lines.push(`  - ${name}`);
  }
  if (book.isbn) lines.push(`isbn: ${book.isbn}`);
  lines.push(`format: ${book.format}`);
  lines.push("source: homelab-reader");
  lines.push("---");
  return lines.join("\n");
}

// Stable comparator: locator sort key first, then createdAt, then id — so
// output is identical regardless of the order rows arrive from the DB.
// Exported for the flashcard export, which shares the ordering rule.
export function byLocatorThenCreated(
  a: { sortKey: string; createdAt: Date; id: string },
  b: { sortKey: string; createdAt: Date; id: string },
): number {
  if (a.sortKey !== b.sortKey) return a.sortKey < b.sortKey ? -1 : 1;
  const ta = a.createdAt.getTime();
  const tb = b.createdAt.getTime();
  if (ta !== tb) return ta - tb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function renderHighlights(highlights: ExportHighlight[]): string {
  const items = highlights
    .map((h) => {
      const loc = deriveLocator(h.anchor);
      return { ...h, locator: loc, sortKey: loc?.sortKey ?? "9:" };
    })
    .sort(byLocatorThenCreated);

  const blocks = items.map((h) => {
    const parts = [quoteBlock(h.text)];
    if (h.locator) parts.push(`*${h.locator.label}*`);
    return parts.join("\n\n");
  });

  return ["## Highlights", "", blocks.join("\n\n---\n\n")].join("\n");
}

function renderNotes(notes: ExportNote[]): string {
  const items = notes
    .map((n) => {
      const loc = deriveLocator(n.anchor);
      return { ...n, locator: loc, sortKey: loc?.sortKey ?? "9:" };
    })
    .sort(byLocatorThenCreated);

  const blocks = items.map((n) => {
    const parts: string[] = [];
    if (n.context) parts.push(quoteBlock(n.context));
    parts.push(n.body.replace(/[ \t]+$/gm, ""));
    if (n.locator) parts.push(`*${n.locator.label}*`);
    return parts.join("\n\n");
  });

  return ["## Notes", "", blocks.join("\n\n---\n\n")].join("\n");
}

/**
 * Render a book's annotations to a single Markdown document with YAML
 * frontmatter, a Highlights section, and a standalone-Notes section. Pure and
 * deterministic — safe to diff and to round-trip into a notes vault.
 */
export function exportAnnotationsMarkdown(input: ExportInput): string {
  const { book, highlights, notes } = input;

  const sections: string[] = [buildFrontmatter(book)];
  if (highlights.length > 0) sections.push(renderHighlights(highlights));
  if (notes.length > 0) sections.push(renderNotes(notes));

  // Single blank line between sections; exactly one trailing newline; no
  // trailing whitespace anywhere.
  return sections.join("\n\n") + "\n";
}
