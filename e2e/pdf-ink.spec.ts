import { test, expect, type Page } from "@playwright/test";

// PDF ink clean-clip gate.
//
// A PDF ink stroke belongs to ONE page and stores its points as fractions of
// that page (per the PDF format itself — an Ink annotation is a per-page object).
// Dragging a stroke off the page used to clamp every past-edge point to the
// boundary, accumulating a flat line ALONG the page edge — the same "straight
// line across the screen" smear the EPUB block-cage produced.
//
// The fix ends the stroke at the page edge instead. This spec draws a stroke that
// descends the page and then sweeps horizontally BELOW it: under the old clamp
// that sweep would land as a wide run of points pinned at y≈1; under the fix the
// stroke has already ended at the crossing, so no such run exists.

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };
const PDF_TITLE = "E2E Sample PDF";

interface BookRow {
  id: string;
  title: string;
  format: "epub" | "pdf";
}

interface InkRow {
  id: string;
  page: number | null;
  points: number[][];
  anchor?: { kind: string };
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

test("PDF ink: a stroke dragged off the page ends at the edge, no smear", async ({
  page,
}) => {
  test.setTimeout(90_000);

  await signIn(page);

  const res = await page.request.get("/api/books");
  const { books } = (await res.json()) as { books: BookRow[] };
  const book = books.find((b) => b.title === PDF_TITLE);
  expect(book, "seeded PDF present").toBeTruthy();
  const bookId = book!.id;

  // Clean slate so the assertions name exactly the stroke this test draws.
  const listed = (await (await page.request.get(`/api/ink?bookId=${bookId}`)).json()) as {
    strokes: InkRow[];
  };
  for (const s of listed.strokes) await page.request.delete(`/api/ink/${s.id}`);

  await page.goto(`/books/${bookId}/read`);
  await expect(page.getByText(/^1 \/ \d+$/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("canvas").first()).toBeVisible();

  // Turn on Draw and let the ink toolbar mount (it shifts the layout, so the
  // page box must be measured after it settles).
  await page.getByRole("button", { name: "Draw" }).click();
  await expect(page.getByRole("button", { name: /eras/i })).toBeVisible();

  // The ink overlay IS the page's coordinate box (rectRef in InkLayer).
  const overlay = page.locator("svg.z-20").first();
  await expect(overlay).toBeVisible();
  const pg = (await overlay.boundingBox())!;
  expect(pg.width, "the page overlay has real size").toBeGreaterThan(50);

  await test.step("descend the page, then sweep horizontally below it", async () => {
    const startX = pg.x + pg.width * 0.5;
    const startY = pg.y + pg.height * 0.4;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // In-page descent to just above the bottom edge.
    for (let i = 1; i <= 6; i++) {
      await page.mouse.move(startX, startY + (pg.height * 0.55 * i) / 6);
    }
    // Off the bottom edge (beyond the 6px slop) and sweep left→right well below
    // the page. The OLD clamp turned this into a wide flat line at y≈1.
    const belowY = pg.y + pg.height + 40;
    for (let i = 0; i <= 8; i++) {
      await page.mouse.move(pg.x + pg.width * (0.1 + 0.1 * i), belowY);
    }
    await page.mouse.up();
  });

  await test.step("the persisted stroke is a page stroke with no edge smear", async () => {
    const { strokes } = (await (
      await page.request.get(`/api/ink?bookId=${bookId}`)
    ).json()) as { strokes: InkRow[] };
    expect(strokes, "exactly the one stroke this test drew").toHaveLength(1);
    const s = strokes[0];

    // PDF shape: fastened to a page, no block anchor.
    expect(s.page, "a PDF stroke carries a page").not.toBeNull();
    expect(s.anchor, "a PDF stroke has no block anchor").toBeUndefined();
    expect(s.points.length, "the descent drew real geometry").toBeGreaterThan(2);

    // Nothing persisted past the page (clean-clip keeps points on the page).
    const maxY = Math.max(...s.points.map(([, y]) => y));
    expect(maxY, "no point sits below the page edge").toBeLessThanOrEqual(1.03);

    // The decisive check: the horizontal below-page sweep did NOT land as a run
    // of points pinned along the bottom edge. Under the old clamp, points at
    // y≈1 would span most of the page width; under the fix there is at most the
    // single crossing point, so their x-spread is tiny.
    const edgeXs = s.points.filter(([, y]) => y >= 0.97).map(([x]) => x);
    const spread = edgeXs.length ? Math.max(...edgeXs) - Math.min(...edgeXs) : 0;
    expect(
      spread,
      `edge points must not smear across the page (x-spread ${spread.toFixed(3)}, count ${edgeXs.length})`,
    ).toBeLessThan(0.2);
  });

  await page.screenshot({ path: "e2e/screenshots/pdf-ink-clean-clip.png" });
});
