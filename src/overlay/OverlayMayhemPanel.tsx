import React from 'react';
import type { RankedMayhemChoice } from '../logic/mayhem/types';

/*
 * In-game augment panel.
 *
 * Design rule: the decision is one number ("Pick 2"), the reason is <= 6
 * words, and the three cards read top-to-bottom in rank order (1 best).
 * NOTE: rank is the app's score order, not the on-screen left-to-right card
 * order — the panel says "Pick n" meaning the nth row here.
 */

const RARITY_COLOR: Record<string, string> = {
  prismatic: 'var(--ov-teal)',
  gold: 'var(--ov-amber)',
  silver: 'var(--ov-text-2)',
};

/** Keep the HUD headline short: ranks explain, they don't narrate. */
function shortenReason(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (cleaned.length <= 48) return cleaned;
  const cut = cleaned.slice(0, 48);
  const space = cut.lastIndexOf(' ');
  return `${space > 18 ? cut.slice(0, space) : cut}…`;
}

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

  const best = ranked.reduce<RankedMayhemChoice | null>(
    (acc, row) => (!acc || row.score > acc.score ? row : acc),
    null
  );

  if (resolvedMode === 'reading') {
    return (
      <div className="hud-overlay-panel px-2 py-1.5">
        <div className="hud-chrome-meta !text-[11px]">Reading augment cards…</div>
      </div>
    );
  }

  return (
    <div className="hud-overlay-panel pointer-events-none">
      <div className="hud-chrome-header !py-1 !px-2 flex items-center justify-between gap-2">
        <div className="hud-chrome-title !text-[11px] truncate">Augments · {championName}</div>
        {pickHint ? <div className="hud-chrome-meta !text-[11px] shrink-0">{pickHint}</div> : null}
      </div>

      <div className="relative z-10 px-2 py-1.5">
        {best ? (
          <div className="flex items-center gap-1.5 mb-1.5">
            <span
              className="text-[10px] font-bold uppercase tracking-[0.14em] px-1.5 py-0.5 rounded"
              style={{ background: 'rgba(53,208,186,0.16)', color: 'var(--ov-teal)' }}
            >
              Pick {best.rank}
            </span>
            <span className="text-[12px] font-semibold truncate" style={{ color: 'var(--ov-text)' }}>
              {best.name}
            </span>
          </div>
        ) : null}

        {ranked.length ? (
          <ol className="space-y-1">
            {ranked.map((row) => {
              const isBest = row.rank === best?.rank;
              const verdictTone =
                row.verdict === 'pick' ? 'var(--ov-teal)' : row.verdict === 'alt' ? 'var(--ov-amber)' : 'var(--ov-red)';
              return (
                <li
                  key={row.augmentId}
                  className="flex items-start gap-1.5 text-[11px] leading-snug"
                  style={isBest ? { opacity: 1 } : { opacity: 0.72 }}
                >
                  <span
                    className="ot-num font-bold w-3 shrink-0 text-right"
                    style={{ color: isBest ? 'var(--ov-teal)' : 'var(--ov-text-2)' }}
                  >
                    {row.rank}
                  </span>
                  <span className="min-w-0">
                    <span
                      className="font-medium"
                      style={{ color: isBest ? 'var(--ov-text)' : RARITY_COLOR[row.rarity] }}
                    >
                      {row.name}
                    </span>
                    <span
                      className="ml-1 text-[9px] font-bold uppercase tracking-wider"
                      style={{ color: verdictTone }}
                    >
                      {row.verdict === 'pick' ? 'take' : row.verdict === 'alt' ? 'alt' : 'skip'}
                    </span>
                    <span className="block" style={{ color: 'var(--ov-text-2)' }}>
                      {shortenReason(row.headline)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-[11px]" style={{ color: 'var(--ov-text-2)' }}>
            PageDown scans · PageUp closes
          </p>
        )}

        {waitingForDeath ? (
          <div className="hud-chrome-meta !text-[10px] mt-1">Opens again at the next augment</div>
        ) : null}
      </div>
    </div>
  );
};
