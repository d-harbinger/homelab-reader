import { BookCard, type BookCardData } from "./BookCard";

export function Section({
  title,
  books,
  hideWhenEmpty,
}: {
  title: string;
  books: BookCardData[];
  hideWhenEmpty?: boolean;
}) {
  if (hideWhenEmpty && books.length === 0) return null;

  return (
    <section className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-medium tracking-tight text-zinc-100">
          {title}
        </h2>
        {books.length > 0 && (
          <span className="text-xs text-zinc-600">
            {books.length}
            {books.length === 1 ? " book" : " books"}
          </span>
        )}
      </div>
      {books.length > 0 ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {books.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-600">No books yet.</p>
      )}
    </section>
  );
}
