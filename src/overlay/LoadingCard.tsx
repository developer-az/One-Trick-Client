import React, { useMemo } from 'react';
import { loadingCardState, type LoadingStats } from './loadingStats';
import { LOADING_PANEL_SIZE, loadingPanelRect, type Rect } from './loadingScreenGeometry';

/**
 * Pre-match loading card: your recent form on the champion you are about to
 * play. Completely static (no animation, no timers) so it costs zero paints
 * after the first render. Present for the whole load: numbers when the history
 * is in, a pending line while it lands, and a neutral line when nothing is
 * known yet. Sits beside your loading-screen card when the slot is known,
 * otherwise bottom-right.
 */
export const LoadingCard: React.FC<{
  championName: string;
  /** null until the history for this load has landed. */
  stats: LoadingStats | null;
  /** Your loading-screen card; only when side + index + team size are known. */
  home?: Rect | null;
  /** Current viewport, so an anchored card stays on-screen. */
  viewport: { vw: number; vh: number };
}> = ({ championName, stats, home, viewport }) => {
  const state = loadingCardState(championName, stats);
  const placement = useMemo(
    () => (home ? loadingPanelRect(home, viewport.vw, viewport.vh, LOADING_PANEL_SIZE) : null),
    [home, viewport]
  );

  const games = stats?.games ?? 0;
  const hasGames = state === 'ready' && !!stats;

  return (
    <aside
      className={`ov-panel ov-panel-accent ov-loading-card${placement ? ' ov-loading-card--placed' : ''}`}
      aria-label="Your recent form"
      style={placement ? { left: placement.x, top: placement.y } : undefined}
    >
      <div className="ov-loading-eyebrow">ONE TRICK · LOADING</div>
      <div className="ov-loading-champ ov-chrome-text">{championName || '—'}</div>
      {hasGames ? (
        <>
          <div className="ov-loading-sub">
            Last {games} {stats.scope === 'ranked' ? 'ranked ' : ''}game{games === 1 ? '' : 's'} on this champion
          </div>
          <div className="ov-loading-stats">
            <div className="ov-loading-stat">
              <span className="ov-loading-value">{stats.winRate}%</span>
              <span className="ov-loading-label">Win %</span>
            </div>
            <div className="ov-loading-stat">
              <span className="ov-loading-value">{stats.streak || '—'}</span>
              <span className="ov-loading-label">Streak</span>
            </div>
            <div className="ov-loading-stat">
              <span className="ov-loading-value">{stats.kda.toFixed(2)}</span>
              <span className="ov-loading-label">KDA</span>
            </div>
          </div>
          <div className="ov-form-bar" aria-hidden>
            {stats.form.map((result, index) => (
              <span
                key={`${index}-${result}`}
                className={`ov-form-seg ${result === 'W' ? 'ov-form-seg--win' : 'ov-form-seg--loss'}`}
              />
            ))}
          </div>
          <div className="ov-form-axis">
            <span>OLDER</span>
            <span>LATEST</span>
          </div>
        </>
      ) : state === 'first' ? (
        <div className="ov-loading-sub">First game on this champion</div>
      ) : state === 'pending' ? (
        <div className="ov-loading-sub">Reading your recent games…</div>
      ) : (
        <div className="ov-loading-sub">Good luck.</div>
      )}
    </aside>
  );
};

