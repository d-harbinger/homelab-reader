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
        {children}
      </body>
    </html>
  );
}
