import React from 'react';
import type { JungleThreat } from '../logic/jungleLogic';

/**
 * Colored gank-probability square:
 * - red: brief high window
 * - yellow: fog / low-vision risk
 * - dim: farming / tracked
 */
export const GankSquare: React.FC<{ threat: JungleThreat | null; compact?: boolean }> = ({
  threat,
  compact,
}) => {
  if (!threat) return null;

  const tone =
    threat.gankRisk === 'high' ? 'red' : threat.gankRisk === 'medium' ? 'yellow' : 'dim';

  return (
    <div
      className={`hud-gank hud-gank--${tone}${compact ? ' hud-gank--compact' : ''}`}
      title={`${threat.detail}\n${threat.clearStyle} clear · ${threat.probability}%`}
    >
      <span className="hud-gank-sq" aria-hidden />
      <div className="hud-gank-copy min-w-0">
        <div className="hud-gank-label">{threat.squareReason}</div>
      </div>
    </div>
  );
};
