import React, { useEffect, useRef, useState } from 'react';
import {
  createPetState,
  createRoamState,
  petPoseFromState,
  roamAnchor,
  stepPet,
  stepRoam,
  type PetSettings,
  type PetState,
  type RoamRect,
  type RoamState,
} from '../app/pixelPetLogic';
import { drawPetPose, PET_LOGICAL_H, PET_LOGICAL_W, preparePetCanvas } from '../app/pixelPetCanvas';

/** Loading-screen pet: ~8 fps is plenty for a small idle animation. */
const PET_FRAME_MS = 125;

/** What the sprite's small canvas is drawn into at the roam position. */
function spriteTransform(x: number, y: number): string {
  const left = Math.round(x - PET_LOGICAL_W / 2);
  const top = Math.round(y - (PET_LOGICAL_H - 8));
  // translate3d keeps the moving element on the compositor: the paint is the
  // small sprite rect, never a full-screen repaint.
  return `translate3d(${left}px, ${top}px, 0)`;
}

function sameHome(a: RoamRect | null, b: RoamRect | null): boolean {
  if (!a || !b) return a === b;
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}

export const OverlayPet: React.FC<{ preference: PetSettings; home?: RoamRect | null }> = ({
  preference,
  home = null,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const homeRef = useRef<RoamRect | null>(home);
  const prefRef = useRef(preference);
  const reducedRef = useRef(false);
  // First-paint position: the anchor, so the pet never flashes in the corner.
  // Constant for the component's life — the loop moves the element by hand.
  const [initialTransform] = useState(() => {
    const anchor =
      typeof window === 'undefined'
        ? { x: 0, y: 0 }
        : roamAnchor({ width: window.innerWidth, height: window.innerHeight, home });
    return spriteTransform(anchor.x, anchor.y);
  });

  useEffect(() => {
    prefRef.current = preference;
  }, [preference]);

  useEffect(() => {
    homeRef.current = home;
  }, [home]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updateReduced = () => {
      reducedRef.current = media.matches;
    };
    updateReduced();
    media.addEventListener('change', updateReduced);
    return () => media.removeEventListener('change', updateReduced);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    const body = bodyRef.current;
    if (!canvas || !body) return;
    const ctx = preparePetCanvas(canvas);
    if (!ctx) return;

    const nowMs = () => performance.now();
    const space = () => ({
      width: window.innerWidth,
      height: window.innerHeight,
      home: homeRef.current,
    });

    // Two clocks: stepPet owns the animation phase (bob / legs / one-shots),
    // stepRoam owns the 2D position. The sprite is drawn centred in its small
    // canvas, so the element's transform is what moves.
    let animState: PetState = createPetState(nowMs(), 'loading');
    let roamState: RoamState = createRoamState(nowMs(), space());
    let knownHome = homeRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;
    let lastKey = '';

    const paint = (x: number, y: number, dir: 1 | -1): void => {
      const pose = petPoseFromState(animState);
      const mood = reducedRef.current ? 'idle' : roamState.moving ? 'walk' : 'idle';
      // Quantized key: sub-pixel drift and repeated frames never repaint.
      const key = `${prefRef.current.species}|${prefRef.current.color}|${mood}|${Math.round(x)}|${Math.round(y)}|${dir}|${pose.phase.toFixed(3)}`;
      if (key === lastKey) return;
      lastKey = key;
      body.style.transform = spriteTransform(x, y);
      drawPetPose(
        ctx,
        { ...pose, mood, x: 0.5, dir },
        prefRef.current,
        reducedRef.current
      );
    };

    const tick = (): void => {
      if (disposed) return;
      if (document.hidden) return;
      const now = nowMs();
      const current = space();
      // The slot arrives asynchronously: when it does, walk over to the card
      // instead of teleporting (the pet was already sent with the payload).
      if (!sameHome(knownHome, current.home)) {
        knownHome = current.home;
        if (current.home) {
          roamState = {
            ...roamState,
            target: roamAnchor(current),
            moving: true,
            idleLeftMs: 0,
          };
        }
      }
      roamState = stepRoam(roamState, {
        now,
        width: current.width,
        height: current.height,
        home: current.home,
        reducedMotion: reducedRef.current,
      });
      animState = stepPet(animState, {
        stage: 'loading',
        now,
        hidden: false,
        reducedMotion: reducedRef.current,
        width: PET_LOGICAL_W,
      });
      paint(roamState.x, roamState.y, roamState.dir);
      schedule();
    };

    // One bounded setTimeout chain: no continuous rAF on the loading screen.
    // It stops on hidden/unmount and restarts from "now" (hidden time is not
    // walked) when the page is visible again.
    const schedule = (): void => {
      if (disposed || timer || document.hidden) return;
      timer = setTimeout(() => {
        timer = null;
        tick();
      }, PET_FRAME_MS);
    };

    const stop = (): void => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onVisibilityChange = (): void => {
      if (document.hidden) {
        stop();
        return;
      }
      // Hidden time is not walked: restart both clocks from "now".
      roamState = { ...roamState, lastNow: nowMs() };
      animState = { ...animState, lastNow: nowMs() };
      tick();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    tick();
    return () => {
      disposed = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <div className="ov-pet-layer" aria-hidden>
      <div
        ref={bodyRef}
        className="ov-pet-body"
        style={{ width: PET_LOGICAL_W, height: PET_LOGICAL_H, transform: initialTransform }}
      >
        <canvas ref={canvasRef} width={PET_LOGICAL_W} height={PET_LOGICAL_H} className="block" />
        <span className="ov-pet-ground" />
      </div>
    </div>
  );
};
