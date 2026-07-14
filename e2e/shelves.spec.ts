import { test, expect } from "@playwright/test";

// The bookstore-organization gate: the Shelves|Folders switcher renders
// both views, an admin shelf assignment (PATCH genre) moves a book onto
// its shelf in the Shelves view, and the organize-plan export projects
// that same assignment onto disk as a reviewable mv script.

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };
const EPUB_TITLE = "E2E Sample EPUB";

interface BookRow {
  id: string;
  title: string;
  format: "epub" | "pdf";
}

test("shelves: genre PATCH shelves a book; views switch; organize plan projects it", async ({ page }) => {
  // Order-tolerant bootstrap (create the admin or sign in).
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
  } else {
    await page.goto("/login");
    await page.fill("#username", ADMIN.username);
    await page.fill("#password", ADMIN.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
  }
  await page.waitForURL("**/");

  // Shelves is the default view; the seeded book (no subjects) sits on
  // the Unsorted pile and the folder rail is not rendered.
  await expect(page.getByRole("tab", { name: "shelves" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Unsorted" })).toBeVisible();
  await expect(page.getByText(EPUB_TITLE)).toBeVisible();

  // Shelve it via the allowlisted PATCH (the GenreShelf picker's wire call).
  const list = (await (await page.request.get("/api/books")).json()) as { books: BookRow[] };
  const epub = list.books.find((b) => b.title === EPUB_TITLE);
  expect(epub, "seeded EPUB present").toBeTruthy();
  const patch = await page.request.patch(`/api/books/${epub!.id}`, {
    data: { genre: "Science Fiction & Fantasy" },
  });
  expect(patch.status()).toBe(200);

  // The shelf appears in the Shelves view with the book on it.
  await page.reload();
  await expect(page.getByText("Science Fiction & Fantasy")).toBeVisible();

  // Folders view still shows disk truth (rail + grid), and the switcher
  // round-trips.
  await page.getByRole("tab", { name: "folders" }).click();
  await expect(page.getByRole("tab", { name: "folders" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText(EPUB_TITLE)).toBeVisible();
  await page.getByRole("tab", { name: "shelves" }).click();
  await expect(page.getByText("Science Fiction & Fantasy")).toBeVisible();

  // The organize plan is a well-formed script AND honors the safety
  // property: the seeded fixture book lives OUTSIDE the enabled scan
  // root, so despite being shelved it must never be planned for a move.
  // (Move emission itself is unit-gated in lib/library/organize-plan.test.)
  const plan = await page.request.get("/api/library/organize-plan");
  expect(plan.status()).toBe(200);
  const script = await plan.text();
  expect(script).toContain("set -euo pipefail");
  expect(script).toMatch(/# Plan: \d+ move\(s\)/);
  expect(script).not.toContain(EPUB_TITLE);
  expect(script).not.toContain("fixtures");
});
