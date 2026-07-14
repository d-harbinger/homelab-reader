import { test, expect } from "@playwright/test";

// End-to-end coverage of the text-quote → CFI resolution path (Phase C, slice
// P2), the served-surface complement to the resolve-textquote unit tests.
//
// A highlight synced from another device arrives with a text-quote anchor
// (surrounding text + reading position) and NO CFI, because a CFI only means
// something inside a specific EPUB rendition. This spec seeds exactly that
// through the real API, opens the web EPUB reader, and asserts the two things
// that prove resolution ran end-to-end:
//   1. the highlight mark paints in the reader (an epub.js SVG highlight), and
//   2. the stored anchor is upgraded in the database from "text-quote" to
//      "epub-cfi-range" — the one-time upgrade PATCH the reader fires on view.
//
// It boots through the same playwright.config.ts webServer as the core-flow
// spec (isolated SQLite DB, reset + seeded at boot). Auth is order-independent:
// the shared server may already have an admin from another spec, so this creates
// the first-run admin only if /setup still offers it, otherwise it logs in.

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };
const EPUB_TITLE = "E2E Sample EPUB";

// The EPUB fixture's single content section (OEBPS/ch1.xhtml) is exactly
// "<p>Chapter one body.</p>", so this quote resolves against its DOM.
const QUOTE = "Chapter one body";

interface BookRow {
  id: string;
  title: string;
  format: "epub" | "pdf";
}

test("text-quote highlight resolves to a CFI, paints, and upgrades in the DB", async ({
  page,
}) => {
  await test.step("authenticate (create the first admin, or log in if one exists)", async () => {
    await page.goto("/setup");
    const setupOffered = await page
      .getByRole("heading", { name: /welcome to homelab-reader/i })
      .isVisible()
      .catch(() => false);

    if (setupOffered) {
      await page.fill("#username", ADMIN.username);
      await page.fill("#password", ADMIN.password);
      await page.fill("#confirm", ADMIN.password);
      await page.getByRole("button", { name: /create admin/i }).click();
      // First-run step 2 (privacy choice): decline online lookups so the
      // suite runs fully offline.
      await page.waitForURL("**/setup/privacy");
      await page.getByRole("button", { name: /keep everything offline/i }).click();
      await page.waitForURL("**/");
    } else {
      await page.goto("/login");
      await page.fill("#username", ADMIN.username);
      await page.fill("#password", ADMIN.password);
      await page.getByRole("button", { name: /^sign in$/i }).click();
      await page.waitForURL("**/");
    }

    await expect(page.getByText(EPUB_TITLE)).toBeVisible();
  });

  let epubId = "";
  await test.step("discover the seeded EPUB id", async () => {
    const res = await page.request.get("/api/books");
    expect(res.status()).toBe(200);
    const { books } = (await res.json()) as { books: BookRow[] };
    const epub = books.find(
      (b) => b.format === "epub" && b.title === EPUB_TITLE,
    );
    expect(epub, "seeded EPUB present in /api/books").toBeTruthy();
    epubId = epub!.id;
  });

  let highlightId = "";
  await test.step("seed a text-quote highlight through the API (as a synced anchor)", async () => {
    const res = await page.request.post("/api/highlights", {
      data: {
        bookId: epubId,
        anchor: {
          type: "text-quote",
          quote: QUOTE,
          chapterHref: "ch1.xhtml",
          progression: 0.5,
        },
        text: QUOTE,
        color: "green",
      },
    });
    expect(res.status()).toBe(200);
    const hl = (await res.json()) as {
      id: string;
      anchor: { type: string; cfi?: string };
    };
    expect(hl.id).toBeTruthy();
    // Stored verbatim as a text-quote anchor — not yet resolved to a CFI.
    expect(hl.anchor.type).toBe("text-quote");
    expect(hl.anchor.cfi).toBeUndefined();
    highlightId = hl.id;
  });

  await test.step("open the EPUB reader and confirm it renders", async () => {
    await page.goto(`/books/${epubId}/read`);
    await expect(page.getByText(EPUB_TITLE)).toBeVisible();
    // epub.js reaches a rendered state: the pager label flips from "Loading…"
    // to a concrete percentage once the rendition displays.
    await expect(page.getByText(/^\d+%$/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the resolved highlight paints a mark in the reader", async () => {
    // epub.js renders a highlight as an SVG <g ref="epubjs-hl"> in the view's
    // overlay (outer document), tagged data-id with the highlight's id. Its
    // presence means the text-quote anchor resolved to a CFI and the mark was
    // added — resolve-on-view actually painted.
    await expect(
      page.locator(`[ref="epubjs-hl"][data-id="${highlightId}"]`),
    ).toHaveCount(1, { timeout: 30_000 });
  });

  await test.step("the stored anchor is upgraded from text-quote to epub-cfi-range", async () => {
    // The reader fires the one-time upgrade PATCH after resolving. Poll the API
    // until the persisted anchor reflects the upgrade (the fetch is fire-and-
    // forget, so it lands shortly after the mark paints).
    await expect
      .poll(
        async () => {
          const list = await page.request.get(
            `/api/highlights?bookId=${epubId}`,
          );
          if (list.status() !== 200) return null;
          const { highlights } = (await list.json()) as {
            highlights: { id: string; anchor: { type: string; cfi?: string } }[];
          };
          const row = highlights.find((h) => h.id === highlightId);
          return row?.anchor.type ?? null;
        },
        { timeout: 30_000, intervals: [250, 500, 1000] },
      )
      .toBe("epub-cfi-range");

    // And the upgraded anchor carries a concrete CFI while preserving the quote.
    const list = await page.request.get(`/api/highlights?bookId=${epubId}`);
    const { highlights } = (await list.json()) as {
      highlights: {
        id: string;
        anchor: { type: string; cfi?: string; quote?: string };
      }[];
    };
    const row = highlights.find((h) => h.id === highlightId);
    expect(row?.anchor.cfi, "upgraded anchor has a CFI").toBeTruthy();
    expect(row?.anchor.quote, "quote context is preserved").toBe(QUOTE);
  });
});
