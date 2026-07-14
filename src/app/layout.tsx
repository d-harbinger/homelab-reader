import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "homelab-reader",
  description: "Self-hosted book server for technical libraries",
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
