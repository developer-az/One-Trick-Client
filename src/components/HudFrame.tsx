import React from 'react';

type HudAccent = 'green' | 'blood' | 'steel' | 'cyan';

interface HudFrameProps {
  children: React.ReactNode;
  className?: string;
  accent?: HudAccent;
  label?: string;
  compact?: boolean;
}

export const HudFrame: React.FC<HudFrameProps> = ({
  children,
  className = '',
  accent = 'green',
  label,
  compact = false,
}) => {
  return (
    <div className={`hud-panel hud-accent-${accent}${compact ? ' hud-panel--compact' : ''}`}>
      {label ? <div className="hud-tag">{label}</div> : null}
      <div className={`hud-panel-body ${className}`}>{children}</div>
    </div>
  );
};
