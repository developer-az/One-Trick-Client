import React, { useEffect, useMemo, useState } from 'react';
import { enemyRespawns, formatRespawn, type OverlayEnemy } from '../overlay/overlayLogic';

interface Props {
  enemies?: OverlayEnemy[];
  timestamp?: number;
}

/** Compact dead-enemy respawn countdowns under the summoner chips. */
export const EnemyRespawns: React.FC<Props> = ({ enemies, timestamp }) => {
  const [now, setNow] = useState(() => Date.now());
  const rows = useMemo(
    () => enemyRespawns(enemies, timestamp, now),
    [enemies, timestamp, now]
  );

  // Tick only while a respawn is pending; idle mounts cost nothing.
  useEffect(() => {
    if (!rows.length) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [rows.length]);

  if (!rows.length) return null;

  return (
    <div className="hud-respawn">
      {rows.map((row, i) => (
        <div
          key={`${row.championName}-${row.position || ''}-${i}`}
          className={`hud-respawn-row${row.remainingSec <= 8 ? ' hud-respawn--soon' : ''}`}
        >
          <span className="hud-respawn-name">{row.championName}</span>
          <span className="hud-chip">
            Back {formatRespawn(row.remainingSec)}
          </span>
        </div>
      ))}
    </div>
  );
};
