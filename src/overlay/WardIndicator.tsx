import React from 'react';
import type { WardStatus } from '../logic/visionLogic';

/** Purpose lives in the tooltip — compact HUD only shows where. */
export const WardIndicator: React.FC<{ status: WardStatus | null; compact?: boolean }> = ({
  status,
  compact,
}) => {
  if (!status) return null;

  return (
    <div
      className={`hud-ward${status.due ? ' hud-ward--due' : ''}${compact ? ' hud-ward--compact' : ''}`}
      title={`${status.why}\n${status.controlPlan}${
        status.sweepTargets?.length ? `\n${status.sweepTargets.join('\n')}` : ''
      }`}
    >
      <svg
        className="hud-ward-icon"
        width={compact ? 10 : 12}
        height={compact ? 10 : 12}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M8 1.5 12.5 6v5.5L8 14.5 3.5 11.5V6z" />
        <circle cx="8" cy="8" r="1.8" fill="currentColor" stroke="none" />
      </svg>
      <div className="hud-ward-copy min-w-0">
        <span className="hud-ward-where">{status.where}</span>
      </div>
      {status.buyHint ? <span className="hud-ward-meta">{status.buyHint}</span> : null}
    </div>
  );
};
