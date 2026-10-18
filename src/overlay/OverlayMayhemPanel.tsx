import React from 'react';
import type { RankedMayhemChoice } from '../logic/mayhem/types';

const rarityClass = (r: string): string => {
  if (r === 'prismatic') return 'text-teal-300';
  if (r === 'gold') return 'text-[color:var(--ot-gold)]';
  return 'text-gray-300';
};

const verdictLabel = (v: RankedMayhemChoice['verdict']): { text: string; className: string } => {
  if (v === 'pick') return { text: 'PICK', className: 'text-teal-300 font-bold' };
  if (v === 'alt') return { text: 'ALT', className: 'text-amber-300 font-semibold' };
  return { text: 'SKIP', className: 'text-red-300/90 font-semibold' };
};

export const OverlayMayhemPanel: React.FC<{
  championName: string;
  ranked: RankedMayhemChoice[];
  detecting?: boolean;
  mode?: 'roll' | 'suggest' | 'reading';
  pickHint?: string;
  waitingForDeath?: boolean;
}> = ({ championName, ranked, detecting, mode, pickHint, waitingForDeath }) => {
  const resolvedMode =
    mode ?? (detecting ? (ranked.length ? 'roll' : 'reading') : ranked.length ? 'roll' : 'suggest');

  if (!ranked.length && resolvedMode !== 'reading' && !waitingForDeath && !pickHint) return null;

  const title =
    resolvedMode === 'reading'
      ? 'Reading augment names…'
      : resolvedMode === 'suggest'
        ? 'No roll detected — top augments'
        : 'Pick 1 · 2 · 3';

  return (
    <div className="hud-overlay-panel pointer-events-none max-w-[min(380px,92vw)]">
      <div className="text-[10px] uppercase tracking-wider opacity-70 mb-1">Mayhem · {championName}</div>
      <div className="text-xs font-semibold mb-1.5">{pickHint || title}</div>
      {ranked.length ? (
        <ol className="space-y-2">
          {ranked.slice(0, 3).map((row) => {
            const badge = verdictLabel(row.verdict);
            return (
              <li key={row.augmentId} className="text-[11px] leading-snug">
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="ot-num font-bold text-sm w-4">{row.rank}</span>
                  <span className={`font-medium ${rarityClass(row.rarity)}`}>{row.name}</span>
                  <span className={`text-[10px] uppercase tracking-wide ${badge.className}`}>{badge.text}</span>
                </div>
                <p className="opacity-80 pl-5 mt-0.5">{row.headline}</p>
              </li>
            );
          })}
          {resolvedMode === 'roll' && ranked.length < 3 ? (
            <li className="text-[11px] leading-snug opacity-70">
              <div className="flex items-baseline gap-1.5">
                <span className="ot-num font-bold text-sm w-4">{ranked.length + 1}</span>
                <span>Reading third card…</span>
              </div>
              <p className="pl-5 mt-0.5">Page Down to rescan · Page Up to close.</p>
            </li>
          ) : null}
        </ol>
      ) : (
        <p className="text-[11px] opacity-70">Page Down to scan · Page Up to close the augment HUD.</p>
      )}
    </div>
  );
};
