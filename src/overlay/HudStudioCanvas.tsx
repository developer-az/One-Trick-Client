import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeChromeColor } from './chromeTheme';
import { HUD_MODULE_LABELS, HUD_STUDIO_MODULE_IDS, type HudModuleId } from './hudModules';
import {
  layoutStyle,
  upsertLayoutElement,
  upsertSticker,
  type HudElement,
  type HudLayout,
} from './hudLayout';
import { computeLeagueGeometry } from './leagueGeometry';
import { StickerMark } from './OverlayStickers';

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

function studioPinStyle(
  el: Pick<HudElement, 'x' | 'y' | 'scale' | 'opacity' | 'anchor'>,
  geo: ReturnType<typeof computeLeagueGeometry>
) {
  const style = layoutStyle(el, geo);
  const horizontalRoom = Math.max(72, (1 - el.x) * geo.gameViewW - 10);
  return { ...style, maxWidth: horizontalRoom };
}

function renderStudioModuleContent(id: HudModuleId) {
  switch (id) {
    case 'sums':
      return (
        <div className="flex w-full min-w-0 flex-col gap-1 text-left select-none pointer-events-none">
          <div className="flex items-center justify-between border-b border-white/10 pb-0.5 text-[9px] font-mono text-zinc-400">
            <span>ENEMY SUMS</span>
            <span className="text-[8px] text-zinc-500 font-bold">PgUp / PgDn</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Caitlyn.png"
              alt=""
              className="h-4 w-4 rounded border border-white/10 flex-none"
            />
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/spell/SummonerFlash.png"
              alt=""
              className="h-3.5 w-3.5 rounded opacity-60 flex-none"
            />
            <span className="font-mono text-rose-400 font-bold text-[9px]">240s</span>
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/spell/SummonerHeal.png"
              alt=""
              className="h-3.5 w-3.5 rounded flex-none"
            />
            <span className="font-mono text-emerald-400 text-[8px] font-bold">UP</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px]">
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Lux.png"
              alt=""
              className="h-4 w-4 rounded border border-white/10 flex-none"
            />
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/spell/SummonerFlash.png"
              alt=""
              className="h-3.5 w-3.5 rounded flex-none"
            />
            <span className="font-mono text-emerald-400 text-[8px] font-bold">UP</span>
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/spell/SummonerDot.png"
              alt=""
              className="h-3.5 w-3.5 rounded opacity-60 flex-none"
            />
            <span className="font-mono text-amber-400 font-bold text-[9px]">110s</span>
          </div>
        </div>
      );
    case 'gank':
      return (
        <div className="flex w-full min-w-0 flex-col gap-0.5 text-left select-none pointer-events-none">
          <div className="flex items-center justify-between text-[8px] font-mono text-zinc-400">
            <span>GANK RADAR</span>
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          </div>
          <div className="font-mono text-[11px] font-bold text-amber-300">FOG RISK</div>
          <div className="text-[8px] font-mono text-zinc-400">River Unwarded</div>
        </div>
      );
    case 'buy':
      return (
        <div className="flex w-full min-w-0 flex-col gap-1 text-left select-none pointer-events-none">
          <div className="text-[8px] font-mono text-zinc-400">NEXT BUY · 1100g</div>
          <div className="flex items-center gap-1">
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/item/3134.png"
              alt=""
              className="h-5 w-5 rounded border border-white/20 flex-none"
            />
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/item/1036.png"
              alt=""
              className="h-5 w-5 rounded border border-white/20 flex-none"
            />
          </div>
        </div>
      );
    case 'action':
      return (
        <div className="flex w-full min-w-0 items-center gap-1.5 text-left select-none pointer-events-none">
          <span className="rounded bg-rose-500/30 px-1 py-0.5 font-mono text-[8px] text-rose-300 font-bold flex-none">
            SPIKE
          </span>
          <span className="min-w-0 flex-1 text-[10px] font-medium text-white truncate">
            Level 2: All-in now
          </span>
        </div>
      );
    case 'vision':
      return (
        <div className="flex w-full min-w-0 flex-col gap-0.5 text-left select-none pointer-events-none">
          <div className="flex items-center gap-1 text-[8px] font-mono text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            <span>VISION</span>
          </div>
          <div className="text-[8px] font-mono text-zinc-300">Pink: Hold 1</div>
        </div>
      );
    default:
      return <span>{HUD_MODULE_LABELS[id]}</span>;
  }
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
  /** Logical stage floor so the HUD stays legible on narrow screens (the wrapper scrolls). */
  minStageWidth?: number;
}> = ({
  layout,
  onChange,
  chromeColor = '#d4d8de',
  hudScale = 20,
  mapScale = 33,
  editable = true,
  width = 960,
  height = 540,
  minStageWidth = 280,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: width, h: height });
  const [dragId, setDragId] = useState<string | null>(null);
  const dragOffsetRef = useRef({ dx: 0, dy: 0 });
  const color = normalizeChromeColor(chromeColor);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const apply = () => {
      const nextW = Math.max(minStageWidth, Math.floor(host.clientWidth));
      const nextH = Math.max(1, Math.round((nextW * height) / width));
      setBox((prev) => (prev.w === nextW && prev.h === nextH ? prev : { w: nextW, h: nextH }));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => ro.disconnect();
  }, [width, height, minStageWidth]);

  const geo = useMemo(
    () => computeLeagueGeometry({ vw: box.w, vh: box.h, hudScale, mapScale, gameWidth: 1920, gameHeight: 1080 }),
    [box.w, box.h, hudScale, mapScale]
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
    const { dx, dy } = dragOffsetRef.current;
    const x = Math.max(0, Math.min(1, norm.x - dx));
    const y = Math.max(0, Math.min(1, norm.y - dy));
    const isSticker = dragId.startsWith('sticker:');
    moveTo(isSticker ? dragId.slice('sticker:'.length) : dragId, isSticker ? 'sticker' : 'module', x, y);
  };

  const endDrag = () => {
    dragOffsetRef.current = { dx: 0, dy: 0 };
    setDragId(null);
  };

  const nudgeBy = (key: string, deltaX: number, deltaY: number) => {
    if (!editable) return;
    const isSticker = key.startsWith('sticker:');
    const id = isSticker ? key.slice('sticker:'.length) : key;
    const current = isSticker
      ? layout.stickers.find((row) => row.id === id)
      : layout.elements.find((el) => el.id === id);
    if (!current) return;
    const x = Math.max(0, Math.min(1, current.x + deltaX));
    const y = Math.max(0, Math.min(1, current.y + deltaY));
    moveTo(id, isSticker ? 'sticker' : 'module', x, y);
  };

  const onPinKeyDown = (key: string) => (event: React.KeyboardEvent) => {
    if (!editable) return;
    const step = event.shiftKey ? 0.02 : 0.005;
    const delta =
      event.key === 'ArrowLeft'
        ? [-step, 0]
        : event.key === 'ArrowRight'
          ? [step, 0]
          : event.key === 'ArrowUp'
            ? [0, -step]
            : event.key === 'ArrowDown'
              ? [0, step]
              : null;
    if (!delta) return;
    event.preventDefault();
    nudgeBy(key, delta[0], delta[1]);
  };

  const startDrag = (id: string) => (event: React.PointerEvent) => {
    if (!editable) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = stageRef.current?.getBoundingClientRect();
    if (rect) {
      const norm = clientToNorm(event, rect, geo);
      const isSticker = id.startsWith('sticker:');
      const current = isSticker
        ? layout.stickers.find((row) => row.id === id.slice('sticker:'.length))
        : layout.elements.find((el) => el.id === id);
      dragOffsetRef.current = current
        ? { dx: norm.x - current.x, dy: norm.y - current.y }
        : { dx: 0, dy: 0 };
    }
    setDragId(id);
  };

  return (
    <div ref={hostRef} className="hud-studio-fit">
      <div
        ref={stageRef}
        className={`hud-studio-stage${editable ? ' is-edit' : ''}`}
        style={{ width: box.w, height: box.h, ['--chrome-frame-color' as string]: color }}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
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

        {/* Top-Right Game Clock / Score reference */}
        <div
          className="chrome-frame-box"
          style={{
            right: geo.displayRightInset + 16,
            top: geo.offsetY + 10,
            pointerEvents: 'none',
          }}
        >
          <div className="flex items-center gap-2 rounded border border-white/10 bg-black/60 px-2.5 py-1 font-mono text-[10px] text-zinc-400">
            <span className="text-white font-semibold">14 vs 11</span>
            <span className="opacity-40">|</span>
            <span>12:45</span>
          </div>
        </div>

        {/* Ability HUD reference frame */}
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
          <div className="absolute inset-0 flex flex-col justify-end p-2 pointer-events-none opacity-80">
            <div className="h-1.5 w-full bg-emerald-500/30 rounded-full mb-1" />
            <div className="h-1 w-full bg-blue-500/30 rounded-full mb-2" />
            <div className="flex items-center justify-center gap-1.5">
              {['Q', 'W', 'E', 'R'].map((spell) => (
                <div
                  key={spell}
                  className="h-6 w-6 rounded border border-white/20 bg-black/70 flex items-center justify-center font-mono text-[9px] text-zinc-300"
                >
                  {spell}
                </div>
              ))}
              <div className="h-6 w-6 rounded border border-white/20 bg-black/70 flex items-center justify-center font-mono text-[8px] text-zinc-400">
                D
              </div>
              <div className="h-6 w-6 rounded border border-white/20 bg-black/70 flex items-center justify-center font-mono text-[8px] text-zinc-400">
                F
              </div>
            </div>
          </div>
        </div>

        {/* Minimap reference frame */}
        <div
          className="chrome-frame-box chrome-frame-guide chrome-frame-guide-map"
          style={{
            right: geo.displayRightInset + geo.mapPad,
            bottom: geo.displayBottomInset + geo.mapPad,
            width: mapW,
            height: mapH,
          }}
        >
          <img
            src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/map/map11.png"
            alt=""
            className="absolute inset-0 h-full w-full object-cover opacity-70 pointer-events-none"
          />
          <div className="absolute inset-0 pointer-events-none ring-1 ring-inset ring-emerald-300/25" />
        </div>

        {/* Real Overlay Modules Pins */}
        {layout.elements
          .filter((el) => HUD_STUDIO_MODULE_IDS.includes(el.id as HudModuleId) && el.visible)
          .map((el) => (
            <button
              key={el.id}
              type="button"
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
              title={`${HUD_MODULE_LABELS[el.id as HudModuleId]} — drag or use arrow keys to move`}
              className={`hud-studio-pin${dragId === el.id ? ' is-drag' : ''}`}
              style={studioPinStyle(el, geo)}
              onPointerDown={startDrag(el.id)}
              onKeyDown={onPinKeyDown(el.id)}
            >
              {renderStudioModuleContent(el.id as HudModuleId)}
            </button>
          ))}

        {/* Custom Stickers */}
        {layout.stickers.map((sticker) => (
          <button
            key={sticker.id}
            type="button"
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown"
            className={`hud-studio-sticker${dragId === `sticker:${sticker.id}` ? ' is-drag' : ''}`}
            style={layoutStyle(sticker, geo)}
            onPointerDown={startDrag(`sticker:${sticker.id}`)}
            onKeyDown={onPinKeyDown(`sticker:${sticker.id}`)}
            title={sticker.label || sticker.kind}
          >
            <StickerMark sticker={sticker} />
          </button>
        ))}
      </div>
    </div>
  );
};
