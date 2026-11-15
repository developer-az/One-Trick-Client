import React, { useEffect, useRef } from 'react';
import {
  createPetState,
  petPoseFromState,
  stepPet,
  type PetSettings,
  type PetState,
} from '../app/pixelPetLogic';
import { drawPetPose, PET_LOGICAL_H, PET_LOGICAL_W, preparePetCanvas } from '../app/pixelPetCanvas';

/** Loading-screen pet: ~8 fps is plenty for a small idle animation. */
const PET_FRAME_MS = 125;

export const OverlayPet: React.FC<{ preference: PetSettings }> = ({ preference }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<PetState | null>(null);
  const prefRef = useRef(preference);
  const reducedRef = useRef(false);

  useEffect(() => {
    prefRef.current = preference;
  }, [preference]);

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
    if (!canvas) return;
    const ctx = preparePetCanvas(canvas);
    if (!ctx) return;

    const nowMs = () => performance.now();
    stateRef.current = createPetState(nowMs(), 'loading');
    let raf = 0;
    let lastFrameAt = 0;
    let lastKey = '';
    let disposed = false;

    const stopLoop = () => {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const tick = (now: number) => {
      if (disposed) return;
      if (document.hidden) {
        stopLoop();
        return;
      }
      raf = requestAnimationFrame(tick);
      // Cap the paint/animation cadence; rAF still drives the timer smoothly.
      if (now - lastFrameAt < PET_FRAME_MS) return;
      lastFrameAt = now;
      const s = stateRef.current;
      if (!s) return;
      const next = stepPet(s, {
        stage: 'loading',
        now: nowMs(),
        hidden: false,
        reducedMotion: reducedRef.current,
        width: PET_LOGICAL_W,
      });
      stateRef.current = next;
      const pose = petPoseFromState(next);
      // Key on whole canvas pixels: sub-pixel idle drift must not repaint.
      const pixelX = Math.round(pose.x * PET_LOGICAL_W);
      const key = `${prefRef.current.species}|${prefRef.current.color}|${pose.mood}|${pixelX}|${pose.dir}|${pose.phase.toFixed(3)}|${pose.popProgress.toFixed(3)}`;
      if (key === lastKey) return;
      lastKey = key;
      drawPetPose(ctx, pose, prefRef.current, reducedRef.current);
    };

    const startLoop = () => {
      if (disposed || raf || document.hidden) return;
      lastFrameAt = 0;
      // Hidden time is paused: restart from "now" instead of fast-forwarding
      // through the whole time the document was in the background.
      if (stateRef.current) stateRef.current = { ...stateRef.current, lastNow: nowMs() };
      raf = requestAnimationFrame(tick);
    };

    const onVisibilityChange = () => {
      if (document.hidden) stopLoop();
      else startLoop();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    startLoop();
    return () => {
      disposed = true;
      stopLoop();
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2" style={{ width: PET_LOGICAL_W, height: PET_LOGICAL_H }} aria-hidden>
      <canvas ref={canvasRef} width={PET_LOGICAL_W} height={PET_LOGICAL_H} className="block" />
    </div>
  );
};