import React from 'react';
import type { LoadingStats } from './loadingStats';

/**
 * Pre-match loading card: your recent form on the champion you are about to
 * play. Completely static (no animation, no timers) so it costs zero paints
 * after the first render. Sits bottom-right, above the pet's ground line.
 */
export const LoadingCard: React.FC<{
  championName: string;
  stats: LoadingStats;
}> = ({ championName, stats }) => {
  const games = stats.games;
  const hasGames = games > 0;
  return (
    <aside className="ov-panel ov-panel-accent ov-loading-card" aria-label="Your recent form">
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
      ) : (
        <div className="ov-loading-sub">First game on this champion</div>
      )}
    </aside>
  );
};
