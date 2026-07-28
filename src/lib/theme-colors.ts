/**
 * Shared chart palette — a plain module (no "use client") so both server
 * pages and client chart components can import it. Every value is a CSS
 * custom-property reference (not a literal hex), so charts automatically
 * follow the active theme (dark/light) and color-blind palette defined in
 * globals.css — no theme awareness needed inside chart components.
 */
export const C = {
  gold: "var(--color-gold)",
  goldHi: "var(--color-gold-hi)",
  ink: "var(--color-ink)",
  mute: "var(--color-mute)",
  faint: "var(--color-faint)",
  edge: "var(--color-edge)",
  edge2: "var(--color-edge2)",
  panel: "var(--color-panel)",
  panel2: "var(--color-panel2)",
  up: "var(--color-up)",
  down: "var(--color-down)",
  navy: "var(--chart-navy)",
  blue: "var(--color-blue)",
  purple: "var(--color-purple)",
  teal: "var(--color-teal)",
} as const;
