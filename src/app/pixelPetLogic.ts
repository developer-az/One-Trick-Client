/**
 * pixelPetLogic.ts — pure dashboard-pet simulation.
 *
 * No React, no DOM, no League-client or overlay code: everything here is a
 * plain function a test (or the component) can drive with an injected clock.
 *
 * The pet lives only in the dashboard window and only exists during the
 * `idle`, `queue` and `loading` stages (see PET_VISIBLE_STAGES — it disappears
 * in game). It idles, wanders back and forth inside its allotted area, sleeps
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

/** The pet is a dashboard companion: visible only when nothing urgent is up. */
export const PET_VISIBLE_STAGES: ReadonlySet<LeagueStage> = new Set(['idle', 'queue', 'loading']);

/** The pet pops when the stage enters queue (Matchmaking + ReadyCheck both arrive here). */
export const PET_POP_STAGES: ReadonlySet<LeagueStage> = new Set(['queue']);

export function petVisibleForStage(stage: LeagueStage): boolean {
  return PET_VISIBLE_STAGES.has(stage);
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
      let x = s.x + (s.dir * PET_TIMING.walkPxPerSec * dt) / span;
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
