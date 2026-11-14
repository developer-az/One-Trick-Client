/**
 * Cross-map / roam quality.
 *
 * A roam is only "strong" when the fight can be won without a carry paying for
 * it. If the only version of the play is "our ADC or mid eats the engage and we
 * clean up after", the suggestion gets toned down to vision / tempo instead.
 */

import type { Champion } from './pykeLogic';

export type CrossMapQuality = 'strong' | 'conditional' | 'avoid';

export interface CrossMapRead {
  quality: CrossMapQuality;
  /** One-line headline for cues. */
  headline: string;
  /** Longer advice for the analysis panel. */
  detail: string;
  /** Why the read came out this way — surfaced as tips. */
  notes: string[];
  /** True when a carry has to trade themselves for the play to work. */
  requiresCarrySacrifice: boolean;
}

/** Allies who create a fight with hard, non-suicidal lockdown (ranged/point-click CC). */
const SAFE_SETUP_ALLIES = new Set([
  'Ahri', 'Anivia', 'Annie', 'Ashe', 'Brand', 'Cassiopeia', 'Galio', 'Gragas', 'Hwei', 'Jhin',
  'Karma', 'Lissandra', 'Lux', 'Morgana', 'Neeko', 'Orianna', 'Rell', 'Ryze', 'Seraphine', 'Sett',
  'Swain', 'Syndra', 'Taliyah', 'Twistedfate', 'TwistedFate', 'Varus', 'Veigar', 'Viktor', 'Xerath',
  'Zilean', 'Zoe', 'Zyra', 'Nautilus', 'Thresh', 'Blitzcrank', 'Maokai', 'Amumu', 'Sejuani',
  'JarvanIV', 'Skarner', 'Vi', 'Nunu', 'Zac', 'Wukong', 'Hecarim', 'Poppy', 'RekSai',
]);

/** Allies whose only engage is walking their own body in first (someone eats it). */
const SACRIFICE_ENGAGE_ALLIES = new Set([
  'Alistar', 'Leona', 'Rakan', 'Malphite', 'Kennen', 'Ornn', 'Shyvana', 'Yasuo', 'Yone', 'Tryndamere',
  'MasterYi', 'Katarina', 'Nilah', 'Samira', 'Kalista', 'Aatrox', 'Riven', 'Irelia',
]);

/** Allies who die if they are the first thing the enemy touches. */
const FRAGILE_CARRIES = new Set([
  'Veigar', 'Xerath', 'VelKoz', 'Ziggs', 'Lux', 'Orianna', 'Anivia', 'Heimerdinger', 'Karthus',
  'Jinx', 'Ashe', 'KogMaw', 'Twitch', 'Aphelios', 'Varus', 'Caitlyn', 'Smolder', 'Jhin', 'Zeri',
  'Seraphine', 'Sona', 'Soraka', 'Yuumi', 'Milio',
]);

/** Enemies who punish a failed collapse by deleting whoever showed up first. */
const PUNISH_ENEMIES = new Set([
  'Naafiri', 'Zed', 'Talon', 'Khazix', 'KhaZix', 'Rengar', 'Kayn', 'Nocturne', 'Evelynn', 'Fizz',
  'Akali', 'Qiyana', 'LeBlanc', 'Katarina', 'Yone', 'Yasuo', 'Samira', 'Vladimir', 'Malphite',
  'Amumu', 'Kennen', 'Sett', 'Ornn',
]);

/** Enemies who simply cannot escape a coordinated collapse. */
const IMMOBILE_ENEMIES = new Set([
  'Veigar', 'Xerath', 'VelKoz', 'Annie', 'Malzahar', 'Lux', 'Syndra', 'Viktor', 'Orianna',
  'Anivia', 'Heimerdinger', 'Taliyah', 'Swain', 'Mel', 'Hwei', 'Brand', 'Zyra', 'Karthus',
  'Jinx', 'KogMaw', 'Ashe', 'Twitch', 'Varus', 'Seraphine', 'Sona', 'Soraka', 'Janna', 'Lulu',
]);

export interface CrossMapInput {
  /** Where you would be roaming to (enemy mid / whoever is getting collapsed on). */
  target?: Champion | null;
  /** Allies who would be part of the collapse. */
  allies: Array<Champion | null | undefined>;
  /** Your own carry that stays behind — losing them is the cost of a bad roam. */
  homeCarry?: Champion | null;
  /** Enemy team, for punish reads. */
  enemyTeam: Champion[];
  /** True when your own lane cannot be left for free. */
  hardBot?: boolean;
  /** Game state — behind means a failed roam is unrecoverable. */
  state?: 'behind' | 'even' | 'ahead';
  /** Your ultimate available (Pyke R / Pantheon R make roams free-er). */
  hasUlt?: boolean;
}

function idOf(champ: Champion | null | undefined): string {
  return champ?.id || '';
}

export function evaluateCrossMap(input: CrossMapInput): CrossMapRead {
  const allies = input.allies.filter(Boolean) as Champion[];
  const notes: string[] = [];

  let setup = 0;
  let risk = 0;

  const safeSetupAllies = allies.filter((a) => SAFE_SETUP_ALLIES.has(a.id));
  const sacrificeAllies = allies.filter((a) => SACRIFICE_ENGAGE_ALLIES.has(a.id));

  if (safeSetupAllies.length > 0) {
    setup += 2;
    notes.push(
      `${safeSetupAllies.map((a) => a.name).join(' / ')} can start the fight from range — nobody has to trade their body for it.`
    );
  }
  if (sacrificeAllies.length > 0 && safeSetupAllies.length === 0) {
    risk += 2;
    notes.push(
      `${sacrificeAllies[0].name} only starts fights by walking in first — that play spends a carry to buy the kill.`
    );
  }

  const target = input.target || null;
  if (target) {
    if (IMMOBILE_ENEMIES.has(target.id)) {
      setup += 2;
      notes.push(`${target.name} has no escape — a collapse converts without a trade.`);
    } else {
      risk += 1;
      notes.push(`${target.name} can leave — you need CC first, not a raw walk-in.`);
    }
  } else {
    notes.push('No confirmed roam target — do not leave on hope; ward the path instead.');
  }

  const punishers = input.enemyTeam.filter((c) => PUNISH_ENEMIES.has(c.id));
  if (punishers.length > 0) {
    risk += punishers.length >= 2 ? 2 : 1;
    notes.push(
      `${punishers.map((c) => c.name).join(' / ')} punish a failed collapse — whoever arrives first dies for nothing.`
    );
  }

  const homeCarryFragile = input.homeCarry ? FRAGILE_CARRIES.has(idOf(input.homeCarry)) : false;
  if (homeCarryFragile) {
    risk += 1;
    notes.push(`${input.homeCarry!.name} cannot hold alone — leaving costs them the wave or their life.`);
  }

  if (input.hardBot) {
    setup += 1;
    notes.push('Your own lane is not worth farming — the cross-map is the higher-value clock.');
  }
  if (input.hasUlt) {
    setup += 1;
  } else {
    risk += 1;
    notes.push('No ultimate — you are a body, not a threat. Roam for vision, not for a kill.');
  }
  if (input.state === 'behind') {
    risk += 1;
    notes.push('Behind: a failed roam is a second death lead for them. Only take confirmed fights.');
  } else if (input.state === 'ahead') {
    setup += 1;
  }

  const requiresCarrySacrifice = safeSetupAllies.length === 0 && (sacrificeAllies.length > 0 || risk >= 2);

  let quality: CrossMapQuality;
  if (setup >= 3 && risk <= 1) {
    quality = 'strong';
  } else if (risk >= 3 || (setup <= 1 && risk >= 2)) {
    quality = 'avoid';
  } else {
    quality = 'conditional';
  }

  // A fight that only works if a carry dies first is never "strong".
  if (quality === 'strong' && requiresCarrySacrifice) {
    quality = 'conditional';
  }

  const targetName = target?.name || 'their lane';
  const setupName = safeSetupAllies[0]?.name;

  const headline =
    quality === 'strong'
      ? `Free collapse on ${targetName}`
      : quality === 'conditional'
        ? `Timed roam — ${targetName}`
        : 'Do not roam — take vision';

  const detail =
    quality === 'strong'
      ? `${setupName ? `${setupName} locks, you convert. ` : ''}Crash first, then collapse on ${targetName} — this fight wins without anyone trading themselves.`
      : quality === 'conditional'
        ? `Only leave on a crashed wave with ${setupName ? `${setupName}'s CC up` : 'their escape spent'} — otherwise you are buying a support kill with your carry's life.`
        : `The only version of this fight needs a carry to eat the engage first. Skip it: ward the path, deny their vision, and take the objective clock instead.`;

  return { quality, headline, detail, notes, requiresCarrySacrifice };
}

export interface CrossMapCueInput {
  quality: CrossMapQuality;
  jgHot: boolean;
  junglerName?: string;
  cannonClock?: string;
}

/** Short HUD line for roam vs hold — verb + target + threat/clock. */
export function crossMapCue(input: CrossMapCueInput): { label: string; detail: string } {
  if (input.jgHot) {
    const who = input.junglerName ? ` ${input.junglerName}` : '';
    return {
      label: 'Hold — jg hot',
      detail: `Enemy jg${who} bot side — finish crash, skip river hover.`,
    };
  }
  if (input.quality === 'avoid') {
    return {
      label: 'Hold lane',
      detail: 'Collapse loses without carry setup — ward pit/tri instead.',
    };
  }
  const clock = input.cannonClock ? ` ${input.cannonClock}` : '';
  if (input.quality === 'strong') {
    return {
      label: `Crash${clock}`,
      detail: 'Strong collapse — leave after bot wave dies.',
    };
  }
  return {
    label: `Crash${clock}`,
    detail: 'Timed roam only if bot spells are down.',
  };
}
