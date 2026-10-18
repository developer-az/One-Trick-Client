import { app } from 'electron';
import fs from 'fs';
import path from 'path';

interface MayhemPersist {
  owned?: string[];
  roll?: string[];
  /** Augment slots consumed this match (when Live Client does not list owned augments). */
  picksTaken?: number;
}

const FILE = (): string => path.join(app.getPath('userData'), 'mayhem-owned.json');

function read(): MayhemPersist {
  try {
    const raw = fs.readFileSync(FILE(), 'utf8');
    return JSON.parse(raw) as MayhemPersist;
  } catch {
    return {};
  }
}

function write(data: MayhemPersist): void {
  try {
    fs.writeFileSync(FILE(), JSON.stringify(data), 'utf8');
  } catch (error) {
    console.warn('[mayhem] failed to save state:', error);
  }
}

export function getOwnedMayhemAugmentIds(): string[] {
  const owned = read().owned;
  return Array.isArray(owned) ? owned.filter((x) => typeof x === 'string') : [];
}

export function setOwnedMayhemAugmentIds(ids: string[]): void {
  const data = read();
  data.owned = ids;
  write(data);
}

export function getMayhemPicksTaken(): number {
  const n = read().picksTaken;
  return typeof n === 'number' && n >= 0 ? Math.min(4, Math.floor(n)) : 0;
}

export function setMayhemPicksTaken(count: number): void {
  const data = read();
  data.picksTaken = Math.max(0, Math.min(4, Math.floor(count)));
  write(data);
}

export function resetMayhemMatchState(): void {
  const data = read();
  data.roll = [];
  data.picksTaken = 0;
  write(data);
}

export function getMayhemRollIds(): string[] {
  const roll = read().roll;
  return Array.isArray(roll) ? roll.filter((x) => typeof x === 'string') : [];
}

export function setMayhemRollIds(ids: string[]): void {
  const data = read();
  data.roll = ids;
  write(data);
}

export function mergedMayhemOfferIds(ocrIds: string[]): string[] {
  const roll = getMayhemRollIds();
  const out: string[] = [];
  for (const id of [...ocrIds, ...roll]) {
    if (id && !out.includes(id)) out.push(id);
  }
  return out.slice(0, 3);
}
