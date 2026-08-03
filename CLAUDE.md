# CLAUDE.md

Guidance for Claude Code working in this repository.

## Read before you edit (HARD RULE)

Before making any edit aimed at a visual, layout, or behavioral bug: open
and read the relevant file(s) first, and state in the reply what the code
actually does and which line causes the symptom. Never edit based on a
guess, a hunch about a library's behavior, or a glance at a screenshot.
When a screenshot is provided, examine it closely and, if unsure which
element or region is wrong, ask precisely rather than assert. No
speculative `sed`/edits. Why: guessing wastes the maintainer's time, breaks
trust, and the cause is almost always obvious within seconds of reading the
code. The app shell layout (`src/app/layout.tsx`, `globals.css`) and the
in-reader epub.js layout (`EpubReader.tsx` theme/flow) are separate systems —
read the one that owns the symptom.

## What this is

**homelab-reader** — self-hosted book server for technical libraries.
Sibling project to [`android-reader`](../android-reader/) (Readium-based
EPUB reader for GrapheneOS) and to [`chimera`](../chimera/) (personal
workspace dashboard, which shares this project's stack shape).

The two-device story: android-reader on mobile, homelab-reader on the
LAN serving PCs and feeding android-reader via OPDS. Same library, same
notes shape, same privacy posture.

## Stack

- Next.js 15 + React 19 (App Router, TypeScript)
- Prisma + SQLite (DB at `/data/homelab-reader.db` in prod, `./data/` in dev)
- TailwindCSS v4
- NextAuth v5 (multi-user credentials, bcrypt + JWT; first-run admin setup, admin-managed accounts)
- chokidar — folder watch
- In-house EPUB extraction (yauzl + fast-xml-parser), pdfjs-dist — server-side metadata + cover
- epub.js, PDF.js — client-side reader

Same shape as `chimera/`. When in doubt, reference how chimera does it.

## Build / dev

- **Dev**: `npm run dev` (port 3000). `predev` hook runs `prisma generate && prisma migrate deploy`.
- **Build**: `npm run build` (webpack — Turbopack stays dev-only here until it + Next standalone output GA together, same as chimera)
- **Lint**: `npm run lint`
- **Typecheck**: `npx tsc --noEmit`
- **DB migrations**: schema edits require `npx prisma migrate dev --name <descriptive>` to generate a migration; commit schema + migration together.

## Docker

- `./launch.sh` (first run asks the books folder + network questions and saves
  them to `.env`) or `docker compose up -d --build` once `.env` exists — the
  bind `HOMELAB_HOST_BIND` is required, so compose refuses to start without a
  saved answer. Host port 5456 by default (override with `HOMELAB_PORT`;
  container listens on 3000 internally). Port follows the sibling scheme:
  chimera 5454, chef-calc-pro 5455, homelab-reader 5456.
- Volumes: `/books` (the user's library, read-only mount) and `/data` (DB + cover cache)
- Entrypoint runs `prisma migrate deploy` and fails loudly if migrations don't apply

## Privacy

See `~/Projects/CLAUDE.md` §Workspace-Wide Privacy Policy. This repo
ships the standard four pieces:

1. `scripts/hooks/pre-commit` — staged-diff privacy guard
2. `scripts/audit-privacy.sh` — full-history audit
3. `.privacy-patterns` (gitignored) + `.privacy-patterns.example` (committed)
4. This pointer

One-time activation per clone:

```
git config core.hooksPath scripts/hooks
```

**Never write device serials, MACs, private IPs, home-directory paths,
real names, internal hostnames, or per-clone tokens into any file or
commit message.** The hook is a safety net, not the primary defense.

## Architecture (current)

- `prisma/schema.prisma` — Book, Author, Note, Highlight, Progress, Tag, ScanLocation, User
- `src/lib/scanner/` — folder watcher + per-format extractors (in-house EPUB extraction with yauzl + fast-xml-parser, PDF via pdfjs-dist)
- `src/app/api/opds/` — OPDS 1.2 catalog endpoint, the bridge to android-reader
- `src/app/api/books/`, `src/app/api/notes/`, etc. — REST around the DB
- `GET /api/library/folders` — folder tree of the indexed library (admin-selected roots)
- `GET /api/books?folder=` — books filtered to a root-relative folder path (and what sits under it)
- `GET /api/books/[id]/annotations` — a book's highlights and notes as a Markdown export
- `GET /api/books/[id]/flashcards` — a book's highlights as an Anki-importable deck, tagged by the color key
- `GET|PUT /api/highlight-key?bookId=` — the per-user, per-book highlight color key (color → meaning)
- `GET /api/books/[id]/citation` — citation metadata for a book
- `src/app/books/`, `src/app/search/`, `src/app/settings/`, `src/app/setup/` — library list, search, settings, first-run admin setup, with the reader UI under the book detail page

When adding new file format support: add an extractor in `src/lib/scanner/<format>.ts`
and register it in the scanner dispatch. Don't fork the scanner.
