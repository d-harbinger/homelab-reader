"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { BookCard, type BookCardData } from "./BookCard";
import { readSetting, writeSetting } from "./ReaderToolbar";

type Layout = "row" | "grid";

interface Props {
  title: string;
  books: BookCardData[];
  hideWhenEmpty?: boolean;
  layout?: Layout;
}

// Sections render as horizontal-scrolling rows by default — closer to the
// Jellyfin/Netflix shelf vibe and stays tidy when a tag/section has a
// long tail. The catch-all Library section uses layout="grid" so the
// whole library is visible without horizontal scroll gymnastics.
//
// Each section collapses from its header so a busy overview (Continue
// reading + Recently added + a stack of tag shelves) can be tidied to just
// the shelves you care about. Collapsed state persists per section title,
// loaded AFTER mount so the server/first paint (always expanded) can't
// mismatch the client.
export function Section({
  title,
  books,
  hideWhenEmpty,
  layout = "row",
}: Props) {
  const storageKey = `library.section.${title}.collapsed`;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(readSetting<string>(storageKey, "0") === "1");
  }, [storageKey]);

  function toggle() {
    setCollapsed((c) => {
      const next = !c;
      writeSetting(storageKey, next ? "1" : "0");
      return next;
    });
  }

  if (hideWhenEmpty && books.length === 0) return null;

  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="group flex w-full items-baseline gap-2 px-1 text-left"
      >
        <span className="self-center text-zinc-600 transition-colors group-hover:text-zinc-300">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
        </span>
        <h2 className="text-lg font-medium tracking-tight text-zinc-100">
          {title}
        </h2>
        {books.length > 0 && (
          <span className="text-xs text-zinc-600">{books.length}</span>
        )}
      </button>

      {!collapsed &&
        (books.length === 0 ? (
          <p className="px-1 text-sm text-zinc-600">No books yet.</p>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        ) : (
          <div
            // Horizontal scroller with snap. Hide scrollbar but allow native
            // touch / wheel scrolling. Negative margin + padding lets cards
            // bleed to the screen edges without clipping the hover lift.
            className="-mx-6 overflow-x-auto px-6 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex snap-x snap-mandatory gap-4">
              {books.map((b) => (
                <div
                  key={b.id}
                  className="w-[clamp(140px,18vw,200px)] flex-none snap-start"
                >
                  <BookCard book={b} />
                </div>
              ))}
            </div>
          </div>
        ))}
    </section>
  );
}
