"use client";

import { useState } from "react";
import { Quote } from "lucide-react";
import { fetcher } from "@/lib/fetcher";

// Cite action for the book detail page. Fetches the book's citation
// (a one-line reference + a BibTeX @book entry) from /api/books/[id]/citation,
// copies the reference string to the clipboard, and offers the BibTeX as a
// client-side .bib download. The route carries all the formatting logic; this
// is the browser-only plumbing (clipboard + blob) the server page can't do.
export function CiteButton({ bookId }: { bookId: string }) {
  const [status, setStatus] = useState<"idle" | "done" | "error">("idle");

  async function cite() {
    try {
      const { reference, bibtex } = (await fetcher(
        `/api/books/${bookId}/citation`,
      )) as { reference: string; bibtex: string };

      await navigator.clipboard.writeText(reference);

      const blob = new Blob([bibtex], { type: "application/x-bibtex" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${bookId}.bib`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      setStatus("done");
      setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
      setTimeout(() => setStatus("idle"), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={cite}
      className="inline-flex items-center gap-2 rounded-md border border-zinc-800 px-5 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-700 hover:text-zinc-100"
    >
      <Quote size={14} />
      {status === "done"
        ? "Copied + .bib"
        : status === "error"
          ? "Cite failed"
          : "Cite"}
    </button>
  );
}
