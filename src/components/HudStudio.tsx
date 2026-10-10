import React, { useMemo, useRef } from 'react';
import { getCatalog } from '../catalog/client';
import { HudStudioCanvas } from '../overlay/HudStudioCanvas';
import {
  HUD_LAYOUT_PRESETS,
  applyModulesToLayout,
  normalizeHudLayout,
  removeSticker,
  storeHudLayout,
  upsertSticker,
  type HudLayout,
  type HudSticker,
} from '../overlay/hudLayout';
import { HUD_MODULE_IDS, HUD_MODULE_LABELS, type HudModules } from '../overlay/hudModules';
import { ChromeMark } from '../overlay/ChromeMark';
import { HudFrame } from './HudFrame';

function downloadLayout(layout: HudLayout): void {
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'onetrick-hud-layout.json';
  a.click();
  URL.revokeObjectURL(url);
}

export const HudStudio: React.FC<{
  layout: HudLayout;
  onLayoutChange: (next: HudLayout) => void;
  modules: HudModules;
  onModulesChange: (next: HudModules) => void;
  chromeColor: string;
  hudScale: number;
  mapScale: number;
}> = ({ layout, onLayoutChange, modules, onModulesChange, chromeColor, hudScale, mapScale }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const catalog = getCatalog();
  const sampleChamps = useMemo(() => (catalog?.champions || []).slice(0, 8), [catalog]);
  const sampleItems = useMemo(
    () => (catalog?.items || []).filter((item) => item.purchasable && item.gold >= 2400).slice(0, 8),
    [catalog]
  );

  const commit = (next: HudLayout) => {
    const normalized = normalizeHudLayout(next);
    storeHudLayout(normalized);
    onLayoutChange(normalized);
  };

  const toggleModule = (id: (typeof HUD_MODULE_IDS)[number]) => {
    const nextModules = { ...modules, [id]: !modules[id] };
    onModulesChange(nextModules);
    commit(applyModulesToLayout(layout, nextModules));
  };

  const addSticker = (partial: Omit<HudSticker, 'id' | 'x' | 'y' | 'scale' | 'opacity'>) => {
    const sticker: HudSticker = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      x: 0.46,
      y: 0.38,
      scale: 1,
      opacity: 1,
      ...partial,
    };
    commit(upsertSticker(layout, sticker));
  };

  return (
    <HudFrame accent="steel" label="HUD Studio" className="p-5">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-chrome-dim mb-1">Studio</p>
          <h2 className="hud-heading text-xl text-chrome-bright">
            <ChromeMark size={14} className="inline-block align-[-2px] mr-1.5 text-chrome-silver" />
            Pin it on the Rift
          </h2>
          <p className="text-[10px] font-mono text-chrome-dim/75 mt-2 tracking-wide leading-relaxed max-w-xl">
            Drag modules onto the letterboxed game plane. Stickers are chrome marks — no blur, no coach spam.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {HUD_LAYOUT_PRESETS.map((preset) => (
            <button
              key={preset.name}
              type="button"
              className={`hud-btn${layout.name === preset.name ? ' hud-btn--active' : ''}`}
              onClick={() => commit({ ...preset })}
            >
              {preset.name}
            </button>
          ))}
          <button type="button" className="hud-btn" onClick={() => downloadLayout(layout)}>
            Export JSON
          </button>
          <button type="button" className="hud-btn" onClick={() => fileRef.current?.click()}>
            Import
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => {
                try {
                  commit(normalizeHudLayout(JSON.parse(text)));
                } catch {
                  /* ignore bad file */
                }
              });
              event.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="hud-studio-wrap">
        <HudStudioCanvas
          layout={layout}
          onChange={commit}
          chromeColor={chromeColor}
          hudScale={hudScale}
          mapScale={mapScale}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {HUD_MODULE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className={`hud-btn${modules[id] ? ' hud-btn--active' : ''}`}
            onClick={() => toggleModule(id)}
          >
            {HUD_MODULE_LABELS[id]}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-chrome-dim mb-2">Stickers</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="hud-btn" onClick={() => addSticker({ kind: 'mark' })}>
              Chrome mark
            </button>
            <button
              type="button"
              className="hud-btn"
              onClick={() => addSticker({ kind: 'text', label: 'ONE TRICK' })}
            >
              Text
            </button>
            {sampleChamps.map((champ) => (
              <button
                key={champ.id}
                type="button"
                className="hud-btn"
                onClick={() => addSticker({ kind: 'champ', championId: champ.id, label: champ.name })}
              >
                {champ.name}
              </button>
            ))}
            {sampleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="hud-btn"
                onClick={() => addSticker({ kind: 'item', itemId: item.id, label: item.name })}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-chrome-dim mb-2">Pinned</p>
          {layout.stickers.length === 0 ? (
            <p className="text-[11px] font-mono text-chrome-dim/70">No stickers yet.</p>
          ) : (
            <ul className="space-y-1">
              {layout.stickers.map((sticker) => (
                <li key={sticker.id} className="flex items-center justify-between gap-2 text-[11px] font-mono">
                  <span className="truncate text-chrome-silver">
                    {sticker.label || sticker.kind} · {Math.round(sticker.x * 100)}/{Math.round(sticker.y * 100)}
                  </span>
                  <button type="button" className="hud-btn" onClick={() => commit(removeSticker(layout, sticker.id))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </HudFrame>
  );
};
