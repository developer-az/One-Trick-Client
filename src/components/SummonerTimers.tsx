import React, { useEffect, useMemo, useState } from 'react';
import type { OverlayBotSummoner } from '../overlay/overlayLogic';
import { formatCd } from '../logic/summonerSpells';
import { HudFrame } from './HudFrame';
import { ChromeMark } from '../overlay/ChromeMark';
import { ChampionIcon } from './GameIcons';

interface Props {
  lanes: OverlayBotSummoner[];
  accentColor?: string;
  /** Compact strip for overlay / idle panel */
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

export const SummonerTimers: React.FC<Props> = ({ lanes, accentColor, compact }) => {
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tick only while a spell is on cooldown — idle mounts cost nothing
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
  const copyLabel = midFocus ? 'Copy mid sums' : 'Copy ADC sums';
  const copiedLabel = midFocus ? 'Copied mid sums' : 'Copied ADC sums';
  const heading = midFocus ? 'Enemy Mid Sums' : 'Enemy Bot Sums';

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
    // Click toggles the same way as Page Up / Page Down
    if (window.electronAPI?.toggleSummonerSpell) {
      void window.electronAPI.toggleSummonerSpell(role, spellName);
    } else {
      void window.electronAPI?.markSummonerSpell?.(role, spellName);
    }
  };

  const body = (
    <div className={compact ? 'space-y-1.5' : 'space-y-3'}>
      {liveLanes.map((lane) => (
        <div key={lane.role} className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <ChampionIcon
              championName={lane.championName}
              championKey={lane.championId}
              size={compact ? 18 : 22}
              className="hud-champ-icon shrink-0"
              alt={lane.championName}
            />
            <span
              className={`font-mono uppercase tracking-wider text-chrome-dim ${compact ? 'text-[11px]' : 'text-[12px]'} w-14 shrink-0`}
            >
              {lane.role}
            </span>
            <span className={`text-chrome-bright truncate ${compact ? 'text-[11px]' : 'text-sm'} min-w-[4rem]`}>
              {lane.championName}
            </span>
            <div className="flex flex-wrap gap-1">
              {lane.spells.map((sp) => {
                const ready = sp.ready || sp.remaining <= 0;
                return (
                  <button
                    key={`${lane.role}-${sp.short}`}
                    type="button"
                    title={
                      ready
                        ? `Click / hotkey: start ${sp.name} timer`
                        : `${sp.name} ${formatCd(sp.remaining)}${sp.source ? ` (${sp.source})` : ''} · click again or Page key to reset`
                    }
                    onClick={() => markSpell(lane.role, sp.name)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      markSpell(lane.role, sp.name, true);
                    }}
                    className={`hud-chip !py-0.5 ${compact ? '!text-[11px]' : '!text-[12px]'} cursor-pointer hover:opacity-100 ${
                      ready ? 'hud-accent-green !text-chrome-bright' : 'is-down'
                    }`}
                  >
                    {sp.short} {ready ? 'UP' : formatCd(sp.remaining)}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className={`hud-chip !py-0.5 ${compact ? '!text-[11px]' : '!text-[12px]'} cursor-pointer hover:opacity-100`}
          title={midFocus ? 'Copy mid laner summoner timers' : 'Copy ADC summoner timers'}
        >
          {copied ? copiedLabel : copyLabel}
        </button>
        {!compact && (
          <p className="text-[11px] font-mono text-chrome-dim/70 tracking-wide">
            PgUp/Num9 ADC Flash · PgDn/Num3 Support Flash · click chip to toggle · Flash auto on first death only
          </p>
        )}
      </div>
    </div>
  );

  if (compact) return body;

  return (
    <HudFrame accent="cyan" label="Sums" className="p-5">
      <h2 className="hud-heading text-xl text-chrome-bright mb-4">
        <ChromeMark size={14} style={{ color: accentColor }} /> {heading}
      </h2>
      {body}
    </HudFrame>
  );
};
