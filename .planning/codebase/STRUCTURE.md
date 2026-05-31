# Codebase Structure

**Analysis Date:** 2026-05-31

## Directory Layout

```
homelab-reader/
├── prisma/
│   ├── schema.prisma          # Single schema: User, Book, Author, Tag, Note, Highlight, Progress, ScanLocation
│   └── migrations/            # Prisma migrations (initial, add_user_role)
├── src/
│   ├── instrumentation.ts     # Server boot hook — starts the watcher
│   ├── middleware.ts          # Edge auth gate (route matcher)
│   ├── auth.ts                # Node-runtime NextAuth instance (bcrypt + Prisma)
│   ├── auth.config.ts         # Edge-safe auth config (authorized callback, JWT)
│   ├── app/
│   │   ├── layout.tsx         # Root layout (system fonts, dark shell)
│   │   ├── globals.css        # Tailwind v4 + global styles
│   │   ├── page.tsx           # Library home (client, SWR)
│   │   ├── login/             # Sign-in page
│   │   ├── setup/             # First-run admin creation
│   │   ├── search/            # Search/browse page
│   │   ├── settings/          # Admin: libraries + users
│   │   ├── books/[id]/        # Book detail
│   │   ├── books/[id]/read/   # Reader entry (dispatches Epub/Pdf)
│   │   └── api/               # REST + OPDS route handlers (see below)
│   ├── components/            # Client React widgets (readers, panels, cards)
│   ├── lib/                   # Domain helpers (non-route logic)
│   │   ├── prisma.ts          # PrismaClient singleton
│   │   ├── current-user.ts    # Session → user/role, admin guard
│   │   ├── users.ts           # User CRUD + validation
│   │   ├── opds.ts            # OPDS 1.2 feed/entry XML builders
│   │   ├── highlight-colors.ts# Highlight color palette
│   │   └── scanner/           # Filesystem ingest subsystem (see below)
│   └── types/
│       └── next-auth.d.ts     # Session/JWT type augmentation (id, role)
├── public/
│   └── pdf.worker.min.mjs     # PDF.js worker (copied in by a build script)
├── scripts/                   # setup, preflight, copy-pdfjs-worker, hooks/
├── docs/
│   └── OPDS-AUTH-CONTRACT.md  # Cross-repo OPDS per-user auth contract
├── data/                      # Dev DB + cover cache (gitignored)
│   └── covers/                # Extracted cover images
├── test-library/             # Sample EPUB/PDF for local scanning
├── Dockerfile, docker-compose.yml, docker-entrypoint.sh
├── next.config.ts            # standalone output, CSP headers, serverExternalPackages
└── package.json
```

## Directory Purposes

**`src/app/api/`:**
- Purpose: All HTTP endpoints (REST JSON, OPDS XML, binary file/cover streams)
- Contains: `route.ts` files, one folder per resource
- Key files: see "Key File Locations" — endpoints for `books`, `notes`, `highlights`, `progress`, `covers`, `scan`, `users`, `locations`, `tags`, `fs`, `opds`, `me`, `auth/[...nextauth]`

**`src/lib/scanner/`:**
- Purpose: Turn filesystem book files into indexed DB rows
- Contains: watcher, dispatch, per-format extractors, cover writer, hash, locations
- Key files: `index.ts` (dispatch + reconcile), `watcher.ts` (chokidar + global state), `epub.ts`, `pdf.ts`, `locations.ts`, `covers.ts`, `hash.ts`

**`src/components/`:**
- Purpose: Client-side React widgets
- Contains: `"use client"` components — the two readers and their panels, library cards/headers, admin managers
- Key files: `EpubReader.tsx`, `PdfReader.tsx` + `PdfReaderLazy.tsx` (dynamic import wrapper), `HighlightsPanel.tsx`, `BookAnnotations.tsx`, `LibraryManager.tsx`, `UserManager.tsx`, `LibraryHeader.tsx`, `Section.tsx`, `BookCard.tsx`, `ReaderToolbar.tsx`, `AuthShell.tsx`

**`src/lib/`:**
- Purpose: Non-route domain logic shared by routes, pages, and the boot hook
- Contains: Prisma singleton, auth helpers, user/opds/color helpers
- Key files: `prisma.ts`, `current-user.ts`, `users.ts`, `opds.ts`

## Key File Locations

**Entry Points:**
- `src/instrumentation.ts`: Server boot — starts the folder watcher
- `src/middleware.ts`: Edge auth gate
- `src/app/api/**/route.ts`: HTTP endpoints
- `src/app/**/page.tsx`: Rendered pages

**Configuration:**
- `prisma/schema.prisma`: Data model
- `next.config.ts`: standalone output, CSP, server-external packages
- `tsconfig.json`: `@/*` → `src/*` path alias, strict mode
- `eslint.config.mjs`: lint config
- `.env` / `.env.example`: `DATABASE_URL`, `BOOKS_PATH`, auth secret (never read `.env` contents)

**Core Logic:**
- `src/lib/scanner/index.ts`: `scanFile`, `walkAndScan`, `removeFileFromLibrary`
- `src/lib/scanner/watcher.ts`: `startWatcher`, `watcherStatus`, `restartWatcher`
- `src/lib/scanner/locations.ts`: ScanLocation CRUD + `seedFromBooksPath`
- `src/lib/opds.ts`: feed/entry XML
- `src/lib/current-user.ts`: auth guards
- `src/auth.ts` / `src/auth.config.ts`: NextAuth split

**Testing:**
- No test framework or test files present. `test-library/` holds sample books for manual scan verification; `scripts/preflight.mjs` is the closest automated check (env/setup validation).

## Naming Conventions

**Files:**
- React components: PascalCase `.tsx` (`EpubReader.tsx`, `BookCard.tsx`)
- Library/helper modules: kebab-case or single-word `.ts` (`current-user.ts`, `opds.ts`, `index.ts`)
- Route handlers: always `route.ts` inside the resource folder
- Pages: always `page.tsx`
- Build scripts: kebab-case `.mjs` under `scripts/`

**Directories:**
- API resources: lowercase noun, plural where it's a collection (`books`, `notes`, `highlights`, `locations`, `users`)
- Dynamic segments: bracketed (`[id]`, `[...nextauth]`)
- Nested actions as subfolders (`books/[id]/file`, `books/[id]/read`, `scan/status`, `tags/sections`)

## Where to Add New Code

**New REST endpoint:**
- Handler: `src/app/api/<resource>/route.ts` (and `[id]/route.ts` for item ops)
- Keep it thin: parse → validate → call `src/lib/` helper / Prisma → return `NextResponse.json`
- Scope annotation queries by `getCurrentUserId()`; gate admin actions with `requireAdmin()` + the shared `authError` mapper

**New book format:**
- Extractor: `src/lib/scanner/<format>.ts` returning the `ExtractedCommon` shape
- Register the extension in `isBookFile` / `formatOf` / `extractFor` in `src/lib/scanner/index.ts` — do not fork the scanner or watcher
- Add the format's reader to `src/components/` and dispatch it in `src/app/books/[id]/read/page.tsx`

**New UI page:**
- Server page that loads data: `src/app/<route>/page.tsx` using `prisma` directly (see `src/app/books/[id]/page.tsx`)
- Interactive page: `"use client"` page using `useSWR` against an API route (see `src/app/page.tsx`)

**New reusable component:**
- `src/components/<PascalCase>.tsx`, `"use client"` if it uses hooks/state

**Shared non-route logic:**
- `src/lib/<name>.ts`; import via the `@/lib/...` alias

**Schema change:**
- Edit `prisma/schema.prisma`, then `npx prisma migrate dev --name <descriptive>`; commit schema + the generated migration together

## Special Directories

**`data/` (and `data/covers/`):**
- Purpose: Dev SQLite DB + extracted cover images
- Generated: Yes (DB by Prisma, covers by the scanner)
- Committed: No (gitignored)

**`prisma/migrations/`:**
- Purpose: Ordered schema migrations applied by `prisma migrate deploy`
- Generated: Yes (`prisma migrate dev`)
- Committed: Yes

**`public/`:**
- Purpose: Static assets; holds `pdf.worker.min.mjs`
- Generated: `pdf.worker.min.mjs` is copied in by `scripts/copy-pdfjs-worker.mjs` during `predev`/`prebuild`
- Committed: worker is copied at build time, not relied on from git

**`scripts/hooks/`:**
- Purpose: Privacy-guard git hooks (activate via `git config core.hooksPath scripts/hooks`)
- Committed: Yes

**`test-library/`:**
- Purpose: Sample EPUB/PDF for local scan testing
- Committed: Yes (sample fixtures)

---

*Structure analysis: 2026-05-31*
