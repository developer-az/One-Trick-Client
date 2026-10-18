export type MayhemRarity = 'silver' | 'gold' | 'prismatic';

export interface MayhemAugment {
  id: string;
  slug: string;
  name: string;
  rarity: MayhemRarity;
  pickRate: number;
  pickRateRank: number;
  tags: string[];
  /** Retired augment kept only so editorial combos still resolve — never suggest in browse. */
  legacy?: boolean;
}

export interface MayhemCombo {
  championId: string;
  augmentIds: string[];
  types: string[];
}

export interface MayhemBundle {
  meta: {
    patch: string;
    statsDate: string;
    attribution: string;
    source: string;
    syncedAt: string;
  };
  augments: MayhemAugment[];
  combos: MayhemCombo[];
}

export type MayhemVerdict = 'pick' | 'alt' | 'skip';

export interface RankedMayhemChoice {
  augmentId: string;
  name: string;
  rarity: MayhemRarity;
  score: number;
  /** 1 = best on this roll */
  rank: number;
  verdict: MayhemVerdict;
  /** One-line call for overlay / HUD */
  headline: string;
  reasons: string[];
}
