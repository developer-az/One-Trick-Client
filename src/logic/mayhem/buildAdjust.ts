import type { Build, Item } from '../pykeLogic';
import type { MayhemBundle } from './types';
import { inferAugmentTags } from './synergy';

type TagWeight = Record<string, number>;

const ITEM_BIAS: Array<{ tags: string[]; patterns: RegExp[] }> = [
  {
    tags: ['ap'],
    patterns: [/zhonya|void|rod|rabadon|lich|storm|shadowflame|malignance|nashor|archangel|everfrost|liandry|demonic|cosmic|horizon|cryptbloom|blackfire|hextech|mejais|fimbul|malignance|riftmaker|rylai|statikk|guinsoo|nashor/i],
  },
  {
    tags: ['ad', 'crit'],
    patterns: [/infinity|collector|lord|mortal|essence|bloodthirster|kraken|trinity|cleaver|hubris|youmuu|voltaic|serpent|guardian angel|deaths dance|immortal|navori|phantom|runaan|stormrazor|the collector|hubris|sundered|profane|axiom|edge of night|serylda|mortal reminder/i],
  },
  {
    tags: ['attack_speed'],
    patterns: [/kraken|runaan|phantom|nashor|guinsoo|witts|terminus|blade|statikk|kraken|terminus/i],
  },
  {
    tags: ['tank', 'shield'],
    patterns: [/warmog|thornmail|heartsteel|jaksho|sunfire|force of nature|kaenic|unending|overlord|randuin|frozen heart|iceborn|jak|spirit visage|kaenic|gargoyle|sterak|maw|jaksho|hollow radiance/i],
  },
  {
    tags: ['heal'],
    patterns: [/redemption|ardent|staff of flowing|moonstone|vigilant|blessed|kindlegem|spirit visage|oceanic|perseverance/i],
  },
  {
    tags: ['ultimate'],
    patterns: [/axiom|cosmic|shojin|black cleaver|ability haste|ionian|kindlegem|fiendish|fimbul/i],
  },
];

function tagWeightsFromOwned(ownedIds: string[], bundle: MayhemBundle): TagWeight {
  const weights: TagWeight = {};
  const map = new Map(bundle.augments.map((a) => [a.id, a]));
  for (const id of ownedIds) {
    const aug = map.get(id);
    if (!aug) continue;
    const tags = aug.tags.length
      ? aug.tags
      : inferAugmentTags(aug.id, aug.slug, aug.name);
    for (const tag of tags) {
      weights[tag] = (weights[tag] || 0) + 1;
    }
  }
  return weights;
}

function scoreItemForMayhem(item: Item, weights: TagWeight): number {
  const hay = `${item.name} ${item.id} ${item.icon}`.toLowerCase();
  let score = 0;
  for (const row of ITEM_BIAS) {
    const w = row.tags.reduce((n, t) => n + (weights[t] || 0), 0);
    if (w <= 0) continue;
    if (row.patterns.some((re) => re.test(hay))) score += w * 4;
  }
  return score;
}

function topBiasLabel(weights: TagWeight): string | null {
  const entries = Object.entries(weights).filter(([t]) => t !== 'prismatic_power');
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const [tag] = entries[0];
  const labels: Record<string, string> = {
    ap: 'AP augments',
    ad: 'AD augments',
    attack_speed: 'attack speed',
    tank: 'tank augments',
    heal: 'heal augments',
    shield: 'shield augments',
    ultimate: 'ultimate haste',
    crit: 'crit',
    mobility: 'mobility',
  };
  return labels[tag] || tag.replace(/_/g, ' ');
}

function withMayhemReason(item: Item, bias: string | null): Item {
  if (!bias || !item.reason) {
    return bias ? { ...item, reason: `Mayhem · ${bias}` } : item;
  }
  if (item.reason.toLowerCase().includes('mayhem')) return item;
  return { ...item, reason: `Mayhem · ${bias} — ${item.reason}` };
}

/** Re-order situational (and secondary core) items to match owned augment tags. */
export function adjustBuildForMayhem(
  build: Build | null,
  ownedIds: string[],
  bundle: MayhemBundle
): Build | null {
  if (!build || !ownedIds.length) return build;
  const weights = tagWeightsFromOwned(ownedIds, bundle);
  if (!Object.keys(weights).length) return build;

  const bias = topBiasLabel(weights);
  const sortByMayhem = (items: Item[]): Item[] =>
    [...items].sort((a, b) => scoreItemForMayhem(b, weights) - scoreItemForMayhem(a, weights));

  const core = build.core.length ? [build.core[0], ...sortByMayhem(build.core.slice(1))] : build.core;
  const situational = sortByMayhem(build.situational);

  return {
    ...build,
    core: core.map((i) => withMayhemReason(i, bias)),
    situational: situational.map((i) => withMayhemReason(i, bias)),
    boots: withMayhemReason(build.boots, bias),
    buildPath: sortByMayhem(build.buildPath.length ? build.buildPath : [...core, build.boots, ...situational]),
  };
}
