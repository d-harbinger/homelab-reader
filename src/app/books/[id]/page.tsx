import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/prisma";

function formatBytes(n: number | null | undefined): string | null {
  if (!n) return null;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function BookDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = await prisma.book.findUnique({
    where: { id },
    include: { authors: true, tags: true, progress: true },
  });
  if (!book) notFound();

  const coverUrl = book.coverPath ? `/api/covers/${book.id}` : null;
  const fileUrl = `/api/books/${book.id}/file`;
  const readHref = book.format === "epub" ? `/books/${book.id}/read` : fileUrl;
  const readLabel = book.format === "epub" ? "Read" : "Open PDF";
  const fileSize = formatBytes(book.fileSizeBytes);

  return (
    <main className="mx-auto max-w-5xl px-6 py-10 space-y-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <ArrowLeft size={14} />
        Library
      </Link>

      <div className="grid grid-cols-1 gap-10 md:grid-cols-[260px_1fr]">
        <div className="flex justify-center md:block">
          <div className="aspect-[2/3] w-full max-w-[260px] overflow-hidden rounded-lg bg-zinc-900 shadow-xl shadow-black/40">
            {coverUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={coverUrl}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-800 to-zinc-900">
                <span className="text-xs uppercase tracking-[0.2em] text-zinc-500">
                  {book.format}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">
              {book.title}
            </h1>
            {book.subtitle && (
              <p className="text-lg text-zinc-400">{book.subtitle}</p>
            )}
            {book.authors.length > 0 && (
              <p className="text-sm text-zinc-400">
                {book.authors.map((a) => a.name).join(", ")}
              </p>
            )}
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href={readHref}
              className="rounded-md bg-amber-500/90 px-5 py-2 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            >
              {readLabel}
            </Link>
            <a
              href={fileUrl}
              download
              className="rounded-md border border-zinc-800 px-5 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              Download
            </a>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-xs sm:grid-cols-3">
            <Meta label="Format" value={book.format.toUpperCase()} />
            {book.pageCount && (
              <Meta label="Pages" value={book.pageCount.toLocaleString()} />
            )}
            {book.language && <Meta label="Language" value={book.language} />}
            {book.publisher && (
              <Meta label="Publisher" value={book.publisher} />
            )}
            {book.publishedAt && (
              <Meta
                label="Published"
                value={book.publishedAt.getFullYear().toString()}
              />
            )}
            {book.isbn && <Meta label="ISBN" value={book.isbn} />}
            {fileSize && <Meta label="Size" value={fileSize} />}
          </dl>

          {book.description && (
            <div className="space-y-2 border-t border-zinc-900 pt-6">
              <h2 className="text-xs uppercase tracking-wider text-zinc-500">
                Description
              </h2>
              <p className="text-sm leading-relaxed text-zinc-300 whitespace-pre-wrap">
                {book.description}
              </p>
            </div>
          )}

          {book.tags.length > 0 && (
            <div className="flex flex-wrap gap-2 border-t border-zinc-900 pt-6">
              {book.tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-full bg-zinc-900 px-3 py-1 text-xs text-zinc-400"
                >
                  {t.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-zinc-600 uppercase tracking-wider">{label}</dt>
      <dd className="text-zinc-200">{value}</dd>
    </div>
  );
}
