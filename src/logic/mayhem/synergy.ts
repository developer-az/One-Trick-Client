import type { Champion } from '../pykeLogic';
import type { MayhemAugment } from './types';

/** Keyword → build tag for stacking bonuses between augments you already own. */
const SLUG_TAG_RULES: Array<[RegExp, string]> = [
  [/twin|double.?attack|dual.?wield/i, 'ad'],
  [/crit|lethality|collector|infinity|sword|blade|axe|physical|ad_|_ad|slayer|giant.?slayer/i, 'ad'],
  [/lethality|armor.?pen/i, 'lethality'],
  [/crit|critical/i, 'crit'],
  [/magic|spell|ap_|_ap|arcane|mage|ability.?power|caster/i, 'ap'],
  [/attack.?speed|dual.?wield|on.?hit|auto/i, 'attack_speed'],
  [/heal|regen|lifesteal|omnivamp|sustain|rejuvenat/i, 'heal'],
  [/shield|barrier|guard|protect/i, 'shield'],
  [/ultimate|ult_|_ult|haste|cooldown/i, 'ultimate'],
  [/health|tank|colossus|goliath|max.?hp|overgrowth/i, 'tank'],
  [/move|dash|mobility|quick|speed/i, 'mobility'],
  [/execute|reset|takedown|kill/i, 'reset'],
  [/burn|dot|poison|ignite|vulnerab/i, 'dot'],
  [/summoner|flash|snowball/i, 'summoner'],
];

const STACK_BONUS: Record<string, number> = {
  ad: 14,
  ap: 14,
  crit: 12,
  lethality: 11,
  attack_speed: 12,
  heal: 10,
  shield: 10,
  ultimate: 11,
  tank: 10,
  mobility: 9,
  reset: 13,
  dot: 9,
  summoner: 8,
};

const CHAMP_TAG_AFFINITY: Record<string, string[]> = {
  Assassin: ['ad', 'lethality', 'mobility', 'reset', 'execute'],
  Marksman: ['ad', 'attack_speed', 'crit', 'lethality'],
  Mage: ['ap', 'ultimate', 'dot'],
  Fighter: ['ad', 'tank', 'heal'],
  Tank: ['tank', 'shield', 'heal'],
  Support: ['heal', 'shield', 'ultimate'],
};

export function effectiveAugmentTags(aug: MayhemAugment): string[] {
  if (aug.tags?.length) return aug.tags;
  return inferAugmentTags(aug.id, aug.slug, aug.name);
}

export function inferAugmentTags(augmentId: string, slug: string, name: string): string[] {
  const hay = `${augmentId} ${slug} ${name}`.toLowerCase();
  const tags = new Set<string>();
  for (const [re, tag] of SLUG_TAG_RULES) {
    if (re.test(hay)) tags.add(tag);
  }
  if (/prismatic/i.test(hay) || augmentId.includes('prismatic')) tags.add('prismatic_power');
  return [...tags];
}

export function championAffinityTags(champion: Champion): string[] {
  const out = new Set<string>();
  for (const t of champion.tags || []) {
    for (const a of CHAMP_TAG_AFFINITY[t] || []) out.add(a);
  }
  if (champion.damageType === 'Magic') out.add('ap');
  if (champion.damageType === 'Physical') out.add('ad');
  if (champion.damageType === 'Mixed') {
    out.add('ad');
    out.add('ap');
  }
  return [...out];
}

export function synergyScore(owned: MayhemAugment[], candidate: MayhemAugment): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const ownedTags = new Set(owned.flatMap((a) => effectiveAugmentTags(a)));
  for (const tag of effectiveAugmentTags(candidate)) {
    if (ownedTags.has(tag)) {
      const bump = STACK_BONUS[tag] ?? 6;
      score += bump;
      reasons.push(`Stacks with your ${tag.replace(/_/g, ' ')} augments (+${bump})`);
    }
  }
  return { score, reasons: reasons.slice(0, 3) };
}

export function archetypeFitScore(champion: Champion, candidate: MayhemAugment): { score: number; reasons: string[] } {
  const affinity = new Set(championAffinityTags(champion));
  let score = 0;
  const reasons: string[] = [];
  for (const tag of effectiveAugmentTags(candidate)) {
    if (affinity.has(tag)) {
      score += 8;
      reasons.push(`Fits ${champion.name}'s ${tag.replace(/_/g, ' ')} profile`);
    }
  }
  return { score, reasons: reasons.slice(0, 2) };
}
