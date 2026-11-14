import {
  paletteFor,
  PET_SPRITES,
  type PetPose,
  type PetSettings,
} from './pixelPetLogic';

export const PET_LOGICAL_W = 128;
export const PET_LOGICAL_H = 72;
const SPRITE_SCALE = 3;
const BASE_Y = PET_LOGICAL_H - 8;

function drawZ(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, size * 3, size);
  ctx.fillRect(x + size * 2, y + size, size, size);
  ctx.fillRect(x, y + size * 2, size * 3, size);
}

function drawExclaim(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  ctx.fillStyle = color;
  ctx.fillRect(x - 1, y, 3, 6);
  ctx.fillRect(x - 1, y + 8, 3, 3);
}

/** Draw one pet pose into a canvas context (logical 128×72 space). */
export function drawPetPose(
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

  ctx.clearRect(0, 0, PET_LOGICAL_W, PET_LOGICAL_H);

  ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
  const shadowW = 22;
  ctx.fillRect(Math.round(PET_LOGICAL_W / 2 - shadowW / 2), BASE_Y, shadowW, 4);

  let dy = 0;
  if (pose.mood === 'idle') dy = Math.round(Math.sin(pose.phase * Math.PI * 2) * 1);
  else if (pose.mood === 'walk') dy = Math.round(Math.sin(pose.phase * Math.PI * 4) * 1);
  else if (pose.mood === 'pop') dy = reducedMotion ? 0 : -Math.round(Math.sin(pose.popProgress * Math.PI) * 5);

  const padX = 8;
  const inner = Math.max(0, PET_LOGICAL_W - padX * 2 - spriteW);
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

  if (pose.mood === 'pop') {
    drawExclaim(ctx, Math.round(xPx + spriteW / 2), yPx - 6, pal.accent);
  }
}

export function preparePetCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = PET_LOGICAL_W * dpr;
  canvas.height = PET_LOGICAL_H * dpr;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}