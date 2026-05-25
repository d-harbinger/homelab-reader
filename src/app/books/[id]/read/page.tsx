import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentUserId } from "@/lib/current-user";
import { EpubReader } from "@/components/EpubReader";
import { PdfReaderLazy } from "@/components/PdfReaderLazy";

interface EpubAnchor {
  type: "epub-cfi";
  cfi: string;
}
interface PdfAnchor {
  type: "pdf-page";
  page: number;
}

export default async function ReadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) notFound();

  const userId = await getCurrentUserId();
  const progress = await prisma.progress.findUnique({
    where: { bookId_userId: { bookId: book.id, userId } },
  });

  const parsedAnchor = parseAnchor(progress?.anchor);

  if (book.format === "epub") {
    const initialCfi =
      parsedAnchor?.type === "epub-cfi" ? parsedAnchor.cfi : null;
    return (
      <EpubReader
        bookId={book.id}
        title={book.title}
        fileUrl={`/api/books/${book.id}/file`}
        initialCfi={initialCfi}
      />
    );
  }

  if (book.format === "pdf") {
    const initialPage =
      parsedAnchor?.type === "pdf-page" ? parsedAnchor.page : 1;
    return (
      <PdfReaderLazy
        bookId={book.id}
        title={book.title}
        fileUrl={`/api/books/${book.id}/file`}
        initialPage={initialPage}
        scannerPageCount={book.pageCount}
      />
    );
  }

  notFound();
}

function parseAnchor(s: string | null | undefined): EpubAnchor | PdfAnchor | null {
  if (!s) return null;
  try {
    const parsed = JSON.parse(s) as { type?: unknown; cfi?: unknown; page?: unknown };
    if (parsed.type === "epub-cfi" && typeof parsed.cfi === "string") {
      return { type: "epub-cfi", cfi: parsed.cfi };
    }
    if (parsed.type === "pdf-page" && typeof parsed.page === "number") {
      return { type: "pdf-page", page: parsed.page };
    }
  } catch {
    // malformed; treat as no anchor
  }
  return null;
}
