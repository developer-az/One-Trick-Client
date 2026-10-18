import type { Champion } from '../pykeLogic';
import {
  archetypeFitScore,
  championAffinityTags,
  effectiveAugmentTags,
  synergyScore,
} from './synergy';
import { isLiveMayhemAugment } from './bundleSanitize';
import type { MayhemAugment, MayhemBundle, MayhemVerdict, RankedMayhemChoice } from './types';

function byId(bundle: MayhemBundle): Map<string, MayhemAugment> {
  return new Map(bundle.augments.map((a) => [a.id, a]));
}

function combosForChampion(bundle: MayhemBundle, championId: string): MayhemBundle['combos'] {
  return bundle.combos.filter((c) => c.championId === championId);
}

function augmentName(map: Map<string, MayhemAugment>, id: string): string {
  return map.get(id)?.name || id;
}

function comboTypeLabel(types: string[]): string {
  return types.length ? types.join(' · ') : 'combo';
}

function isTrapCombo(types: string[]): boolean {
  return types.includes('trap') || types.includes('bug');
}

function singleAugmentComboBump(types: string[]): number | null {
  if (types.includes('god')) return 28;
  if (types.includes('strong')) return 22;
  if (types.includes('blackTech')) return 14;
  if (types.includes('entertainment')) return 8;
  if (isTrapCombo(types)) return -42;
  return null;
}

function comboBonus(
  championId: string,
  ownedIds: Set<string>,
  candidateId: string,
  bundle: MayhemBundle,
  map: Map<string, MayhemAugment>
): { score: number; reasons: string[]; headline: string | null } {
  const reasons: string[] = [];
  let score = 0;
  let headline: string | null = null;

  for (const combo of combosForChampion(bundle, championId)) {
    if (!combo.augmentIds.includes(candidateId)) continue;
    if (!combo.augmentIds.every((id) => map.has(id))) continue;

    const total = combo.augmentIds.length;
    if (total === 0) continue;

    if (total === 1) {
      const bump = singleAugmentComboBump(combo.types);
      if (bump == null) continue;
      if (bump > score || (bump < 0 && bump < score)) {
        score = bump;
        const typeLabel = comboTypeLabel(combo.types);
        if (bump < 0) {
          headline = `Editorial trap on ${championId} — usually a bait pick`;
          reasons.push(`arammayhem.com tags this as ${typeLabel}; skip unless you know the niche`);
        } else if (combo.types.includes('god')) {
          headline = `Top-tier ${typeLabel} pick for ${championId}`;
          reasons.push(headline);
        } else {
          headline = `Strong ${typeLabel} pick for ${championId}`;
          reasons.push(headline);
        }
      }
      continue;
    }

    const after = new Set(ownedIds);
    after.add(candidateId);
    const matched = combo.augmentIds.filter((id) => after.has(id)).length;
    if (isTrapCombo(combo.types) && matched === total) {
      const penalty = -30;
      if (penalty < score) {
        score = penalty;
        headline = `Trap combo on ${championId} — usually a bait pick`;
        reasons.push(headline);
      }
      continue;
    }

    const typeBonus = combo.types.includes('strong')
      ? 12
      : combo.types.includes('god')
        ? 10
        : combo.types.includes('blackTech')
          ? 8
          : 5;
    const progress = matched / total;
    let bump = Math.round(18 * progress + typeBonus);
    if (matched === total) bump += 14;

    if (bump > score) {
      score = bump;
      const ownedNames = combo.augmentIds
        .filter((id) => ownedIds.has(id) && id !== candidateId)
        .map((id) => augmentName(map, id));
      const typeLabel = comboTypeLabel(combo.types);
      if (matched === total) {
        headline = `Completes ${championId} ${typeLabel} (${total}/${total})`;
        reasons.push(headline);
      } else if (ownedNames.length) {
        headline = `Links with ${ownedNames.join(' + ')} (${matched}/${total} of ${typeLabel})`;
        reasons.push(headline);
      } else {
        headline = `Listed ${typeLabel} for ${championId} (${matched}/${total})`;
        reasons.push(headline);
      }
    }
  }

  return { score, reasons: reasons.slice(0, 2), headline };
}

/** Augments that need burn/DoT (items or kit) — not direct burst ADCs like Samira. */
const DOT_SYNERGY_AUGMENT_IDS = new Set(['vulnerability']);

/** AD-only augments that read well on AP mages due to global pick rate noise. */
const AD_ONLY_AUGMENT_IDS = new Set([
  'twin_fire',
  'giant_slayer',
  'bloodthirster',
  'kraken_slayer',
]);

function kitMismatchPenalty(
  champion: Champion,
  candidateId: string,
  candidate: MayhemAugment
): { score: number; reason: string | null } {
  const candTags = effectiveAugmentTags(candidate);
  const adHeavy = candTags.includes('ad') || AD_ONLY_AUGMENT_IDS.has(candidateId);
  if (!adHeavy) return { score: 0, reason: null };

  const affinity = new Set(championAffinityTags(champion));
  const mageCarry =
    champion.damageType === 'Magic' ||
    (champion.tags?.includes('Mage') && !champion.tags?.includes('Marksman'));
  if (!mageCarry || affinity.has('ad')) return { score: 0, reason: null };

  return {
    score: -14,
    reason: `${candidate.name} is AD-focused — weak on ${champion.name}'s AP kit`,
  };
}

function dotSynergyPenalty(
  champion: Champion,
  owned: MayhemAugment[],
  candidateId: string
): { score: number; reason: string | null } {
  if (!DOT_SYNERGY_AUGMENT_IDS.has(candidateId)) return { score: 0, reason: null };
  const affinity = new Set(championAffinityTags(champion));
  const ownedDot = owned.some((a) => effectiveAugmentTags(a).includes('dot'));
  if (affinity.has('dot') || ownedDot) return { score: 0, reason: null };
  return {
    score: -18,
    reason: 'Vulnerability wants burn/DoT — your build is burst/crit, not ticks',
  };
}

function pickRateScore(
  aug: MayhemAugment,
  rollMode: boolean,
  hasEditorialSignal: boolean
): { score: number; reason: string | null } {
  const rank = aug.pickRateRank || 200;
  let score = Math.max(0, Math.min(8, 8 - rank * 0.05));
  if (rollMode && hasEditorialSignal) score *= 0.12;
  else if (rollMode) score *= 0.35;
  if (!rollMode && rank <= 30 && !hasEditorialSignal) {
    return { score, reason: `Global pick rate #${rank} (not champ-specific)` };
  }
  if (rollMode && rank <= 15 && !hasEditorialSignal) return { score: score + 1, reason: null };
  return { score, reason: null };
}

function resolveAugments(ids: string[], map: Map<string, MayhemAugment>): MayhemAugment[] {
  return ids.map((id) => map.get(id)).filter((a): a is MayhemAugment => !!a);
}

function withEffectiveTags(owned: MayhemAugment[], candidate: MayhemAugment): ReturnType<typeof synergyScore> {
  const ownedTagged = owned.map((a) => ({ ...a, tags: effectiveAugmentTags(a) }));
  const candTagged = { ...candidate, tags: effectiveAugmentTags(candidate) };
  return synergyScore(ownedTagged, candTagged);
}

function withEffectiveFit(champion: Champion, candidate: MayhemAugment): ReturnType<typeof archetypeFitScore> {
  return archetypeFitScore(champion, { ...candidate, tags: effectiveAugmentTags(candidate) });
}

function applyVerdicts(rows: RankedMayhemChoice[], rollMode: boolean): RankedMayhemChoice[] {
  if (!rows.length) return rows;
  const top = rows[0].score;
  const allWeak = top < 0;
  return rows.map((row, i) => {
    const rank = i + 1;
    let verdict: MayhemVerdict = 'skip';
    if (allWeak) verdict = 'skip';
    else if (rank === 1) verdict = 'pick';
    else if (rollMode && top - row.score <= 6) verdict = 'alt';

    let headline = row.headline;
    if (!headline) {
      if (verdict === 'pick') headline = rollMode ? 'Best on this roll' : 'Top suggestion';
      else if (verdict === 'alt') headline = 'Close second — only if you hate #1';
      else headline = 'No combo link — skip unless desperate';
    }

    return { ...row, rank, verdict, headline };
  });
}

export function rankMayhemChoices(
  champion: Champion,
  ownedIds: string[],
  candidateIds: string[],
  bundle: MayhemBundle
): RankedMayhemChoice[] {
  const map = byId(bundle);
  const ownedSet = new Set(ownedIds);
  const owned = resolveAugments(ownedIds, map);
  const uniqueCandidates = [...new Set(candidateIds)].filter((id) => map.has(id));
  const rollMode = uniqueCandidates.length > 0 && uniqueCandidates.length <= 3;

  const ranked: RankedMayhemChoice[] = uniqueCandidates.map((id) => {
    const aug = map.get(id)!;
    const reasons: string[] = [];
    let score = 0;
    let headline: string | null = null;

    const combo = comboBonus(champion.id, ownedSet, id, bundle, map);
    score += combo.score;
    reasons.push(...combo.reasons);
    headline = combo.headline;

    const dotPen = dotSynergyPenalty(champion, owned, id);
    score += dotPen.score;
    if (dotPen.reason) {
      reasons.push(dotPen.reason);
      if (!headline || combo.score >= 0) headline = dotPen.reason;
    }

    const kitPen = kitMismatchPenalty(champion, id, aug);
    score += kitPen.score;
    if (kitPen.reason) {
      reasons.push(kitPen.reason);
      if (!headline || kitPen.score < 0) headline = kitPen.reason;
    }

    const syn = withEffectiveTags(owned, aug);
    score += syn.score;
    if (syn.reasons[0] && !headline) headline = syn.reasons[0];
    reasons.push(...syn.reasons);

    const fit = withEffectiveFit(champion, aug);
    score += fit.score;
    reasons.push(...fit.reasons);

    const hasEditorialSignal = Math.abs(combo.score) >= 8;
    const pick = pickRateScore(aug, rollMode, hasEditorialSignal);
    score += pick.score;
    if (pick.reason) reasons.push(pick.reason);

    if (ownedSet.has(id)) {
      score -= 80;
      headline = 'Already owned';
      reasons.unshift('Already owned');
    }

    return {
      augmentId: id,
      name: aug.name,
      rarity: aug.rarity,
      score: Math.round(score * 10) / 10,
      reasons: [...new Set(reasons)].slice(0, 4),
      headline: headline ?? aug.name,
      rank: 0,
      verdict: 'skip',
    };
  });

  const sorted = ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return applyVerdicts(sorted, rollMode);
}

/** Browse mode: best augments for a champ given what you already have. */
function browseCandidateIds(championId: string, ownedIds: Set<string>, bundle: MayhemBundle): string[] {
  const fromCombos = new Set<string>();
  for (const combo of bundle.combos) {
    if (combo.championId !== championId) continue;
    for (const id of combo.augmentIds) {
      if (!ownedIds.has(id)) fromCombos.add(id);
    }
  }
  const live = bundle.augments.filter((a) => isLiveMayhemAugment(a) && !ownedIds.has(a.id));
  const ordered = live
    .slice()
    .sort((a, b) => a.pickRateRank - b.pickRateRank)
    .map((a) => a.id);
  const out: string[] = [];
  for (const id of fromCombos) {
    if (live.some((a) => a.id === id)) out.push(id);
  }
  for (const id of ordered) {
    if (!out.includes(id)) out.push(id);
    if (out.length >= 48) break;
  }
  return out;
}

export function suggestMayhemAugments(
  champion: Champion,
  ownedIds: string[],
  bundle: MayhemBundle,
  limit = 12
): RankedMayhemChoice[] {
  const ownedSet = new Set(ownedIds);
  const candidates = browseCandidateIds(champion.id, ownedSet, bundle);
  return rankMayhemChoices(champion, ownedIds, candidates, bundle).slice(0, limit);
}

export function findAugment(query: string, bundle: MayhemBundle): MayhemAugment | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const pool = bundle.augments.filter(isLiveMayhemAugment);
  const exact = pool.find((a) => a.id === q || a.slug === q || a.name.toLowerCase() === q);
  if (exact) return exact;
  const partial = pool.filter(
    (a) => a.name.toLowerCase().includes(q) || a.slug.includes(q.replace(/\s+/g, '-'))
  );
  partial.sort((a, b) => a.pickRateRank - b.pickRateRank);
  return partial[0] || null;
}

export function searchAugments(query: string, bundle: MayhemBundle, limit = 12): MayhemAugment[] {
  const q = query.trim().toLowerCase();
  const live = bundle.augments.filter(isLiveMayhemAugment);
  if (!q) return live.slice().sort((a, b) => a.pickRateRank - b.pickRateRank).slice(0, limit);
  return live
    .filter((a) => a.name.toLowerCase().includes(q) || a.slug.includes(q.replace(/\s+/g, '-')))
    .sort((a, b) => a.pickRateRank - b.pickRateRank)
    .slice(0, limit);
}
