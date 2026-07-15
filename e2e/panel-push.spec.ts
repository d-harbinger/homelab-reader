import { test, expect, type Page } from "@playwright/test";

// Highlights panel layout + highlight undo, against the real EPUB reader.
//
// Proves two behaviors a unit test can't:
//   1. Opening the highlights panel PUSHES the reading surface aside instead
//      of overlaying it — including the epub.js reflow: the section iframe
//      itself must shrink (the reader's ResizeObserver → rendition.resize()
//      path), not just the outer flex column, and the panel's box must not
//      intersect the shrunken surface.
//   2. Ctrl+Z deletes the most recent highlight created in the session — the
//      full path: highlighter-mode drag selection inside the section iframe →
//      highlight persisted (header badge increments) → Ctrl+Z → gone again.

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };
const EPUB_TITLE = "E2E Sample EPUB";

interface BookRow {
  id: string;
  title: string;
}

async function signIn(page: Page) {
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
    await page.waitForURL("**/setup/privacy");
    await page.getByRole("button", { name: /keep everything offline/i }).click();
  } else {
    await page.goto("/login");
    await page.fill("#username", ADMIN.username);
    await page.fill("#password", ADMIN.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
  }
  await page.waitForURL("**/");
}

async function openEpubReader(page: Page) {
  const res = await page.request.get("/api/books");
  const { books } = (await res.json()) as { books: BookRow[] };
  const book = books.find((b) => b.title === EPUB_TITLE);
  expect(book, `${EPUB_TITLE} present`).toBeTruthy();
  await page.goto(`/books/${book!.id}/read`);
  await expect(page.getByText(/%$/)).toBeVisible({ timeout: 30_000 });
  const viewer = page.locator("iframe").first();
  await expect(viewer).toBeVisible();
  return viewer;
}

test("opening the highlights panel pushes the book aside (and epub.js reflows)", async ({ page }) => {
  await signIn(page);
  const viewer = await openEpubReader(page);
  const before = (await viewer.boundingBox())!;

  await page.getByRole("button", { name: "Highlights and notes" }).click();
  const panel = page.getByRole("heading", { name: /highlights & notes/i });
  await expect(panel).toBeVisible();

  // The rendition reflow runs through a ResizeObserver + rAF, so poll: the
  // iframe must end up narrower by roughly the panel's width...
  await expect(async () => {
    const after = (await viewer.boundingBox())!;
    expect(after.width).toBeLessThan(before.width - 300);
  }).toPass({ timeout: 10_000 });

  // ...and the panel must sit BESIDE the surface, not over it.
  const surface = (await viewer.boundingBox())!;
  const aside = (await page
    .locator("aside", { has: panel })
    .boundingBox())!;
  expect(aside.x).toBeGreaterThanOrEqual(surface.x + surface.width - 1);
});

test("Ctrl+Z undoes the highlight just made in highlighter mode", async ({ page }) => {
  await signIn(page);
  await openEpubReader(page);

  // Highlights persist across specs in a run, so count relative to the
  // badge's starting value (absent badge = 0).
  const notebookBtn = page.getByRole("button", { name: "Highlights and notes" });
  const startBadge = await notebookBtn.textContent();
  const start = Number(startBadge?.trim() || "0");

  // Highlighter mode on: a drag selection applies the color immediately.
  await page.getByRole("button", { name: "Highlighter" }).click();

  // Select a word of the fixture's text line inside the section iframe by
  // double-click (word select) — a drag selection is flaky under synthesized
  // input, and the reader's mouseup hook fires either way. Under a cold run
  // the selection hooks can attach a beat after first paint, so retry the
  // gesture until the badge ticks up.
  const line = page
    .frameLocator("iframe")
    .getByText(/chapter one body/i)
    .first();
  const box = (await line.boundingBox())!;
  await expect(async () => {
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    await expect(notebookBtn).toContainText(String(start + 1), { timeout: 2000 });
  }).toPass({ timeout: 20_000 });

  // Ctrl+Z deletes it again — badge back to where it started (the badge
  // element disappears entirely at zero).
  await page.keyboard.press("Control+z");
  if (start > 0) {
    await expect(notebookBtn).toContainText(String(start));
  } else {
    await expect(notebookBtn).not.toContainText("1");
  }

  // And the deletion is persisted, not cosmetic: reload and the badge still
  // shows the starting count.
  await page.reload();
  await expect(page.getByText(/%$/)).toBeVisible({ timeout: 30_000 });
  if (start > 0) {
    await expect(notebookBtn).toContainText(String(start));
  } else {
    await expect(notebookBtn).not.toContainText("1");
  }
});
