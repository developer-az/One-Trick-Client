import React, { useEffect, useMemo, useState } from 'react';
import type { OverlayBotSummoner } from '../overlay/overlayLogic';
import { formatCd } from '../logic/summonerSpells';
import { championSquareUrl } from '../data/ddragonAssets';

interface Props {
  lanes: OverlayBotSummoner[];
  accentColor?: string;
  compact?: boolean;
}

function isMidFocus(lanes: OverlayBotSummoner[]): boolean {
  return lanes.some((l) => l.role === 'Mid') && !lanes.some((l) => l.role === 'Bot' || l.role === 'Support');
}

function formatPrimaryClipboard(lanes: OverlayBotSummoner[], now: number): string | null {
  const mid = lanes.find((l) => l.role === 'Mid');
  const adc = lanes.find((l) => l.role === 'Bot');
  const primary = mid || adc;
  if (!primary) return null;
  const bits = primary.spells.map((s) => {
    const rem =
      typeof s.readyAt === 'number' && s.readyAt > 0
        ? Math.max(0, Math.ceil((s.readyAt - now) / 1000))
        : s.remaining;
    return rem <= 0 ? `${s.short} UP` : `${s.short} ${formatCd(rem)}`;
  });
  const label = primary.role === 'Mid' ? 'MID' : 'ADC';
  return `${label} ${primary.championName}: ${bits.join(' · ')}`;
}

export const SummonerTimers: React.FC<Props> = ({ lanes, compact }) => {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const hasActiveCd = useMemo(
    () =>
      lanes.some((lane) =>
        lane.spells.some((s) =>
          typeof s.readyAt === 'number' && s.readyAt > 0 ? s.readyAt > now : s.remaining > 0
        )
      ),
    [lanes, now]
  );

  useEffect(() => {
    if (!lanes.length || !hasActiveCd) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lanes.length, hasActiveCd]);

  const liveLanes = useMemo(
    () =>
      lanes.map((lane) => ({
        ...lane,
        spells: lane.spells.map((s) => {
          const remaining =
            typeof s.readyAt === 'number' && s.readyAt > 0
              ? Math.max(0, Math.ceil((s.readyAt - now) / 1000))
              : s.remaining;
          return { ...s, remaining, ready: remaining <= 0 };
        }),
      })),
    [lanes, now]
  );

  if (!liveLanes.length) return null;

  const midFocus = isMidFocus(liveLanes);
  const copyLabel = midFocus ? 'Copy mid' : 'Copy ADC';

  const handleCopy = async () => {
    const text = formatPrimaryClipboard(liveLanes, now);
    if (!text) return;
    try {
      if (window.electronAPI?.clipboardWrite) {
        await window.electronAPI.clipboardWrite(text);
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  const markSpell = (role: OverlayBotSummoner['role'], spellName: string, clear?: boolean) => {
    if (clear) {
      void window.electronAPI?.markSummonerSpell?.(role, spellName, { clear: true });
      return;
    }
    if (window.electronAPI?.toggleSummonerSpell) {
      void window.electronAPI.toggleSummonerSpell(role, spellName);
    } else {
      void window.electronAPI?.markSummonerSpell?.(role, spellName);
    }
  };

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      {liveLanes.map((lane) => (
        <div key={lane.role} className="flex items-center gap-1.5 min-w-0">
          <img
            src={championSquareUrl(lane.championName.replace(/[^a-zA-Z]/g, '') || lane.championName)}
            alt=""
            width={compact ? 18 : 22}
            height={compact ? 18 : 22}
            className="hud-champ-icon shrink-0"
            decoding="async"
            draggable={false}
            onError={(e) => {
              (e.target as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
          <span className={`font-mono text-chrome-dim shrink-0 ${compact ? 'text-[8px] w-7' : 'text-[10px] w-10'}`}>
            {lane.role === 'Support' ? 'SUP' : lane.role === 'Bot' ? 'ADC' : 'MID'}
          </span>
          <div className="flex flex-wrap gap-0.5 min-w-0">
            {lane.spells.map((sp) => {
              const ready = sp.ready || sp.remaining <= 0;
              return (
                <button
                  key={`${lane.role}-${sp.short}`}
                  type="button"
                  title={
                    ready
                      ? `Start ${sp.name} timer`
                      : `${sp.name} ${formatCd(sp.remaining)} · click to reset`
                  }
                  onClick={() => markSpell(lane.role, sp.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    markSpell(lane.role, sp.name, true);
                  }}
                  className={`hud-chip !py-0 ${compact ? '!text-[9px]' : '!text-[10px]'} cursor-pointer ${
                    ready ? 'hud-accent-green' : '!text-chrome-dim'
                  }`}
                >
                  {sp.short} {ready ? 'UP' : formatCd(sp.remaining)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!compact && (
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="hud-btn"
          title={midFocus ? 'Copy mid laner summoner timers' : 'Copy ADC summoner timers'}
        >
          {copied ? 'Copied' : copyLabel}
        </button>
      )}
    </div>
  );
};
