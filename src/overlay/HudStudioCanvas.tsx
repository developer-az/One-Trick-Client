import React, { useMemo, useRef, useState } from 'react';
import { normalizeChromeColor } from './chromeTheme';
import { HUD_MODULE_LABELS, type HudModuleId } from './hudModules';
import {
  layoutStyle,
  upsertLayoutElement,
  upsertSticker,
  type HudLayout,
} from './hudLayout';
import { computeLeagueGeometry } from './leagueGeometry';
import { StickerMark } from './OverlayStickers';

const MODULE_IDS: HudModuleId[] = ['sums', 'gank', 'vision', 'buy', 'action'];

function clientToNorm(
  event: React.PointerEvent,
  rect: DOMRect,
  geo: ReturnType<typeof computeLeagueGeometry>
): { x: number; y: number } {
  const x = (event.clientX - rect.left - geo.offsetX) / Math.max(1, geo.gameViewW);
  const y = (event.clientY - rect.top - geo.offsetY) / Math.max(1, geo.gameViewH);
  return {
    x: Math.max(0, Math.min(1, x)),
    y: Math.max(0, Math.min(1, y)),
  };
}

export const HudStudioCanvas: React.FC<{
  layout: HudLayout;
  onChange?: (next: HudLayout) => void;
  chromeColor?: string;
  hudScale?: number;
  mapScale?: number;
  editable?: boolean;
  width?: number;
  height?: number;
}> = ({
  layout,
  onChange,
  chromeColor = '#d4d8de',
  hudScale = 20,
  mapScale = 33,
  editable = true,
  width = 960,
  height = 540,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const color = normalizeChromeColor(chromeColor);
  const geo = useMemo(
    () => computeLeagueGeometry({ vw: width, vh: height, hudScale, mapScale, gameWidth: 1920, gameHeight: 1080 }),
    [width, height, hudScale, mapScale]
  );

  const abilityWidth = geo.abilityW;
  const abilityHeight = geo.abilityH;
  const mapW = geo.mapSize;
  const mapH = geo.mapSize;

  const moveTo = (id: string, kind: 'module' | 'sticker', x: number, y: number) => {
    if (!onChange) return;
    if (kind === 'module') {
      const current = layout.elements.find((el) => el.id === id);
      if (!current) return;
      onChange(upsertLayoutElement(layout, { ...current, x, y }));
      return;
    }
    const sticker = layout.stickers.find((row) => row.id === id);
    if (!sticker) return;
    onChange(upsertSticker(layout, { ...sticker, x, y }));
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!editable || !dragId || !stageRef.current) return;
    const norm = clientToNorm(event, stageRef.current.getBoundingClientRect(), geo);
    const isSticker = dragId.startsWith('sticker:');
    moveTo(isSticker ? dragId.slice('sticker:'.length) : dragId, isSticker ? 'sticker' : 'module', norm.x, norm.y);
  };

  const startDrag = (id: string) => (event: React.PointerEvent) => {
    if (!editable) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragId(id);
  };

  return (
    <div
      ref={stageRef}
      className={`hud-studio-stage${editable ? ' is-edit' : ''}`}
      style={{ width, height, ['--chrome-frame-color' as string]: color }}
      onPointerMove={onPointerMove}
      onPointerUp={() => setDragId(null)}
      onPointerCancel={() => setDragId(null)}
    >
      <div
        className="hud-studio-game"
        style={{
          left: geo.offsetX,
          top: geo.offsetY,
          width: geo.gameViewW,
          height: geo.gameViewH,
        }}
      />

      <div
        className="chrome-frame-box chrome-frame-guide"
        style={{
          left: geo.offsetX + geo.gameViewW / 2,
          bottom: geo.displayBottomInset + geo.abilityBottomPad,
          width: abilityWidth,
          height: abilityHeight,
          transform: 'translateX(-50%)',
        }}
      >
        <span className="chrome-frame-label">Ability HUD</span>
      </div>
      <div
        className="chrome-frame-box chrome-frame-guide chrome-frame-guide-map"
        style={{
          right: geo.displayRightInset + geo.mapPad,
          bottom: geo.displayBottomInset + geo.mapPad,
          width: mapW,
          height: mapH,
        }}
      >
        <span className="chrome-frame-label">Minimap</span>
      </div>

      {layout.elements
        .filter((el) => MODULE_IDS.includes(el.id as HudModuleId) && el.visible)
        .map((el) => (
          <button
            key={el.id}
            type="button"
            className={`hud-studio-pin${dragId === el.id ? ' is-drag' : ''}`}
            style={layoutStyle(el, geo)}
            onPointerDown={startDrag(el.id)}
          >
            {HUD_MODULE_LABELS[el.id as HudModuleId]}
          </button>
        ))}

      {layout.stickers.map((sticker) => (
        <button
          key={sticker.id}
          type="button"
          className={`hud-studio-sticker${dragId === `sticker:${sticker.id}` ? ' is-drag' : ''}`}
          style={layoutStyle(sticker, geo)}
          onPointerDown={startDrag(`sticker:${sticker.id}`)}
          title={sticker.label || sticker.kind}
        >
          <StickerMark sticker={sticker} />
        </button>
      ))}
    </div>
  );
};
