import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";

// Shared chrome for the signed-out pages (login, first-run setup). A
// centered, bordered card lifted off the background with a soft amber glow
// — the same warm, calm-authority tone as the library, so the first screen
// doesn't read as a stark form on a void.
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-950 px-6">
      {/* Ambient glow + faint grid so the backdrop has depth */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% -10%, rgba(245,158,11,0.10), transparent 60%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-500/40 to-transparent"
      />

      <div className="relative w-full max-w-sm">
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-8 shadow-2xl shadow-black/60 backdrop-blur-sm">
          <div className="mb-7 flex flex-col items-center gap-3 text-center">
            <span
              aria-hidden
              className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 ring-1 ring-inset ring-amber-500/25"
            >
              <BookOpen size={24} strokeWidth={1.75} />
            </span>
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight text-zinc-100">
                {title}
              </h1>
              <p className="text-sm text-zinc-500">{subtitle}</p>
            </div>
          </div>

          {children}
        </div>

        {footer && (
          <p className="mt-5 text-center text-xs text-zinc-600">{footer}</p>
        )}
      </div>
    </main>
  );
}

// Shared field + submit styles so login and setup match exactly.
export function AuthField({
  id,
  label,
  type = "text",
  autoComplete,
  autoFocus,
}: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={id}
        className="block text-xs uppercase tracking-wider text-zinc-500"
      >
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        autoFocus={autoFocus}
        className="block w-full rounded-md border border-zinc-800 bg-zinc-950/60 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/30"
      />
    </div>
  );
}

export function AuthSubmit({ children }: { children: ReactNode }) {
  return (
    <button
      type="submit"
      className="w-full rounded-md bg-amber-500/90 px-4 py-2.5 text-sm font-medium text-zinc-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
    >
      {children}
    </button>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-red-500/25 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      {children}
    </div>
  );
}
