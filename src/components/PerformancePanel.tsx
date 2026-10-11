import React, { useEffect, useState } from 'react';

/**
 * Game-impact panel: what One Trick is costing right now, and the switches
 * that change it. Stats refresh every 2 s only while this panel is on screen.
 */

const PHASE_LABEL: Record<string, string> = {
  None: 'Home screen',
  Lobby: 'In lobby',
  Matchmaking: 'In queue',
  ReadyCheck: 'Match found',
  ChampSelect: 'Champ select',
  GameStart: 'Loading into game',
  InProgress: 'In game',
  Reconnect: 'Reconnecting to game',
  WaitingForStats: 'Game over',
  PreEndOfGame: 'Game over',
  EndOfGame: 'Post-game',
};

function lcuLabel(lcu: LcuStatus | undefined): string {
  if (!lcu) return 'Unknown';
  if (lcu.state === 'searching') return 'Not running (watching for it)';
  if (lcu.state === 'connecting') return 'Connecting…';
  const phase = lcu.phase ? PHASE_LABEL[lcu.phase] || lcu.phase : 'Connected';
  return lcu.summonerName ? `${lcu.summonerName} · ${phase}` : phase;
}

function hotkeyLabel(mode: string | undefined): string {
  switch (mode) {
    case 'native':
      return 'Keyboard-only hook active';
    case 'starting':
      return 'Starting…';
    case 'unavailable':
      return 'Fallback (may not work while League has focus)';
    default:
      return 'Off';
  }
}

const Row: React.FC<{ label: string; value: React.ReactNode; tone?: 'ok' | 'warn' | 'muted' }> = ({
  label,
  value,
  tone,
}) => (
  <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-white/5 last:border-0">
    <span className="text-xs uppercase tracking-wider text-chrome-dim">{label}</span>
    <span
      className={`text-sm text-right ${
        tone === 'ok' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : 'text-chrome-silver'
      }`}
    >
      {value}
    </span>
  </div>
);

const Toggle: React.FC<{
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}> = ({ label, hint, checked, onChange }) => (
  <label className="flex items-start gap-3 py-2 cursor-pointer select-none">
    <input
      type="checkbox"
      className="mt-1 h-4 w-4 accent-slate-200"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
    <span>
      <span className="block text-sm text-chrome-bright">{label}</span>
      <span className="block text-xs text-chrome-dim leading-relaxed">{hint}</span>
    </span>
  </label>
);

export const PerformancePanel: React.FC = () => {
  const [stats, setStats] = useState<PerfStats | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getPerfStats) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      void api.getPerfStats?.().then((next) => {
        if (!cancelled) setStats(next);
      });
    };
    load();
    void api.getAppSettings?.().then((next) => {
      if (!cancelled) setSettings(next);
    });
    const id = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const update = (patch: Partial<AppSettings>) => {
    void window.electronAPI?.setAppSettings?.(patch).then((res) => {
      setSettings(res.settings);
      setRestartRequired(res.restartRequired);
    });
  };

  if (!window.electronAPI?.getPerfStats) {
    return (
      <div className="hud-panel p-6 text-sm text-chrome-dim">
        Performance stats are available in the desktop app.
      </div>
    );
  }

  const processes = [...(stats?.processes || [])].sort((a, b) => b.cpu - a.cpu);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="hud-panel p-6">
        <h2 className="hud-heading text-lg text-chrome-bright mb-1">Game impact</h2>
        <p className="text-xs text-chrome-dim mb-4">
          Everything One Trick is doing right now. In a match the only regular work should be one
          Live Client read every few seconds.
        </p>
        <Row label="League client" value={lcuLabel(stats?.lcu)} tone={stats?.lcu.state === 'connected' ? 'ok' : 'muted'} />
        <Row
          label="Match"
          value={stats?.inGame ? 'In progress' : 'Not in a match'}
          tone={stats?.inGame ? 'ok' : 'muted'}
        />
        <Row
          label="Game data reads"
          value={stats?.livePollMs ? `Every ${(stats.livePollMs / 1000).toFixed(1)} s` : 'Idle (no polling)'}
        />
        <Row
          label="Hotkeys"
          value={hotkeyLabel(stats?.hotkeys.mode)}
          tone={stats?.hotkeys.mode === 'native' ? 'ok' : stats?.hotkeys.mode === 'unavailable' ? 'warn' : 'muted'}
        />
        <Row
          label="Overlay windows"
          value={
            stats
              ? stats.overlayWindows === 0
                ? 'None open'
                : `${stats.overlayWindows} open · ${stats.overlayVisible ? 'showing' : 'hidden (nothing to show)'}`
              : '—'
          }
        />
        <Row
          label="Rendering"
          value={stats?.gpuActive ? 'GPU (hardware)' : 'CPU (GPU left to League)'}
          tone={stats?.gpuActive ? 'warn' : 'ok'}
        />
        <Row
          label="One Trick total"
          value={stats ? `${stats.totalCpu.toFixed(1)}% CPU · ${stats.totalMemoryMb} MB` : '—'}
        />
        {stats?.hotkeys.error ? <p className="mt-3 text-xs text-amber-300">{stats.hotkeys.error}</p> : null}
      </section>

      <section className="hud-panel p-6">
        <h2 className="hud-heading text-lg text-chrome-bright mb-1">Performance settings</h2>
        <p className="text-xs text-chrome-dim mb-2">
          Defaults favour League's frame rate. Compare FPS with each switch if you want to see the difference.
        </p>
        {settings ? (
          <>
            <Toggle
              label="In-game overlay"
              hint="Off means no windows over League at all. Timers and stats still run in the background."
              checked={settings.overlayEnabled}
              onChange={(v) => update({ overlayEnabled: v })}
            />
            <Toggle
              label="Hide One Trick during matches"
              hint="Sends this window to the tray when a game starts so it never draws while you play."
              checked={settings.hideDashboardInGame}
              onChange={(v) => update({ hideDashboardInGame: v })}
            />
            <Toggle
              label="Use GPU for One Trick"
              hint="Off by default so League keeps the GPU to itself. Turn on only if the app feels sluggish. Needs a restart."
              checked={settings.gpuAcceleration}
              onChange={(v) => update({ gpuAcceleration: v })}
            />
            {restartRequired ? (
              <button
                type="button"
                className="hud-btn mt-2"
                onClick={() => void window.electronAPI?.relaunchApp?.()}
              >
                Restart One Trick to apply
              </button>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-chrome-dim">Loading…</p>
        )}
      </section>

      <section className="hud-panel p-6 lg:col-span-2">
        <h2 className="hud-heading text-lg text-chrome-bright mb-3">Processes</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wider text-chrome-dim">
              <th className="py-1 font-normal">Process</th>
              <th className="py-1 font-normal text-right">CPU</th>
              <th className="py-1 font-normal text-right">Memory</th>
            </tr>
          </thead>
          <tbody>
            {processes.map((p, i) => (
              <tr key={`${p.type}-${i}`} className="border-t border-white/5">
                <td className="py-1.5 text-chrome-silver">{p.name}</td>
                <td className="py-1.5 text-right tabular-nums">{p.cpu.toFixed(1)}%</td>
                <td className="py-1.5 text-right tabular-nums">{p.memoryMb} MB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
};
