import React, { useEffect, useState } from 'react';
import { isDesktop, useAppSettings } from '../hooks';
import { Card, CardHeader, Pill, SettingRow, Switch, type Tone } from '../ui';

const PHASE_LABEL: Record<string, string> = {
  None: 'Home screen',
  Lobby: 'Lobby',
  Matchmaking: 'In queue',
  ReadyCheck: 'Match found',
  ChampSelect: 'Champ select',
  GameStart: 'Loading',
  InProgress: 'In game',
  Reconnect: 'Reconnecting',
  WaitingForStats: 'Game over',
  PreEndOfGame: 'Game over',
  EndOfGame: 'Post game',
};

function usePerfStats(): PerfStats | null {
  const [stats, setStats] = useState<PerfStats | null>(null);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getPerfStats) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      void api.getPerfStats?.().then((next) => !cancelled && setStats(next));
    };
    load();
    const id = window.setInterval(load, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return stats;
}

export const PerformanceView: React.FC = () => {
  const stats = usePerfStats();
  const { settings, update, restartRequired } = useAppSettings();

  if (!isDesktop) {
    return (
      <div className="ot-page">
        <div className="ot-page-header">
          <h1 className="ot-page-title">Performance</h1>
        </div>
        <Card>
          <p className="ot-muted">Live performance numbers are available in the desktop app.</p>
        </Card>
      </div>
    );
  }

  const lcu = stats?.lcu;
  const hotkeyMode = stats?.hotkeys.mode;
  const rows: Array<{ label: string; value: string; tone: Tone }> = [
    {
      label: 'League client',
      value: !lcu
        ? 'Checking'
        : lcu.state === 'searching'
          ? 'Not running'
          : lcu.state === 'connecting'
            ? 'Connecting'
            : (lcu.phase && PHASE_LABEL[lcu.phase]) || 'Connected',
      tone: lcu?.state === 'connected' ? 'live' : 'muted',
    },
    {
      label: 'Game data reads',
      value: stats?.livePollMs ? `Every ${(stats.livePollMs / 1000).toFixed(1)} s` : 'None (idle)',
      tone: 'muted',
    },
    {
      label: 'Hotkeys',
      value:
        hotkeyMode === 'native'
          ? 'Keyboard-only hook'
          : hotkeyMode === 'starting'
            ? 'Starting'
            : hotkeyMode === 'unavailable'
              ? 'Fallback, may not work in game'
              : 'Off',
      tone: hotkeyMode === 'native' ? 'live' : hotkeyMode === 'unavailable' ? 'warn' : 'muted',
    },
    {
      label: 'Overlay windows',
      value: !stats
        ? 'Checking'
        : stats.overlayWindows === 0
          ? 'None open'
          : `${stats.overlayWindows} open, ${stats.overlayVisible ? 'showing' : 'hidden until needed'}`,
      tone: 'muted',
    },
    {
      label: 'Rendering',
      value: stats?.gpuActive ? 'GPU (shared with League)' : 'CPU only (GPU left to League)',
      tone: stats?.gpuActive ? 'warn' : 'live',
    },
  ];

  const processes = [...(stats?.processes || [])].sort((a, b) => b.cpu - a.cpu);

  return (
    <div className="ot-page">
      <div className="ot-page-header">
        <div>
          <h1 className="ot-page-title">Performance</h1>
          <p className="ot-page-sub">What One Trick costs your PC right now. During a match it should be close to nothing.</p>
        </div>
      </div>

      <div className="grid gap-5 sm:grid-cols-3 mb-5">
        <Stat label="CPU" value={stats ? `${stats.totalCpu.toFixed(1)}%` : '–'} hint="All One Trick processes" />
        <Stat label="Memory" value={stats ? `${stats.totalMemoryMb} MB` : '–'} hint="All One Trick processes" />
        <Stat label="Game reads" value={stats ? String(stats.liveReads) : '–'} hint="Live Client requests this session" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Right now" />
          <dl>
            {rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 py-2.5 border-b border-[color:var(--ot-border)] last:border-0">
                <dt className="ot-muted">{r.label}</dt>
                <dd>
                  <Pill tone={r.tone}>{r.value}</Pill>
                </dd>
              </div>
            ))}
          </dl>
          {stats?.hotkeys.error ? <div className="ot-callout ot-callout-warn mt-3">{stats.hotkeys.error}</div> : null}
        </Card>

        <Card>
          <CardHeader title="Settings" sub="The defaults favour League's frame rate." />
          {settings ? (
            <>
              <SettingRow
                title="In-game overlay"
                hint="Off means no windows over League at all."
                control={<Switch label="In-game overlay" checked={settings.overlayEnabled} onChange={(v) => update({ overlayEnabled: v })} />}
              />
              <SettingRow
                title="Hide this window during matches"
                hint="Sends One Trick to the tray when a game starts, so it never draws while you play."
                control={
                  <Switch
                    label="Hide during matches"
                    checked={settings.hideDashboardInGame}
                    onChange={(v) => update({ hideDashboardInGame: v })}
                  />
                }
              />
              <SettingRow
                title="Use the GPU for One Trick"
                hint="Off by default so League keeps the GPU. Needs a restart."
                control={
                  <Switch label="GPU acceleration" checked={settings.gpuAcceleration} onChange={(v) => update({ gpuAcceleration: v })} />
                }
              />
              {restartRequired ? (
                <div className="ot-callout ot-callout-warn mt-3 items-center justify-between">
                  <span>Restart One Trick to apply the GPU change.</span>
                  <button type="button" className="ot-btn ot-btn-sm" onClick={() => void window.electronAPI?.relaunchApp?.()}>
                    Restart
                  </button>
                </div>
              ) : null}
            </>
          ) : (
            <p className="ot-muted text-sm">Loading</p>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Processes" />
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left ot-faint text-xs uppercase tracking-wide">
                <th className="py-1.5 font-semibold">Process</th>
                <th className="py-1.5 font-semibold text-right">CPU</th>
                <th className="py-1.5 font-semibold text-right">Memory</th>
              </tr>
            </thead>
            <tbody className="ot-num">
              {processes.map((p, i) => (
                <tr key={`${p.type}-${i}`} className="border-t border-[color:var(--ot-border)]">
                  <td className="py-2">{p.name}</td>
                  <td className="py-2 text-right">{p.cpu.toFixed(1)}%</td>
                  <td className="py-2 text-right">{p.memoryMb} MB</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => (
  <Card>
    <div className="text-xs ot-faint uppercase tracking-wide">{label}</div>
    <div className="ot-stat-big ot-num mt-1">{value}</div>
    <div className="text-sm ot-muted mt-1">{hint}</div>
  </Card>
);
