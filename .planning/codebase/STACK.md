# Technology Stack

**Analysis Date:** 2026-05-31

## Languages

**Primary:**
- TypeScript `^5` - All application code under `src/` (App Router routes, React components, scanner, libs). Config in `tsconfig.json` (`strict: true`, `target: ES2017`, `moduleResolution: bundler`).

**Secondary:**
- JavaScript (ESM `.mjs`) - Build/setup tooling in `scripts/` (`preflight.mjs`, `copy-pdfjs-worker.mjs`, `setup.mjs`, `set-password.mjs`).
- CSS - `src/app/globals.css` (TailwindCSS v4 via PostCSS).
- POSIX shell - `docker-entrypoint.sh`, privacy/probe scripts in `scripts/`.
- Prisma schema DSL - `prisma/schema.prisma`.

## Runtime

**Environment:**
- Node.js `>=20` (declared in `package.json` `engines`). Docker runtime image is `node:22-alpine` (`Dockerfile` line 1).
- Next.js standalone server (`output: "standalone"` in `next.config.ts`); container runs `node server.js` (`docker-entrypoint.sh` line 57).

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`). Docker build uses `npm ci` (`Dockerfile` line 9).

## Frameworks

**Core:**
- Next.js `^15.5.18` - App Router web framework. Entry config `next.config.ts`. Server instrumentation hook at `src/instrumentation.ts` boots the folder watcher.
- React `19.1.0` / React DOM `19.1.0` - UI layer (`src/components/`, `src/app/`).
- NextAuth (Auth.js) `^5.0.0-beta.30` - Authentication. Edge-safe config `src/auth.config.ts`, Node instance `src/auth.ts`, middleware gate `src/middleware.ts`.
- Prisma `^6.19.2` (CLI) + `@prisma/client` `^6.19.2` - ORM over SQLite. Schema `prisma/schema.prisma`, client singleton `src/lib/prisma.ts`.

**Testing:**
- Not detected. No test runner (Jest/Vitest) in dependencies; no `*.test.*` / `*.spec.*` files in `src/`.

**Build/Dev:**
- Turbopack - dev only (`npm run dev` → `next dev --turbopack`). Production `npm run build` uses webpack (the default Next build), per CLAUDE.md the Turbopack/standalone split is intentional.
- ESLint `^9` + `eslint-config-next` `^15.5.18` - lint (`eslint.config.mjs`, `npm run lint`).
- TailwindCSS `^4` + `@tailwindcss/postcss` `^4` - styling pipeline (`postcss.config.mjs`).

## Key Dependencies

**Critical:**
- `chokidar` `^5.0.0` - Filesystem watcher that drives library ingestion (`src/lib/scanner/watcher.ts`). Watches enabled `ScanLocation` folders, dispatches add/change/unlink to the scanner.
- `yauzl` `^3.3.1` - ZIP reader used to crack open EPUB containers for metadata + cover extraction (`src/lib/scanner/epub.ts`). Server-external (not bundled).
- `fast-xml-parser` `^5.8.0` - Parses EPUB `container.xml` and OPF metadata XML (`src/lib/scanner/epub.ts`).
- `pdfjs-dist` `^5.6.205` - Server-side PDF metadata extraction (Info dict + XMP) and page count (`src/lib/scanner/pdf.ts`, legacy ESM build `pdfjs-dist/legacy/build/pdf.mjs`). Also client-side reader via `react-pdf`.
- `pdf-to-img` `^6.1.0` - Renders PDF page 1 to a PNG cover thumbnail in Node (`src/lib/scanner/pdf.ts`, `renderFirstPageCover`). Wraps pdfjs + canvas + font wiring.
- `bcryptjs` `^3.0.3` - Password hashing/verification for the Credentials provider (`src/auth.ts`).
- `epubjs` `^0.3.93` - Client-side EPUB rendering in the in-browser reader (`src/components/EpubReader.tsx`).
- `react-pdf` `^10.4.1` - Client-side PDF rendering (`src/components/PdfReader.tsx`, lazy-loaded via `PdfReaderLazy.tsx`).

**Infrastructure:**
- `swr` `^2.4.0` - Client-side data fetching/caching against the REST API.
- `lucide-react` `^1.14.0` - Icon set for the UI.

## Configuration

**Environment:**
- Configured via environment variables; template committed at `.env.example`. Local `.env`, `.env.local` exist (gitignored, contents not read).
- Variables consumed: `DATABASE_URL` (SQLite file path), `BOOKS_PATH` (initial library folder to seed; read in `src/lib/scanner/locations.ts` line 117), `AUTH_SECRET`, `AUTH_TRUST_HOST`, `NEXTAUTH_URL`, `NODE_ENV`, `NEXT_RUNTIME` (set by Next; gates the scanner to the Node runtime in `src/instrumentation.ts`).
- `AUTH_SECRET` fallback: if unset, `docker-entrypoint.sh` generates 32 bytes from `/dev/urandom`, base64-encodes, and persists to `/app/data/.auth-secret` with `umask 077`.

**Build:**
- `next.config.ts` - `output: "standalone"`, `serverExternalPackages: ["pdfjs-dist", "yauzl", "pdf-to-img"]` (kept out of the bundle as native/Node-only), and a strict security-header set (CSP, X-Frame-Options DENY, nosniff, Referrer-Policy, Permissions-Policy) applied to all routes.
- `tsconfig.json` - path alias `@/*` → `./src/*`.
- `prisma/schema.prisma` - `sqlite` datasource, `prisma-client-js` generator.
- `postcss.config.mjs`, `eslint.config.mjs` - styling + lint config.

## Platform Requirements

**Development:**
- Node.js >=20, npm. `predev` hook runs `scripts/preflight.mjs`, `prisma generate`, `prisma migrate deploy`, and copies the PDF.js worker into `public/`.
- Per project CLAUDE.md / host-VM split: dev server, build, and DB migrations run on the host, not inside the VM.

**Production:**
- Docker. `docker compose up -d --build` builds a multi-stage image (`Dockerfile`: deps → builder → runner) and serves on host port 3333 → container 3000.
- Runs as non-root user `nextjs` (uid 1001). Container hardened: `cap_drop: ALL`, `no-new-privileges:true`.
- Volumes: named volume `homelab-reader-data` → `/app/data` (SQLite DB, covers, auth secret); host `${BOOKS_HOST_PATH:-./books}` → `/app/books` read-only.
- Healthcheck polls `/api/scan/status` every 30s.
- Entrypoint runs `prisma migrate deploy` on boot and refuses to start (prints a banner, exits 1) if migrations fail.

---

*Stack analysis: 2026-05-31*
