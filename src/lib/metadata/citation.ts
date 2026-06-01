// "References for free." The OpenLibrary enrichment already yields clean
// author/title/year/publisher/ISBN — which is exactly a citation. Render it two
// ways: a casual one-line reference for notes, and a BibTeX entry for the people
// who want it. No forms, no required fields — Zotero's payoff without its
// ceremony. Pure and deterministic; works off a MetadataSuggestion or a Book row.

export interface CitationInput {
  title?: string;
  authors: string[];
  publishedYear?: number;
  publisher?: string;
  isbn?: string;
}

/** Casual one-line reference, e.g.
 *  "Allen B. Downey — _Think Python_ (O'Reilly Media, 2012). ISBN 9781449330729" */
export function formatReference(b: CitationInput): string {
  const authors = b.authors.length > 0 ? `${b.authors.join(", ")} — ` : "";
  const title = `_${b.title?.trim() || "Untitled"}_`;
  const inParens = [b.publisher, b.publishedYear]
    .filter((v) => v !== undefined && v !== null && `${v}`.trim() !== "")
    .join(", ");
  const where = inParens ? ` (${inParens})` : "";
  const isbn = b.isbn ? ` ISBN ${b.isbn}` : "";
  return `${authors}${title}${where}.${isbn}`;
}

function bibKey(b: CitationInput): string {
  const first = b.authors[0];
  const last = first ? (first.trim().split(/\s+/).pop() ?? "") : "";
  const cleanLast = last.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  const year = b.publishedYear ? String(b.publishedYear) : "";
  return cleanLast + year || "ref";
}

/** BibTeX @book entry; omits fields that are absent rather than emitting blanks. */
export function formatBibtex(b: CitationInput): string {
  const fields: Array<[string, string]> = [];
  if (b.authors.length > 0) fields.push(["author", b.authors.join(" and ")]);
  if (b.title?.trim()) fields.push(["title", b.title.trim()]);
  if (b.publisher?.trim()) fields.push(["publisher", b.publisher.trim()]);
  if (b.publishedYear) fields.push(["year", String(b.publishedYear)]);
  if (b.isbn?.trim()) fields.push(["isbn", b.isbn.trim()]);

  const body = fields.map(([k, v]) => `  ${k} = {${v}},`).join("\n");
  return `@book{${bibKey(b)},\n${body}\n}`;
}
