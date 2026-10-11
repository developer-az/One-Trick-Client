/**
 * Tracks enemy summoner spells from champ select / live client and estimates
 * CDs from kill/death events (Live Client has no spell-cast API).
 *
 * Focus:
 * - Support profiles → Bot + Support
 * - Yone Mid → Mid only
 *
 * Reliability model:
 * - Never restart a spell that is already on cooldown
 * - Heal/Barrier/Ghost/Cleanse on death (high confidence — usually burned)
 * - Flash on death only the first time while ready (later deaths are too noisy)
 * - Ignite/Exhaust on kill/assist only for Support lane (ADC kills ≠ Ignite)
 * - Manual mark overrides always win
 */

export interface TrackedSpell {
  spellId: number;
  name: string;
  short: string;
  baseCd: number;
  readyAt: number;
  source?: 'kill' | 'death' | 'inferred' | 'manual';
  /** Auto Flash-on-death already used once for this lane */
  flashAutoUsed?: boolean;
}

export type TrackedRole = 'Bot' | 'Support' | 'Mid';
export type SummonerFocus = 'bot' | 'mid';

export interface EnemyLaneSpells {
  role: TrackedRole;
  championName: string;
  championId?: number;
  spells: TrackedSpell[];
  /** First Flash auto-start already consumed for this lane */
  flashDeathArmed?: boolean;
  /** Summoner Spell Haste visible from items (Lucidity boots). Runes are hidden for enemies. */
  summonerHaste?: number;
}

/** @deprecated alias — prefer EnemyLaneSpells */
export type EnemyBotSpells = EnemyLaneSpells;

interface SpellDef {
  id: number;
  name: string;
  short: string;
  baseCd: number;
}

const SPELLS: Record<number, SpellDef> = {
  1: { id: 1, name: 'Cleanse', short: 'Cleanse', baseCd: 210 },
  3: { id: 3, name: 'Exhaust', short: 'Exhaust', baseCd: 210 },
  4: { id: 4, name: 'Flash', short: 'Flash', baseCd: 300 },
  6: { id: 6, name: 'Ghost', short: 'Ghost', baseCd: 210 },
  7: { id: 7, name: 'Heal', short: 'Heal', baseCd: 240 },
  11: { id: 11, name: 'Smite', short: 'Smite', baseCd: 90 },
  12: { id: 12, name: 'Teleport', short: 'TP', baseCd: 360 },
  14: { id: 14, name: 'Ignite', short: 'Ignite', baseCd: 180 },
  21: { id: 21, name: 'Barrier', short: 'Barrier', baseCd: 180 },
};

const ADC_HINTS = new Set(
  [
    'Ashe', 'Caitlyn', 'Jinx', 'KaiSa', 'Kaisa', 'Ezreal', 'Jhin', 'Lucian', 'MissFortune',
    'Sivir', 'Tristana', 'Twitch', 'Varus', 'Vayne', 'Xayah', 'Aphelios', 'Draven', 'Kalista',
    'KogMaw', 'Samira', 'Zeri', 'Nilah', 'Smolder', 'Yunara', 'Corki',
  ].map((n) => n.toLowerCase().replace(/[^a-z]/g, ''))
);

const SUPPORT_HINTS = new Set(
  [
    'Pyke', 'Thresh', 'Nautilus', 'Leona', 'Blitzcrank', 'Rakan', 'Alistar', 'Braum', 'Taric',
    'Rell', 'Nami', 'Lulu', 'Janna', 'Soraka', 'Yuumi', 'Sona', 'Milio', 'Renata', 'RenataGlasc',
    'Karma', 'Zyra', 'Brand', 'Xerath', 'Lux', 'Morgana', 'Swain', 'Neeko', 'Zilean', 'Bard',
    'Senna', 'Pantheon', 'Mel', 'Seraphine', 'Shaco',
  ].map((n) => n.toLowerCase().replace(/[^a-z]/g, ''))
);

/** Common mids — fallback when Live Client omits MIDDLE. */
const MID_HINTS = new Set(
  [
    'Ahri', 'Akali', 'Anivia', 'Annie', 'AurelionSol', 'Azir', 'Cassiopeia', 'Corki', 'Diana',
    'Ekko', 'Fizz', 'Galio', 'Hwei', 'Irelia', 'Kassadin', 'Katarina', 'Leblanc', 'Lissandra',
    'Lux', 'Malzahar', 'Neeko', 'Orianna', 'Qiyana', 'Ryze', 'Sylas', 'Syndra', 'Talon',
    'TwistedFate', 'Veigar', 'Vex', 'Viktor', 'Vladimir', 'Xerath', 'Yasuo', 'Yone', 'Zed',
    'Ziggs', 'Zoe', 'Aurora', 'Mel',
  ].map((n) => n.toLowerCase().replace(/[^a-z]/g, ''))
);

const NAME_TO_DEF: Record<string, SpellDef> = {};
for (const s of Object.values(SPELLS)) {
  NAME_TO_DEF[s.name.toLowerCase()] = s;
  NAME_TO_DEF[s.short.toLowerCase()] = s;
}

function normChamp(name: string | undefined): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function defFromId(id: number | undefined): SpellDef | null {
  if (!id) return null;
  return SPELLS[id] || null;
}

function defFromName(name: string | undefined): SpellDef | null {
  if (!name) return null;
  const cleaned = name.replace(/[^a-zA-Z]/g, '').toLowerCase();
  return (
    NAME_TO_DEF[cleaned] ||
    NAME_TO_DEF[name.toLowerCase()] ||
    Object.values(SPELLS).find((s) => cleaned.includes(s.name.toLowerCase())) ||
    null
  );
}

function toTracked(def: SpellDef, readyAt = 0): TrackedSpell {
  return { spellId: def.id, name: def.name, short: def.short, baseCd: def.baseCd, readyAt };
}

/**
 * Summoner Spell Haste from items. Ionian Boots of Lucidity give 10; Crimson
 * Lucidity (its upgrade) is counted at the same 10 as a floor. Cosmic Insight
 * also gives haste but enemy rune pages aren't exposed by the Live Client, so
 * it can't be counted.
 */
const SUMMONER_HASTE_ITEMS: Record<string, number> = { '3158': 10, '3171': 10 };

export function summonerHasteFromItems(itemIds: Array<string | number>): number {
  let haste = 0;
  for (const id of itemIds) haste = Math.max(haste, SUMMONER_HASTE_ITEMS[String(id)] || 0);
  return haste;
}

/** Cooldown in ms after haste: base * 100 / (100 + haste). */
export function hastedCooldownMs(baseCdSeconds: number, haste = 0): number {
  return (baseCdSeconds * 100 * 1000) / (100 + Math.max(0, haste));
}

let trackedLanes: EnemyLaneSpells[] = [];
/** False until the first event batch of a match has been seen. */
let eventsPrimed = false;
let processedEventIds = new Set<number>();
let lastFingerprint = '';
/** Focus lane Flash/sums coming back — clipboard auto-copy. */
let pendingClipboardText: string | null = null;
const prevReady = new Map<string, boolean>();
/** Active focus for serialize / clipboard (set from game-monitor). */
let activeFocus: SummonerFocus = 'bot';

export function setSummonerFocus(focus: SummonerFocus): void {
  activeFocus = focus === 'mid' ? 'mid' : 'bot';
}

export function getSummonerFocus(): SummonerFocus {
  return activeFocus;
}

export function getEnemyBotSummoners(): EnemyLaneSpells[] {
  return filterByFocus(trackedLanes, activeFocus);
}

export function resetSummonerTracker(): void {
  trackedLanes = [];
  processedEventIds = new Set();
  eventsPrimed = false;
  lastFingerprint = '';
  pendingClipboardText = null;
  prevReady.clear();
  activeFocus = 'bot';
}

export function consumeSummonerClipboard(): string | null {
  const t = pendingClipboardText;
  pendingClipboardText = null;
  return t;
}

function filterByFocus(lanes: EnemyLaneSpells[], focus: SummonerFocus): EnemyLaneSpells[] {
  if (focus === 'mid') return lanes.filter((l) => l.role === 'Mid');
  return lanes.filter((l) => l.role === 'Bot' || l.role === 'Support');
}

function upsertLane(
  role: TrackedRole,
  championName: string,
  championId: number | undefined,
  defs: SpellDef[]
): void {
  if (!championName && !defs.length) return;
  const existing = trackedLanes.find((b) => b.role === role);
  const byChamp = trackedLanes.find(
    (b) => normChamp(b.championName) === normChamp(championName) && b.role !== role
  );
  if (byChamp && !existing) {
    trackedLanes = trackedLanes.filter((b) => b !== byChamp);
  }
  const spells = defs.map((d) => {
    const prev = existing?.spells.find((s) => s.name === d.name || s.spellId === d.id);
    return prev
      ? { ...toTracked(d), readyAt: prev.readyAt, source: prev.source }
      : toTracked(d);
  });
  const entry: EnemyLaneSpells = {
    role,
    championName,
    championId,
    spells,
    flashDeathArmed: existing?.flashDeathArmed ?? true,
    summonerHaste: existing?.summonerHaste,
  };
  if (existing) {
    Object.assign(existing, entry);
  } else {
    trackedLanes.push(entry);
  }
}

function inferRoleFromSpells(defs: SpellDef[]): TrackedRole | null {
  const names = new Set(defs.map((d) => d.name));
  if (names.has('Heal') || names.has('Barrier')) return 'Bot';
  if (names.has('Exhaust')) return 'Support';
  if (names.has('Teleport') && !names.has('Heal')) return 'Mid';
  return null;
}

function inferRoleFromChamp(championName: string): TrackedRole | null {
  const n = normChamp(championName);
  if (ADC_HINTS.has(n)) return 'Bot';
  if (SUPPORT_HINTS.has(n)) return 'Support';
  if (MID_HINTS.has(n)) return 'Mid';
  return null;
}

function resolveRole(pos: string, championName: string, defs: SpellDef[]): TrackedRole | null {
  const p = pos.toUpperCase();
  if (p === 'BOTTOM') return 'Bot';
  if (p === 'UTILITY' || p === 'SUPPORT') return 'Support';
  if (p === 'MIDDLE' || p === 'MID') return 'Mid';
  if (p === 'TOP' || p === 'JUNGLE') return null;
  return inferRoleFromSpells(defs) || inferRoleFromChamp(championName);
}

const LANE_ROLES: TrackedRole[] = ['Bot', 'Support', 'Mid'];

/** How well a champion + spells fit a lane (0 = no evidence). */
function laneScore(champ: string, defs: SpellDef[], role: TrackedRole): number {
  let score = inferRoleFromChamp(champ) === role ? 3 : 0;
  const names = new Set(defs.map((d) => d.name));
  if (role === 'Bot' && (names.has('Heal') || names.has('Barrier'))) score += 2;
  if (role === 'Support' && names.has('Exhaust')) score += 2;
  if (role === 'Mid' && names.has('Teleport')) score += 1;
  return score;
}

/**
 * Give each lane (Bot, Support, Mid) to at most one enemy, maximising total
 * fit. Players with a reported position keep it. Assigning one by one let
 * several enemies claim the same lane, so timers jumped between champions.
 */
export function assignLaneRoles(
  candidates: Array<{ champ: string; defs: SpellDef[]; fixed: TrackedRole | null }>
): Map<string, TrackedRole> {
  const out = new Map<string, TrackedRole>();
  const taken = new Set<TrackedRole>();
  for (const c of candidates) {
    if (c.fixed && !taken.has(c.fixed)) {
      out.set(c.champ, c.fixed);
      taken.add(c.fixed);
    }
  }
  const open = LANE_ROLES.filter((r) => !taken.has(r));
  const pool = candidates.filter((c) => !c.fixed);
  let best: Array<[string, TrackedRole]> = [];
  let bestScore = 0;
  const walk = (i: number, used: Set<string>, picked: Array<[string, TrackedRole]>, score: number) => {
    if (score > bestScore) {
      bestScore = score;
      best = [...picked];
    }
    if (i >= open.length) return;
    walk(i + 1, used, picked, score); // leave this lane empty
    for (const c of pool) {
      if (used.has(c.champ)) continue;
      const gain = laneScore(c.champ, c.defs, open[i]);
      if (gain <= 0) continue;
      used.add(c.champ);
      picked.push([c.champ, open[i]]);
      walk(i + 1, used, picked, score + gain);
      picked.pop();
      used.delete(c.champ);
    }
  };
  walk(0, new Set(), [], 0);
  for (const [champ, role] of best) out.set(champ, role);
  return out;
}

/** Champ select: cache enemy BOTTOM + UTILITY + MIDDLE spell ids. */
export function ingestChampSelectTeam(
  theirTeam: Array<{
    championId?: number;
    championName?: string;
    assignedPosition?: string;
    teamPosition?: string;
    position?: string;
    spell1Id?: number;
    spell2Id?: number;
  }>
): void {
  for (const m of theirTeam) {
    const defs = [defFromId(m.spell1Id), defFromId(m.spell2Id)].filter(Boolean) as SpellDef[];
    const name = m.championName || (m.championId ? `#${m.championId}` : '');
    const pos = m.assignedPosition || m.teamPosition || m.position || '';
    const role = resolveRole(pos, name, defs);
    if (!role) continue;
    upsertLane(role, name || role, m.championId, defs);
  }
}

/** Live client: refresh spell names for tracked laners by position / hints. */
export function ingestLivePlayers(
  enemies: Array<{
    championName: string;
    position?: string;
    itemIds?: Array<string | number>;
    summonerSpells?: {
      summonerSpellOne?: { displayName: string };
      summonerSpellTwo?: { displayName: string };
    };
  }>
): void {
  const candidates: Array<{ champ: string; defs: SpellDef[]; fixed: TrackedRole | null }> = [];
  for (const e of enemies) {
    const defs = [
      defFromName(e.summonerSpells?.summonerSpellOne?.displayName),
      defFromName(e.summonerSpells?.summonerSpellTwo?.displayName),
    ].filter(Boolean) as SpellDef[];
    if (defs.some((d) => d.name === 'Smite')) continue;
    const p = (e.position || '').toUpperCase();
    const known = p !== '' && p !== 'NONE';
    const fixed = known ? resolveRole(p, e.championName, defs) : null;
    if (known && !fixed) continue; // Top / Jungle
    candidates.push({ champ: e.championName, defs, fixed });
  }

  for (const [champ, role] of assignLaneRoles(candidates)) {
    const c = candidates.find((x) => x.champ === champ);
    if (!c) continue;
    if (c.defs.length === 0) {
      const existing = trackedLanes.find((b) => b.role === role);
      if (existing) existing.championName = c.champ;
      continue;
    }
    upsertLane(role, c.champ, undefined, c.defs);
  }

  for (const e of enemies) {
    const lane = trackedLanes.find((l) => laneMatchesChampion(l, e.championName));
    if (lane && e.itemIds) lane.summonerHaste = summonerHasteFromItems(e.itemIds);
  }
}

/**
 * Start a spell CD. Never restarts an active cooldown (fixes false mid-CD refreshes).
 * Manual marks always apply.
 */
function startSpellCd(
  lane: EnemyLaneSpells,
  spellName: string,
  source: TrackedSpell['source'],
  opts?: { force?: boolean; at?: number }
): boolean {
  const spell = lane.spells.find((s) => s.name === spellName);
  if (!spell) return false;
  // `at` is when the spell was most likely used (the kill event time), so a
  // timer reflects the event, not the moment we happened to poll.
  const at = opts?.at ?? Date.now();
  if (!opts?.force && spell.readyAt > at) return false;
  spell.readyAt = at + hastedCooldownMs(spell.baseCd, lane.summonerHaste);
  spell.source = source;
  return true;
}

function laneMatchesChampion(lane: EnemyLaneSpells, championName: string | undefined): boolean {
  if (!championName) return false;
  return normChamp(lane.championName) === normChamp(championName);
}

interface LiveEvent {
  EventID?: number;
  EventName?: string;
  EventTime?: number;
  KillerName?: string;
  VictimName?: string;
  Assisters?: string[];
}

/**
 * Heuristics (no spell-cast events in Live Client):
 * - Support killer/assister → Ignite / Exhaust
 * - Victim → Heal/Barrier/Ghost/Cleanse (high confidence)
 * - Victim Flash → only first auto death while Flash is ready (then manual)
 */
export function ingestLiveEvents(
  events: LiveEvent[] | undefined,
  nameToChampion: Map<string, string>,
  gameTime?: number
): void {
  if (!events?.length) return;
  const now = Date.now();
  // Map an event's game time to wall-clock. Without a game clock, events seen
  // for the first time (app started mid-match, or a reset) can't be dated, so
  // they are recorded without starting timers instead of replaying old kills now.
  const eventAt = (ev: LiveEvent): number | null =>
    typeof gameTime === 'number' && typeof ev.EventTime === 'number'
      ? now - Math.max(0, gameTime - ev.EventTime) * 1000
      : eventsPrimed
        ? now
        : null;

  const lookup = (raw: string | undefined): string | undefined => {
    if (!raw) return undefined;
    return nameToChampion.get(raw) || nameToChampion.get(raw.split('#')[0]) || raw;
  };

  for (const ev of events) {
    if (ev.EventName !== 'ChampionKill' || ev.EventID == null) continue;
    if (processedEventIds.has(ev.EventID)) continue;
    processedEventIds.add(ev.EventID);
    const at = eventAt(ev);
    if (at === null) continue;

    const killerChamp = lookup(ev.KillerName);
    const victimChamp = lookup(ev.VictimName);

    for (const lane of trackedLanes) {
      // Combat sums: Support Ignite/Exhaust are reliable; ADC kills are usually autos
      if (lane.role === 'Support' || lane.role === 'Mid') {
        if (laneMatchesChampion(lane, killerChamp)) {
          startSpellCd(lane, 'Ignite', 'kill', { at });
        }
        for (const a of ev.Assisters || []) {
          const assistChamp = lookup(a);
          if (laneMatchesChampion(lane, assistChamp)) {
            startSpellCd(lane, 'Exhaust', 'kill', { at });
            startSpellCd(lane, 'Ignite', 'kill', { at });
          }
        }
      }

      if (laneMatchesChampion(lane, victimChamp)) {
        // High-confidence defensive sums — usually burned before death
        startSpellCd(lane, 'Heal', 'death', { at });
        startSpellCd(lane, 'Barrier', 'death', { at });
        startSpellCd(lane, 'Ghost', 'death', { at });
        startSpellCd(lane, 'Cleanse', 'death', { at });

        // Mid Teleport is often burned into a death / dive — arm if ready
        if (lane.role === 'Mid') {
          startSpellCd(lane, 'Teleport', 'death', { at });
        }
        // Support Exhaust often used into the fight that kills them
        if (lane.role === 'Support') {
          startSpellCd(lane, 'Exhaust', 'death', { at });
        }

        // Flash: only if currently ready (never restarts mid-CD).
        // Live Client has no cast events — death while Flash is up is still the
        // best available signal; press PageUp/PageDown to correct.
        startSpellCd(lane, 'Flash', 'death', { at });
      }
    }
  }

  eventsPrimed = true;
  detectFocusSumsComingUp();
}

/**
 * Manual override — click when you saw them burn a sum.
 * force=true restarts even mid-CD (correct a false timer).
 */
export function markSpellUsed(
  role: TrackedRole,
  spellName: string,
  opts?: { clear?: boolean }
): boolean {
  const lane = trackedLanes.find((l) => l.role === role);
  if (!lane) return false;
  const spell = lane.spells.find(
    (s) => s.name.toLowerCase() === spellName.toLowerCase() || s.short.toLowerCase() === spellName.toLowerCase()
  );
  if (!spell) return false;
  if (opts?.clear) {
    spell.readyAt = 0;
    spell.source = 'manual';
    if (spell.name === 'Flash') lane.flashDeathArmed = true;
    lastFingerprint = '';
    return true;
  }
  startSpellCd(lane, spell.name, 'manual', { force: true });
  if (spell.name === 'Flash') lane.flashDeathArmed = false;
  lastFingerprint = '';
  return true;
}

/**
 * Toggle a spell timer: start CD if ready, clear if already counting down.
 * Used by Page Up / Page Down so a mis-press is undoable.
 */
export function toggleSpellUsed(
  role: TrackedRole,
  spellName: string
): { success: boolean; active: boolean } {
  const tryRole = (r: TrackedRole) => {
    const lane = trackedLanes.find((l) => l.role === r);
    if (!lane) return null;
    const spell = lane.spells.find(
      (s) =>
        s.name.toLowerCase() === spellName.toLowerCase() ||
        s.short.toLowerCase() === spellName.toLowerCase()
    );
    if (!spell) return null;
    const now = Date.now();
    if (spell.readyAt > now) {
      spell.readyAt = 0;
      spell.source = 'manual';
      if (spell.name === 'Flash') lane.flashDeathArmed = true;
      lastFingerprint = '';
      return { success: true as const, active: false };
    }
    startSpellCd(lane, spell.name, 'manual', { force: true });
    if (spell.name === 'Flash') lane.flashDeathArmed = false;
    lastFingerprint = '';
    return { success: true as const, active: true };
  };

  // Only the lane the key is for. Falling back to another lane would start a
  // timer the user can't see and didn't mean.
  return tryRole(role) || { success: false, active: false };
}

function focusPrimaryLane(): EnemyLaneSpells | undefined {
  if (activeFocus === 'mid') return trackedLanes.find((b) => b.role === 'Mid');
  return trackedLanes.find((b) => b.role === 'Bot');
}

function detectFocusSumsComingUp(now = Date.now()): void {
  const primary = focusPrimaryLane();
  if (!primary) return;
  const watch =
    activeFocus === 'mid'
      ? ['Flash', 'Teleport', 'Ignite', 'Cleanse', 'Ghost']
      : ['Flash', 'Heal', 'Barrier'];
  const parts: string[] = [];
  for (const s of primary.spells) {
    if (!watch.includes(s.name)) continue;
    const key = `${primary.role}:${s.name}`;
    const ready = s.readyAt <= now;
    const wasReady = prevReady.get(key);
    prevReady.set(key, ready);
    if (wasReady === false && ready) {
      parts.push(`${s.short} UP`);
    }
  }
  if (parts.length) {
    const label = activeFocus === 'mid' ? 'MID' : 'ADC';
    pendingClipboardText = `${label} ${primary.championName}: ${parts.join(' · ')} (${new Date().toLocaleTimeString()})`;
  }
}

export function summonerFingerprint(now = Date.now()): string {
  detectFocusSumsComingUp(now);
  const lanes = filterByFocus(trackedLanes, activeFocus);
  const parts = lanes.map((lane) => {
    const spells = lane.spells
      .map((s) => {
        const rem = s.readyAt > now ? Math.ceil((s.readyAt - now) / 2000) : 0;
        return `${s.short}:${rem}`;
      })
      .join(',');
    return `${lane.role}:${lane.championName}:{${spells}}`;
  });
  return `${activeFocus}|${parts.join('|')}`;
}

export function summonerPayloadChanged(): boolean {
  const fp = summonerFingerprint();
  if (fp === lastFingerprint) return false;
  lastFingerprint = fp;
  return true;
}

/** Snapshot for IPC — remaining seconds + absolute readyAt for local UI ticks. */
export function serializeSummoners(
  now = Date.now(),
  focus: SummonerFocus = activeFocus
): Array<{
  role: TrackedRole;
  championName: string;
  championId?: number;
  spells: Array<{
    name: string;
    short: string;
    baseCd: number;
    remaining: number;
    ready: boolean;
    readyAt: number;
    source?: string;
  }>;
}> {
  detectFocusSumsComingUp(now);
  return filterByFocus(trackedLanes, focus).map((lane) => ({
    role: lane.role,
    championName: lane.championName,
    championId: lane.championId,
    spells: lane.spells.map((s) => {
      const remaining = s.readyAt > now ? Math.ceil((s.readyAt - now) / 1000) : 0;
      return {
        name: s.name,
        short: s.short,
        baseCd: s.baseCd,
        remaining,
        ready: remaining <= 0,
        readyAt: s.readyAt,
        source: s.source,
      };
    }),
  }));
}

/** Format primary-lane timers for manual clipboard copy. */
export function formatAdcClipboard(now = Date.now()): string | null {
  const primary = focusPrimaryLane();
  if (!primary) return null;
  const bits = primary.spells.map((s) => {
    const rem = s.readyAt > now ? Math.ceil((s.readyAt - now) / 1000) : 0;
    return rem > 0 ? `${s.short} ${Math.floor(rem / 60)}:${String(rem % 60).padStart(2, '0')}` : `${s.short} UP`;
  });
  const label = activeFocus === 'mid' ? 'MID' : 'ADC';
  return `${label} ${primary.championName}: ${bits.join(' · ')}`;
}
