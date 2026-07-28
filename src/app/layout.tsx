import type { Metadata } from "next";
import { Barlow_Condensed, Inter } from "next/font/google";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme-script";
import { BRAND_FULL } from "@/lib/brand";
import "./globals.css";

const display = Barlow_Condensed({
  weight: ["500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-display",
});
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: `${BRAND_FULL} Mode`,
  description: "Sales performance suite — agent cards, team pulse, diagnostics.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: the theme bootstrap script sets data-theme/
    // data-palette on this element before React hydrates, which is an
    // intentional, expected mismatch (see src/lib/theme-script.ts).
    <html lang="en" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so the saved theme/palette applies with
            no flash of the wrong colors. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className="min-h-screen bg-field text-ink">{children}</body>
    </html>
  );
}
