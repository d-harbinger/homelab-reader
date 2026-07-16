import { test, expect, type Page } from "@playwright/test";

// The acceptance test for block-anchored EPUB ink, against a real book in a real
// browser. Everything this file asserts was unproven until it ran: pointer
// capture on the overlay, elementFromPoint through the section iframe, the
// CFI round-trip, and the frame-offset viewport conversion on live column
// geometry.
//
// The claim under test is the one the whole design exists to make: a freehand
// stroke on reflowable text is fastened to the BLOCK it was drawn across, not to
// a pixel — so it survives a reflow and stays on the same words. A stroke
// anchored to pixels would pass a reload and fail the font-size change; that
// second half is the acceptance criterion.
//
// Two traps this spec is written to avoid:
//
//   1. The empty pass. An overlay that resolves nothing renders nothing and
//      throws nothing, which looks identical to success if the assertions only
//      check that no error appeared. So every check here is geometric: an SVG
//      path must exist, carry a non-empty `d`, and occupy a real box on screen.
//
//   2. The vacuous pass. If the anchoring paragraph does not actually MOVE when
//      the font size changes, then "the stroke is still on the paragraph" is
//      true of a pixel-anchored stroke too, and proves nothing. So the spec
//      first asserts the text moved by a meaningful distance, and only then
//      asserts the stroke moved WITH it. The relationship is what is tested —
//      never that coordinates are unchanged, which is the opposite of the claim.

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };
const INK_TITLE = "E2E Ink EPUB";

// The fixture's second paragraph, class="target". Chosen because at every font
// size this spec uses it stays whole inside the first column — no column split,
// so its box describes real text — while still being pushed a long way down the
// page by the paragraph above it growing. Both properties are asserted rather
// than assumed.
const TARGET_SELECTOR = "p.target";

interface BookRow {
  id: string;
  title: string;
  format: "epub" | "pdf";
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface InkRow {
  id: string;
  page: number | null;
  points: number[][];
  anchor?: { kind: string; cfi?: string; section?: number };
}

// Auth is order-independent: the shared server may already have an admin from
// another spec, so create the first-run one only if /setup still offers it.
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
    await page.waitForURL("**/");
  } else {
    await page.goto("/login");
    await page.fill("#username", ADMIN.username);
    await page.fill("#password", ADMIN.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
    await page.waitForURL("**/");
  }
}

// The anchoring paragraph's on-screen FRAGMENTS, in outer viewport coordinates.
//
// getClientRects, not getBoundingClientRect: a paragraph broken across a column
// boundary reports one rect per fragment, and the bounding box would be their
// union — a rectangle spanning the gap between the columns that describes no
// text at all. Asserting containment against that union is how this spec would
// quietly go vacuous, because the union is nearly the size of the screen.
//
// The frame offset is the whole viewport conversion: the section iframe spans
// every column and slides left as the container scrolls, so a rect measured
// inside it plus the frame's own offset is the on-screen position. This spec
// computes it independently of the overlay — if the overlay's conversion were
// wrong, the stroke simply would not land on these boxes.
async function targetRects(page: Page, selector: string): Promise<Box[] | null> {
  return page.evaluate((sel) => {
    for (const frame of Array.from(document.querySelectorAll("iframe"))) {
      const doc = frame.contentDocument;
      if (!doc) continue;
      const el = doc.querySelector(sel);
      if (!el) continue;
      const f = frame.getBoundingClientRect();
      const rects = Array.from(el.getClientRects())
        .filter((r) => r.width > 0 && r.height > 0)
        .map((r) => ({
          x: f.left + r.left,
          y: f.top + r.top,
          width: r.width,
          height: r.height,
        }));
      if (rects.length === 0) continue;
      return rects;
    }
    return null;
  }, selector);
}

// The painted stroke's box, read off the live SVG geometry rather than off the
// model. `d` is returned so an empty path — the shape a zero-rect resolve would
// produce — cannot masquerade as a rendered stroke.
async function strokeBox(page: Page): Promise<(Box & { d: string }) | null> {
  return page.evaluate(() => {
    const svg = document.querySelector("svg.z-30");
    if (!svg) return null;
    // The first path of each placed stroke is the visible one; the second is the
    // fat transparent erase target, which is not what a reader sees.
    const paths = Array.from(svg.querySelectorAll("path")).filter((p) => {
      const s = p.getAttribute("stroke");
      return s !== null && s !== "transparent";
    });
    if (paths.length === 0) return null;
    const p = paths[0];
    const d = p.getAttribute("d") ?? "";
    const r = p.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height, d };
  });
}

function centerOf(b: Box) {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Wait until the target paragraph is laid out AND has stopped moving.
//
// Deliberately not a wait on the pager label: the reader's toolbar also renders
// a "100%" font-size chip, so a /^\d+%$/ text match goes green while the book is
// still showing "Loading…" — measuring then aims the stroke at where the text is
// not. The paragraph's own box settling is the real readiness signal, and it is
// the thing this spec actually depends on. It also covers the reflow that Draw
// mode itself triggers: mounting the ink toolbar shrinks the reading row, trips
// the reader's ResizeObserver, and re-columns the book.
// Returns the paragraph's SINGLE fragment box once the layout has stopped
// moving. The single-fragment demand is a guard on this spec's own premise, not
// a claim about the feature: the fixture's target paragraph is chosen to sit
// whole inside one column at every size the spec uses, so that "the ink is on
// the paragraph" is a tight statement about a real box. If a layout change ever
// splits it across a column, the union box would balloon and the containment
// checks would start passing for the wrong reason — so fail loudly here instead.
// (The overlay's own handling of a split block is covered by pickFragment's unit
// tests; this spec is about reflow survival.)
async function settledBox(page: Page, selector: string): Promise<Box> {
  let last: Box | null = null;
  let stable = 0;
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    const rects = await targetRects(page, selector);
    const box = rects?.[0] ?? null;
    if (box && last && box.x === last.x && box.y === last.y && box.width === last.width) {
      if (++stable >= 2) {
        expect(
          rects!.length,
          `the target paragraph must sit whole in one column for this comparison to mean anything (got ${rects!.length} fragments)`,
        ).toBe(1);
        return box;
      }
    } else {
      stable = 0;
    }
    last = box;
    await page.waitForTimeout(250);
  }
  throw new Error(
    `the target paragraph (${selector}) never settled — the book did not lay out`,
  );
}

test("EPUB ink: a stroke persists, survives reload, and rides a font-size reflow", async ({
  page,
}) => {
  test.setTimeout(120_000);

  let bookId = "";

  await test.step("sign in and find the ink fixture book", async () => {
    await signIn(page);
    const res = await page.request.get("/api/books");
    expect(res.status()).toBe(200);
    const { books } = (await res.json()) as { books: BookRow[] };
    const book = books.find((b) => b.format === "epub" && b.title === INK_TITLE);
    expect(book, "seeded ink EPUB present in /api/books").toBeTruthy();
    bookId = book!.id;
  });

  await test.step("open the reader and turn on Draw", async () => {
    await page.goto(`/books/${bookId}/read`);
    // The book is genuinely laid out — the fixture's own text is on screen.
    await settledBox(page, TARGET_SELECTOR);

    await page.getByRole("button", { name: "Draw" }).click();
    // Mounting the ink toolbar shrinks the reading row, which trips the
    // reader's ResizeObserver and reflows the book. That is the design working
    // — but it means the paragraph must be measured AFTER the reflow settles,
    // or the stroke would be aimed at where the text used to be.
    await expect(page.getByRole("button", { name: /eras/i })).toBeVisible();

    // Red and Bold, for the screenshots. The default pen is "Ink" (#1c1c1e),
    // which on the reader's dark theme is a black line on a near-black page —
    // legible to the geometry assertions but not to the human reading the
    // screenshots this spec saves.
    await page.getByRole("button", { name: "Red" }).click();
    await page.getByRole("button", { name: "Bold" }).click();
  });

  let drawnOn!: Box;

  await test.step("draw a stroke across the target paragraph", async () => {
    drawnOn = await settledBox(page, TARGET_SELECTOR);

    // A horizontal swipe across the middle of the paragraph — the gesture a
    // reader makes to underline a line of text.
    const mid = centerOf(drawnOn);
    const x0 = drawnOn.x + drawnOn.width * 0.15;
    const x1 = drawnOn.x + drawnOn.width * 0.85;

    await page.mouse.move(x0, mid.y);
    await page.mouse.down();
    // Several intermediate moves: one move would be dropped as sub-2-unit
    // jitter is filtered, and a real stroke is a series of samples anyway.
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x0 + ((x1 - x0) * i) / 10, mid.y + Math.sin(i) * 4);
    }
    await page.mouse.up();
  });

  await test.step("the stroke painted, with real geometry — not an empty path", async () => {
    await expect
      .poll(async () => (await strokeBox(page)) !== null, { timeout: 10_000 })
      .toBe(true);
    const s = await strokeBox(page);

    expect(s, "a visible stroke path exists in the overlay").toBeTruthy();
    // The trap this guards: a zero-rect resolve renders an empty path that
    // throws nothing and looks like a pass.
    expect(s!.d.length, "the path carries real geometry").toBeGreaterThan(10);
    expect(s!.width, "the stroke occupies real width on screen").toBeGreaterThan(20);
  });

  await test.step("the stroke persisted through /api/ink as a block anchor", async () => {
    const res = await page.request.get(`/api/ink?bookId=${bookId}`);
    expect(res.status()).toBe(200);
    const { strokes } = (await res.json()) as { strokes: InkRow[] };
    expect(strokes, "exactly one stroke was saved").toHaveLength(1);

    const s = strokes[0];
    // The EPUB half of the discriminated union: fastened to a block CFI, with
    // no page — a page here would mean it had been saved as a PDF stroke.
    expect(s.anchor, "the stroke carries an anchor").toBeTruthy();
    expect(s.anchor!.kind).toBe("block");
    expect(s.anchor!.cfi).toContain("epubcfi(");
    expect(s.anchor!.section).toBe(0);
    expect(s.page, "an EPUB stroke has no page").toBeNull();
    expect(s.points.length, "the stroke has multiple sampled points").toBeGreaterThan(2);
    // Points are fractions of the block's box, so they are all 0..1 — a pixel
    // coordinate would blow this immediately.
    for (const [x, y] of s.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
  });

  await test.step("screenshot: the stroke on the page, before the font change", async () => {
    await page.screenshot({ path: "e2e/screenshots/epub-ink-before-font-change.png" });
  });

  let beforePara!: Box;
  let beforeStroke!: Box;

  await test.step("reload: the stroke is still there, still on the same text", async () => {
    await page.reload();
    await settledBox(page, TARGET_SELECTOR);
    // Draw mode is session state, so it is off after a reload; the overlay
    // renders saved strokes regardless. Turn it back on so the surface (and its
    // reflow) matches the state the stroke was drawn under, which is what makes
    // the before/after comparison a like-for-like one.
    await page.getByRole("button", { name: "Draw" }).click();
    await expect(page.getByRole("button", { name: /eras/i })).toBeVisible();

    const para = await settledBox(page, TARGET_SELECTOR);

    await expect
      .poll(async () => (await strokeBox(page)) !== null, { timeout: 15_000 })
      .toBe(true);
    const s = await strokeBox(page);
    expect(s, "the saved stroke re-resolved and painted after a reload").toBeTruthy();
    expect(s!.d.length).toBeGreaterThan(10);

    // It is ON the paragraph it was drawn on — the stroke's box sits within the
    // paragraph's box, allowing for the nib's own half-width spilling over.
    const NIB = 12;
    expect(s!.x + s!.width).toBeGreaterThan(para.x - NIB);
    expect(s!.x).toBeLessThan(para.x + para.width + NIB);
    expect(s!.y + s!.height).toBeGreaterThan(para.y - NIB);
    expect(s!.y).toBeLessThan(para.y + para.height + NIB);

    beforePara = para;
    beforeStroke = s!;
  });

  await test.step("THE ACCEPTANCE TEST: the stroke rides a font-size reflow", async () => {
    // 100% → 140%: three steps up the reader's font ladder (100/110/120/140).
    // Enough that the chapter re-wraps and the target paragraph relocates.
    for (let i = 0; i < 3; i++) {
      await page.getByRole("button", { name: "Larger" }).click();
    }
    await expect(page.getByText("140%")).toBeVisible();
    // The reflow and the overlay's re-measure both have to land before anything
    // is compared.
    const afterPara = await settledBox(page, TARGET_SELECTOR);

    // GUARD AGAINST A VACUOUS PASS. If the paragraph did not move, then a
    // pixel-anchored stroke would also still be sitting on it, and the rest of
    // this step would prove nothing at all. The text must demonstrably have
    // relocated before "the stroke followed it" means anything.
    const paraMoved = Math.hypot(
      afterPara.x - beforePara.x,
      afterPara.y - beforePara.y,
    );
    expect(
      paraMoved,
      "the target text actually relocated on the font change — otherwise this test proves nothing",
    ).toBeGreaterThan(20);

    const afterStroke = await strokeBox(page);
    expect(
      afterStroke,
      "the stroke is STILL PAINTED after the reflow (a rotted anchor would render nothing)",
    ).toBeTruthy();
    expect(afterStroke!.d.length).toBeGreaterThan(10);

    // The invariant the design actually claims, asserted directly: a stroke is
    // stored as fractions OF ITS BLOCK, so its position *relative to that block*
    // is what must survive the reflow. Comparing raw screen displacements is the
    // weaker test — the block resizes as well as moves, so a rigid-translation
    // check needs a tolerance loose enough to let a genuinely rotted anchor
    // through. The fraction is exact, and it is the thing being promised.
    const relative = (stroke: Box, para: Box) => ({
      x: (stroke.x + stroke.width / 2 - para.x) / para.width,
      y: (stroke.y + stroke.height / 2 - para.y) / para.height,
    });
    const before = relative(beforeStroke, beforePara);
    const after = relative(afterStroke!, afterPara);

    expect(
      Math.abs(after.x - before.x),
      `the stroke sits at the same fraction ACROSS its block after the reflow (was ${before.x.toFixed(3)}, now ${after.x.toFixed(3)})`,
    ).toBeLessThan(0.12);
    expect(
      Math.abs(after.y - before.y),
      `the stroke sits at the same fraction DOWN its block after the reflow (was ${before.y.toFixed(3)}, now ${after.y.toFixed(3)})`,
    ).toBeLessThan(0.12);

    // And the decisive containment check: wherever the text went, the ink is
    // lying across it.
    const NIB = 14;
    expect(afterStroke!.x + afterStroke!.width).toBeGreaterThan(afterPara.x - NIB);
    expect(afterStroke!.x).toBeLessThan(afterPara.x + afterPara.width + NIB);
    expect(afterStroke!.y + afterStroke!.height).toBeGreaterThan(afterPara.y - NIB);
    expect(afterStroke!.y).toBeLessThan(afterPara.y + afterPara.height + NIB);

    await page.screenshot({ path: "e2e/screenshots/epub-ink-after-font-change.png" });
  });
});
