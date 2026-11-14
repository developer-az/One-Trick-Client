import React, { useEffect, useRef } from 'react';
import {
  createPetState,
  petPoseFromState,
  stepPet,
  type PetSettings,
  type PetState,
} from '../app/pixelPetLogic';
import { drawPetPose, PET_LOGICAL_H, PET_LOGICAL_W, preparePetCanvas } from '../app/pixelPetCanvas';

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
    let lastKey = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
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
      const key = `${prefRef.current.species}|${prefRef.current.color}|${pose.mood}|${pose.x.toFixed(3)}|${pose.dir}|${pose.phase.toFixed(3)}|${pose.popProgress.toFixed(3)}`;
      if (key === lastKey) return;
      lastKey = key;
      drawPetPose(ctx, pose, prefRef.current, reducedRef.current);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 -translate-x-1/2" style={{ width: PET_LOGICAL_W, height: PET_LOGICAL_H }} aria-hidden>
      <canvas ref={canvasRef} width={PET_LOGICAL_W} height={PET_LOGICAL_H} className="block" />
    </div>
  );
};