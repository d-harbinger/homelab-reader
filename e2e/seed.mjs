// Seed deterministic fixtures for the core-flow end-to-end suite.
//
// Creates one EPUB book and one PDF book, both pointing at the repository's real
// test fixtures so the reader routes stream genuine bytes, plus one pending
// metadata suggestion attached to the EPUB for the enrich-accept path. No user
// rows are seeded: the spec deliberately creates the first admin through the
// live first-run /setup flow, which is the first step of the tested journey.
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const fixtures = path.join(repoRoot, "tests", "fixtures");

const prisma = new PrismaClient();

async function main() {
  const epub = await prisma.book.create({
    data: {
      filePath: path.join(fixtures, "valid.epub"),
      format: "epub",
      title: "E2E Sample EPUB",
    },
  });

  const pdf = await prisma.book.create({
    data: {
      filePath: path.join(fixtures, "valid.pdf"),
      format: "pdf",
      title: "E2E Sample PDF",
      pageCount: 1,
    },
  });

  // A pending suggestion whose fields fill columns the EPUB book leaves empty
  // (publisher, isbn) and adds subjects as tags — the accept path exercises the
  // empty-only write-back in src/lib/metadata/enrich.ts (applyAcceptance). The
  // title matches the book's so the accept never clobbers a present field.
  await prisma.bookSuggestion.create({
    data: {
      bookId: epub.id,
      source: "openlibrary",
      confidence: 0.9,
      title: "E2E Sample EPUB",
      authors: JSON.stringify(["Ada Lovelace"]),
      publishedYear: 1998,
      publisher: "E2E Test Press",
      isbn: "9780000000001",
      subjects: JSON.stringify(["Testing", "Automation"]),
      status: "pending",
    },
  });

  console.log(
    `[e2e seed] created epub=${epub.id} pdf=${pdf.id} + 1 pending suggestion`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error("[e2e seed] failed:", err);
    await prisma.$disconnect();
    process.exit(1);
  });
