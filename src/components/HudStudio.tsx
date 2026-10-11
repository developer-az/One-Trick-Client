import React, { useMemo, useRef } from 'react';
import { getCatalog } from '../catalog/client';
import { HudStudioCanvas } from '../overlay/HudStudioCanvas';
import {
  HUD_LAYOUT_PRESETS,
  normalizeHudLayout,
  removeSticker,
  storeHudLayout,
  upsertSticker,
  type HudLayout,
  type HudSticker,
} from '../overlay/hudLayout';

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
  chromeColor: string;
  hudScale: number;
  mapScale: number;
}> = ({ layout, onLayoutChange, chromeColor, hudScale, mapScale }) => {
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
    <section className="ot-card ot-card-pad">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="ot-card-title">Layout</h2>
          <p className="mt-1 text-sm ot-muted max-w-xl">
            Drag panels to where you want them on screen. The frame is your game window at its real aspect ratio.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="ot-segment" role="group" aria-label="Preset">
            {HUD_LAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className={layout.name === preset.name ? 'is-active' : ''}
                onClick={() => commit({ ...preset })}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <button type="button" className="ot-btn ot-btn-ghost ot-btn-sm" onClick={() => downloadLayout(layout)}>
            Export
          </button>
          <button type="button" className="ot-btn ot-btn-ghost ot-btn-sm" onClick={() => fileRef.current?.click()}>
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

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div>
          <div className="text-xs ot-faint uppercase tracking-wide mb-2">Add a sticker</div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="ot-btn ot-btn-sm" onClick={() => addSticker({ kind: 'mark' })}>
              Logo
            </button>
            <button type="button" className="ot-btn ot-btn-sm" onClick={() => addSticker({ kind: 'text', label: 'ONE TRICK' })}>
              Text
            </button>
            {sampleChamps.map((champ) => (
              <button
                key={champ.id}
                type="button"
                className="ot-btn ot-btn-sm"
                onClick={() => addSticker({ kind: 'champ', championId: champ.id, label: champ.name })}
              >
                {champ.name}
              </button>
            ))}
            {sampleItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="ot-btn ot-btn-sm"
                onClick={() => addSticker({ kind: 'item', itemId: item.id, label: item.name })}
              >
                {item.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="text-xs ot-faint uppercase tracking-wide mb-2">On screen</div>
          {layout.stickers.length === 0 ? (
            <p className="text-sm ot-muted">No stickers yet.</p>
          ) : (
            <ul className="space-y-1">
              {layout.stickers.map((sticker) => (
                <li key={sticker.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{sticker.label || sticker.kind}</span>
                  <button type="button" className="ot-btn ot-btn-ghost ot-btn-sm" onClick={() => commit(removeSticker(layout, sticker.id))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
};
