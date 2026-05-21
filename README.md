# homelab-reader

Self-hosted book server for technical libraries. Point it at a folder of
EPUBs and PDFs, get a web reader with notes, highlights, and reading
progress, plus an OPDS catalog that mobile apps (e.g.
[android-reader](../android-reader/)) can pull from.

Built for technical books and manuals — flat folders, no series/volume
gymnastics. Lives on the LAN. No cloud, no external account, no
phone-home.

## Status

**Phase 0 — Scaffold.** Schema, scanner, reader, OPDS are next.

## Stack

- Next.js 15 + React 19 (App Router)
- Prisma + SQLite
- TailwindCSS v4
- NextAuth v5 (single-user credentials)
- chokidar (folder watch)
- epub2 + pdfjs-dist (server-side metadata + cover extraction)
- epub.js + PDF.js (client-side reader)

## Dev

```bash
npm install
cp .env.example .env   # then edit BOOKS_PATH + AUTH_SECRET
npm run dev            # http://localhost:3000
```

The `predev` hook runs `prisma generate && prisma migrate deploy`, so a
fresh clone + `npm run dev` self-heals the schema.

## Docker (production)

Mount your library at `/books` and persistent data at `/data`:

```bash
docker compose up -d --build   # port 3333
```

## Privacy posture

- LAN-only by intent. Auth is single-user credentials, but the threat model
  assumes trusted-network deployment.
- Pre-commit privacy hook ships in `scripts/hooks/pre-commit`. Activate
  per-clone:
  ```
  git config core.hooksPath scripts/hooks
  ```
- Full-history audit: `bash scripts/audit-privacy.sh` before any public push.
- See `/mnt/Projects/CLAUDE.md` §Workspace-Wide Privacy Policy for the
  full rationale.
# homelab-reader
