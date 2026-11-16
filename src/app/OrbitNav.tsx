/**
 * OrbitNav — the client's disk navigation (brief K, matching the approved
 * mockup 1:1).
 *
 * A true circle, half off the top edge. The hub portrait sits inside it with
 * the champion name in Cinzel under it; pinned champions fan down the LEFT
 * arc and page pills fan up the RIGHT arc, both on circles concentric with the
 * disk at `disk radius + 70px`. Positions come from `orbitLayout` (pure) with
 * the measured pill widths, so the fan never overlaps.
 *
 * Below 1100px the arcs collapse to a segmented bar under the disk; below
 * 760px the bar goes icon-only (the only place icons are used — the reference
 * arc pills are text only).
 */
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Champion } from '../logic/pykeLogic';
import type { ViewId } from './App';
import {
  anchorsAlongArc,
  orbitFromAnchors,
  resolvePins,
  type OrbitAnchor,
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

/** Arc pills are text only (reference); this is the measured-size estimate. */
function estimateWidth(label: string): number {
  return Math.round(label.length * 7.6 + label.length * 1.9 + 24);
}

/**
 * The mockup's own nav fan, measured off mockup-orbital.html at 1280x720 and
 * expressed in disk radii: HOME sits at the disk's lower right and the pills
 * climb up-right, Mayhem farthest out. OrbitNav feeds these to the anchor
 * solver so the shape matches the reference and still cannot overlap.
 */
const REF_NAV_ANCHORS: OrbitAnchor[] = [
  { r: 1.273, deg: 64.6 },
  { r: 1.507, deg: 45.0 },
  { r: 1.847, deg: 28.1 },
  { r: 2.32, deg: 16.2 },
  { r: 2.767, deg: 8.9 },
  { r: 3.293, deg: 11.0 },
  { r: 2.907, deg: 16.8 },
];
/** The mockup's pin band: far left (the "+") sweeping down to the disk. */
const PIN_FROM: OrbitAnchor = { r: 1.52, deg: 165 };
const PIN_TO: OrbitAnchor = { r: 1.1, deg: 116 };

/**
 * Profile glyph in the app's own stroke idiom (icons.tsx is not part of this
 * brief's allowlist). Same 24px box, 1.8 stroke, currentColor.
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

export const OrbitNav: React.FC<{
  tier: OrbitTier;
  disk: number;
  items: OrbitNavItem[];
  view: ViewId;
  onSelect: (id: ViewId) => void;
  champion: Champion | { id?: string | null; name?: string | null; key?: string | number | null } | null;
  championName: string;
  pins: readonly string[];
  champions: Champion[];
  activePinId: string | null;
  pinActions: PinActions & { onPin: (id: string) => void };
}> = ({ tier, disk, items, view, onSelect, champion, championName, pins, champions, activePinId, pinActions }) => {
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

  // One read after layout / tier / item-set change: the pills are content
  // sized, so a single pass is exact. No observers, no per-frame work.
  useLayoutEffect(measure, [tier, items, championName]);

  const diskRadius = disk / 2;

  const navLayout = useMemo(() => {
    const sizes = items.map((_, i) => ({ width: widths[i] ?? estimateWidth(items[i].label), height: 36 }));
    return orbitFromAnchors(items, REF_NAV_ANCHORS, diskRadius, sizes, { gap: 8, itemHeight: 36 });
  }, [items, widths, diskRadius]);

  // "+" first in the fan so it lands at the far end of the left arc.
  const pinSlots = useMemo(() => ['\u0000add', ...pins], [pins]);
  const pinLayout = useMemo(
    () =>
      orbitFromAnchors(
        pinSlots.map((id) => ({ id })),
        anchorsAlongArc(pinSlots.length, PIN_FROM, PIN_TO),
        diskRadius,
        pinSlots.map(() => ({ width: 40, height: 40 })),
        { gap: 8, itemHeight: 40, shape: 'circle' }
      ),
    [pinSlots, diskRadius]
  );

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
  const badgeFor = (item: OrbitNavItem) =>
    item.badge ? <span className="ot-nav-badge" aria-label="Live" /> : null;

  const hub = (
    <button
      type="button"
      className="ot-disk-hub"
      onClick={() => onSelect('profile')}
      data-ot-geo="hub"
      title={championName ? `${championName} · open profile` : 'Open profile'}
      aria-label={championName ? `${championName}, open your profile` : 'Open your profile'}
    >
      <Portrait champion={champion} size={Math.round(disk * 0.28)} className="ot-disk-hub-portrait" />
    </button>
  );

  if (tier === 'bar' || tier === 'icons') {
    const iconOnly = tier === 'icons';
    return (
      <div className={`ot-disk is-${tier}`} style={{ ['--ot-disk-size' as string]: `${disk}px` }}>
        <div className="ot-disk-circle" aria-hidden="true" />
        {hub}
        <span className="ot-disk-name" data-ot-geo="hub-name">
          {championName || 'No champion'}
        </span>
        <nav className="ot-disk-bar" aria-label="Main">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`ot-disk-pill is-core ${iconOnly ? 'is-icon' : ''} ${view === item.id ? 'is-active' : ''}`}
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
    <div className="ot-disk is-arc" style={{ ['--ot-disk-size' as string]: `${disk}px` }}>
      <div className="ot-disk-circle" aria-hidden="true" />
      {hub}
      <span className="ot-disk-name" data-ot-geo="hub-name">
        {championName || 'No champion'}
      </span>
      <nav className="ot-orbit ot-orbit-nav" aria-label="Main">
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
              style={{ left: p.x, top: p.y }}
              onClick={() => onSelect(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
              aria-label={item.label}
              data-ot-geo="nav"
            >
              <span>{item.label}</span>
              {badgeFor(item)}
            </button>
          );
        })}
      </nav>
      <div className="ot-orbit ot-orbit-pins">
        {(() => {
          const slot = pinPlacements.get('\u0000add');
          if (!slot || pins.length >= 6) return null;
          return (
            <span className="ot-orbit-slot" style={{ left: slot.x, top: slot.y }} data-ot-geo="pin">
              <PinAdd champions={champions} pins={pins} onPin={pinActions.onPin} />
            </span>
          );
        })()}
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
      </div>
    </div>
  );
};

