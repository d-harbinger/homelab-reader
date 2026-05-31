---
phase: 02-opds-per-user-authentication
reviewed: 2026-05-30T00:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - prisma/schema.prisma
  - src/lib/opds-auth.ts
  - src/app/api/opds/route.ts
  - src/app/api/opds/all/route.ts
  - src/app/api/opds/recent/route.ts
  - src/app/api/opds/progress/route.ts
  - src/app/api/opds-tokens/route.ts
  - src/app/api/opds-tokens/[id]/route.ts
  - src/auth.config.ts
  - src/app/settings/tokens/page.tsx
  - src/components/TokenManager.tsx
  - src/components/LibraryHeader.tsx
  - tests/opds-auth.test.ts
  - tests/opds-tokens.test.ts
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-30
**Depth:** deep (cross-file + cross-repo contract conformance)
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The OPDS per-user authentication implementation is, in the code itself, careful
and largely correct against the cross-repo wire contract: the Basic/Bearer
split is right (first-colon, token-survives-colons), the SHA-256 lookup +
`timingSafeEqual` compare is sound, the `WWW-Authenticate` realm string is
byte-exact, the 401 challenge is wired into every OPDS route, `lastUsedAt` is
genuinely fire-and-forget, the token list uses an explicit non-secret `select`,
mint returns plaintext exactly once, revoke is IDOR-safe (404 on non-owner),
and progress is attributed strictly to the token owner. No token or hash is
logged or leaked into a URL/error/response. Tests are real (ephemeral SQLite,
not mocked data path).

**However, there is one BLOCKER that breaks the entire feature at runtime:**
the `OpdsToken` model was added to `prisma/schema.prisma` but **no migration
was generated or committed.** Every runtime path (`predev`, the Docker
entrypoint, and the tests themselves) runs `prisma migrate deploy`, which
applies only committed migration files — none of which create the `OpdsToken`
table. The code typechecks (the generated client is built from the schema, not
migrations) but every OPDS auth query hits a nonexistent table. This also means
the new test suites cannot have passed: their `beforeAll` seeds `OpdsToken`
rows against the same migrated temp DB and would throw "no such table". This
directly violates the project's CLAUDE.md rule: "schema edits require
`npx prisma migrate dev --name <descriptive>` ... commit schema + migration
together."

Fix the migration and the rest of the phase is in good shape.

## Critical Issues

### CR-01: `OpdsToken` table has no migration — feature dead at runtime, tests cannot pass

**File:** `prisma/schema.prisma:53` (model added) + `prisma/migrations/` (no corresponding migration)

**Issue:**
The schema now declares `model OpdsToken` and the `User.opdsTokens`
back-relation, but `prisma/migrations/` contains only `20260521170330_initial`
and `20260525120000_add_user_role`. Neither creates an `OpdsToken` table:

```
$ grep -rni "opds" prisma/migrations/        # -> no matches
$ git status --porcelain prisma/             # -> no untracked migration
```

Every runtime path applies committed migrations via `prisma migrate deploy`:
- `package.json:8` `predev`: `... && prisma migrate deploy && ...`
- `docker-entrypoint.sh:49`: `node "$PRISMA_CLI" migrate deploy ...`
- `package.json:18` `db:migrate`: `prisma migrate deploy`
- both new tests, `beforeAll`: `execFileSync("npx", ["prisma","migrate","deploy"], ...)`

`prisma generate` reads the schema (so the client gains an `opdsToken` delegate
and the code typechecks), but the database never gets the table. Result:
- Production / dev: the first OPDS request, token mint, or list throws at the
  Prisma layer — effectively `SQLite error: no such table: main.OpdsToken`.
  OPDS auth, token management, and OPDS progress are all 500s.
- Tests: `tests/opds-auth.test.ts` and `tests/opds-tokens.test.ts` seed
  `opdsToken.create(...)` in `beforeAll` against the freshly-migrated temp DB.
  With no migration, that throws and the entire suite fails in setup — so the
  green claim in the test headers ("real ephemeral SQLite ... OpdsToken table
  from the opds_tokens migration generated on the host") describes a migration
  that does not exist in the tree.

This is the headline defect: the implementation is otherwise correct but
non-functional and unshippable until the migration lands.

**Fix:**
Generate and commit the migration alongside the schema (per CLAUDE.md):

```bash
npx prisma migrate dev --name opds_tokens
git add prisma/schema.prisma prisma/migrations/<timestamp>_opds_tokens/
```

The generated SQL should create `OpdsToken` with a UNIQUE index on `tokenHash`,
an index on `userId`, and the `ON DELETE CASCADE` FK to `User`, matching the
schema. Verify the test comments' claim by running `npm test` after the
migration exists. Do not hand-write the SQL; let Prisma generate it so the
checksum in `migration_lock.toml`/`_prisma_migrations` stays consistent.

## Warnings

### WR-01: `findUnique` on a non-`@unique` field in the OPDS progress book check is fine, but unvalidated `anchor.type` is stored verbatim

**File:** `src/app/api/opds/progress/route.ts:35-47`

**Issue:**
The handler accepts `anchor` as any object and JSON-stringifies it straight into
the `Progress.anchor` column without validating `anchor.type` against the known
set (`"epub-cfi"` | `"pdf-page"`) or that the matching field (`cfi`/`page`) is
present and well-typed. A malformed client can persist `{"type":"garbage"}` or
an arbitrarily large object as progress. This is not an injection risk (it is
JSON-serialized, not interpolated), but the web reader that later reads this row
will get an anchor it cannot resolve, silently breaking resume-position for that
book. The web `/api/progress` route has the identical gap, so this is a
pre-existing pattern, but the OPDS path is new code and the contract names the
exact anchor shapes.

**Fix:**
Validate the discriminated union before persisting:

```ts
const validAnchor =
  (anchor.type === "epub-cfi" && typeof anchor.cfi === "string") ||
  (anchor.type === "pdf-page" && typeof anchor.page === "number");
if (!validAnchor) {
  return NextResponse.json({ error: "invalid anchor" }, { status: 400 });
}
```

### WR-02: Token label length is clamped on write but not on the contract's UI promise; empty-after-trim slice edge

**File:** `src/app/api/opds-tokens/route.ts:62-66`

**Issue:**
`label.slice(0, 200)` is applied to the already-trimmed `label`, but the 400
guard above checks the un-sliced `label` for emptiness. That ordering is fine,
but the 200-char clamp is silent — a client sending a 5000-char label gets a
truncated label back with no signal, and the truncation is only on the server
copy. Minor, but it means the mint response's `label` can differ from what a
non-conforming client sent without an error. Low blast radius; flagged for
robustness, not correctness.

**Fix:**
Either reject over-long labels explicitly (`if (label.length > 200) return 400`)
or document the silent clamp. Returning the clamped `row.label` (which the code
already does) is correct either way; prefer the explicit reject so the client
knows.

### WR-03: `extractToken` Basic branch has a dead try/catch — `Buffer.from(..., "base64")` never throws

**File:** `src/lib/opds-auth.ts:38-43`

**Issue:**
`Buffer.from(b64, "base64")` does not throw on invalid base64 — it silently
decodes what it can and ignores the rest. The `try/catch` around it is dead code
that can never catch anything, and `decoded` is always assigned. This is
harmless (the subsequent `indexOf(":") === -1` and empty-token checks still
reject garbage) but the comment/structure implies a guard that does not exist,
which can mislead a future maintainer into assuming malformed base64 is rejected
here. It is not — `Basic ===garbage===` decodes to some bytes and falls through
to the colon check.

**Fix:**
Drop the try/catch (it is unreachable) and rely on the colon/empty checks, or if
strict rejection of non-base64 is desired, validate explicitly:

```ts
const decoded = Buffer.from(b64, "base64").toString("utf8");
const colon = decoded.indexOf(":");
if (colon === -1) return null;
```

### WR-04: Guard returns the full `User` row (including `passwordHash`) to every OPDS handler

**File:** `src/lib/opds-auth.ts:72-93`

**Issue:**
`authenticateOpds` does `include: { user: true }` and returns `row.user`, which
carries `passwordHash`. The current callers only read `user.id`, so nothing
leaks today — but handing a full credentialed `User` (with the bcrypt hash) to
every OPDS route is a latent disclosure footgun: a future handler that
serializes `user` into a feed or error would leak the password hash. The contract
only needs the user id for attribution.

**Fix:**
Select only what callers need, or return the id directly:

```ts
const row = await prisma.opdsToken.findUnique({
  where: { tokenHash },
  select: { id: true, tokenHash: true, user: { select: { id: true, role: true } } },
});
...
return row.user; // now { id, role } only
```

Adjust the return type from `User` to a narrowed shape.

## Info

### IN-01: Defensive `timingSafeEqual` after an indexed `findUnique` is belt-and-suspenders, not a real timing fix

**File:** `src/lib/opds-auth.ts:78-84`

**Issue:**
The comment frames the constant-time compare as guarding "any timing oracle in
the comparison path," but the row was already fetched by exact `tokenHash`
equality in `findUnique` — if a row came back, the hashes are equal by
definition, so the compare always passes. The DB index lookup itself is the
(non-constant-time) part, but that is keyed on the SHA-256 of a high-entropy
secret, so a timing oracle there is not exploitable. The code is correct and the
extra compare is harmless; the comment slightly overstates what it buys. No
change required.

### IN-02: `lastUsedAt` bump can race / write after response, acceptable here

**File:** `src/lib/opds-auth.ts:86-91`

**Issue:**
The fire-and-forget `update` is correctly not awaited and swallows errors, which
matches the contract ("bump lastUsedAt" without blocking the feed). In a
serverless/edge runtime the function could be frozen before the write lands, but
this app runs as a long-lived Node server (Docker, `next start`), so the write
completes. Noted only so a future serverless move revisits it. No change.

### IN-03: `MintedBanner` correctly drops the plaintext on dismiss; clipboard fallback is sound

**File:** `src/components/TokenManager.tsx` (MintedBanner, MintForm)

**Issue:**
Verified the UI does not persist the plaintext: it lives only in `minted` state,
is cleared on "Done" (`onDismiss -> setMinted(null)`), is never written to
localStorage/SWR cache, and the list refetch (`mutate()`) returns rows without a
token. The clipboard `catch` is a no-op with a correct comment (the field stays
selectable). The only nit: the token sits in React state/DOM until dismissed,
which is the intended one-time-reveal UX and matches the contract. No change.

---

_Reviewed: 2026-05-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
