/**
 * OrbitNav — the client's disk navigation (brief J).
 *
 * A half-disk plaque docked at the top edge: champion hub in the middle, page
 * pills on the right arc, pinned champions on the left arc. Positions come
 * from `orbitLayout` (pure, collision-free) using the *measured* pill widths,
 * so no breakpoint ever overlaps. Below 1100px the arcs collapse into a
 * segmented bar under the hub; below 760px the bar goes icon-only.
 *
 * Ink and hairlines only: one solid chrome line, one dashed inner ring, no
 * glow, no blur. Nothing animates except hover/active steps (<=120ms).
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Champion } from '../logic/pykeLogic';
import type { ViewId } from './App';
import { Filigree, type BannerChampion } from './ornaments';
import {
  orbitLayout,
  resolvePins,
  type OrbitPlacement,
  type OrbitTier,
  type PinActions,
} from './orbitLayout';
import { PinAdd, PinDot } from './PinnedChampions';
import { Portrait } from './ui';

export interface OrbitNavItem {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
  /** Live state dot: champ select live / match running. */
  badge?: boolean;
}

/** Rough width used before the first measurement lands (layout effect fixes it). */
function estimateWidth(label: string): number {
  return Math.round(label.length * 7 + 40);
}

/**
 * Profile glyph in the app's own stroke idiom (icons.tsx is not part of this
 * brief's allowlist, so the one new mark lives here rather than in the shared
 * set). Same 24px box, 1.8 stroke, currentColor.
 */
export const IconProfile: React.FC<{ size?: number; className?: string }> = ({ size = 18, className }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    aria-hidden="true"
    focusable="false"
  >
    <circle cx="12" cy="8" r="3.6" />
    <path d="M4.6 20c0-3.9 3.3-6.4 7.4-6.4s7.4 2.5 7.4 6.4" />
  </svg>
);

const NAV_RADIUS = 1500;
/**
 * Half-width of the arc in degrees. A 12° window at a ~1500px radius reads as
 * a gently curved rail (the sag is ~10px) — the disk's curve comes from the
 * plaque and the ring, and the rail stays dense instead of ballooning into a
 * half circle that would eat the window.
 */
const NAV_SPAN = 12;
const PIN_RADIUS = 900;

export const OrbitNav: React.FC<{
  tier: OrbitTier;
  items: OrbitNavItem[];
  view: ViewId;
  onSelect: (id: ViewId) => void;
  champion: BannerChampion | null;
  championName: string;
  pins: readonly string[];
  champions: Champion[];
  activePinId: string | null;
  pinActions: PinActions & { onPin: (id: string) => void };
  onOpenProfile: () => void;
}> = ({ tier, items, view, onSelect, champion, championName, pins, champions, activePinId, pinActions, onOpenProfile }) => {
  const navRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [widths, setWidths] = useState<number[]>(() => items.map((item) => estimateWidth(item.label)));

  const measure = () => {
    if (tier !== 'arc') return;
    const next = items.map((item, i) => {
      const measured = navRefs.current[i]?.offsetWidth;
      return measured && measured > 0 ? measured : estimateWidth(item.label);
    });
    setWidths((prev) => (prev.length === next.length && prev.every((w, i) => w === next[i]) ? prev : next));
  };

  // Once per mount / tier / item-set change: the pills are content-sized, so a
  // single read after layout is exact. No observers, no per-frame work.
  useLayoutEffect(measure, [tier, items, championName]);

  const navLayout = useMemo(() => {
    const sizes = items.map((_, i) => ({ width: widths[i] ?? estimateWidth(items[i].label), height: 36 }));
    // Item 0 (Home) sits nearest the hub, so the arc sweeps away from it.
    return orbitLayout(items, NAV_RADIUS, 90 + NAV_SPAN, 90 - NAV_SPAN, sizes, {
      maxRings: 2,
      fixedRings: 2,
      ringGap: 46,
      itemHeight: 36,
    });
  }, [items, widths]);

  const pinLayout = useMemo(() => {
    const slots = [...pins, '\u0000add'];
    const sizes = slots.map(() => ({ width: 40, height: 40 }));
    return orbitLayout(
      slots.map((id) => ({ id })),
      PIN_RADIUS,
      90 - NAV_SPAN,
      90 + NAV_SPAN,
      sizes,
      { maxRings: 2, ringGap: 48, itemHeight: 40 }
    );
  }, [pins]);

  const navTop = 96 - (navLayout.ringRadii[0] ?? NAV_RADIUS);
  const pinTop = 96 - (pinLayout.ringRadii[0] ?? PIN_RADIUS);
  const rowOffset = Math.max((navLayout.rings - 1) * 46, (pinLayout.rings - 1) * 48);
  const diskHeight = tier === 'arc' ? Math.round(96 + rowOffset + 42) : 0;

  const placementsById = useMemo(() => {
    const map = new Map<string, OrbitPlacement>();
    for (const p of navLayout.placements) map.set(p.id, p);
    return map;
  }, [navLayout]);

  const pinPlacements = useMemo(() => {
    const map = new Map<string, OrbitPlacement>();
    for (const p of pinLayout.placements) map.set(p.id, p);
    return map;
  }, [pinLayout]);

  const resolvedPins = resolvePins(pins, champions);

  const hub = (
    <button
      type="button"
      className="ot-disk-hub"
      onClick={onOpenProfile}
      data-ot-geo="hub"
      title={championName ? `${championName} · open profile` : 'Open profile'}
      aria-label={championName ? `${championName}, open your profile` : 'Open your profile'}
    >
      <Portrait champion={champion} size={tier === 'arc' ? 56 : 48} className="ot-disk-hub-portrait" />
    </button>
  );

  const badgeFor = (item: OrbitNavItem) => (item.badge ? <span className="ot-nav-badge" aria-label="Live" /> : null);

  if (tier === 'bar' || tier === 'icons') {
    const iconOnly = tier === 'icons';
    return (
      <div className={`ot-disk is-${tier}`} style={{ ['--ot-disk-h' as string]: '184px' }}>
        <div className="ot-disk-plate" aria-hidden="true" />
        <div className="ot-disk-top">
          {hub}
          <span className="ot-disk-name">{championName || 'No champion'}</span>
        </div>
        <nav className="ot-disk-bar" aria-label="Main">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ot-disk-pill ${iconOnly ? 'is-icon' : ''} ${view === item.id ? 'is-active' : ''}`}
              onClick={() => onSelect(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
              aria-label={item.label}
              title={item.label}
              data-ot-geo="nav"
            >
              {item.icon}
              {iconOnly ? null : <span>{item.label}</span>}
              {badgeFor(item)}
            </button>
          ))}
        </nav>
        <div className="ot-disk-pins">
          {resolvedPins.map((championPin, index) => (
            <span key={String(championPin.id)} data-ot-geo="pin">
              <PinDot
                champion={championPin}
                index={index}
                count={resolvedPins.length}
                active={championPin.id === activePinId}
                onPick={pinActions.onPick}
                onUnpin={pinActions.onUnpin}
                onReorder={pinActions.onReorder}
              />
            </span>
          ))}
          {pins.length < 6 ? <PinAdd champions={champions} pins={pins} onPin={pinActions.onPin} /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ot-disk is-arc" style={{ ['--ot-disk-h' as string]: `${diskHeight}px` }}>
      <div className="ot-disk-plate" aria-hidden="true">
        <span className="ot-disk-ring" />
      </div>
      <div className="ot-disk-top">
        {hub}
        <span className="ot-disk-name">{championName || 'No champion'}</span>
        <Filigree className="ot-disk-filigree" />
      </div>
      <nav
        className="ot-orbit"
        aria-label="Main"
        style={{ left: 'calc(50% + 274px)', top: navTop }}
      >
        {items.map((item, i) => {
          const p = placementsById.get(item.id);
          if (!p) return null;
          return (
            <button
              key={item.id}
              ref={(node) => {
                navRefs.current[i] = node;
              }}
              type="button"
              className={`ot-disk-pill is-arc ${view === item.id ? 'is-active' : ''}`}
              style={{
                left: p.x,
                top: p.y,
              }}
              onClick={() => onSelect(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
              aria-label={item.label}
              data-ot-geo="nav"
            >
              {item.icon}
              <span>{item.label}</span>
              {badgeFor(item)}
            </button>
          );
        })}
      </nav>
      <div className="ot-orbit ot-orbit-pins" style={{ left: 'calc(50% - 300px)', top: pinTop }}>
        {resolvedPins.map((championPin, index) => {
          const p = pinPlacements.get(String(championPin.id));
          if (!p) return null;
          return (
            <span key={String(championPin.id)} className="ot-orbit-slot" style={{ left: p.x, top: p.y }} data-ot-geo="pin">
              <PinDot
                champion={championPin}
                index={index}
                count={resolvedPins.length}
                active={championPin.id === activePinId}
                onPick={pinActions.onPick}
                onUnpin={pinActions.onUnpin}
                onReorder={pinActions.onReorder}
              />
            </span>
          );
        })}
        {pins.length < 6
          ? (() => {
              const slot = pinPlacements.get('\u0000add');
              if (!slot) return null;
              return (
                <span className="ot-orbit-slot" style={{ left: slot.x, top: slot.y }} data-ot-geo="pin">
                  <PinAdd champions={champions} pins={pins} onPin={pinActions.onPin} />
                </span>
              );
            })()
          : null}
      </div>
    </div>
  );
};

