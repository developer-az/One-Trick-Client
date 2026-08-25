import React from 'react';
import { ChromeMark } from '../overlay/ChromeMark';

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
    <div className={`hud-panel hud-accent-${accent} ${compact ? 'hud-panel--compact' : ''}`}>
      <span className="hud-corner hud-corner-tl" aria-hidden />
      <span className="hud-corner hud-corner-tr" aria-hidden />
      <span className="hud-corner hud-corner-bl" aria-hidden />
      <span className="hud-corner hud-corner-br" aria-hidden />
      <span className="hud-rail hud-rail-top" aria-hidden />
      <span className="hud-rail hud-rail-bottom" aria-hidden />
      <span className="hud-tick hud-tick-l" aria-hidden />
      <span className="hud-tick hud-tick-r" aria-hidden />
      <span className="hud-panel-mark hud-panel-mark--tl" aria-hidden>
        <ChromeMark size={11} />
      </span>
      <span className="hud-panel-mark hud-panel-mark--tr" aria-hidden>
        <ChromeMark size={11} />
      </span>
      {label ? <div className="hud-tag">{label}</div> : null}
      <div className={`hud-panel-body ${className}`}>{children}</div>
    </div>
  );
};
