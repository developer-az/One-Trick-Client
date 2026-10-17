import type { PlayRecapEntry } from '../src/logic/playMoments';

const MAX_RECAP = 40;
let recap: PlayRecapEntry[] = [];

export function appendPlayRecap(entries: PlayRecapEntry[]): void {
  if (!entries.length) return;
  recap = [...recap, ...entries].slice(-MAX_RECAP);
}

export function getPlayRecap(): PlayRecapEntry[] {
  return [...recap];
}

export function clearPlayRecap(): void {
  recap = [];
}
