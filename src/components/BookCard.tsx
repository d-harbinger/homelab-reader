import Link from "next/link";

export interface BookCardData {
  id: string;
  title: string;
  format: "epub" | "pdf";
  authors: string[];
  pageCount: number | null;
  coverUrl: string | null;
  // Top-level on-disk folder this book sits under (server-derived), or null
  // for a book directly under a scan root. The chip that renders it lands in
  // a later slice; this is the data/type seam only.
  genre?: string | null;
}

export function BookCard({ book }: { book: BookCardData }) {
  return (
    <Link
      href={`/books/${book.id}`}
      className="group flex flex-col gap-2 outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 rounded-md"
    >
      <div className="relative aspect-[2/3] overflow-hidden rounded-md bg-zinc-900 shadow-md shadow-black/30 transition-all duration-200 group-hover:-translate-y-1 group-hover:shadow-xl group-hover:shadow-black/50">
        {book.coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={book.coverUrl}
            alt={book.title}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-zinc-800 to-zinc-900" />
        )}
        {/* Format is what decides which reader — and which tools — a book opens
            with: freehand ink is PDF-only, because EPUB reflows and a stroke has
            nothing fixed to anchor to. The shelf is where that expectation gets
            set, so the chip rides every tile, cover or not. */}
        <span className="absolute right-1.5 top-1.5 rounded bg-zinc-950/75 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-zinc-300 ring-1 ring-white/10 backdrop-blur-sm">
          {book.format}
        </span>
      </div>
      <div className="space-y-0.5 px-0.5">
        <div className="text-sm font-medium text-zinc-100 line-clamp-2 leading-snug">
          {book.title}
        </div>
        <div className="text-xs text-zinc-500 line-clamp-1">
          {book.authors.length > 0 ? book.authors.join(", ") : "—"}
        </div>
      </div>
    </Link>
  );
}
