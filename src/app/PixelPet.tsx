import React, { useEffect, useRef } from 'react';
import {
  createPetState,
  paletteFor,
  PET_SPRITES,
  petPoseFromState,
  petVisibleForStage,
  stepPet,
  type LeagueStage,
  type PetPose,
  type PetSettings,
  type PetState,
} from './pixelPetLogic';

/**
 * PixelPet — a small canvas sprite pet for the dashboard window.
 *
 * Pure canvas primitives (fillRect per sprite pixel): no image assets, no
 * dependencies. It mounts only inside the dashboard shell (App.tsx), is
 * strictly passive (pointer-events: none) and only exists while the league
 * stage is idle / queue / loading — it disappears in game.
 *
 * Behaviour lives in pixelPetLogic.ts (a pure, injected-clock state machine);
 * this component just drives it with requestAnimationFrame and draws each
 * changing pose. Timers pause while the window is hidden, and
 * prefers-reduced-motion freezes the phase clock and disables wandering.
 */

const LOGICAL_W = 128;
const LOGICAL_H = 72;
const SPRITE_SCALE = 3;
const BASE_Y = LOGICAL_H - 8;

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function dprScale(): number {
  if (typeof window === 'undefined') return 1;
  return Math.min(2, window.devicePixelRatio || 1);
}

function prepareCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = dprScale();
  canvas.width = LOGICAL_W * dpr;
  canvas.height = LOGICAL_H * dpr;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/** Small pixel Z (sleeping). */
function drawZ(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size * 3, size);
  ctx.fillRect(x + size * 2, y + size, size, size);
  ctx.fillRect(x, y + size * 2, size * 3, size);
}

/** Small pixel "!" (queue pop). */
function drawExclaim(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x - 1, y, 3, 6);
  ctx.fillRect(x - 1, y + 8, 3, 3);
}

function drawPose(
  ctx: CanvasRenderingContext2D,
  pose: PetPose,
  pref: PetSettings,
  reducedMotion: boolean
): void {
  const pal = paletteFor(pref.species, pref.color);
  const map = PET_SPRITES[pref.species];
  const rows = map.length;
  const cols = map[0]?.length ?? 0;
  const spriteW = cols * SPRITE_SCALE;
  const spriteH = rows * SPRITE_SCALE;

  ctx.clearRect(0, 0, LOGICAL_W, LOGICAL_H);

  // Static ground shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  const shadowW = 22;
  ctx.fillRect(Math.round(LOGICAL_W / 2 - shadowW / 2), BASE_Y, shadowW, 4);

  // Mood bob / jump (skipped under reduced motion — static pose).
  let dy = 0;
  if (pose.mood === 'idle') dy = Math.round(Math.sin(pose.phase * Math.PI * 2) * 1);
  else if (pose.mood === 'walk') dy = Math.round(Math.sin(pose.phase * Math.PI * 4) * 1);
  else if (pose.mood === 'pop') dy = reducedMotion ? 0 : -Math.round(Math.sin(pose.popProgress * Math.PI) * 5);

  const padX = 8;
  const inner = Math.max(0, LOGICAL_W - padX * 2 - spriteW);
  const xPx = padX + pose.x * inner;
  const yPx = BASE_Y - spriteH + dy;

  ctx.save();
  ctx.translate(Math.round(xPx + spriteW / 2), Math.round(yPx));
  if (pose.dir === -1) ctx.scale(-1, 1);
  ctx.translate(-spriteW / 2, 0);

  const sleeping = pose.mood === 'sleep';
  for (let row = 0; row < rows; row++) {
    const line = map[row];
    for (let col = 0; col < line.length; col++) {
      const ch = line[col];
      if (ch === '.') continue;
      let color: string;
      switch (ch) {
        case 'o':
          color = pal.outline;
          break;
        case 'B':
          color = pal.body;
          break;
        case 'b':
          color = pal.belly;
          break;
        case 'a':
          color = pal.accent;
          break;
        case 'e':
          color = sleeping ? pal.outline : pal.eye;
          break;
        default:
          color = pal.body;
      }
      ctx.fillStyle = color;
      ctx.fillRect(col * SPRITE_SCALE, row * SPRITE_SCALE, SPRITE_SCALE, SPRITE_SCALE);
    }
  }
  ctx.restore();

  // Floating zzz while asleep (only when actually animating).
  if (pose.mood === 'sleep' && !reducedMotion) {
    const zx = Math.round(xPx + spriteW + 2);
    const zy0 = BASE_Y - spriteH - 4;
    for (let i = 0; i < 3; i++) {
      const t = (pose.phase + i * 0.34) % 1;
      ctx.globalAlpha = 0.15 + 0.8 * (1 - t);
      drawZ(ctx, zx + i * 5, Math.round(zy0 - t * 14), 2 + (i % 2), pal.accent);
    }
    ctx.globalAlpha = 1;
  }

  // Queue-pop exclamation above the head.
  if (pose.mood === 'pop') {
    drawExclaim(ctx, Math.round(xPx + spriteW / 2), yPx - 6, pal.accent);
  }
}

export interface PixelPetProps {
  /** Live league stage from leagueStatus(...). */
  stage: LeagueStage;
  /** Persisted species + color choice. */
  preference: PetSettings;
  /** 'live' animates in the dashboard corner; 'static' draws one preview frame. */
  mode?: 'live' | 'static';
}

export const PixelPet: React.FC<PixelPetProps> = ({ stage, preference, mode = 'live' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<PetState | null>(null);
  const prefRef = useRef<PetSettings>(preference);
  const hiddenRef = useRef(false);
  const reducedRef = useRef(false);

  const visible = petVisibleForStage(stage);

  useEffect(() => {
    prefRef.current = preference;
  }, [preference]);

  // Track window/document hidden + prefers-reduced-motion (refs: no re-render).
  useEffect(() => {
    const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const updateHidden = () => {
      hiddenRef.current = typeof document !== 'undefined' && (document.hidden || !document.hasFocus());
    };
    const updateReduced = () => {
      reducedRef.current = !!media?.matches;
    };
    updateHidden();
    updateReduced();
    document.addEventListener('visibilitychange', updateHidden);
    window.addEventListener('blur', updateHidden);
    window.addEventListener('focus', updateHidden);
    media?.addEventListener('change', updateReduced);
    return () => {
      document.removeEventListener('visibilitychange', updateHidden);
      window.removeEventListener('blur', updateHidden);
      window.removeEventListener('focus', updateHidden);
      media?.removeEventListener('change', updateReduced);
    };
  }, []);

  // Live loop: step the pure state machine on every frame, redraw on change.
  useEffect(() => {
    if (mode !== 'live') return;
    if (!visible) {
      stateRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas);
    if (!ctx) return;

    stateRef.current = createPetState(nowMs(), stage);
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const s = stateRef.current;
      if (!s) return;
      const next = stepPet(s, {
        stage,
        now: nowMs(),
        hidden: hiddenRef.current,
        reducedMotion: reducedRef.current,
        width: LOGICAL_W,
      });
      stateRef.current = next;
      const pose = petPoseFromState(next);
      const key = `${pose.mood}|${pose.x.toFixed(3)}|${pose.dir}|${pose.phase.toFixed(3)}|${pose.popProgress.toFixed(3)}`;
      if (key === lastKey) return;
      lastKey = key;
      drawPose(ctx, pose, prefRef.current, reducedRef.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [visible, stage, mode]);

  // Static preview for the settings drawer.
  useEffect(() => {
    if (mode !== 'static') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = prepareCanvas(canvas);
    if (!ctx) return;
    drawPose(ctx, { mood: 'idle', x: 0.5, dir: 1, phase: 0.4, popProgress: 0 }, preference, reducedRef.current);
  }, [mode, preference]);

  if (mode === 'live' && !visible) return null;

  return (
    <div className={mode === 'static' ? 'ot-pet-preview' : 'ot-pet-area'} aria-hidden="true">
      <canvas ref={canvasRef} width={128} height={72} />
    </div>
  );
};

export default PixelPet;
