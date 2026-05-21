import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getDefaultUserId } from "@/lib/default-user";
import { EpubReader } from "@/components/EpubReader";

export default async function ReadPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = await prisma.book.findUnique({ where: { id } });
  if (!book) notFound();

  // PDFs use the browser's native viewer for now — the in-app PDF reader
  // is a later phase. Redirect to the raw file route.
  if (book.format !== "epub") {
    redirect(`/api/books/${book.id}/file`);
  }

  const userId = await getDefaultUserId();
  const progress = await prisma.progress.findUnique({
    where: { bookId_userId: { bookId: book.id, userId } },
  });

  let initialCfi: string | null = null;
  if (progress?.anchor) {
    try {
      const parsed = JSON.parse(progress.anchor) as {
        type?: string;
        cfi?: string;
      };
      if (parsed.type === "epub-cfi" && typeof parsed.cfi === "string") {
        initialCfi = parsed.cfi;
      }
    } catch {
      // malformed anchor — start from the top
    }
  }

  return (
    <EpubReader
      bookId={book.id}
      title={book.title}
      fileUrl={`/api/books/${book.id}/file`}
      initialCfi={initialCfi}
    />
  );
}
