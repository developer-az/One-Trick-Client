/**
 * What a fight actually was, from Live Client events and the player list.
 *
 * The Live Client has no positions and no enemy health, so rules that need
 * "enemies near" or "victim was full HP" stay unanswered. Everything here is
 * a name, a streak, or a Stolen flag the API really sent.
 */

import type { GameEvent, GameState, PlayerSnapshot } from './gameState';

export interface MomentFacts {
  events: GameEvent[];
  now: GameState | null;
}

export interface MomentEventRead {
  /** From the kill's KillStreak field, or 0 when the API didn't send one. */
  killStreakFromEvent: number;
  objectiveStolen: boolean;
  /** "Infernal dragon", "Baron", … when this window stole an objective. */
  objectiveName: string | null;
  /** Champion (or summoner) who killed you, when this window has that event. */
  deathKiller: string | null;
  deathAssists: number;
  firstBlood: boolean;
}

const EMPTY_READ: MomentEventRead = {
  killStreakFromEvent: 0,
  objectiveStolen: false,
  objectiveName: null,
  deathKiller: null,
  deathAssists: 0,
  firstBlood: false,
};

const OBJECTIVE_EVENTS = new Set(['DragonKill', 'BaronKill', 'HeraldKill', 'HordeKill', 'EpicMonsterKill']);

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function aliasesOf(player: PlayerSnapshot): string[] {
  const out = new Set<string>();
  const add = (raw: string) => {
    const n = norm(raw);
    if (!n) return;
    out.add(n);
    const base = n.split('#')[0];
    if (base) out.add(base);
  };
  add(player.riotId);
  add(player.champion);
  return [...out];
}

function selfAliases(now: GameState | null, selfChampion: string): string[] {
  const out = new Set<string>();
  const self = now?.players.find((p) => p.isSelf);
  if (self) for (const name of aliasesOf(self)) out.add(name);
  const champ = norm(selfChampion);
  if (champ) out.add(champ);
  if (now?.self.champion) out.add(norm(now.self.champion));
  return [...out];
}

function hits(aliases: string[], raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  const n = norm(raw);
  if (!n) return false;
  return aliases.includes(n) || aliases.includes(n.split('#')[0]);
}

function inWindow(gameTime: number, since: number, until: number): boolean {
  return gameTime > since - 0.05 && gameTime <= until + 1.5;
}

function stolenFlag(raw: Record<string, unknown>): boolean {
  const value = raw.Stolen ?? raw.stolen;
  return value === true || String(value).toLowerCase() === 'true';
}

function displayName(players: PlayerSnapshot[], raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const n = norm(raw);
  const player = players.find((p) => aliasesOf(p).includes(n) || aliasesOf(p).includes(n.split('#')[0]));
  return player?.champion || raw.trim();
}

function objectiveLabel(event: GameEvent): string {
  const raw = event.raw;
  const dragon = typeof raw.DragonType === 'string' ? raw.DragonType.trim() : '';
  if (event.name === 'BaronKill') return 'Baron';
  if (event.name === 'HeraldKill') return 'Herald';
  if (event.name === 'HordeKill') return 'void grubs';
  if (dragon) return `${dragon.toLowerCase()} dragon`;
  const monster = String(raw.MonsterType ?? raw.monsterType ?? '').toLowerCase();
  if (monster.includes('baron')) return 'Baron';
  if (monster.includes('herald') || monster.includes('rift')) return 'Herald';
  if (monster.includes('dragon')) return 'dragon';
  return 'objective';
}

/**
 * Read the events that landed between two HUD ticks.
 * `since` / `until` are game-time seconds. Unknown fields stay empty — never guessed.
 */
export function readMomentEvents(
  facts: MomentFacts | null | undefined,
  since: number,
  until: number,
  selfChampion: string
): MomentEventRead {
  const events = facts?.events;
  if (!events?.length) return { ...EMPTY_READ };
  const aliases = selfAliases(facts?.now ?? null, selfChampion);
  const players = facts?.now?.players ?? [];
  const read: MomentEventRead = { ...EMPTY_READ };

  for (const event of events) {
    if (!inWindow(event.gameTime, since, until)) continue;
    if (event.name === 'FirstBlood') read.firstBlood = true;

    if (event.name === 'ChampionKill') {
      const killer = event.raw.KillerName;
      const victim = event.raw.VictimName;
      if (hits(aliases, victim)) {
        read.deathKiller = displayName(players, killer);
        const assisters = event.raw.Assisters;
        read.deathAssists = Array.isArray(assisters) ? assisters.length : 0;
      }
      if (hits(aliases, killer)) {
        const streak = Number(event.raw.KillStreak);
        if (Number.isFinite(streak) && streak > read.killStreakFromEvent) read.killStreakFromEvent = streak;
      }
    }

    if (OBJECTIVE_EVENTS.has(event.name) && stolenFlag(event.raw) && hits(aliases, event.raw.KillerName)) {
      read.objectiveStolen = true;
      read.objectiveName = objectiveLabel(event);
    }
  }

  return read;
}
