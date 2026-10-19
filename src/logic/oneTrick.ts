import type { Champion } from './pykeLogic';
import type { CatalogRole } from '../catalog/types';

/*
 * One-trick guidance.
 *
 * Deliberate scope: this module never claims a win rate or a matchup number.
 * The app has no ranked data source, and inventing "62% vs Yone" would be
 * false precision. Instead it states, from what we actually model:
 *
 *   - the win condition the champion's kit points to (derived from tags)
 *   - the ranked discipline that follows from that win condition
 *   - the mistakes that cost one-tricks LP on their own champion
 *
 * Every line is a claim about how champions work in general, not a statistic.
 */

export type OneTrickLane = CatalogRole;

export interface OneTrickPlan {
  championId: string;
  /** What the kit wants to do — one sentence, no jargon. */
  winCondition: string;
  /** The three habits that separate a one-trick from a dabbler. */
  habits: string[];
  /** Self-inflicted losses. These are the LP leaks, not bad teammates. */
  leaks: string[];
  /** What the enemy must do to beat you, so you can watch for it. */
  enemyAnswer: string;
  /** Short tag for the HUD / card header. */
  archetype: string;
}

type Kit = 'assassin' | 'mage' | 'marksman' | 'fighter' | 'tank' | 'support' | 'enchanter';

function classify(champion: Champion, role: CatalogRole): Kit {
  const tags = champion.tags || [];
  const has = (t: string) => tags.includes(t);
  const isMage = has('Mage');
  const isSupport = has('Support');
  const isAssassin = has('Assassin');
  const isTank = has('Tank');
  const isMarksman = has('Marksman');

  /*
   * Riot tags are unordered and often name a secondary playstyle, so tag
   * order alone is not signal: Lux is Mage+Support but a mid mage; Janna is
   * Support+Mage but an enchanter. Both look identical in tags alone, so the
   * lane you play them in decides it — that is exactly the one-trick question.
   *
   * Support + Mage played in a Support slot  -> enchanter (Janna, Lulu, Karma).
   * Support + Mage played anywhere else      -> mage (Lux mid, Zyra, Brand).
   * Support without Mage in a Support slot   -> engage support (Leona, Thresh).
   */
  if (isSupport) {
    if (!isMage) return 'support';
    return role === 'Support' ? 'enchanter' : 'mage';
  }
  if (isTank) return 'tank';
  if (isAssassin) return isMarksman ? 'marksman' : 'assassin';
  if (isMarksman) return 'marksman';
  if (isMage) return 'mage';
  return 'fighter';
}

const PLAN_BY_KIT: Record<Kit, Omit<OneTrickPlan, 'championId' | 'archetype'>> = {
  assassin: {
    winCondition:
      'You win by converting one kill into map tempo — the first pick on a side lane is worth more than a 5/0 laning phase.',
    habits: [
      'Take the fight you already won: move only after your damage is confirmed, not on a guess.',
      'Track the enemy Flash like a resource you own. It is the real cooldown that decides your kills.',
      'Spend the tempo: after a kill, take a wave, camp, or plate. Kills without an objective are not momentum.',
    ],
    leaks: [
      'Diving for a kill after your combo is spent — you are a minion for the next 6 seconds.',
      'Farming a side lane while the team fights for a dragon. Your value is the flank, not the wave.',
      'Building full damage into two tanks on the enemy team because it worked last game.',
    ],
    enemyAnswer:
      'They beat you by refusing your engage — grouping as five and forcing you to fight into a wall of peel.',
  },
  mage: {
    winCondition:
      'You win by controlling space before the fight starts: your value is the zone, spacing, and the wave you push to force rotations.',
    habits: [
      'Hold key spells for the enemy engage, not for poke. A spell you keep is a spell the enemy must respect.',
      'Push, then move. A mage who is never seen on the map is a mage the enemy has to guess about.',
      'Stand at your maximum range, not theirs. Distance is your HP bar.',
    ],
    leaks: [
      'Using the disengage spell as damage, then dying to the engage it would have stopped.',
      'Sitting under your own tower on a wave you could shove — you give the enemy zero map pressure.',
      'Fighting in narrow chokes where you cannot use range, because it felt like a good angle.',
    ],
    enemyAnswer:
      'They beat you with two fast flankers — once you must choose which to zone, the other reaches you.',
  },
  marksman: {
    winCondition:
      'You win on gold-per-minute and fight duration: every fight that lasts longer is yours, so your job is to survive the first 3 seconds.',
    habits: [
      'Farm without contesting. CS you do not need to fight for is free LP.',
      'Position by the biggest threat, not the closest one. Walk away from a kill that costs your flash.',
      'Take fights only when you are at an item spike. Item timing decides your damage, not your skill.',
    ],
    leaks: [
      'Walking forward to auto the frontline while the enemy assassin is unaccounted for.',
      'Chasing kills into fog. Your whole kit is worthless at melee range.',
      'Dying to a 3v1 because the wave was worth it — it was not.',
    ],
    enemyAnswer:
      'They beat you by removing the front line and walking at you — once the tank is dead you have no space.',
  },
  fighter: {
    winCondition:
      'You win by forcing extended trades on your terms and being the first to the fight — a fighter who arrives second is just a smaller tank.',
    habits: [
      'Trade to a breakpoint, not to a coin flip. Know the health where the all-in is real.',
      'Be first to river. Presence decides Skirmishes more than damage does.',
      'Buy the resistance that answers their damage, not the one that answers your ego.',
    ],
    leaks: [
      'Taking a 50/50 all-in at level 3 in a lane you already won. The lane was the win.',
      'Split-pushing with no vision and no exit. A side lane is only pressure if you can leave it.',
      'Building the same three items every game into wildly different comps.',
    ],
    enemyAnswer:
      'They beat you by kiting the trade out — if you cannot close the gap, your damage never happens.',
  },
  tank: {
    winCondition:
      'You win by making the enemy spend cooldowns on you and still being alive for the second wave of the fight.',
    habits: [
      'Engage when your team can follow, not when you can. A pick with no follow is a death.',
      'Peel one carry instead of diving everyone. Choose the carry that is actually fed.',
      'Buy gold-efficiency, not damage. Your job is duration.',
    ],
    leaks: [
      'Engaging 1v5 because you felt durable from the last fight.',
      'Leaving your carry to dive their backline, then losing the carry to a single assassin.',
      'Itemising damage because laning felt bad — it will feel worse at 3 items.',
    ],
    enemyAnswer:
      'They beat you by ignoring you — walking past the tank to the damage behind it.',
  },
  support: {
    winCondition:
      'You win by making your lane partner stronger than theirs and by being first to the first objective, not by out-damaging.',
    habits: [
      'Your job is the ADC’s gold and the enemy’s reset. Everything else is secondary.',
      'Leave lane when the wave is neutral. A support who sits is a support the enemy can count.',
      'Ward the next objective, not the last one.',
    ],
    leaks: [
      'Taking kills that were free for the carry.',
      'Roaming on a stacked wave you just gave up, then blaming the ADC.',
      'Warding where you would walk, not where the enemy jungler will.',
    ],
    enemyAnswer:
      'They beat you by making your lane partner miss gold — pressure that costs no kills still wins lane.',
  },
  enchanter: {
    winCondition:
      'You win by preventing damage before it lands: shields and heals are worth more on a full-health target than a dying one.',
    habits: [
      'Shield the incoming hit, not the one that already landed.',
      'Stand behind your own carry, not beside them — a double-hit engage loses both of you.',
      'Choose who gets the buff by who is actually dealing damage.',
    ],
    leaks: [
      'Healing a carry who is already dead to the next auto.',
      'Walking into melee range to auto-attack in a lane you could simply hold.',
      'Buffing the carry by name instead of by score.',
    ],
    enemyAnswer:
      'They beat you with targeted burst that skips your heal range — one hard engage on your carry.',
  },
};

const ARCHETYPE_LABEL: Record<Kit, string> = {
  assassin: 'assassin',
  mage: 'control mage',
  marksman: 'marksman',
  fighter: 'fighter',
  tank: 'tank',
  support: 'engage support',
  enchanter: 'enchanter',
};

export function oneTrickPlan(champion: Champion, role: CatalogRole): OneTrickPlan {
  const kit = classify(champion, role);
  const base = PLAN_BY_KIT[kit];
  const habits = [...base.habits];

  // Lane-specific discipline is the one thing that actually changes by role.
  if (role === 'Jungle') {
    habits.unshift('Your first clear is a route, not a habit — learn the one path that gets you to your first gank on time.');
  } else if (role === 'Support') {
    habits.unshift('Your lane is two people’s gold. Track both resets before you decide to trade.');
  } else if (role === 'Top') {
    habits.unshift('Top lane is decided by wave state, not by trades — the third wave decides the lane.');
  } else if (role === 'Mid') {
    habits.unshift('Mid is a roaming lane. Push and move before you look for a solo kill.');
  } else if (role === 'Bot') {
    habits.unshift('Bot lane is a support lane. Your first job is not dying to their support’s engage.');
  }

  return {
    championId: champion.id,
    archetype: ARCHETYPE_LABEL[kit],
    winCondition: base.winCondition,
    habits: habits.slice(0, 4),
    leaks: base.leaks,
    enemyAnswer: base.enemyAnswer,
  };
}
