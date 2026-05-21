"use client";

import dynamic from "next/dynamic";

// pdfjs touches browser-only globals (DOMMatrix, Path2D, ImageData) at
// module-evaluation time. Even with the file marked `use client`, Next
// still loads the module on the server during the first render to derive
// the initial HTML, which throws. dynamic({ ssr: false }) tells Next to
// skip the server render entirely; the reader is interactive-only anyway,
// so there's nothing for SSR to contribute.
export const PdfReaderLazy = dynamic(
  () => import("./PdfReader").then((m) => ({ default: m.PdfReader })),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 flex items-center justify-center bg-zinc-950 text-sm text-zinc-600">
        Loading reader…
      </div>
    ),
  },
);
