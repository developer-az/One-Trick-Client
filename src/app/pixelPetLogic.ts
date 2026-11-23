/**
 * pixelPetLogic.ts — pure dashboard-pet simulation.
 *
 * No React, no DOM, no League-client or overlay code: everything here is a
 * plain function a test (or the component) can drive with an injected clock.
 *
 * The pet lives only in the dashboard window for every league stage except an
 * active match (`game` — the overlay owns that). It idles, wanders back and
 * forth inside its allotted area, sleeps
 * after a long quiet stretch, and reacts exactly once — with a queue-pop jump
 * — each time the stage enters `queue` (leagueStatus folds both Matchmaking
 * and ReadyCheck into stage 'queue').
 *
 * Timers pause while the window is hidden (the hidden branch advances the
 * clock but not the simulation), and prefers-reduced-motion freezes the phase
 * clock, disables wandering and settles a queue pop into a static pose.
 */

/* ------------------------------------------------------------------ types */

export type PetSpecies = 'imp' | 'pup' | 'wyrm' | 'blob';
export type PetColor = 'teal' | 'gold' | 'blood' | 'royal' | 'chrome';

/** User-persisted pet choice (mirrors the global PetSettings in src/types.d.ts). */
export interface PetSettings {
  species: PetSpecies;
  color: PetColor;
}

export type LeagueStage =
  | 'preview'
  | 'offline'
  | 'connecting'
  | 'idle'
  | 'queue'
  | 'draft'
  | 'loading'
  | 'game'
  | 'post';

export type PetMood = 'hidden' | 'idle' | 'walk' | 'sleep' | 'pop';

/* ------------------------------------------------------------ enums + lists */

export const PET_SPECIES: readonly PetSpecies[] = ['imp', 'pup', 'wyrm', 'blob'];
export const PET_COLORS: readonly PetColor[] = ['teal', 'gold', 'blood', 'royal', 'chrome'];

export const PET_DEFAULT_SPECIES: PetSpecies = 'imp';
export const PET_DEFAULT_COLOR: PetColor = 'teal';

export const PET_DEFAULTS: PetSettings = {
  species: PET_DEFAULT_SPECIES,
  color: PET_DEFAULT_COLOR,
};

export const PET_SPECIES_LABELS: Record<PetSpecies, string> = {
  imp: 'Imp',
  pup: 'Pup',
  wyrm: 'Wyrm',
  blob: 'Blob',
};

/** Body colors offered in settings (also used for previews / swatches). */
export const COLOR_HEX: Record<PetColor, string> = {
  teal: '#35d0ba',
  gold: '#c8a24e',
  blood: '#d6454d',
  royal: '#5f7fd6',
  chrome: '#d6dae0',
};

export function isPetSpecies(v: unknown): v is PetSpecies {
  return typeof v === 'string' && (PET_SPECIES as readonly string[]).includes(v);
}

export function isPetColor(v: unknown): v is PetColor {
  return typeof v === 'string' && (PET_COLORS as readonly string[]).includes(v);
}

export function normalizePetSpecies(raw: unknown): PetSpecies {
  return isPetSpecies(raw) ? raw : PET_DEFAULT_SPECIES;
}

export function normalizePetColor(raw: unknown): PetColor {
  return isPetColor(raw) ? raw : PET_DEFAULT_COLOR;
}

/** Validate a persisted/loaded pet choice; unknown values fall back to defaults. */
export function normalizePet(raw: unknown): PetSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    species: normalizePetSpecies(src.species),
    color: normalizePetColor(src.color),
  };
}

/* ------------------------------------------------------------- visibility */

/** Dashboard stages where the companion may show (everything except in-match). */
export const PET_VISIBLE_STAGES: ReadonlySet<LeagueStage> = new Set([
  'preview',
  'offline',
  'connecting',
  'idle',
  'queue',
  'draft',
  'loading',
  'post',
]);

/** The pet pops when the stage enters queue (Matchmaking + ReadyCheck both arrive here). */
export const PET_POP_STAGES: ReadonlySet<LeagueStage> = new Set(['queue']);

export function petVisibleForStage(stage: LeagueStage): boolean {
  return stage !== 'game';
}

/* ------------------------------------------------------------------ timing */

export const PET_TIMING = {
  /** Queue-pop reaction length before the pet settles. */
  popMs: 1600,
  /** How long one walk bout lasts. */
  walkMs: 5000,
  /** Idle time before the pet starts wandering again. */
  wanderEveryMs: 3200,
  /** Total awake time before the pet goes to sleep. */
  sleepAfterMs: 30000,
  /** One animation cycle (bob / legs / zzz drift). */
  cycleMs: 800,
  /** Walk speed in fractions of the allotted width per second. */
  walkPxPerSec: 18,
} as const;

/* ---------------------------------------------------------------- palettes */

/** Pixel-role colors. Sprite maps reference these keys; the palette maps them to hex. */
export interface PetPalette {
  body: string;
  belly: string;
  outline: string;
  accent: string;
  eye: string;
}

/** Per-species accents: horns, collar, wing membrane, blush. */
const SPECIES_LAYOUT: Record<PetSpecies, { belly: string; outline: string; accent: string; eye: string }> = {
  imp: { belly: '#101217', outline: '#050508', accent: '#f2b350', eye: '#e9ebef' },
  pup: { belly: '#16181f', outline: '#050508', accent: '#6aa6f8', eye: '#e9ebef' },
  wyrm: { belly: '#101319', outline: '#050508', accent: '#35c7b0', eye: '#e9ebef' },
  blob: { belly: '#1a1d24', outline: '#050508', accent: '#f0656a', eye: '#e9ebef' },
};

export function paletteFor(species: PetSpecies, color: PetColor): PetPalette {
  const s = SPECIES_LAYOUT[species];
  return { body: COLOR_HEX[color], belly: s.belly, outline: s.outline, accent: s.accent, eye: s.eye };
}

/* ----------------------------------------------------------------- sprites */

/**
 * 16×14 pixel maps, drawn with canvas primitives only (fillRect per pixel).
 * Keys: '.' transparent, 'o' outline, 'B' body, 'b' belly, 'a' accent, 'e' eye.
 */
export type SpriteMap = readonly string[];

export const PET_SPRITES: Record<PetSpecies, SpriteMap> = {
  imp: [
    '......oo........',
    '......oo........',
    '.....oBBo.......',
    '....oBBBBo......',
    '...oBBBBBBo.....',
    '..oBBBBBBBBo....',
    '.oBeBBBBBBeeBo..',
    '.oBBBBBBBBBBBBo.',
    'oBBbBBBBBBbBBo..',
    'oBBbBBBBBBbBBo..',
    'oBBBBBBBBBBBBo..',
    '.oBaBBBBBBaBo...',
    '..oBBBBBBBBo....',
    '...oo....oo.....',
  ],
  pup: [
    'oo........o.....',
    'oBo.......oo....',
    'oBeBo....oBo....',
    'oBBBBooooBBBo...',
    'oBBBBBBBBBBo....',
    'oBBeBBBBBBBeBo..',
    'oBBbBBBBBBbBBo..',
    'oBBbBBBBBBbBBo..',
    'oBBBBBBBBBBBBo..',
    '.oBaBBBBBBaBo...',
    '..oBBBBBBBBo....',
    '..oBBBBBBBBo....',
    '..oB.BB..B.Bo...',
    '...oo....oo.....',
  ],
  wyrm: [
    '.......oo.......',
    '......oBBo......',
    'o....oBBBBo.....',
    '.oBo.oBeBBBo.o..',
    'oBBooBBBBBBooBo.',
    'oBBBBBBBBBBBBBo.',
    '.oBBbBBBBbBBBo..',
    '.oBBbBBBBbBBBo..',
    'oBBBBBBBBBBBBBo.',
    'oBaBBBBBBBBaBo..',
    'oBBBBBBBBBBBBo..',
    '.oBBBBBBBBBBo...',
    '..oBBBBBBBBo....',
    '...oo....oo.....',
  ],
  blob: [
    '.....oooooo.....',
    '...ooBBBBBBoo...',
    '..oBBBBBBBBBBo..',
    '.oBBBBBBBBBBBBo.',
    '.oBeBBBBBBBeBo..',
    'oBBBBBBBBBBBBBBo',
    'oBBBBBBBBBBBBBBo',
    '.oBBBBBBBBBBBBo.',
    '..oBBbBBBBbBBo..',
    '...ooBBBBBBoo...',
    '.....oooooo.....',
  ],
};

/* ------------------------------------------------------------------ state */

export interface PetState {
  mood: PetMood;
  /** Horizontal position, 0..1 across the allotted area. */
  x: number;
  dir: 1 | -1;
  /** 0..1 phase into the current mood's cycle. */
  phase: number;
  popLeftMs: number;
  /** Continuous awake time in this visible period. */
  awakeMs: number;
  /** Time since the last mood switch (drives idle↔walk pacing). */
  wanderMs: number;
  /** One-shot queue-pop latch. */
  popArmed: boolean;
  stage: LeagueStage;
  /** Last clock value seen (simulation time never counts hidden time). */
  lastNow: number;
}

export function createPetState(now: number, stage: LeagueStage): PetState {
  return {
    mood: petVisibleForStage(stage) ? 'idle' : 'hidden',
    x: 0.22,
    dir: 1,
    phase: 0,
    popLeftMs: 0,
    awakeMs: 0,
    wanderMs: 0,
    popArmed: true,
    stage,
    lastNow: now,
  };
}

/** What a frame should look like — everything the canvas needs to draw. */
export interface PetPose {
  mood: PetMood;
  x: number;
  dir: 1 | -1;
  phase: number;
  /** 0..1 progress through the one-shot queue-pop jump. */
  popProgress: number;
}

export function petPoseFromState(s: PetState): PetPose {
  return {
    mood: s.mood,
    x: s.x,
    dir: s.dir,
    phase: s.phase,
    popProgress: s.mood === 'pop' && PET_TIMING.popMs > 0 ? 1 - s.popLeftMs / PET_TIMING.popMs : 0,
  };
}

/* ------------------------------------------------------------------- step */

export interface PetStepInput {
  stage: LeagueStage;
  /** Monotonic clock in ms (Date.now / performance.now). */
  now: number;
  /** Window/document hidden — pauses all timers. */
  hidden: boolean;
  /** prefers-reduced-motion — freezes phase, no wandering. */
  reducedMotion: boolean;
  /** Width of the allotted area in px (clamped to ≥ 1 internally). */
  width: number;
}

export function stepPet(prev: PetState, input: PetStepInput): PetState {
  const { stage, now, hidden, reducedMotion, width } = input;

  // Leaving a visible stage fully resets the pet and re-arms the pop latch.
  if (!petVisibleForStage(stage)) return createPetState(now, stage);

  // Hidden: advance the clock so elapsed hidden time is not counted, but keep
  // the whole simulation frozen (pose, pop timer, awake/wander accumulators).
  if (hidden) return { ...prev, lastNow: now };

  const dt = Math.max(0, now - prev.lastNow);
  if (dt <= 0) return prev;

  // A stage change inside the visible set wakes the pet from a fresh state
  // (sleep ends, wandering restarts) and re-arms the pop latch.
  let s: PetState = prev.stage !== stage ? createPetState(now, stage) : { ...prev, lastNow: now };
  s = { ...s, awakeMs: s.awakeMs + dt, wanderMs: s.wanderMs + dt };

  // One-shot queue-pop reaction: fires when the stage first enters queue.
  if (s.popArmed && PET_POP_STAGES.has(stage)) {
    s = { ...s, mood: 'pop', popLeftMs: PET_TIMING.popMs, phase: 0, popArmed: false, wanderMs: 0, awakeMs: 0 };
  }

  switch (s.mood) {
    case 'pop': {
      const left = Math.max(0, s.popLeftMs - dt);
      if (left <= 0) {
        // Settle into a calm mood. Under reduced motion settle static (no walk).
        s = { ...s, mood: reducedMotion ? 'idle' : 'walk', popLeftMs: 0, phase: 0, wanderMs: 0 };
      } else {
        s = { ...s, popLeftMs: left };
      }
      break;
    }
    case 'walk': {
      if (reducedMotion) {
        // No autonomous movement under reduced motion.
        s = { ...s, mood: 'idle', phase: 0, wanderMs: 0 };
        break;
      }
      const span = Math.max(1, width);
      const dtSec = dt / 1000;
      let x = s.x + (s.dir * PET_TIMING.walkPxPerSec * dtSec) / span;
      let dir = s.dir;
      if (x <= 0) {
        x = 0;
        dir = 1;
      } else if (x >= 1) {
        x = 1;
        dir = -1;
      }
      s = { ...s, x, dir };
      if (s.wanderMs >= PET_TIMING.walkMs) s = { ...s, mood: 'idle', phase: 0, wanderMs: 0 };
      break;
    }
    case 'idle': {
      if (s.awakeMs >= PET_TIMING.sleepAfterMs) {
        s = { ...s, mood: 'sleep', phase: 0 };
      } else if (!reducedMotion && s.wanderMs >= PET_TIMING.wanderEveryMs) {
        s = { ...s, mood: 'walk', phase: 0, wanderMs: 0 };
      }
      break;
    }
    case 'sleep':
    case 'hidden':
      break;
  }

  s = { ...s, phase: reducedMotion ? 0 : (s.phase + dt / PET_TIMING.cycleMs) % 1 };
  return s;
}

/* ---------------------------------------------------------------- roaming */
/*
 * The overlay's companion roams a 2D viewport instead of a one-row box: a
 * home rect (your loading-screen portrait) is the anchor, most goals stay in
 * an ellipse around it, and the rest of the screen is fair game inside the
 * safe margins. Pure and clock-injected like the rest of this module, so the
 * verifier can sample a thousand goals and step the walk deterministically.
 */

export interface RoamPoint {
  x: number;
  y: number;
}

/** Home card rect in viewport pixels (structurally an overlay Rect). */
export interface RoamRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RoamSpace {
  width: number;
  height: number;
  /** Your loading-screen card; null/absent = the bottom third of the screen. */
  home?: RoamRect | null;
}

export const PET_ROAM = {
  /** Walking speed; the pet eases out over the last few pixels. */
  speedPxPerSec: 40,
  /** Pause between goals. */
  idleMinMs: 1500,
  idleMaxMs: 4000,
  /** Share of goals that stay near the home card, not across the screen. */
  nearHomeChance: 0.7,
  /** The screen's top/bottom 6% is never walked into. */
  safeMarginYRatio: 0.06,
  safeMarginXRatio: 0.02,
  /** Without a home card: wander the bottom third. */
  bandRatio: 1 / 3,
  /** Share of near-home goals that stay below/beside the card (rest: the top). */
  lowerBiasChance: 0.8,
  /** Home ellipse: centre and radii as fractions of the card rect. */
  ellipseCxRatio: 0.5,
  ellipseCyRatio: 0.45,
  ellipseRxRatio: 0.75,
  ellipseRyRatio: 0.55,
  /** Radial range of a near-home goal (fractions of the ellipse). */
  nearRadiusMin: 0.55,
  nearRadiusMax: 1,
  /** Slow down inside this distance so the stop is not a snap. */
  easeDistancePx: 32,
  /** One step never integrates more than this much time (tab wakes). */
  maxStepMs: 250,
} as const;

export interface RoamState {
  x: number;
  y: number;
  /** Facing, from the horizontal direction of travel. */
  dir: 1 | -1;
  target: RoamPoint;
  /** Idle time left before the next goal is chosen. */
  idleLeftMs: number;
  /** Walking to `target` (true) or waiting (false). */
  moving: boolean;
  /** Last clock value seen. */
  lastNow: number;
  /** LCG state, so the wander is reproducible from a seed. */
  seed: number;
}

/** Screen area the pet may occupy (excludes the top/bottom 6%). */
export function roamSafeArea(
  width: number,
  height: number
): { minX: number; maxX: number; minY: number; maxY: number } {
  const w = Math.max(1, Number.isFinite(width) ? width : 1);
  const h = Math.max(1, Number.isFinite(height) ? height : 1);
  return {
    minX: w * PET_ROAM.safeMarginXRatio,
    maxX: w * (1 - PET_ROAM.safeMarginXRatio),
    minY: h * PET_ROAM.safeMarginYRatio,
    maxY: h * (1 - PET_ROAM.safeMarginYRatio),
  };
}

/** The ellipse around the home card that most goals land in. */
export function homeEllipse(home: RoamRect): { cx: number; cy: number; rx: number; ry: number } {
  return {
    cx: home.x + home.w * PET_ROAM.ellipseCxRatio,
    cy: home.y + home.h * PET_ROAM.ellipseCyRatio,
    rx: Math.max(1, home.w * PET_ROAM.ellipseRxRatio),
    ry: Math.max(1, home.h * PET_ROAM.ellipseRyRatio),
  };
}

export function insideHomeEllipse(home: RoamRect, x: number, y: number): boolean {
  const e = homeEllipse(home);
  const dx = (x - e.cx) / e.rx;
  const dy = (y - e.cy) / e.ry;
  return dx * dx + dy * dy <= 1;
}

/** One LCG draw: value in [0,1) plus the next seed. */
function randomOf(seed: number): { value: number; seed: number } {
  const next = (Math.imul(seed >>> 0, 1664525) + 1013904223) >>> 0;
  return { value: next / 4294967296, seed: next };
}

function clampToSafe(point: RoamPoint, space: RoamSpace): RoamPoint {
  const safe = roamSafeArea(space.width, space.height);
  return {
    x: Math.min(safe.maxX, Math.max(safe.minX, point.x)),
    y: Math.min(safe.maxY, Math.max(safe.minY, point.y)),
  };
}

/** Where the pet sits when it is not walking: the home card's bottom edge. */
export function roamAnchor(space: RoamSpace): RoamPoint {
  const safe = roamSafeArea(space.width, space.height);
  const home = space.home ?? null;
  if (home) {
    return {
      x: Math.min(safe.maxX, Math.max(safe.minX, home.x + home.w / 2)),
      y: Math.min(safe.maxY, Math.max(safe.minY, home.y + home.h)),
    };
  }
  return { x: (safe.minX + safe.maxX) / 2, y: safe.maxY - 8 };
}

/**
 * One goal, drawn from the seeded stream. Near the home card: 70% of goals in
 * the ellipse (mostly its lower arc, sometimes the card face/top); otherwise
 * anywhere inside the safe margins. No home: the bottom third only.
 */
export function pickRoamTarget(space: RoamSpace, seed: number): { target: RoamPoint; seed: number } {
  let s = seed;
  const draw = (): number => {
    const r = randomOf(s);
    s = r.seed;
    return r.value;
  };
  const safe = roamSafeArea(space.width, space.height);
  const home = space.home ?? null;

  if (home && draw() < PET_ROAM.nearHomeChance) {
    const e = homeEllipse(home);
    // 0..π is the lower half (screen y grows downwards); 80% of goals hang
    // below or beside the card, the rest may hop onto its face/top.
    const theta =
      draw() < PET_ROAM.lowerBiasChance
        ? Math.PI * (0.08 + 0.84 * draw())
        : Math.PI * 2 * draw();
    const radius = PET_ROAM.nearRadiusMin + (PET_ROAM.nearRadiusMax - PET_ROAM.nearRadiusMin) * draw();
    return {
      target: clampToSafe(
        { x: e.cx + Math.cos(theta) * e.rx * radius, y: e.cy + Math.sin(theta) * e.ry * radius },
        space
      ),
      seed: s,
    };
  }

  if (!home) {
    const minY = Math.max(safe.minY, space.height * (1 - PET_ROAM.bandRatio));
    return {
      target: {
        x: safe.minX + draw() * (safe.maxX - safe.minX),
        y: minY + draw() * (safe.maxY - minY),
      },
      seed: s,
    };
  }

  return {
    target: {
      x: safe.minX + draw() * (safe.maxX - safe.minX),
      y: safe.minY + draw() * (safe.maxY - safe.minY),
    },
    seed: s,
  };
}

export function createRoamState(now: number, space: RoamSpace, seed = 0x9e3779b9): RoamState {
  const anchor = roamAnchor(space);
  const picked = pickRoamTarget(space, seed);
  return {
    x: anchor.x,
    y: anchor.y,
    dir: picked.target.x >= anchor.x ? 1 : -1,
    target: picked.target,
    // Settle for a beat before the first walk: the pet appears with the card.
    idleLeftMs: PET_ROAM.idleMinMs,
    moving: false,
    lastNow: now,
    seed: picked.seed,
  };
}

export interface RoamStepInput {
  now: number;
  width: number;
  height: number;
  home?: RoamRect | null;
  /** prefers-reduced-motion: stay put at the anchor. */
  reducedMotion: boolean;
}

/**
 * Advance the roam. Movement is bounded by `speedPxPerSec` (a step never
 * integrates more than `maxStepMs`, so a background tab wake cannot teleport
 * the pet), and the fast-forwarded clock is never counted as walked time.
 */
export function stepRoam(prev: RoamState, input: RoamStepInput): RoamState {
  const space: RoamSpace = { width: input.width, height: input.height, home: input.home ?? null };
  if (input.reducedMotion) {
    const anchor = roamAnchor(space);
    return {
      ...prev,
      x: anchor.x,
      y: anchor.y,
      moving: false,
      idleLeftMs: 0,
      lastNow: Math.max(prev.lastNow, input.now),
    };
  }

  const dt = Math.max(0, Math.min(PET_ROAM.maxStepMs, input.now - prev.lastNow));
  const s: RoamState = { ...prev, lastNow: Math.max(prev.lastNow, input.now) };
  if (dt <= 0) return s;

  if (!s.moving) {
    const left = s.idleLeftMs - dt;
    if (left > 0) return { ...s, idleLeftMs: left };
    const picked = pickRoamTarget(space, s.seed);
    return {
      ...s,
      idleLeftMs: 0,
      moving: true,
      target: picked.target,
      seed: picked.seed,
      dir: picked.target.x >= s.x ? 1 : -1,
    };
  }

  const dx = s.target.x - s.x;
  const dy = s.target.y - s.y;
  const dist = Math.hypot(dx, dy);
  const stride = PET_ROAM.speedPxPerSec * (dt / 1000);

  if (dist <= Math.max(stride, 0.5)) {
    const r = randomOf(s.seed);
    const idle = PET_ROAM.idleMinMs + r.value * (PET_ROAM.idleMaxMs - PET_ROAM.idleMinMs);
    return { ...s, x: s.target.x, y: s.target.y, moving: false, idleLeftMs: idle, seed: r.seed };
  }

  const ease = Math.min(1, dist / PET_ROAM.easeDistancePx);
  const stepLen = Math.min(dist, stride * (0.35 + 0.65 * ease));
  const next = clampToSafe(
    { x: s.x + (dx / dist) * stepLen, y: s.y + (dy / dist) * stepLen },
    space
  );
  return { ...s, x: next.x, y: next.y, dir: dx === 0 ? s.dir : dx > 0 ? 1 : -1 };
}

