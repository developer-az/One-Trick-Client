/**
 * Enemy jungler pathing / gank-angle heuristics.
 * Live Client has no camp timers — we use per-jungler clear templates + clock + CS.
 *
 * Gank probability levels:
 * - low: farm path / away from lane
 * - medium (yellow): fog risk / low vision — play respectful
 * - high (red): brief window only — expect the gank now
 */

export type GankRisk = 'low' | 'medium' | 'high';

export interface JungleThreat {
  junglerName: string;
  sideBias: 'bot' | 'top' | 'mid' | 'unknown';
  gankRisk: GankRisk;
  /** 0–100 score for UI meters */
  probability: number;
  label: string;
  detail: string;
  /** Short reason for the colored square */
  squareReason: string;
  clearStyle: JunglerClearStyle;
}

export type JunglerClearStyle = 'early-gank' | 'full-clear' | 'invade' | 'power-farm' | 'flex';

export interface JunglerPathProfile {
  id: string;
  style: JunglerClearStyle;
  /** Typical first gank minute window [start, end] */
  firstGank: [number, number];
  /** Preferred first-scuttle / first-gank side */
  preferBot: boolean;
  /** Seconds the HIGH (red) window should stay hot once entered */
  redWindowSec: number;
  notes: string;
}

/** Per-jungler clear / gank templates — skip generic advice; these drive the square. */
const JUNGLER_DB: Record<string, JunglerPathProfile> = {
  leesin: { id: 'LeeSin', style: 'early-gank', firstGank: [3.0, 4.2], preferBot: true, redWindowSec: 45, notes: '3-camp into bot/mid — punish overextends before 4:00.' },
  xinzhao: { id: 'XinZhao', style: 'early-gank', firstGank: [3.0, 4.5], preferBot: true, redWindowSec: 50, notes: 'Early dive bot — flash angles matter.' },
  elise: { id: 'Elise', style: 'early-gank', firstGank: [3.0, 4.0], preferBot: true, redWindowSec: 40, notes: 'Level 3 gank specialist — ward before trading.' },
  reksai: { id: 'RekSai', style: 'early-gank', firstGank: [3.2, 4.5], preferBot: true, redWindowSec: 45, notes: 'Tunnel ganks — river/tri info is everything.' },
  jarvaniv: { id: 'JarvanIV', style: 'early-gank', firstGank: [3.2, 4.8], preferBot: true, redWindowSec: 50, notes: 'EQ engage — hold flash until EQ is spent.' },
  pantheon: { id: 'Pantheon', style: 'early-gank', firstGank: [2.8, 4.0], preferBot: true, redWindowSec: 40, notes: 'Level 2–3 cheese — respect fog until tracked.' },
  nidalee: { id: 'Nidalee', style: 'invade', firstGank: [3.5, 5.0], preferBot: false, redWindowSec: 35, notes: 'Invade + spear poke — track from scuttle fights.' },
  graves: { id: 'Graves', style: 'power-farm', firstGank: [4.5, 6.5], preferBot: false, redWindowSec: 35, notes: 'Farms to spike — mid/bot after first back item.' },
  kindred: { id: 'Kindred', style: 'early-gank', firstGank: [3.5, 5.0], preferBot: true, redWindowSec: 40, notes: 'Mark hunts — she paths to marked lane.' },
  vi: { id: 'Vi', style: 'early-gank', firstGank: [3.5, 5.0], preferBot: true, redWindowSec: 45, notes: 'R is a free engage — flash when R is up.' },
  warwick: { id: 'Warwick', style: 'early-gank', firstGank: [3.0, 4.5], preferBot: true, redWindowSec: 50, notes: 'Blood scent — low HP invites him.' },
  rengar: { id: 'Rengar', style: 'invade', firstGank: [3.5, 5.5], preferBot: true, redWindowSec: 40, notes: 'Brush hops — deny river brush control.' },
  evelynn: { id: 'Evelynn', style: 'power-farm', firstGank: [6.0, 8.0], preferBot: true, redWindowSec: 55, notes: 'Post-6 invis — pink + sweep before fights.' },
  ekko: { id: 'Ekko', style: 'early-gank', firstGank: [3.5, 5.0], preferBot: true, redWindowSec: 40, notes: 'W stun ganks — play outside W circle.' },
  shaco: { id: 'Shaco', style: 'invade', firstGank: [2.5, 4.0], preferBot: true, redWindowSec: 40, notes: 'Box cheese — sweep bushes before walking up.' },
  masteryi: { id: 'MasterYi', style: 'full-clear', firstGank: [5.5, 7.5], preferBot: false, redWindowSec: 35, notes: 'Full clear then side — low early threat.' },
  kayn: { id: 'Kayn', style: 'full-clear', firstGank: [4.5, 6.5], preferBot: true, redWindowSec: 40, notes: 'Wall walks after form — track form timer.' },
  karthus: { id: 'Karthus', style: 'full-clear', firstGank: [5.0, 7.0], preferBot: false, redWindowSec: 30, notes: 'Power farms — R is the lane threat, not pathing.' },
  belveth: { id: 'BelVeth', style: 'power-farm', firstGank: [4.5, 6.5], preferBot: true, redWindowSec: 40, notes: 'Fast clears into crash ganks.' },
  lillia: { id: 'Lillia', style: 'full-clear', firstGank: [5.0, 7.0], preferBot: false, redWindowSec: 35, notes: 'Full clear into skirmish — mid river more than bot.' },
  amumu: { id: 'Amumu', style: 'full-clear', firstGank: [5.0, 7.5], preferBot: true, redWindowSec: 45, notes: 'R engage after clear — respect group fights.' },
  fiddlesticks: { id: 'Fiddlesticks', style: 'full-clear', firstGank: [5.5, 8.0], preferBot: true, redWindowSec: 50, notes: 'Point-and-click fear from fog — sweep before obj.' },
  ivern: { id: 'Ivern', style: 'flex', firstGank: [3.5, 5.0], preferBot: true, redWindowSec: 40, notes: 'Shield ganks early — track daisy later.' },
  udyr: { id: 'Udyr', style: 'power-farm', firstGank: [4.0, 6.0], preferBot: true, redWindowSec: 40, notes: 'Fast clear pressure — leave on crash if missing.' },
  volibear: { id: 'Volibear', style: 'early-gank', firstGank: [3.2, 4.8], preferBot: true, redWindowSec: 45, notes: 'Tower dive specialist — respect when he is bot side.' },
  hecarim: { id: 'Hecarim', style: 'early-gank', firstGank: [3.5, 5.0], preferBot: true, redWindowSec: 45, notes: 'E charge from fog — deep ward raptors on shove.' },
  nocturne: { id: 'Nocturne', style: 'power-farm', firstGank: [6.0, 8.0], preferBot: true, redWindowSec: 50, notes: 'Post-6 R — darken = leave or flash pre-R.' },
  khazix: { id: 'KhaZix', style: 'invade', firstGank: [3.5, 5.5], preferBot: true, redWindowSec: 40, notes: 'Isolation paths — stay near ally when missing.' },
  qiyana: { id: 'Qiyana', style: 'early-gank', firstGank: [3.5, 5.0], preferBot: true, redWindowSec: 40, notes: 'River element ganks — river brush control.' },
  viego: { id: 'Viego', style: 'flex', firstGank: [4.0, 6.0], preferBot: true, redWindowSec: 40, notes: 'Skirmish hopper — reset fights invite him.' },
  diana: { id: 'Diana', style: 'full-clear', firstGank: [5.0, 7.0], preferBot: true, redWindowSec: 40, notes: 'Clear then R engage — group carefully.' },
  shyvana: { id: 'Shyvana', style: 'power-farm', firstGank: [5.5, 8.0], preferBot: false, redWindowSec: 35, notes: 'Farms dragons — track mark, not early ganks.' },
  zac: { id: 'Zac', style: 'early-gank', firstGank: [3.5, 5.0], preferBot: true, redWindowSec: 45, notes: 'E blob from fog — deep vision on shove.' },
  sejuani: { id: 'Sejuani', style: 'full-clear', firstGank: [4.5, 6.5], preferBot: true, redWindowSec: 40, notes: 'Engage tank — respect R in river fights.' },
  maokai: { id: 'Maokai', style: 'full-clear', firstGank: [4.5, 6.5], preferBot: true, redWindowSec: 40, notes: 'Sapling vision + R — clear river before obj.' },
  poppy: { id: 'Poppy', style: 'flex', firstGank: [3.5, 5.5], preferBot: true, redWindowSec: 40, notes: 'Wall pins — don’t hug walls when missing.' },
  trundle: { id: 'Trundle', style: 'flex', firstGank: [3.5, 5.5], preferBot: true, redWindowSec: 40, notes: 'Pillar peels — contest crab carefully.' },
  nunu: { id: 'Nunu', style: 'early-gank', firstGank: [3.0, 4.5], preferBot: true, redWindowSec: 45, notes: 'Snowball mid/bot — ping when he rolls.' },
  nunuwillump: { id: 'Nunu', style: 'early-gank', firstGank: [3.0, 4.5], preferBot: true, redWindowSec: 45, notes: 'Snowball mid/bot — ping when he rolls.' },
  jarvan: { id: 'JarvanIV', style: 'early-gank', firstGank: [3.2, 4.8], preferBot: true, redWindowSec: 50, notes: 'EQ engage — hold flash until EQ is spent.' },
};

const EARLY_FALLBACK = new Set(
  ['leesin', 'xinzhao', 'elise', 'reksai', 'jarvaniv', 'pantheon', 'vi', 'warwick', 'rengar', 'ekko', 'shaco', 'hecarim', 'zac', 'nunu', 'nunuwillump'].map(
    (n) => n
  )
);

const FARM_FALLBACK = new Set(
  ['masteryi', 'kayn', 'karthus', 'belveth', 'lillia', 'amumu', 'fiddlesticks', 'ivern', 'skarner', 'udyr', 'volibear', 'graves', 'shyvana', 'diana'].map(
    (n) => n
  )
);

function norm(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** When a HIGH window opens, hold it for profile.redWindowSec of game time. */
let highRiskSinceGameTime: number | null = null;

export function resetJungleThreatClock(): void {
  highRiskSinceGameTime = null;
}

function profileFor(name: string): JunglerPathProfile | null {
  const n = norm(name);
  if (JUNGLER_DB[n]) return JUNGLER_DB[n];
  if (EARLY_FALLBACK.has(n)) {
    return {
      id: name,
      style: 'early-gank',
      firstGank: [3.0, 4.5],
      preferBot: true,
      redWindowSec: 40,
      notes: `${name} early pressure — ward before extending.`,
    };
  }
  if (FARM_FALLBACK.has(n)) {
    return {
      id: name,
      style: 'full-clear',
      firstGank: [5.0, 7.0],
      preferBot: false,
      redWindowSec: 35,
      notes: `${name} farms first — low early bot threat.`,
    };
  }
  return null;
}

/**
 * Estimate whether enemy jg is threatening the focus lane.
 * Red (high) only fires inside brief templated windows — yellow covers fog risk.
 */
function hasSmite(e: {
  summonerSpells?: {
    summonerSpellOne?: { displayName?: string };
    summonerSpellTwo?: { displayName?: string };
  };
}): boolean {
  const a = (e.summonerSpells?.summonerSpellOne?.displayName || '').toLowerCase();
  const b = (e.summonerSpells?.summonerSpellTwo?.displayName || '').toLowerCase();
  return a.includes('smite') || b.includes('smite');
}

export function assessJungleThreat(
  gameTime: number,
  enemies: Array<{
    championName: string;
    level?: number;
    position?: string;
    scores?: { creepScore?: number };
    summonerSpells?: {
      summonerSpellOne?: { displayName?: string };
      summonerSpellTwo?: { displayName?: string };
    };
    isDead?: boolean;
  }>,
  focusLane: 'bot' | 'mid' | 'top' = 'bot'
): JungleThreat | null {
  const smiteHolders = enemies.filter((e) => hasSmite(e));
  const jungleTagged = enemies.filter((e) => {
    const p = (e.position || '').toUpperCase();
    return p === 'JUNGLE' || p === 'JNG';
  });
  const jg =
    jungleTagged.find((e) => hasSmite(e)) ||
    jungleTagged[0] ||
    (smiteHolders.length === 1 ? smiteHolders[0] : null) ||
    enemies.find((e) => profileFor(e.championName) != null);

  if (!jg) {
    // Still surface a dim fog square so the rail isn't empty when jg is unknown
    if (gameTime <= 0 || enemies.length === 0) return null;
    return {
      junglerName: 'Enemy jg',
      sideBias: 'unknown',
      gankRisk: 'medium',
      probability: 35,
      label: 'Fog — jg unknown',
      detail: 'No Smite / jg role yet — play like river is contested.',
      squareReason: 'Fog risk',
      clearStyle: 'flex',
    };
  }

  if (jg.isDead) {
    return {
      junglerName: jg.championName,
      sideBias: 'unknown',
      gankRisk: 'low',
      probability: 12,
      label: 'Jg down',
      detail: `${jg.championName} dead — window to shove / invade.`,
      squareReason: 'Jg respawn',
      clearStyle: profileFor(jg.championName)?.style || 'flex',
    };
  }

  const minutes = gameTime / 60;
  const name = jg.championName;
  const profile = profileFor(name);
  const style = profile?.style || 'flex';
  const cs = jg.scores?.creepScore ?? 0;
  const level = jg.level ?? 1;

  let sideBias: JungleThreat['sideBias'] = 'unknown';
  let gankRisk: GankRisk = 'low';
  let probability = 15;
  let label = 'Track jg';
  let detail = `${name} — watch river.`;
  let squareReason = 'Farm path';

  const preferBot = profile?.preferBot ?? true;
  const [gankStart, gankEnd] = profile?.firstGank || [3.2, 4.8];
  const early = style === 'early-gank' || style === 'invade';
  const farm = style === 'full-clear' || style === 'power-farm';

  // Scuttle contest
  if (minutes >= 2.1 && minutes <= 3.15) {
    sideBias = preferBot ? 'bot' : 'top';
    if (focusLane === 'bot' && preferBot) {
      gankRisk = early ? 'high' : 'medium';
      probability = early ? 78 : 55;
      label = early ? 'Jg bot crab' : 'Scuttle window';
      squareReason = early ? 'Crab contest — leave river' : 'Scuttle fog';
      detail = profile?.notes || `${name} toward first crab — ward pixel ~2:15.`;
    } else if (focusLane === 'mid' || focusLane === 'top') {
      gankRisk = 'medium';
      probability = focusLane === 'top' ? 45 : 50;
      label = focusLane === 'top' ? 'Top river / crab' : 'Scuttle / mid river';
      squareReason = 'River fog';
      detail = `${name} crab fight — short trades only with river ward.`;
    }
  } else if (minutes >= gankStart && minutes <= gankEnd) {
    // Templated first-gank window — RED only here (and CS-missing spike)
    sideBias = preferBot ? 'bot' : focusLane === 'mid' ? 'mid' : 'top';
    const laneMatch =
      (focusLane === 'bot' && preferBot) ||
      (focusLane === 'mid' && (sideBias === 'mid' || !preferBot)) ||
      focusLane === 'bot';

    if (laneMatch && early) {
      gankRisk = 'high';
      probability = 85;
      label = 'First gank window';
      squareReason = `${name} first gank`;
      detail = profile?.notes || `${name} classic first gank — hold flash, ward tri/river.`;
    } else if (farm) {
      gankRisk = 'low';
      probability = 25;
      label = 'Full-clear path';
      squareReason = 'Farming';
      detail = profile?.notes || `${name} full-clear — low threat until ~${gankEnd.toFixed(0)}.`;
    } else {
      gankRisk = 'medium';
      probability = 55;
      label = 'Possible gank';
      squareReason = 'Fog risk';
      detail = `${name} can appear after first clear — play fog edges.`;
    }
  } else if (minutes > 5.5 && minutes <= 7.5) {
    sideBias = focusLane === 'mid' ? 'mid' : 'bot';
    gankRisk = 'medium';
    probability = 58;
    label = 'Second clear';
    squareReason = 'Second clear fog';
    detail = `${name} Lv${level} — ${focusLane} angle after second clear. Deep ward if pushing.`;
  } else if (minutes >= 7.5 && minutes <= 9.5) {
    sideBias = 'bot';
    gankRisk = 'medium';
    probability = 52;
    label = 'Grub / river';
    squareReason = 'Objective path';
    detail = `${name} objective path — leave on crash if missing.`;
  } else if (minutes >= 12 && minutes <= 16) {
    sideBias = 'bot';
    gankRisk = focusLane === 'bot' ? 'high' : 'medium';
    probability = focusLane === 'bot' ? 80 : 55;
    label = 'Dragon setup';
    squareReason = 'Dragon side';
    detail = `${name} lives on dragon side — clear + pick before spawn.`;
  }

  // CS heuristic: very low CS for clock → already ganking (brief red)
  const expectedCs = minutes * 4.2;
  if (minutes >= 3 && minutes <= 8 && cs > 0 && cs < expectedCs * 0.55) {
    gankRisk = 'high';
    probability = 90;
    label = 'Jg missing farms';
    squareReason = 'Missing — on map';
    detail = `${name} CS ${cs} low for ${minutes.toFixed(1)}m — assume on the map.`;
  }

  if (gankRisk === 'high' && profile) {
    if (highRiskSinceGameTime == null) highRiskSinceGameTime = gameTime;
    const held = gameTime - highRiskSinceGameTime;
    if (held > profile.redWindowSec) {
      gankRisk = 'medium';
      probability = Math.min(probability, 55);
      squareReason = 'Fog risk';
      highRiskSinceGameTime = null;
    }
  } else {
    highRiskSinceGameTime = null;
  }

  // Cap how long "high" stays without a missing-CS spike — soft decay outside windows
  if (gankRisk === 'high' && profile) {
    const inFirst = minutes >= gankStart && minutes <= gankEnd;
    const inCrab = minutes >= 2.1 && minutes <= 3.15;
    const inDrake = minutes >= 12 && minutes <= 16;
    const missing = minutes >= 3 && minutes <= 8 && cs > 0 && cs < expectedCs * 0.55;
    if (!inFirst && !inCrab && !inDrake && !missing && highRiskSinceGameTime == null) {
      gankRisk = 'medium';
      probability = Math.min(probability, 55);
      squareReason = 'Fog risk';
    }
  }

  if (gankRisk === 'low' && minutes > 1 && minutes < 12) {
    detail = profile?.notes || `${name} — standard path. Re-ward river when crash-shoving.`;
    squareReason = 'Tracked / farming';
  }

  return {
    junglerName: name,
    sideBias,
    gankRisk,
    probability,
    label,
    detail,
    squareReason,
    clearStyle: style,
  };
}
