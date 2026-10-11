import React, { useEffect, useMemo, useState } from 'react';
import { formatCd } from '../logic/summonerSpells';
import type { OverlayBotSummoner } from '../overlay/overlayLogic';
import { Portrait } from './ui';

function remainingOf(s: OverlayBotSummoner['spells'][number], now: number): number {
  return typeof s.readyAt === 'number' && s.readyAt > 0 ? Math.max(0, Math.ceil((s.readyAt - now) / 1000)) : s.remaining;
}

/**
 * Enemy summoner cooldowns. Click a spell to start (or reset) its timer,
 * right-click to clear. Ticks once a second only while something is down.
 */
export const SpellTimers: React.FC<{ lanes: OverlayBotSummoner[] }> = ({ lanes }) => {
  const [now, setNow] = useState(() => Date.now());

  const anyDown = useMemo(() => lanes.some((l) => l.spells.some((s) => remainingOf(s, now) > 0)), [lanes, now]);
  useEffect(() => {
    if (!anyDown) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyDown]);

  const mark = (role: OverlayBotSummoner['role'], name: string, clear = false) => {
    const api = window.electronAPI;
    if (clear) void api?.markSummonerSpell?.(role, name, { clear: true });
    else if (api?.toggleSummonerSpell) void api.toggleSummonerSpell(role, name);
    else void api?.markSummonerSpell?.(role, name);
  };

  return (
    <div className="space-y-2.5">
      {lanes.map((lane) => (
        <div key={lane.role} className="flex items-center gap-3">
          <Portrait champion={{ name: lane.championName, key: lane.championId }} size={36} ring="red" />
          <div className="min-w-0 w-24 flex-none">
            <div className="truncate text-[15px] font-medium">{lane.championName}</div>
            <div className="text-xs ot-faint uppercase tracking-wide">{lane.role}</div>
          </div>
          <div className="flex gap-2">
            {lane.spells.map((s) => {
              const rem = remainingOf(s, now);
              const ready = rem <= 0;
              return (
                <button
                  key={s.short}
                  type="button"
                  className={`ot-spell ot-num ${ready ? 'is-ready' : 'is-down'}`}
                  title={ready ? `Start ${s.name} timer` : `Reset ${s.name} (right-click clears)`}
                  onClick={() => mark(lane.role, s.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    mark(lane.role, s.name, true);
                  }}
                >
                  {s.short}
                  <span className="ml-auto">{ready ? 'Up' : formatCd(rem)}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};
