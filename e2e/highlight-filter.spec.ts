import { test, expect, type Page } from "@playwright/test";

// Home-page "filter by highlight color" gate.
//
// A reader color-codes highlights (e.g. green = key terms). The library shows a
// chip per color that actually appears; selecting one narrows the whole library
// to books carrying that color, so every key-term book is one glance. This spec
// seeds two highlights of different colors on one book, then drives the bar.

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };
const PDF_TITLE = "E2E Sample PDF";

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

async function addHighlight(page: Page, bookId: string, color: string) {
  const res = await page.request.post("/api/highlights", {
    data: {
      bookId,
      color,
      text: `a ${color} mark`,
      anchor: { type: "pdf-rect", page: 1, rects: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.02 }] },
    },
  });
  expect(res.ok(), `seeded ${color} highlight`).toBeTruthy();
}

test("library filters to books by highlight color", async ({ page }) => {
  test.setTimeout(90_000);

  await signIn(page);

  const { books } = (await (await page.request.get("/api/books")).json()) as {
    books: BookRow[];
  };
  const book = books.find((b) => b.title === PDF_TITLE)!;

  // Clean slate, then seed a green and a blue highlight on this one book.
  const existing = (await (
    await page.request.get(`/api/highlights?bookId=${book.id}`)
  ).json()) as { highlights: { id: string }[] };
  for (const hglt of existing.highlights) {
    await page.request.delete(`/api/highlights/${hglt.id}`);
  }
  await addHighlight(page, book.id, "green");
  await addHighlight(page, book.id, "blue");

  await page.goto("/");
  await page.reload(); // ensure the highlight-colors fetch runs post-seed

  // The bar shows a chip per present color; green and blue must be there.
  const greenChip = page.getByRole("button", { name: /^Green\b/ });
  const blueChip = page.getByRole("button", { name: /^Blue\b/ });
  await expect(greenChip).toBeVisible({ timeout: 15_000 });
  await expect(blueChip).toBeVisible();

  // A color the library doesn't have must NOT get a chip.
  await expect(page.getByRole("button", { name: /^Purple\b/ })).toHaveCount(0);

  await test.step("selecting Green narrows to the highlighted book", async () => {
    await greenChip.click();
    // The filtered grid names its count and shows the book.
    await expect(page.getByText(/book(s)? highlighted/i)).toBeVisible();
    await expect(page.getByRole("link", { name: new RegExp(PDF_TITLE, "i") })).toBeVisible();
  });

  await test.step("Clear returns to the normal library", async () => {
    await page.getByRole("button", { name: /^Clear$/ }).click();
    await expect(page.getByText(/book(s)? highlighted/i)).toHaveCount(0);
  });

  await page.screenshot({ path: "e2e/screenshots/highlight-filter.png" });
});
