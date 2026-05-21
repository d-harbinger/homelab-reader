export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl space-y-4 text-center">
        <h1 className="text-3xl font-semibold">homelab-reader</h1>
        <p className="text-zinc-400">
          Scaffold ready. Schema, scanner, reader, and OPDS land in the next phases.
        </p>
        <p className="text-zinc-500 text-sm">
          Configure <code className="text-zinc-300">BOOKS_PATH</code> in <code className="text-zinc-300">.env</code> to point at your library.
        </p>
      </div>
    </main>
  );
}
