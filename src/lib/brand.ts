/**
 * Branding — the one place to rename this app.
 *
 * Everything user-visible reads from here, so making it yours is a matter of
 * setting three env vars (or editing the defaults below) rather than hunting
 * through components. All three are NEXT_PUBLIC_ because the nav, login page,
 * and document title render them client-side; they are cosmetic strings, never
 * secrets.
 *
 *   NEXT_PUBLIC_BRAND_MARK     short mark, shown in the accent color   e.g. "ACME"
 *   NEXT_PUBLIC_BRAND_NAME     wordmark next to the mark               e.g. "Franchise"
 *   NEXT_PUBLIC_BRAND_TAGLINE  small line under the wordmark           e.g. "Sales Performance"
 */

export const BRAND = {
  mark: process.env.NEXT_PUBLIC_BRAND_MARK?.trim() || "ACME",
  name: process.env.NEXT_PUBLIC_BRAND_NAME?.trim() || "Franchise",
  tagline: process.env.NEXT_PUBLIC_BRAND_TAGLINE?.trim() || "Sales Performance",
} as const;

/** "ACME Franchise" — for <title>, emails, and anywhere the two read as one. */
export const BRAND_FULL = `${BRAND.mark} ${BRAND.name}`;
