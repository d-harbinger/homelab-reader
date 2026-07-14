import { test, expect, type Page } from "@playwright/test";

// Reader right-click menu + wheel page-turn gate.
//
// Proves, against the real readers: right-click on the reading surface
// suppresses the browser menu and opens the app's reader menu (role
// "menu", labelled items), menu actions actually act (PDF page turn),
// and a wheel gesture turns the page in paginated mode. The EPUB half
// exercises the in-iframe listener path (epub.js renders sections into
// iframes; the listener translates coordinates out).

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };
const EPUB_TITLE = "E2E Sample EPUB";
const PDF_TITLE = "E2E Sample PDF";

interface BookRow {
  id: string;
  title: string;
  format: "epub" | "pdf";
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
  } else {
    await page.goto("/login");
    await page.fill("#username", ADMIN.username);
    await page.fill("#password", ADMIN.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
  }
  await page.waitForURL("**/");
}

async function bookId(page: Page, title: string): Promise<string> {
  const res = await page.request.get("/api/books");
  const { books } = (await res.json()) as { books: BookRow[] };
  const book = books.find((b) => b.title === title);
  expect(book, `${title} present`).toBeTruthy();
  return book!.id;
}

test("PDF reader: right-click menu opens, turns the page, wheel flips too", async ({ page }) => {
  await signIn(page);
  const id = await bookId(page, PDF_TITLE);
  await page.goto(`/books/${id}/read`);

  // Page 1 rendered (the header shows "1 / N").
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible({ timeout: 30_000 });
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();

  // Right-click the page → the app menu, not the browser's. Coordinate
  // click: the text layer overlays the canvas, so locator actionability
  // would wait forever on the "covered" element.
  const cbox = (await canvas.boundingBox())!;
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2, { button: "right" });
  const menu = page.getByRole("menu", { name: "Reader menu" });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Next page" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Paginated" })).toBeVisible();

  // A plain left-click on the page dismisses the menu (the stuck-menu
  // bug from the owner's hand-test). Then reopen it for the rest of the
  // test.
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 3);
  await expect(menu).toBeHidden();
  await page.mouse.click(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2, { button: "right" });
  await expect(menu).toBeVisible();

  // The seeded fixture may be a single page; the menu must reflect
  // reality either way. Multi-page → the action turns the page and the
  // wheel flips; single page → Next is correctly disabled and the wheel
  // leaves the indicator alone.
  const indicator = await page.getByText(/^\d+ \/ \d+$/).textContent();
  const total = Number(indicator!.split("/")[1].trim());
  const nextItem = menu.getByRole("menuitem", { name: "Next page" });

  if (total > 1) {
    await nextItem.click();
    await expect(menu).toBeHidden();
    await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();

    // Wheel forward → one page per gesture (throttled), then back.
    // (mouse.move, not hover — the text layer overlays the canvas and
    // hover's actionability check would wait on the "covered" element.)
    await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
    await page.mouse.wheel(0, 150);
    await expect(page.getByText(/^3 \/ \d+$/)).toBeVisible();
    await page.waitForTimeout(450);
    await page.mouse.wheel(0, -150);
    await expect(page.getByText(/^2 \/ \d+$/)).toBeVisible();
  } else {
    await expect(nextItem).toBeDisabled();
    await page.mouse.move(cbox.x + cbox.width / 2, cbox.y + cbox.height / 2);
    await page.mouse.wheel(0, 150);
    await expect(page.getByText(/^1 \/ 1$/)).toBeVisible();
    // Close the menu so the test ends in a clean state.
    await page.keyboard.press("Escape");
  }
});

test("EPUB reader: right-click inside the book opens the reader menu", async ({ page }) => {
  await signIn(page);
  const id = await bookId(page, EPUB_TITLE);
  await page.goto(`/books/${id}/read`);

  // Rendered: the progress readout replaces "Loading…".
  await expect(page.getByText(/%$/)).toBeVisible({ timeout: 30_000 });
  const viewer = page.locator("iframe").first();
  await expect(viewer).toBeVisible();

  // Right-click lands inside the section iframe; the in-iframe listener
  // suppresses the native menu and opens the app menu (rendered in the
  // outer document, coordinates translated).
  // Aim low in the viewport: other specs in the run may have painted a
  // highlight over the opening paragraphs, and right-clicking a mark
  // (correctly) opens the highlight menu rather than the reader menu.
  const box = (await viewer.boundingBox())!;
  const menu = page.getByRole("menu", { name: "Reader menu" });
  // Retry the right-click: under a cold full-suite run the section
  // document can render a beat before the contextmenu hook attaches,
  // and a click in that window does nothing (a human just clicks again).
  await expect(async () => {
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.85, {
      button: "right",
    });
    await expect(menu).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 20_000 });
  await expect(menu.getByRole("menuitem", { name: "Text larger" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Highlights & notes" })).toBeVisible();

  // An action acts: toggle the panel from the menu.
  await menu.getByRole("menuitem", { name: "Highlights & notes" }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByRole("heading", { name: /highlights/i })).toBeVisible();
});
