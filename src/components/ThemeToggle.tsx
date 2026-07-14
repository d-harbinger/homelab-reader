"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Light/dark switch for the app chrome. The dark palette is the
// written-in-code one (zinc scale on zinc-950); light mode is a CSS
// variable remap in globals.css under [data-theme="light"], so no
// component carries theme-conditional classes. The choice persists in
// localStorage and is applied before first paint by the inline script
// in layout.tsx — this button only flips the attribute + storage.
const STORAGE_KEY = "hlr-theme";

export function ThemeToggle() {
  const [light, setLight] = useState(false);

  // Read the applied theme after mount (the boot script has already
  // set the attribute; SSR knows nothing about it).
  useEffect(() => {
    setLight(document.documentElement.dataset.theme === "light");
  }, []);

  function toggle() {
    const next = !light;
    setLight(next);
    if (next) {
      document.documentElement.dataset.theme = "light";
    } else {
      delete document.documentElement.dataset.theme;
    }
    try {
      localStorage.setItem(STORAGE_KEY, next ? "light" : "dark");
    } catch {
      /* storage unavailable — the flip still applies for this page */
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
      title={light ? "Dark mode" : "Light mode"}
      className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
    >
      {light ? <Moon size={15} /> : <Sun size={15} />}
    </button>
  );
}
