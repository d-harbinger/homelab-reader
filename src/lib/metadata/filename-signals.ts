import path from "node:path";
import type { EnrichQuery } from "./openlibrary";

// Turn a messy book filename into enrichment signals (a readable title and, when
// present, an ISBN) to feed OpenLibrary. Operates on the BASENAME only — a
// directory segment that happens to look like an ISBN must never leak into the
// query. Pure and deterministic.
//
// Examples:
//   Project_Management_all-in-one_for_dummies.pdf
//     -> { title: "Project Management all in one for dummies" }
//   Downey - Think Python 9781449330729.pdf
//     -> { title: "Downey Think Python", isbn: "9781449330729" }
//   Clean Code (z-lib.org).epub
//     -> { title: "Clean Code" }

// Parenthetical/bracketed download-site cruft (z-lib, libgen, anna's, …).
const SITE_NOISE =
  /\s*[([][^)\]]*(?:z-?lib|libgen|anna|b-?ok|zlib|\.org|\.com|\.net)[^)\]]*[)\]]/gi;

// A run of digits/hyphens/spaces long enough to maybe be an ISBN, ending in a
// digit or X (ISBN-10 check digit).
const ISBN_CANDIDATE = /[0-9][0-9\-\s]{8,}[0-9Xx]/g;

function extractIsbn(s: string): { isbn?: string; matched?: string } {
  for (const candidate of s.match(ISBN_CANDIDATE) ?? []) {
    const digits = candidate.replace(/[^0-9Xx]/g, "");
    if (digits.length === 13 && /^97[89]/.test(digits)) {
      return { isbn: digits, matched: candidate };
    }
    if (digits.length === 10) {
      return { isbn: digits.toUpperCase(), matched: candidate };
    }
  }
  return {};
}

export function parseFilenameSignals(filePath: string): EnrichQuery {
  const base = path.basename(filePath, path.extname(filePath));

  let work = base.replace(SITE_NOISE, " ");

  const { isbn, matched } = extractIsbn(work);
  if (matched) work = work.replace(matched, " ");

  const title = work
    .replace(/[_+]/g, " ") // underscores / plusses are separators
    .replace(/-/g, " ") // hyphens-as-separators ("all-in-one", "Author - Title")
    .replace(/\s+/g, " ")
    .trim();

  return {
    title: title || undefined,
    isbn,
  };
}
