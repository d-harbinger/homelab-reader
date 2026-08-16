// ═══════════════════════════════════════════════════════════════
//  Property tests for the EPUB metadata extractor.
//
//  WHY THESE AND NOT MORE EXAMPLES. `extractEpub` parses book archives
//  the application did not create, and it is called by the unattended
//  scanner (scanner/watcher.ts, scanner/index.ts). Nobody is watching
//  when it runs, which decides what is worth asserting.
//
//  A wrong title is cosmetic. These are not, and the properties below
//  are ordered by them:
//
//    - the scanner hanging on one archive, so the whole library stops
//      importing and the failure looks like nothing happening;
//    - a rejection that is not an Error, or a throw that escapes the
//      promise, so one bad book takes a batch of good ones with it;
//    - metadata that did not come from the archive it was read from.
//
//  Archives are built by hand in __fixtures__/zip.ts, because this
//  surface takes a file path rather than a string and so cannot be fed
//  generated text the way the other parsers in this repository are.
//
//  One invariant this file deliberately does NOT assert: a bound on how
//  much memory a small archive may cause to be allocated. `readZipEntries`
//  buffers every entry with no cap, so a decompression bomb is amplified
//  without limit. What the parser should do about that — refuse, cap, or
//  stream — is a product decision and is on the owner's board rather than
//  settled here. See the note above the amplification test.
// ═══════════════════════════════════════════════════════════════

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fc from "fast-check";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { extractEpub } from "@/lib/scanner/epub";
import { buildZip, containerXml, opfXml, ordinaryEpub } from "@/lib/scanner/__fixtures__/zip";

function show(v: unknown): string {
  try {
    return fc.stringify(v);
  } catch {
    return "<unprintable>";
  }
}

let dir: string;
let seq = 0;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "epub-props-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write bytes to a throwaway file and hand back its path. */
function asFile(bytes: Buffer, ext = ".epub"): string {
  seq += 1;
  const file = path.join(dir, `f${seq}${ext}`);
  writeFileSync(file, bytes);
  return file;
}

/**
 * Settle a call one way or the other, and say which.
 *
 * Every property here goes through this rather than awaiting directly,
 * because the failure that matters most is the one where nothing settles
 * at all. A test that awaits a hung promise reports as a timeout on a
 * random property; this reports as the thing it is.
 */
async function settle(
  filePath: string,
  ms = 10_000,
): Promise<{ ok: true; value: Awaited<ReturnType<typeof extractEpub>> } | { ok: false; error: unknown } | { ok: "hung" }> {
  let timer: NodeJS.Timeout | undefined;
  const hang = new Promise<{ ok: "hung" }>((resolve) => {
    timer = setTimeout(() => resolve({ ok: "hung" }), ms);
  });
  try {
    return await Promise.race([
      extractEpub(filePath).then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      ),
      hang,
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Bytes that are not an archive: random noise, a truncated archive, an empty
// file, and the shapes that have historically confused zip readers.
const notAnArchive = fc.oneof(
  { weight: 3, arbitrary: fc.uint8Array({ maxLength: 512 }).map((a) => Buffer.from(a)) },
  {
    weight: 1,
    arbitrary: fc.constantFrom(
      Buffer.alloc(0),
      Buffer.from("PK"),
      Buffer.from("PK\x03\x04"),
      Buffer.from("PK\x05\x06"),
      Buffer.from("not a zip at all, just prose"),
      Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(26)]),
    ),
  },
  // A real archive cut off partway through.
  {
    weight: 2,
    arbitrary: fc
      .integer({ min: 1, max: 120 })
      .map((keep) => ordinaryEpub({ title: "Cut Short" }).subarray(0, keep)),
  },
);

describe("extractEpub — it always settles, and always as an Error", () => {
  it("never hangs on bytes that are not an archive", async () => {
    let reached = 0;
    await fc.assert(
      fc.asyncProperty(notAnArchive, async (bytes) => {
        const outcome = await settle(asFile(bytes));
        reached += 1;
        expect(outcome.ok, `hung on ${show(bytes.length)} bytes`).not.toBe("hung");
      }),
      { numRuns: 60 },
    );
    // Lesson 4: say that the generator reached the branch at all.
    expect(reached, "no inputs reached the parser").toBeGreaterThan(50);
  }, 120_000);

  it("rejects with an Error rather than a bare value", async () => {
    // The scanner catches and records failures per book. A rejection that
    // is not an Error loses its message on the way into the failure log,
    // and the book shows as failed with nothing said about why.
    let rejections = 0;
    await fc.assert(
      fc.asyncProperty(notAnArchive, async (bytes) => {
        const outcome = await settle(asFile(bytes));
        if (outcome.ok === false) {
          rejections += 1;
          expect(outcome.error, `rejected with a non-Error: ${show(outcome.error)}`).toBeInstanceOf(
            Error,
          );
        }
      }),
      { numRuns: 60 },
    );
    expect(rejections, "nothing rejected, so the assertion never ran").toBeGreaterThan(0);
  }, 120_000);

  it("rejects a valid archive that is not an EPUB", async () => {
    const outcome = await settle(asFile(buildZip([{ name: "readme.txt", data: "hello" }])));
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect(outcome.error).toBeInstanceOf(Error);
      expect((outcome.error as Error).message).toContain("container.xml");
    }
  });

  it("rejects a container that references an OPF the archive does not hold", async () => {
    const bytes = buildZip([
      { name: "META-INF/container.xml", data: containerXml("OEBPS/absent.opf") },
    ]);
    const outcome = await settle(asFile(bytes));
    expect(outcome.ok).toBe(false);
    if (outcome.ok === false) {
      expect((outcome.error as Error).message).toContain("OPF not found");
    }
  });

  it("settles on a container that is not XML, or names no rootfile", async () => {
    const hostileContainers = [
      "",
      "not xml at all",
      "<container>",
      "<container><rootfiles/></container>",
      `<container><rootfiles><rootfile full-path=""/></rootfiles></container>`,
      `<container><rootfiles><rootfile/></rootfiles></container>`,
    ];
    for (const xml of hostileContainers) {
      const outcome = await settle(
        asFile(buildZip([{ name: "META-INF/container.xml", data: xml }])),
      );
      expect(outcome.ok, `hung on container ${show(xml)}`).not.toBe("hung");
      if (outcome.ok === false) expect(outcome.error).toBeInstanceOf(Error);
    }
  });

  it("settles on an OPF that is not XML, or carries no package", async () => {
    const hostileOpfs = ["", "not xml", "<package>", "<package><metadata>text</metadata></package>"];
    for (const xml of hostileOpfs) {
      const bytes = buildZip([
        { name: "META-INF/container.xml", data: containerXml("content.opf") },
        { name: "content.opf", data: xml },
      ]);
      const outcome = await settle(asFile(bytes));
      expect(outcome.ok, `hung on OPF ${show(xml)}`).not.toBe("hung");
      if (outcome.ok === false) expect(outcome.error).toBeInstanceOf(Error);
    }
  });
});

describe("extractEpub — what comes back came from the archive", () => {
  it("returns the title and authors the OPF stated, or nothing", async () => {
    // Not a restatement of the parser: the invariant is that no field is
    // invented. A title that appears without being in the file is the
    // failure mode where one book's metadata attaches to another.
    const bookText = fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0);
    let withTitle = 0;
    await fc.assert(
      fc.asyncProperty(bookText, fc.array(bookText, { maxLength: 4 }), async (title, authors) => {
        const outcome = await settle(asFile(ordinaryEpub({ title, authors })));
        expect(outcome.ok, `hung on title ${show(title)}`).toBe(true);
        if (outcome.ok !== true) return;
        if (outcome.value.title !== undefined) {
          withTitle += 1;
          expect(title.trim()).toContain(outcome.value.title);
        }
        for (const author of outcome.value.authors) {
          expect(
            authors.some((a) => a.trim().includes(author)),
            `author ${show(author)} was not in the file`,
          ).toBe(true);
        }
      }),
      { numRuns: 40 },
    );
    expect(withTitle, "no run produced a title, so nothing was checked").toBeGreaterThan(0);
  }, 120_000);

  it("never reports a cover the archive does not contain", async () => {
    // The href is resolved against the OPF's directory and then used as a
    // lookup key. A traversing or absolute href must miss, not reach for
    // something else — and must never produce a cover.
    const hostileHrefs = [
      "../../../etc/passwd",
      "/etc/passwd",
      "..%2f..%2fsecret.png",
      "",
      "./././cover.png",
      "OEBPS/../../outside.png",
    ];
    for (const href of hostileHrefs) {
      const bytes = ordinaryEpub({
        title: "Cover Probe",
        items: [{ id: "cover", href, mediaType: "image/png", properties: "cover-image" }],
      });
      const outcome = await settle(asFile(bytes));
      expect(outcome.ok, `hung on href ${show(href)}`).toBe(true);
      if (outcome.ok === true) {
        expect(outcome.value.cover, `invented a cover for href ${show(href)}`).toBeUndefined();
      }
    }
  });

  it("returns the cover bytes when the entry really is there", async () => {
    const pixel = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const bytes = ordinaryEpub(
      {
        title: "Has A Cover",
        items: [
          { id: "cover", href: "images/cover.png", mediaType: "image/png", properties: "cover-image" },
        ],
      },
      [{ name: "OEBPS/images/cover.png", data: pixel }],
    );
    const outcome = await settle(asFile(bytes));
    expect(outcome.ok).toBe(true);
    if (outcome.ok === true) {
      expect(outcome.value.cover?.ext).toBe("png");
      expect(outcome.value.cover?.buffer.equals(pixel)).toBe(true);
    }
  });

  it("keeps every subject it returns inside the length it promises", async () => {
    // parseOpf caps each subject at 64 characters. It does not cap how many
    // there are; that is recorded as a question rather than asserted here.
    const subject = fc.string({ maxLength: 200 });
    await fc.assert(
      fc.asyncProperty(fc.array(subject, { maxLength: 20 }), async (subjects) => {
        const outcome = await settle(asFile(ordinaryEpub({ title: "Subjects", subjects })));
        expect(outcome.ok).toBe(true);
        if (outcome.ok !== true) return;
        for (const s of outcome.value.subjects) {
          expect(s.length, `subject over the cap: ${show(s)}`).toBeLessThanOrEqual(64);
          expect(s, "a subject was returned untrimmed").toBe(s.trim());
        }
      }),
      { numRuns: 40 },
    );
  }, 120_000);

  it("never returns an invalid Date", async () => {
    const hostileDates = ["", "not a date", "0000-00-00", "9999999999999999", "-", "2026-13-45"];
    for (const date of hostileDates) {
      const outcome = await settle(asFile(ordinaryEpub({ title: "Dated", date })));
      expect(outcome.ok, `hung on date ${show(date)}`).toBe(true);
      if (outcome.ok === true && outcome.value.publishedAt !== undefined) {
        expect(
          Number.isNaN(outcome.value.publishedAt.getTime()),
          `returned an invalid Date for ${show(date)}`,
        ).toBe(false);
      }
    }
  });
});

describe("extractEpub — hostile size and shape", () => {
  it("finishes a very large metadata value in reasonable time", async () => {
    // Catastrophic backtracking check. An unbounded quantifier over a
    // hundred thousand characters cost 48 seconds on another surface in
    // this workspace; the bound here is deliberately generous, because the
    // failure it guards against is seconds-to-minutes, not milliseconds.
    const huge = "a,".repeat(50_000);
    const bytes = ordinaryEpub({ title: huge, subjects: [huge], identifier: huge });
    const started = Date.now();
    const outcome = await settle(asFile(bytes), 30_000);
    const elapsed = Date.now() - started;
    expect(outcome.ok).not.toBe("hung");
    expect(elapsed, `took ${elapsed}ms on a 100k-character metadata value`).toBeLessThan(10_000);
  }, 60_000);

  it("finishes an archive with many entries", async () => {
    const many = Array.from({ length: 5_000 }, (_, i) => ({
      name: `OEBPS/text/ch${i}.xhtml`,
      data: "<html/>",
    }));
    const bytes = ordinaryEpub({ title: "Many Parts" }, many);
    const started = Date.now();
    const outcome = await settle(asFile(bytes), 30_000);
    expect(outcome.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(20_000);
  }, 60_000);

  it("settles on duplicate entry names", async () => {
    const bytes = buildZip([
      { name: "META-INF/container.xml", data: containerXml("content.opf") },
      { name: "content.opf", data: opfXml({ title: "First" }) },
      { name: "content.opf", data: opfXml({ title: "Second" }) },
    ]);
    const outcome = await settle(asFile(bytes));
    expect(outcome.ok).toBe(true);
    // Last-wins is what a Map gives; asserted so a change of reader is
    // noticed rather than discovered through a wrong title.
    if (outcome.ok === true) expect(outcome.value.title).toBe("Second");
  });

  it("settles on deeply nested XML rather than dying on the stack", async () => {
    const depth = 2_000;
    const nested = "<a>".repeat(depth) + "x" + "</a>".repeat(depth);
    const bytes = buildZip([
      { name: "META-INF/container.xml", data: containerXml("content.opf") },
      { name: "content.opf", data: `<package><metadata>${nested}</metadata></package>` },
    ]);
    const outcome = await settle(asFile(bytes), 20_000);
    expect(outcome.ok, "nesting hung the parser").not.toBe("hung");
    if (outcome.ok === false) expect(outcome.error).toBeInstanceOf(Error);
  }, 40_000);

  it("settles on an entry name that traverses out of the archive", async () => {
    // Nothing here writes to disk, so this is not a zip-slip write. It is
    // checked because the entry name becomes a Map key and the cover href
    // is resolved against it; a traversing name must stay inert.
    const bytes = buildZip([
      { name: "META-INF/container.xml", data: containerXml("../../escape.opf") },
      { name: "../../escape.opf", data: opfXml({ title: "Escaped" }) },
    ]);
    const outcome = await settle(asFile(bytes));
    expect(outcome.ok).not.toBe("hung");
  });
});
