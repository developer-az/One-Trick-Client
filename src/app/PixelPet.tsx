import React, { useEffect, useRef } from 'react';
import {
  createPetState,
  petPoseFromState,
  petVisibleForStage,
  stepPet,
  type LeagueStage,
  type PetSettings,
  type PetState,
} from './pixelPetLogic';
import { drawPetPose, PET_LOGICAL_H, PET_LOGICAL_W, preparePetCanvas } from './pixelPetCanvas';

export interface PixelPetProps {
  stage: LeagueStage;
  preference: PetSettings;
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

  useEffect(() => {
    if (mode !== 'live') return;
    if (!visible) {
      stateRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = preparePetCanvas(canvas);
    if (!ctx) return;

    const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
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
  }, [visible, stage, mode]);

  useEffect(() => {
    if (mode !== 'static') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = preparePetCanvas(canvas);
    if (!ctx) return;
    drawPetPose(ctx, { mood: 'idle', x: 0.5, dir: 1, phase: 0.4, popProgress: 0 }, preference, reducedRef.current);
  }, [mode, preference]);

  if (mode === 'live' && !visible) return null;

  return (
    <div className={mode === 'static' ? 'ot-pet-preview' : 'ot-pet-area'} aria-hidden="true">
      <canvas ref={canvasRef} width={PET_LOGICAL_W} height={PET_LOGICAL_H} />
    </div>
  );
};

export default PixelPet;