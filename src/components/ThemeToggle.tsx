"use client";

import { useEffect, useState } from "react";

type Appearance = "dark" | "light";
type Palette = "standard" | "cb";

/**
 * Appearance (dark/light) + color-blind-safe palette toggle. Two independent
 * segmented controls so either can be combined with the other. Persists to
 * localStorage; src/lib/theme-script.ts applies the saved choice before
 * first paint to avoid a flash of the wrong theme.
 */
export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState<Appearance>("dark");
  const [palette, setPalette] = useState<Palette>("standard");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const html = document.documentElement;
    setTheme(html.getAttribute("data-theme") === "light" ? "light" : "dark");
    setPalette(html.getAttribute("data-palette") === "cb" ? "cb" : "standard");
    setMounted(true);
  }, []);

  const applyTheme = (next: Appearance) => {
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("dsb-theme", next);
    } catch {
      // localStorage unavailable (private mode) — theme still applies for this load.
    }
  };

  const applyPalette = (next: Palette) => {
    setPalette(next);
    document.documentElement.setAttribute("data-palette", next);
    try {
      localStorage.setItem("dsb-palette", next);
    } catch {
      // localStorage unavailable (private mode) — palette still applies for this load.
    }
  };

  // Avoid a hydration mismatch flash: render the default look until mounted,
  // since the real state comes from a DOM attribute the bootstrap script set.
  if (!mounted) return <div className={compact ? "h-7" : "h-14"} aria-hidden />;

  const segBtn = (active: boolean) =>
    `display flex-1 rounded-sm px-2 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
      active ? "bg-gold text-field" : "text-mute hover:text-ink"
    }`;

  return (
    <div className={`flex ${compact ? "flex-row gap-2" : "flex-col gap-2"}`}>
      <div className="flex items-center gap-1 rounded-sm border border-edge bg-panel2 p-0.5">
        <button
          type="button"
          onClick={() => applyTheme("dark")}
          className={segBtn(theme === "dark")}
          aria-pressed={theme === "dark"}
          title="Dark mode"
        >
          Dark
        </button>
        <button
          type="button"
          onClick={() => applyTheme("light")}
          className={segBtn(theme === "light")}
          aria-pressed={theme === "light"}
          title="Light mode"
        >
          Light
        </button>
      </div>
      <div className="flex items-center gap-1 rounded-sm border border-edge bg-panel2 p-0.5">
        <button
          type="button"
          onClick={() => applyPalette("standard")}
          className={segBtn(palette === "standard")}
          aria-pressed={palette === "standard"}
          title="Standard colors"
        >
          Standard
        </button>
        <button
          type="button"
          onClick={() => applyPalette("cb")}
          className={segBtn(palette === "cb")}
          aria-pressed={palette === "cb"}
          title="Color-blind safe palette (swaps red/green for blue/orange)"
        >
          Color-blind
        </button>
      </div>
    </div>
  );
}
