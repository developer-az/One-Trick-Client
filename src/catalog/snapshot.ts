/**
 * Catalog snapshot shipped inside the app (same files the website serves at
 * /api/v1). Loaded lazily, only when there is no cached or live catalog, so a
 * first launch without internet still has every champion, item and rune.
 */
import manifest from '../../website/public/api/v1/manifest.json';
import champions from '../../website/public/api/v1/champions.json';
import items from '../../website/public/api/v1/items.json';
import runes from '../../website/public/api/v1/runes.json';
import recommendations from '../../website/public/api/v1/recommendations.json';
import profiles from '../../website/public/api/v1/profiles.json';
import type { CatalogBundle } from './types';

export const SNAPSHOT_BUNDLE = {
  manifest,
  champions,
  items,
  runes,
  recommendations,
  profiles,
} as unknown as CatalogBundle;
