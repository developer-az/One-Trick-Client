import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { sanitizeMayhemBundle } from '../src/logic/mayhem/bundleSanitize';
import { slimMayhemFromApi } from '../src/logic/mayhem/remote';
import type { MayhemBundle as TypedMayhemBundle } from '../src/logic/mayhem/types';

const AUG_URL = 'https://arammayhem.com/data/v1/latest/augments.json';
const COMBO_URL = 'https://arammayhem.com/data/v1/latest/combos.json';

export type MayhemBundle = {
  meta: {
    patch: string;
    statsDate: string;
    attribution: string;
    source: string;
    syncedAt: string;
  };
  augments: Array<{
    id: string;
    slug: string;
    name: string;
    rarity: string;
    pickRate: number;
    pickRateRank: number;
    tags: string[];
  }>;
  combos: Array<{ championId: string; augmentIds: string[]; types: string[] }>;
};

let memory: MayhemBundle | null = null;

function cachePath(): string {
  return path.join(app.getPath('userData'), 'mayhem-bundle.json');
}

function bundledPaths(): string[] {
  const root = app.getAppPath();
  return [path.join(root, 'src', 'data', 'mayhem', 'bundle.json'), path.join(root, 'dist', 'data', 'mayhem', 'bundle.json')];
}

async function readJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}


function readBundled(): MayhemBundle | null {
  for (const p of bundledPaths()) {
    try {
      const raw = fs.readFileSync(p, 'utf8');
      return JSON.parse(raw) as MayhemBundle;
    } catch {
      /* try next */
    }
  }
  return null;
}

function readCache(): MayhemBundle | null {
  if (memory) return memory;
  try {
    const raw = fs.readFileSync(cachePath(), 'utf8');
    const parsed = JSON.parse(raw) as MayhemBundle;
    if (parsed.augments?.length) {
      memory = parsed;
      return memory;
    }
  } catch {
    /* no cache */
  }
  return null;
}

function writeCache(bundle: MayhemBundle): void {
  memory = bundle;
  try {
    fs.writeFileSync(cachePath(), JSON.stringify(bundle), 'utf8');
  } catch (error) {
    console.warn('[mayhem] cache write failed:', error);
  }
}

function normalizeBundle(raw: MayhemBundle | null): MayhemBundle | null {
  if (!raw?.augments?.length) return null;
  return sanitizeMayhemBundle(raw as TypedMayhemBundle) as MayhemBundle;
}

export function loadMayhemBundle(): MayhemBundle | null {
  return normalizeBundle(readCache() || readBundled());
}

export async function refreshMayhemBundle(): Promise<{ bundle: MayhemBundle; fromNetwork: boolean }> {
  try {
    const [augDoc, comboDoc] = await Promise.all([readJson(AUG_URL), readJson(COMBO_URL)]);
    const bundle = slimMayhemFromApi(augDoc, comboDoc) as MayhemBundle;
    writeCache(bundle);
    return { bundle, fromNetwork: true };
  } catch (error) {
    console.warn('[mayhem] refresh failed:', error);
    const fallback = readCache() || readBundled();
    if (!fallback) throw error;
    return { bundle: fallback, fromNetwork: false };
  }
}
