/**
 * Pinned champions (brief J) — the pin slots on the disk's left arc, the "+"
 * picker popover, and the manage rail used by the Profile view.
 *
 * The list math lives in src/app/orbitLayout.ts (pure, tested); this file only
 * renders it. Every interaction is a real <button>: clicking a pin makes it
 * the active champion, the × (or right click) unpins it, and pins reorder with
 * a pointer drag or Alt+Arrow. No drag library, no animation beyond a 120ms
 * hover step.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { Champion } from '../logic/pykeLogic';
import { IconX } from './icons';
import {
  PIN_LIMIT,
  resolvePins,
  type PinActions,
  type PinChampion,
} from './orbitLayout';
import { ChampionCombobox, Portrait } from './ui';

/**
 * One 40px pin slot: circular portrait, accent ring when active, × on hover,
 * drag to reorder, Alt+Arrow to nudge.
 */
export const PinDot: React.FC<
  PinActions & {
    champion: PinChampion;
    index: number;
    count: number;
    active?: boolean;
    labelled?: boolean;
  }
> = ({ champion, index, count, active, onPick, onUnpin, onReorder, labelled = false }) => {
  const id = String(champion.id || '');
  const name = champion.name || id;
  const drag = useRef<{ startX: number } | null>(null);
  const pressTimer = useRef<number | null>(null);
  const heldToUnpin = useRef(false);
  const [dragging, setDragging] = useState(false);

  const clearPress = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  useEffect(() => clearPress, []);

  const finish = (clientX: number, startX: number) => {
    const delta = clientX - startX;
    if (Math.abs(delta) < 18) return;
    const steps = Math.round(delta / 48);
    const target = Math.max(0, Math.min(count - 1, index + steps));
    if (target !== index) onReorder(index, target);
  };

  return (
    <span className={`ot-pin ${active ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''} ${labelled ? 'is-labelled' : ''}`}>
      <button
        type="button"
        className="ot-pin-dot"
        aria-label={active ? `${name} (active champion)` : `Make ${name} the active champion`}
        aria-pressed={!!active}
        title={name}
        onClick={() => {
          if (heldToUnpin.current) {
            heldToUnpin.current = false;
            return;
          }
          onPick(id);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          onUnpin(id);
        }}
        onKeyDown={(e) => {
          if (!e.altKey) return;
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            onReorder(index, index - 1);
          } else if (e.key === 'ArrowRight') {
            e.preventDefault();
            onReorder(index, index + 1);
          } else if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            onUnpin(id);
          }
        }}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { startX: e.clientX };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          // Long press unpins on touch, where there is no right click.
          clearPress();
          pressTimer.current = window.setTimeout(() => {
            pressTimer.current = null;
            if (drag.current) {
              drag.current = null;
              setDragging(false);
              heldToUnpin.current = true;
              onUnpin(id);
            }
          }, 600);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          if (Math.abs(e.clientX - drag.current.startX) > 18) {
            setDragging(true);
            clearPress();
          }
        }}
        onPointerUp={(e) => {
          clearPress();
          const start = drag.current;
          drag.current = null;
          setDragging(false);
          if (start) finish(e.clientX, start.startX);
        }}
        onPointerCancel={() => {
          clearPress();
          drag.current = null;
          setDragging(false);
        }}
      >
        <Portrait champion={champion} size={40} className="ot-pin-portrait" />
        {labelled ? <span className="ot-pin-label">{name}</span> : null}
      </button>
      <button type="button" className="ot-pin-remove" aria-label={`Unpin ${name}`} onClick={() => onUnpin(id)}>
        <IconX size={10} />
      </button>
    </span>
  );
};

/** The "+" slot: opens the champion picker anchored to itself. */
export const PinAdd: React.FC<{
  champions: Champion[];
  pins: readonly string[];
  onPin: (id: string) => void;
  label?: string;
}> = ({ champions, pins, onPin, label = 'Pin a champion' }) => {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="ot-pin-add-wrap" ref={root}>
      <button
        type="button"
        className="ot-pin-add"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">+</span>
      </button>
      {open ? (
        <div className="ot-pin-popover" role="dialog" aria-label="Pin a champion">
          <div className="ot-pin-popover-head">Pin a champion</div>
          <ChampionCombobox
            champions={champions}
            value={null}
            exclude={new Set(pins)}
            autoFocus
            placeholder={champions.length ? 'Search a champion' : 'Loading champions'}
            disabled={!champions.length}
            onChange={(c) => {
              if (!c) return;
              onPin(c.id);
              setOpen(false);
            }}
          />
          <p className="ot-pin-popover-hint">Pinned champions live on the left of the disk. Up to six.</p>
        </div>
      ) : null}
    </div>
  );
};

/**
 * Pin rail for the bar / icon tiers and the Profile view: a row of dots plus
 * the "+" slot. `manage` adds the reorder hint.
 */
export const PinRail: React.FC<
  PinActions & {
    pins: readonly string[];
    champions: Champion[];
    activeId: string | null;
    onPin: (id: string) => void;
    manage?: boolean;
  }
> = ({ pins, champions, activeId, onPick, onUnpin, onReorder, onPin, manage = false }) => {
  const resolved = resolvePins(pins, champions);
  return (
    <div className={`ot-pin-row ${manage ? 'is-manage' : ''}`} role="group" aria-label="Pinned champions">
      {resolved.map((champion, index) => (
        <PinDot
          key={String(champion.id)}
          champion={champion}
          index={index}
          count={resolved.length}
          active={champion.id === activeId}
          onPick={onPick}
          onUnpin={onUnpin}
          onReorder={onReorder}
          labelled={manage}
        />
      ))}
      {pins.length < PIN_LIMIT ? <PinAdd champions={champions} pins={pins} onPin={onPin} /> : null}
      {manage && resolved.length ? (
        <span className="ot-pin-manage-hint">Drag to reorder · Alt+← → moves · × unpins</span>
      ) : null}
    </div>
  );
};
