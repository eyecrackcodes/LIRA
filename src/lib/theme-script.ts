/**
 * Inlined in the root layout's <head> and runs before first paint, so the
 * saved theme/palette applies immediately — no flash of the wrong theme.
 * Keep this dependency-free (no imports) since it runs as a raw <script>.
 */
export const THEME_BOOTSTRAP_SCRIPT = `
(function () {
  try {
    var t = localStorage.getItem("dsb-theme") || "dark";
    var p = localStorage.getItem("dsb-palette") || "standard";
    var html = document.documentElement;
    html.setAttribute("data-theme", t === "light" ? "light" : "dark");
    html.setAttribute("data-palette", p === "cb" ? "cb" : "standard");
  } catch (e) {}
})();
`;
