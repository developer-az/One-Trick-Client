import React from 'react';
import {
  HUD_MODULE_IDS,
  HUD_MODULE_LABELS,
  type HudModuleId,
  type HudModules,
} from '../overlay/hudModules';

export const HudModulesBar: React.FC<{
  modules: HudModules;
  onToggle: (id: HudModuleId) => void;
}> = ({ modules, onToggle }) => {
  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="HUD modules">
      <span className="text-[10px] font-mono uppercase tracking-wider text-chrome-dim mr-1">HUD</span>
      {HUD_MODULE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          className={`hud-module${modules[id] ? ' is-on' : ''}`}
          aria-pressed={modules[id]}
          onClick={() => onToggle(id)}
        >
          {HUD_MODULE_LABELS[id]}
        </button>
      ))}
    </div>
  );
};
