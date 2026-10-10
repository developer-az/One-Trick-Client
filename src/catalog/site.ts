/** Canonical public site is Vercel (website/ as the project root). Pages is a fallback mirror. */
export const VERCEL_SITE_ORIGIN = 'https://one-trick-client.vercel.app';
export const PAGES_SITE_ORIGIN = 'https://developer-az.github.io/One-Trick-Client';

export const SITE_ORIGIN = VERCEL_SITE_ORIGIN;

export const CATALOG_API_BASES = [
  `${VERCEL_SITE_ORIGIN}/api/v1`,
  `${PAGES_SITE_ORIGIN}/api/v1`,
] as const;

export const DEFAULT_CATALOG_API_BASE = CATALOG_API_BASES[0];
