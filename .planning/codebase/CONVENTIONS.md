# Coding Conventions

**Analysis Date:** 2026-05-31

## Naming Patterns

**Files:**
- React components: PascalCase, one component per file — `src/components/BookCard.tsx`, `src/components/EpubReader.tsx`, `src/components/LibraryManager.tsx`.
- Library/helper modules: kebab-case — `src/lib/current-user.ts`, `src/lib/highlight-colors.ts`. Single-word libs stay flat — `src/lib/prisma.ts`, `src/lib/opds.ts`, `src/lib/users.ts`.
- Scanner format extractors: lowercase format name — `src/lib/scanner/epub.ts`, `src/lib/scanner/pdf.ts`, plus `index.ts` as the dispatch entry point. Per `CLAUDE.md`, new formats add `src/lib/scanner/<format>.ts` and register in the dispatch — do not fork the scanner.
- API routes: Next.js App Router convention — always `route.ts` inside a folder named for the path segment. Dynamic segments use bracket folders — `src/app/api/notes/[id]/route.ts`, `src/app/api/books/[id]/file/route.ts`.
- Pages: `page.tsx` inside route folders — `src/app/books/[id]/page.tsx`, `src/app/settings/users/page.tsx`.
- Build/maintenance scripts: `.mjs` in `scripts/` — `scripts/preflight.mjs`, `scripts/copy-pdfjs-worker.mjs`.

**Functions:**
- camelCase verbs for actions — `scanFile`, `walkAndScan`, `getCurrentUserId`, `requireAdmin`, `createUser`, `writeCover`.
- Predicates prefixed `is` — `isBookFile`.
- Route handlers are UPPERCASE HTTP verbs exported as named functions — `export async function GET`, `POST`, `PATCH`, `DELETE`.
- Internal helpers are unexported function declarations near the bottom of the file — `safeParse` (`src/app/api/notes/route.ts`), `formatOf`, `extractFor`, `walk` (`src/lib/scanner/index.ts`), `validate`, `toPublic` (`src/lib/users.ts`).

**Variables:**
- camelCase throughout. Short single-letter names for tight `.map` callbacks (`b`, `a`, `n`, `s`, `e`, `p`) — see `src/app/api/books/route.ts` and `src/lib/scanner/index.ts`.
- Module-level constants: SCREAMING_SNAKE_CASE — `MIN_PASSWORD_LENGTH`, `USERNAME_RE` in `src/lib/users.ts`.

**Types:**
- PascalCase `interface` for object shapes and component props — `NotePayload`, `BookCardData`, `CurrentUser`, `PublicUser`, `ScanStatus`, `ExtractedCommon`.
- `type` for unions/aliases — `type Role = "admin" | "reader"`, `type BookFormat = "epub" | "pdf"` (`src/lib/scanner/index.ts`).
- String literal unions preferred over enums — `format: "epub" | "pdf"`.
- Prisma types imported as needed — `import type { Prisma } from "@prisma/client"` then `Prisma.BookWhereInput` (`src/app/api/books/route.ts`).

## Code Style

**Formatting:**
- No Prettier config present. Style is consistent by convention: 2-space indent, double-quoted strings, semicolons, trailing commas in multi-line literals/params.
- No `.prettierrc` / `.editorconfig` committed — formatting is enforced only by hand and ESLint defaults.

**Linting:**
- ESLint flat config in `eslint.config.mjs`, extending `next/core-web-vitals` and `next/typescript` via `FlatCompat`.
- Run with `npm run lint` (bare `eslint`).
- Ignores: `node_modules`, `.next`, `out`, `build`, `data`, `public`, `next-env.d.ts`.
- Inline disables are used sparingly and deliberately, e.g. `// eslint-disable-next-line @next/next/no-img-element` for the raw `<img>` cover in `src/components/BookCard.tsx`.

**TypeScript:**
- `strict: true` in `tsconfig.json`. `noEmit`, `isolatedModules`, `moduleResolution: "bundler"`, target `ES2017`.
- Typecheck with `npx tsc --noEmit` (per `CLAUDE.md`).
- Explicit return types on exported library functions (`Promise<PublicUser>`, `Promise<string>`, `boolean`). Route handlers and components rely on inference.
- Untrusted input cast then validated, never trusted blind — `(await req.json()) as NotePayload` followed by manual field checks (`src/app/api/notes/route.ts`).

## Import Organization

**Order (observed, top to bottom):**
1. Node built-ins with `node:` protocol — `import fs from "node:fs/promises"`, `import path from "node:path"` (`src/lib/scanner/index.ts`).
2. Third-party packages — `next/server`, `react`, `swr`, `bcryptjs`, `@prisma/client`.
3. Internal absolute imports via `@/` alias — `@/lib/prisma`, `@/lib/current-user`, `@/components/...`.
4. Relative sibling imports within a module group — `./hash`, `./epub`, `./pdf`, `./covers` inside `src/lib/scanner/`.

**Path Aliases:**
- `@/*` → `./src/*` (`tsconfig.json` `paths`). Used for all cross-directory imports; relative imports reserved for same-folder siblings (notably the scanner).

**Type-only imports:**
- `import type { ... }` used where the symbol is types-only — `import type { Prisma } from "@prisma/client"`, `import type { BookCardData } from "@/components/BookCard"`.

## Error Handling

**API routes — structured JSON errors with explicit status codes:**
- Bad JSON body: `try { body = await req.json() } catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }) }` — the canonical opening of every mutating handler (`src/app/api/notes/route.ts`, `src/app/api/users/route.ts`, `src/app/api/notes/[id]/route.ts`).
- Validation failures: `{ error: "<message>" }` with 400.
- Not found / ownership mismatch: 404, often as a bare `new NextResponse(null, { status: 404 })`. Ownership is enforced by checking `existing.userId !== userId` rather than leaking existence (`src/app/api/notes/[id]/route.ts`).
- Successful create: 201; successful delete: 204 (`new NextResponse(null, { status: 204 })`).
- Error message strings are lowercase, terse, machine-friendly — `"invalid json"`, `"unknown book"`, `"missing bookId"`.

**Typed domain errors mapped to status codes:**
- Custom `Error` subclasses with a `.name` carry intent: `UnauthenticatedError`, `ForbiddenError` (`src/lib/current-user.ts`), `UserInputError` (`src/lib/users.ts`).
- Auth guards throw, routes catch and translate via a shared `authError(e)` helper that maps `UnauthenticatedError → 401`, `ForbiddenError → 403`, and re-throws anything else (`src/app/api/users/route.ts`). `authError` is exported and reused by sibling routes.
- `UserInputError` is caught at the route boundary and mapped to 400; unexpected errors re-thrown to surface as 500 (`if (e instanceof UserInputError) ... ; throw e`).

**Library layer — guard-and-throw:**
- Validation throws typed errors close to the data (`validate` in `src/lib/users.ts`); routes own the HTTP mapping. Keeps `src/lib/` framework-agnostic.

**Scanner — swallow-and-continue with logging:**
- File-system races are intentionally swallowed with an explanatory comment, not surfaced — `try { stat = await fs.stat(...) } catch { return }` (`src/lib/scanner/index.ts`).
- Walk errors are counted, logged, and skipped so one bad file does not abort a full scan: `console.error(\`[scanner] scan failed for ${full}\`, err); stats.errors++` — `walkAndScan` returns `{ scanned, errors }`.

**Defensive parsing:**
- JSON stored as strings (note anchors) is read back through a `safeParse` helper returning `null` on failure rather than throwing (`src/app/api/notes/route.ts`).

## Logging

**Framework:** `console` only. No logging library. 15 `console.*` call sites across `src/`.

**Patterns:**
- Server-side scanner logs are tagged with a bracketed subsystem prefix — `console.error(\`[scanner] readdir failed at ${dir}\`, err)` (`src/lib/scanner/index.ts`). Match this prefix style for new background work.
- Prisma client log level is environment-gated: `["error", "warn"]` in development, `["error"]` otherwise (`src/lib/prisma.ts`).
- No request-level access logging; rely on Next.js defaults.

## Comments

**When to Comment:**
- Heavy use of intent/why comments over what. Every API route opens with a one-line contract comment naming the method, path, and body shape — e.g. `// POST /api/notes — create a note attached to a CFI/page anchor.` then `// Body: { bookId, anchor, body, context? }`.
- Non-obvious decisions get a rationale block — e.g. the SQLite `contains`/`mode: "insensitive"` warning in `src/app/api/books/route.ts`, and the idempotency/flow notes on `scanFile` in `src/lib/scanner/index.ts`.
- Future-work and v1-scope notes are inline and explicit — see `removeFileFromLibrary` (`src/lib/scanner/index.ts`).

**JSDoc/TSDoc:**
- Not used. Comments are plain `//` line comments above the declaration, not `/** */` doc blocks. Types carry the structural documentation.

## Function Design

**Size:** Small, single-purpose. Larger files (`scanFile`) are linear flows with numbered-step comments rather than deep nesting.

**Parameters:**
- Multi-field inputs passed as a single object literal with an inline or named interface — `createUser(input: { username; password; role })`, `BookCard({ book }: { book: BookCardData })`.
- Dynamic route handlers take the Next 15 `params` promise signature: `{ params }: { params: Promise<{ id: string }> }`, then `const { id } = await params` (`src/app/api/notes/[id]/route.ts`). Always `await params`.
- Unused first arg named `_req` (`src/app/api/notes/[id]/route.ts` DELETE).

**Return Values:**
- Library functions return typed plain objects / DTOs, never Prisma rows directly to the client. A `toPublic` mapper strips sensitive fields like `passwordHash` (`src/lib/users.ts`).
- API responses are hand-shaped JSON objects mapping DB rows to explicit field lists — never `NextResponse.json(row)` of a raw Prisma record (`src/app/api/books/route.ts`, `src/app/api/notes/route.ts`).

## Module Design

**Exports:**
- Named exports throughout for libraries, components, and route handlers. Pages and the home component use `export default` (Next.js requirement).
- Shared singletons memoized on `globalThis` to survive dev hot-reload — the Prisma client pattern in `src/lib/prisma.ts`.

**Barrel Files:**
- None. `src/lib/scanner/index.ts` is a dispatch/entry module with real logic, not a re-export barrel. Import concrete paths directly.

**Client/server split:**
- `"use client"` is the first line of interactive components (11 files: all readers, managers, `LibraryHeader`, and the `page.tsx` home/search views).
- Server-only code (`src/lib/`, route handlers, scanner) never carries `"use client"` and freely imports `node:` built-ins and `prisma`.
- Data fetching in client components uses SWR with a shared inline `const fetcher = (url) => fetch(url).then((r) => r.json())` and `refreshInterval` polling (`src/app/page.tsx`). Six components use SWR.

## Styling

- TailwindCSS v4 utility classes inline in `className`; no CSS modules. Global styles live in `src/app/globals.css`.
- Dark-first palette: `zinc-*` surfaces, `amber-400` accent (`src/components/BookCard.tsx`, `src/app/page.tsx`).
- Per `CLAUDE.md`: the app-shell layout (`src/app/layout.tsx`, `globals.css`) and the in-reader epub.js layout (`src/components/EpubReader.tsx`) are separate systems — edit the one that owns the symptom.

---

*Convention analysis: 2026-05-31*
