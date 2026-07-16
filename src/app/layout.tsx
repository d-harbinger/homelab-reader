import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "homelab-reader",
  description: "Self-hosted book server for technical libraries",
};

// Next already emits width=device-width and initial-scale=1 and merges this
// export over those, so only the settings it has no default for belong here.
//
// interactiveWidget: an on-screen keyboard that resizes the VISUAL viewport
// slides the page under whatever is touching it — on a tablet, under a stroke in
// progress. "resizes-content" shrinks the layout viewport instead, so the reader
// reflows once when the keyboard opens rather than drifting while it animates.
//
// userScalable and maximumScale are deliberately absent: pinch-zoom is an
// accessibility guarantee (WCAG 1.4.4, Resize Text), and a reader is precisely
// the app where someone needs it. Disabling it is never the fix for a stray pan —
// containment on the reading surface is (see PdfReader/EpubReader).
export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
};

// No Google Fonts — the system stack ships with every OS, makes the app
// LAN-friendly, and gives the same clean sans-serif feel that Jellyfin's
// own UI uses. Reading content (EPUB iframe) sets its own typography.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="bg-zinc-950">
      <body className="min-h-screen bg-zinc-950 text-zinc-100 antialiased">
        {/* Apply the stored theme before anything paints — a blocking
            inline script at the top of body prevents the dark→light
            flash. Light mode is a zinc-scale variable remap in
            globals.css keyed off data-theme on <html>. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              '(function(){try{if(localStorage.getItem("hlr-theme")==="light")document.documentElement.dataset.theme="light"}catch(e){}})()',
          }}
        />
        {children}
      </body>
    </html>
  );
}
