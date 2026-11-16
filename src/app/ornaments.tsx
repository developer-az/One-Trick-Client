/**
 * Ornament + champion banner primitives for the client shell (brief G).
 *
 * Everything here is static: 1px-stroke SVG marks drawn in currentColor (so
 * theme.css tints them with --ot-champ), plus the main-champion helpers.
 * The splash art rides the existing masked `.ot-splash`; copy always sits on
 * an ink scrim (R9: text never directly on art). No filters, no loops, and
 * the accent is sampled by the overlay's own resolver so there is exactly one
 * implementation of that pixel work.
 */
import React from 'react';
import { championSplashUrl } from '../data/ddragonAssets';

/** Minimal champion shape the banner needs (catalog rows and stubs fit). */
export interface BannerChampion {
  id?: string | null;
  name?: string | null;
  key?: string | number | null;
}

/**
 * Crest mark: a shield with a cross — the page-title area's ornamental head.
 * Decorative only, so it stays aria-hidden.
 */
export const CrestMark: React.FC<{ size?: number; className?: string }> = ({ size = 18, className = '' }) => (
  <svg
    className={`ot-orn-crest ${className}`}
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 2.5 20 6v6.1c0 4.3-3.2 7.7-8 9.4-4.8-1.7-8-5.1-8-9.4V6l8-3.5Z" stroke="currentColor" strokeWidth="1" />
    <path d="M12 6.4v10.8M8.4 10.6h7.2" stroke="currentColor" strokeWidth="1" />
    <circle cx="12" cy="10.6" r="1.5" stroke="currentColor" strokeWidth="1" />
  </svg>
);

/**
 * Filigree divider: a hairline with mirrored curls and a center diamond.
 * `preserveAspectRatio="none"` lets it span a card or the sidebar; the 1px
 * strokes keep their weight vertically.
 */
export const Filigree: React.FC<{ className?: string }> = ({ className = '' }) => (
  <svg
    className={`ot-orn-filigree ${className}`}
    viewBox="0 0 240 8"
    preserveAspectRatio="none"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    <path d="M0 4h82" stroke="currentColor" strokeWidth="1" />
    <path d="M158 4h82" stroke="currentColor" strokeWidth="1" />
    <path
      d="M86 4c3 0 3.5-2.6 6.5-2.6S96 4 99 4s3.5-2.6 6.5-2.6S109 4 112 4"
      stroke="currentColor"
      strokeWidth="1"
    />
    <path
      d="M128 4c3 0 3.5 2.6 6.5 2.6S138 4 141 4s3.5 2.6 6.5 2.6S151 4 154 4"
      stroke="currentColor"
      strokeWidth="1"
    />
    <path d="M120 1.6 122.4 4 120 6.4 117.6 4Z" stroke="currentColor" strokeWidth="1" />
  </svg>
);

/**
 * Slim champion strip shown above every non-Home view: masked splash on the
 * right, ink scrim, name plate. `null` champion renders nothing.
 */
export const ChampionStrip: React.FC<{ champion: BannerChampion | null }> = ({ champion }) => {
  const id = champion?.id || '';
  if (!champion || !id) return null;
  const name = champion.name || id;
  return (
    <div className="ot-orn-strip" role="img" aria-label={`Main champion: ${name}`}>
      <div className="ot-splash" aria-hidden>
        <img
          src={championSplashUrl(id)}
          alt=""
          decoding="async"
          onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
        />
      </div>
      <div className="ot-orn-strip-scrim" aria-hidden />
      <span className="ot-orn-strip-text">
        <span className="ot-orn-eyebrow">Main champion</span>
        <span className="ot-orn-strip-name">{name}</span>
      </span>
      <Filigree />
    </div>
  );
};
