import React, { useEffect, useState } from 'react';
import { isDesktop, useAppSettings } from '../hooks';
import { recapGrade, type RecapGrade } from '../../logic/playMoments';
import { Card, CardHeader, Pill, SettingRow, Switch, type Tone } from '../ui';

const GRADE_TONE: Record<RecapGrade, Tone> = {
  Brilliant: 'live',
  Great: 'live',
  Good: 'muted',
  Mistake: 'bad',
  Blunder: 'bad',
};

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

function formatClipSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function useClips(): ClipperStatusInfo | null {
  const [lib, setLib] = useState<ClipperStatusInfo | null>(null);
  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.getClipperStatus) return;
    let cancelled = false;
    const load = () => {
      if (document.hidden) return;
      void api.getClipperStatus?.().then((next) => {
        if (!cancelled && next) setLib(next);
      });
    };
    load();
    const id = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);
  return lib;
}

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
  const clips = useClips();
  const { settings, update, restartRequired } = useAppSettings();
  const [recap, setRecap] = React.useState<PlayRecapEntry[]>([]);

  React.useEffect(() => {
    if (!stats || stats.inGame) return;
    void window.electronAPI?.getMatchRecap?.().then((entries) => setRecap(entries || []));
  }, [stats?.inGame, stats]);

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
          : `${stats.overlayWindows} open, ${stats.overlayVisible ? 'showing' : stats.overlayHold ? 'hold Tab to show' : 'hidden until needed'}`,
      tone: stats?.overlayVisible ? 'warn' : 'muted',
    },
    {
      label: 'League display mode',
      value: !stats?.environment.windowMode
        ? 'Unknown'
        : stats.environment.windowMode === 'borderless'
          ? 'Borderless'
          : stats.environment.windowMode === 'windowed'
            ? 'Windowed'
            : 'Fullscreen (overlay can’t show)',
      tone: stats?.environment.windowMode === 'borderless' ? 'warn' : 'muted',
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

      <Card className="mb-5">
        <CardHeader
          title="Clips"
          sub="Turn Auto-clip on before the next game. A kill, a death, or a Great play saves a video here."
          action={
            <button type="button" className="ot-btn ot-btn-sm" onClick={() => void window.electronAPI?.revealClip?.()}>
              Open folder
            </button>
          }
        />
        <p className="text-sm">
          {clips?.detail || 'Checking the recorder…'}
        </p>
        {clips?.ffmpeg === 'missing' ? (
          <div className="ot-callout ot-callout-warn mt-3">
            ffmpeg is not installed, so One Trick cannot write video yet. Install ffmpeg and leave it on PATH, then turn Auto-clip on.
          </div>
        ) : null}
        {clips?.clips.length ? (
          <ul className="mt-3 divide-y divide-[color:var(--ot-border)] text-sm">
            {clips.clips.map((clip) => (
              <li key={clip.path} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">{clip.name}</span>
                <span className="ot-faint shrink-0">{formatClipSize(clip.bytes)}</span>
                <button
                  type="button"
                  className="ot-btn ot-btn-sm shrink-0"
                  onClick={() => void window.electronAPI?.revealClip?.(clip.path)}
                >
                  Play
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm ot-muted">No clips saved yet.</p>
        )}
      </Card>

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
          {stats ? <OverlayCostNote stats={stats} overlayOn={!!settings?.overlayEnabled} /> : null}
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
                title="Only while holding Tab"
                hint="A visible overlay costs frames in borderless. This keeps League uncovered except while you check the scoreboard."
                control={
                  <Switch
                    label="Only while holding Tab"
                    checked={settings.overlayHoldToShow}
                    disabled={!settings.overlayEnabled}
                    onChange={(v) => update({ overlayHoldToShow: v })}
                  />
                }
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
                title="Auto-clip moments"
                hint="Off until you turn it on. Records the desktop during the match and saves a clip on a kill, death, or Great play. Needs ffmpeg. Capture costs frames, so leave it off in a close ranked game."
                control={
                  <Switch
                    label="Auto-clip moments"
                    checked={settings.autoClip}
                    onChange={(v) => update({ autoClip: v })}
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
          <CardHeader
            title="Last match recap"
            sub="Blunders, picks, and enemy mistakes from your most recent game. Shown after the overlay closes."
          />
          {recap.length ? (
            <ul className="space-y-2 text-sm max-h-56 overflow-y-auto">
              {recap.map((entry, i) => {
                const grade = recapGrade(entry);
                return (
                <li key={`${entry.gameTime}-${entry.label}-${i}`} className="border-b border-[color:var(--ot-border)] pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="ot-num text-xs ot-faint">
                      {Math.floor(entry.gameTime / 60)}:{String(Math.floor(entry.gameTime % 60)).padStart(2, '0')}
                    </span>
                    <Pill tone={GRADE_TONE[grade]}>{grade}</Pill>
                    <span className="font-medium">{entry.label}</span>
                  </div>
                  <p className="ot-muted mt-1 text-[13px]">{entry.detail}</p>
                  {entry.hint ? <p className="ot-faint mt-0.5 text-xs">{entry.hint}</p> : null}
                </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm ot-muted">Play a match with the overlay on. Moments appear here when the game ends.</p>
          )}
          {stats?.lastEndReason && !stats.inGame ? (
            <p className="mt-3 text-xs ot-faint">Last overlay close: {stats.lastEndReason}</p>
          ) : null}
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

/**
 * Any window over a borderless game makes Windows composite every frame. That
 * is cheap on most PCs, but on some (often with a screen recorder running) it
 * has measured as ~170 -> ~20 FPS. Say so, with the fixes that work.
 */
const OverlayCostNote: React.FC<{ stats: PerfStats; overlayOn: boolean }> = ({ stats, overlayOn }) => {
  const { windowMode, recorders } = stats.environment;
  if (!overlayOn || windowMode !== 'borderless' || stats.overlayHold) return null;
  const rec = recorders.length ? recorders.join(' and ') : null;
  return (
    <div className="ot-callout ot-callout-warn mt-3">
      League is in borderless mode. On some PCs any window over a borderless game, even Task Manager, costs a lot of FPS
      {rec ? `, especially with ${rec} running` : ''}. If your FPS drops with the overlay on, set League to Windowed at your
      screen resolution{rec ? `, quit ${rec},` : ''} or turn on Only while holding Tab.
    </div>
  );
};
