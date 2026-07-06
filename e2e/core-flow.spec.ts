import { test, expect } from "@playwright/test";

// Core-flow end-to-end coverage of the SERVED surface — the complement to the
// vitest unit suite, which mocks the auth and Prisma seams. Here a real Next.js
// server runs against an isolated, freshly-seeded SQLite database (see
// playwright.config.ts), and one browser context walks the whole journey:
//
//   first-run setup → sign out and log back in → library renders the seeded
//   books → open the EPUB reader → open the PDF reader → create a highlight and
//   a note bound to it (API) → OPDS token mint + authenticated catalog fetch
//   (and the 401 an anonymous OPDS request must get) → accept a pending
//   metadata suggestion and confirm the write-back landed on the book.
//
// The suite is one strictly-ordered test built from steps: each stage depends on
// the state the previous one established (an admin must exist before login can
// be tested, books must be discoverable before a reader can open one, and so
// on). Assertions are explicit and fail loudly — there are no conditional skips.

const ADMIN = { username: "e2eadmin", password: "e2e-password-123!" };
const EPUB_TITLE = "E2E Sample EPUB";
const PDF_TITLE = "E2E Sample PDF";

interface BookRow {
  id: string;
  title: string;
  format: "epub" | "pdf";
}

test("core flow: setup, login, library, readers, annotations, OPDS, enrich", async ({
  page,
  context,
}) => {
  let epubId = "";
  let pdfId = "";
  let highlightId = "";

  await test.step("first-run setup creates the admin and signs in", async () => {
    await page.goto("/setup");
    await expect(
      page.getByRole("heading", { name: /welcome to homelab-reader/i }),
    ).toBeVisible();

    await page.fill("#username", ADMIN.username);
    await page.fill("#password", ADMIN.password);
    await page.fill("#confirm", ADMIN.password);
    await page.getByRole("button", { name: /create admin/i }).click();

    // The server action creates the admin, signs in, and redirects to "/".
    await page.waitForURL("**/");
    await expect(page.getByText(EPUB_TITLE)).toBeVisible();
  });

  await test.step("library renders the seeded books", async () => {
    await page.goto("/");
    // Both seeded books are visible on the library grid.
    await expect(page.getByText(EPUB_TITLE)).toBeVisible();
    await expect(page.getByText(PDF_TITLE)).toBeVisible();
  });

  await test.step("sign out, then log back in through the login form", async () => {
    // Drop the session cookie to force the login path (rather than depending on
    // a specific sign-out control), then authenticate through the real form.
    await context.clearCookies();

    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: /^homelab-reader$/i }),
    ).toBeVisible();

    await page.fill("#username", ADMIN.username);
    await page.fill("#password", ADMIN.password);
    await page.getByRole("button", { name: /^sign in$/i }).click();

    await page.waitForURL("**/");
    await expect(page.getByText(EPUB_TITLE)).toBeVisible();
  });

  await test.step("discover the seeded book ids from the library API", async () => {
    const res = await page.request.get("/api/books");
    expect(res.status()).toBe(200);
    const { books } = (await res.json()) as { books: BookRow[] };

    const epub = books.find((b) => b.format === "epub" && b.title === EPUB_TITLE);
    const pdf = books.find((b) => b.format === "pdf" && b.title === PDF_TITLE);
    expect(epub, "seeded EPUB present in /api/books").toBeTruthy();
    expect(pdf, "seeded PDF present in /api/books").toBeTruthy();

    epubId = epub!.id;
    pdfId = pdf!.id;
  });

  await test.step("the served file endpoint streams the EPUB and PDF bytes", async () => {
    const epubRes = await page.request.get(`/api/books/${epubId}/file`);
    expect(epubRes.status()).toBe(200);
    expect(epubRes.headers()["content-type"]).toContain("application/epub+zip");

    const pdfRes = await page.request.get(`/api/books/${pdfId}/file`);
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
  });

  await test.step("open the EPUB reader and confirm it renders", async () => {
    await page.goto(`/books/${epubId}/read`);
    // The reader chrome mounts (title + pager control)...
    await expect(page.getByText(EPUB_TITLE)).toBeVisible();
    await expect(page.getByRole("button", { name: /next page/i })).toBeVisible();
    // ...and epub.js reaches a rendered state: the pager label flips from
    // "Loading…" to a concrete percentage once the rendition displays.
    await expect(page.getByText(/^\d+%$/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("open the PDF reader and confirm it renders", async () => {
    await page.goto(`/books/${pdfId}/read`);
    await expect(page.getByText(PDF_TITLE)).toBeVisible();
    // PDF.js must actually parse the file: the single-page fixture drives the
    // page indicator to "1 / 1". A parse failure would instead show the
    // "Failed to load PDF" state, which must never appear.
    await expect(page.getByText("1 / 1")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/failed to load pdf/i)).toHaveCount(0);
  });

  await test.step("create a highlight and a note bound to it (API)", async () => {
    const hlRes = await page.request.post("/api/highlights", {
      data: {
        bookId: epubId,
        anchor: {
          type: "epub-cfi-range",
          cfi: "epubcfi(/6/4[ch1]!/4/2,/1:0,/1:9)",
        },
        text: "highlighted passage",
        color: "yellow",
      },
    });
    expect(hlRes.status()).toBe(200);
    const hl = (await hlRes.json()) as { id: string; color: string };
    expect(hl.id).toBeTruthy();
    expect(hl.color).toBe("yellow");
    highlightId = hl.id;

    const noteRes = await page.request.post("/api/notes", {
      data: {
        bookId: epubId,
        anchor: { type: "epub-cfi", cfi: "epubcfi(/6/4[ch1]!/4/2)" },
        body: "a note anchored to the highlight",
        highlightId,
      },
    });
    expect(noteRes.status()).toBe(200);
    const note = (await noteRes.json()) as { id: string; highlightId: string };
    expect(note.id).toBeTruthy();
    expect(note.highlightId).toBe(highlightId);

    // Both persist and read back for the owning user.
    const hlList = await (
      await page.request.get(`/api/highlights?bookId=${epubId}`)
    ).json();
    expect(hlList.highlights).toHaveLength(1);
    expect(hlList.highlights[0].text).toBe("highlighted passage");

    const noteList = await (
      await page.request.get(`/api/notes?bookId=${epubId}`)
    ).json();
    expect(noteList.notes).toHaveLength(1);
    expect(noteList.notes[0].highlightId).toBe(highlightId);
  });

  await test.step("OPDS: anonymous request is challenged, tokened request is served", async () => {
    // An OPDS request with no token is rejected even though the browser context
    // still carries a valid session cookie — OPDS authenticates by token only.
    const anon = await page.request.get("/api/opds");
    expect(anon.status()).toBe(401);
    expect(anon.headers()["www-authenticate"]).toContain("Basic");

    // Mint a per-user token through the cookie-authenticated web API.
    const mint = await page.request.post("/api/opds-tokens", {
      data: { label: "e2e-token" },
    });
    expect(mint.status()).toBe(201);
    const { token } = (await mint.json()) as { token: string };
    expect(token).toBeTruthy();

    // The catalog is served over HTTP Basic (username:token).
    const basic = Buffer.from(`${ADMIN.username}:${token}`).toString("base64");
    const feed = await page.request.get("/api/opds", {
      headers: { Authorization: `Basic ${basic}` },
    });
    expect(feed.status()).toBe(200);
    expect(feed.headers()["content-type"]).toContain("opds-catalog");
    expect(await feed.text()).toContain("All Books");
  });

  await test.step("review screen: accept the pending suggestion through the UI", async () => {
    // Before: the book carries no publisher/isbn (only the extracted title).
    const before = await (
      await page.request.get(`/api/books/${epubId}`)
    ).json();
    expect(before.publisher).toBeNull();
    expect(before.isbn).toBeNull();

    // The book detail page shows the review panel to the admin, listing the
    // seeded pending suggestion with its proposed fields.
    await page.goto(`/books/${epubId}`);
    const panel = page.getByTestId("suggestions-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText("E2E Test Press")).toBeVisible();
    await expect(panel.getByText("9780000000001")).toBeVisible();

    // Accept through the UI. The panel reloads the page so the server-rendered
    // metadata (publisher, ISBN, tags) reflects the write-back.
    await panel.getByRole("button", { name: /^accept$/i }).click();
    await page.waitForLoadState("load");

    // After: the applied fields render on the detail page itself...
    await expect(page.getByText("E2E Test Press")).toBeVisible();
    await expect(page.getByText("9780000000001")).toBeVisible();
    await expect(page.getByText("Testing", { exact: true })).toBeVisible();
    await expect(page.getByText("Automation", { exact: true })).toBeVisible();

    // ...the panel is gone (nothing left pending)...
    await expect(page.getByTestId("suggestions-panel")).toHaveCount(0);

    // ...and the API confirms the columns landed.
    const after = await (
      await page.request.get(`/api/books/${epubId}`)
    ).json();
    expect(after.publisher).toBe("E2E Test Press");
    expect(after.isbn).toBe("9780000000001");
    expect(after.tags).toEqual(expect.arrayContaining(["Testing", "Automation"]));
  });
});
