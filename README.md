# homelab-reader

Self-hosted book server for technical libraries. Point it at a folder of
EPUBs and PDFs, get a web reader with notes, highlights, and reading
progress, plus an OPDS catalog that mobile apps (e.g.
[android-reader](../android-reader/)) can pull from.

Built for technical books and manuals — flat folders, no series/volume
gymnastics. Lives on the LAN. No cloud, no external account, no
phone-home.

## Status

Working library server: admin-selected library folders (browse the server's
filesystem) with folder watch, EPUB and PDF readers with reading progress,
highlights and per-book notes, full-text search and filtering, multi-user
accounts (first-run admin + admin-managed users, each with their own notes
and progress), and a cover-forward web UI. The OPDS catalog endpoint exists;
mobile-client authentication for it is the next milestone.

## Stack

- Next.js 15 + React 19 (App Router)
- Prisma + SQLite
- TailwindCSS v4
- NextAuth v5 (multi-user credentials; first-run admin, admin-managed accounts)
- chokidar (folder watch)
- In-house EPUB extraction (yauzl + fast-xml-parser) and pdfjs-dist — server-side metadata + cover
- epub.js + PDF.js (client-side reader)

## Dev

```bash
npm install
npm run setup   # scaffolds .env, generates AUTH_SECRET, makes the data dir
npm run dev     # http://localhost:3000
```

`npm run setup` is safe to re-run — it never overwrites values that are
already set. After signing in, an admin adds library folders in-app from
**Settings → Libraries** by browsing the server's filesystem; `BOOKS_PATH`,
if set, is adopted as the first library on first run but is otherwise
optional.

A preflight check runs before the dev server and, if anything required is
missing, prints exactly what to fix instead of a cryptic stack trace. Run it
on its own any time with `npm run check`. The `predev` hook also runs
`prisma generate && prisma migrate deploy`, so the schema self-heals.

### Working with the database

Use the npm scripts, not `npx prisma` — they bind to the project's pinned
Prisma, whereas a bare `npx prisma` on a machine without dependencies
installed will fetch the latest major (which may reject this schema):

```bash
npm run db:migrate    # apply pending migrations (prisma migrate deploy)
npm run db:generate   # regenerate the client
npm run db:studio     # browse the database
```

Schema changes still go through `npx prisma migrate dev --name <desc>` once
dependencies are installed (that command needs the local Prisma to diff the
dev database).

### Accounts

Authentication is multi-user. On first run, with no accounts yet, the app
opens a one-time setup screen to create the **admin** account; once an admin
exists, that screen closes itself. The admin adds and removes other users
(readers or further admins) from the in-app Users page. Each account keeps
its own reading progress, notes, and highlights.

A signing secret (`AUTH_SECRET`) must be present in the environment for
sessions to work.

If an admin is ever locked out, reset a password from the host:

```bash
node scripts/set-password.mjs <username>            # masked prompt
node scripts/set-password.mjs <username> 'newpass'  # non-interactive
```

This only resets existing accounts; it does not create them.

## Docker (production)

Mount your library at `/books` and persistent data at `/data`:

```bash
docker compose up -d --build   # host port 3334 (set HOMELAB_PORT to change)
```

## Privacy posture

- LAN-only by intent. Auth is multi-user credentials, but the threat model
  assumes trusted-network deployment.
- Pre-commit privacy hook ships in `scripts/hooks/pre-commit`. Activate
  per-clone:
  ```
  git config core.hooksPath scripts/hooks
  ```
- Full-history audit: `bash scripts/audit-privacy.sh` before any public push.
- See `~/Projects/CLAUDE.md` §Workspace-Wide Privacy Policy for the
  full rationale.
