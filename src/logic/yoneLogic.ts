/**
 * Yone Mid profile — builds/runes/matchups grounded in high-elo patterns
 * (Skill-Capped / OP.GG / one-trick notes: Q-through-minions, E snap-back,
 * Berserker's as real first spike, Fleet vs poke, Cut Down double-dip with E).
 */
import type {
  Build,
  Champion,
  DominanceMetrics,
  Item,
  MatchupAnalysis,
  RunePage,
} from './pykeLogic';
import { activeThreats, applyThreatScoring, threatTips } from './counters';

const ITEMS = {
  DORANS_BLADE: { id: '1055', name: "Doran's Blade", icon: 'Doran_s_Blade', reason: 'Default open — AD + sustain for early Q trades.' },
  DORANS_SHIELD: { id: '1054', name: "Doran's Shield", icon: 'Doran_s_Shield', reason: 'Poke / ranged lane — survive until Berserker spike.' },
  POTION: { id: '2003', name: 'Health Potion', icon: 'Health_Potion', reason: 'Lane HP buffer.' },
  BERSERKERS: { id: '3172', name: 'Gunmetal Greaves', icon: 'Gunmetal_Greaves', reason: 'Finish: Boots → Berserker\'s → Gunmetal. AS cuts Q CD.' },
  MERCURY: { id: '3173', name: 'Chainlaced Crushers', icon: 'Chainlaced_Crushers', reason: 'Finish Mercs → Crushers. Tenacity for E/R chains.' },
  STEELCAPS: { id: '3174', name: 'Armored Advance', icon: 'Armored_Advance', reason: 'Finish Steelcaps → Armored Advance vs AD mid.' },
  BOTRK: { id: '3153', name: 'Blade of the Ruined King', icon: 'Blade_of_the_Ruined_King', reason: '% current HP + on-hit during E — skirmish core (Skill-Capped).' },
  SHIELDBOW: { id: '6673', name: 'Immortal Shieldbow', icon: 'Immortal_Shieldbow', reason: 'Crit + lifeline — survive the snap-back window.' },
  KRAKEN: { id: '6672', name: 'Kraken Slayer', icon: 'Kraken_Slayer', reason: 'True-damage spike when you need raw kill pressure over shield.' },
  IE: { id: '3031', name: 'Infinity Edge', icon: 'Infinity_Edge', reason: '100% crit spike — fourth-item default.' },
  DEATHS_DANCE: { id: '6333', name: "Death's Dance", icon: 'Death_s_Dance', reason: 'Bleed physical — pairs with W shield (one-trick late pattern).' },
  JAKSHO: { id: '6665', name: "Jak'Sho, The Protean", icon: 'JakSho', reason: 'Survive ranged/mixed comps; Yone wins by staying alive.' },
  GA: { id: '3026', name: 'Guardian Angel', icon: 'Guardian_Angel', reason: 'E death recalls to spirit — revive safely after engage.' },
  MAW: { id: '3156', name: 'Maw of Malmortius', icon: 'Maw_of_Malmortius', reason: 'Lifeline vs fed AP mid/jg.' },
  WITEND: { id: '3091', name: "Wit's End", icon: 'Wits_End', reason: 'MR + on-hit when AP lane owns early.' },
  MERCURIAL: { id: '3139', name: 'Mercurial Scimitar', icon: 'Mercurial_Scimitar', reason: 'Cleanse suppress / heavy roots mid-fight.' },
  LDR: { id: '3036', name: "Lord Dominik's Regards", icon: 'Lord_Dominik_s_Regards', reason: 'Pen vs stacked armor / tanks.' },
};

const HARD_RANGE_POKE = [
  'Viktor', 'Xerath', 'Ziggs', 'Anivia', 'Azir', 'Orianna', 'Syndra', 'Hwei', 'Mel', 'Lux', 'VelKoz',
];
const HARD_MELEE_BULLY = ['Pantheon', 'Irelia', 'Yasuo', 'Akali', 'Zed', 'Diana', 'Renekton', 'Galio'];
const EASY_IMMOBILE = [
  'Veigar', 'Malzahar', 'Annie', 'TwistedFate', 'Heimerdinger', 'Swain', 'Lissandra',
];
const MOBILE_ASSASSIN = ['Zed', 'Akali', 'LeBlanc', 'Fizz', 'Qiyana', 'Talon', 'Katarina', 'Ekko', 'Naafiri'];

/** Ally junglers who look for early mid ganks / dives. */
const EARLY_GANK_JG = [
  'LeeSin', 'XinZhao', 'Elise', 'RekSai', 'JarvanIV', 'Pantheon', 'Nidalee', 'Graves', 'Kindred',
  'Vi', 'Warwick', 'Rengar', 'Ekko', 'Shaco', 'Evelynn', 'Talon', 'Qiyana', 'Diana', 'Nocturne',
];
/** Ally junglers who full-clear / scale — don't expect early mid presence. */
const FARM_JG = [
  'MasterYi', 'Kayn', 'Karthus', 'Belveth', 'Lillia', 'Amumu', 'Fiddlesticks', 'Ivern', 'Skarner',
  'Udyr', 'Volibear', 'Briar', 'Viego', 'Shyvana', 'Mordekaiser',
];
/** Ally junglers with hard CC / engage that Yone chains after. */
const SETUP_JG = [
  'JarvanIV', 'Sejuani', 'Amumu', 'Nunu', 'Zac', 'Maokai', 'Wukong', 'Vi', 'Rell', 'Skarner',
  'RekSai', 'XinZhao', 'Poppy', 'Gragas', 'Hecarim',
];

type AllyJgStyle = 'early' | 'farm' | 'setup' | 'standard';

interface AllyJungleIntel {
  champ: Champion;
  style: AllyJgStyle;
  notes: string[];
}

function classifyAllyJungle(ally: Champion | null | undefined): AllyJungleIntel | null {
  if (!ally) return null;
  const id = ally.id;
  let style: AllyJgStyle = 'standard';
  if (EARLY_GANK_JG.includes(id)) style = 'early';
  else if (SETUP_JG.includes(id)) style = 'setup';
  else if (FARM_JG.includes(id)) style = 'farm';

  const notes: string[] = [];
  if (style === 'early') {
    notes.push(`${ally.name} paths for early mid — freeze/thin and play for their first look.`);
  } else if (style === 'setup') {
    notes.push(`${ally.name} locks targets — stack Q3 before their engage, then E-R.`);
  } else if (style === 'farm') {
    notes.push(`${ally.name} full-clears — expect solo lane until ~5–6; don't force dives.`);
  } else {
    notes.push(`Track ${ally.name}'s camps — sync trades when they show mid river.`);
  }
  return { champ: ally, style, notes };
}

interface MidCtx {
  poke: number;
  cc: number;
  ap: number;
  ad: number;
  tanks: number;
  immobile: boolean;
  bully: boolean;
  assassin: boolean;
  enemyMid: Champion | null;
  enemyNames: string[];
  allyJungle: AllyJungleIntel | null;
}

function findEnemyMid(enemyTeam: Champion[]): Champion | null {
  return (
    enemyTeam.find((c) => {
      const tags = c.tags;
      if (tags.includes('Marksman') && !tags.includes('Assassin')) return false;
      if (tags.includes('Support') && !tags.includes('Mage') && !tags.includes('Assassin')) return false;
      return tags.includes('Mage') || tags.includes('Assassin') || tags.includes('Fighter');
    }) ||
    enemyTeam.find((c) => c.tags.includes('Mage')) ||
    null
  );
}

function scanMid(enemyTeam: Champion[], allyJungle?: Champion | null): MidCtx {
  const enemyMid = findEnemyMid(enemyTeam);
  let poke = 0;
  let cc = 0;
  let ap = 0;
  let ad = 0;
  let tanks = 0;

  enemyTeam.forEach((c) => {
    if (c.tags.includes('Mage') || c.damageType === 'Magic') ap++;
    if (c.tags.includes('Marksman') || c.tags.includes('Fighter')) ad++;
    if (c.tags.includes('Tank')) tanks++;
    if (c.tags.includes('Tank') || c.tags.includes('Support')) cc++;
    if (HARD_RANGE_POKE.includes(c.id) || (c.tags.includes('Mage') && !c.tags.includes('Assassin'))) poke++;
  });

  const midId = enemyMid?.id || '';
  return {
    poke,
    cc,
    ap,
    ad,
    tanks,
    immobile: EASY_IMMOBILE.includes(midId),
    bully: HARD_MELEE_BULLY.includes(midId) || HARD_RANGE_POKE.includes(midId),
    assassin: MOBILE_ASSASSIN.includes(midId),
    enemyMid,
    enemyNames: enemyTeam.map((c) => c.name),
    allyJungle: classifyAllyJungle(allyJungle),
  };
}

export function calculateYoneBuild(enemyTeam: Champion[], allyJungle?: Champion | null): Build {
  const ctx = scanMid(enemyTeam, allyJungle);
  const starter: Item[] = ctx.poke >= 2 || (ctx.enemyMid && HARD_RANGE_POKE.includes(ctx.enemyMid.id))
    ? [ITEMS.DORANS_SHIELD, ITEMS.POTION, ITEMS.POTION]
    : [ITEMS.DORANS_BLADE, ITEMS.POTION, ITEMS.POTION];

  // Ally jungler with heavy CC → slightly favor Mercs so skirmish chains complete
  const allySetup = ctx.allyJungle?.style === 'setup' || ctx.allyJungle?.style === 'early';
  const bootScores = [
    {
      item: ITEMS.BERSERKERS,
      score: 50 + (ctx.immobile ? 8 : 0) - (ctx.cc >= 3 ? 10 : 0) - (allySetup && ctx.cc >= 2 ? 4 : 0),
      reason: "Berserker's = Q CD. Default first spike before legendaries.",
    },
    {
      item: ITEMS.MERCURY,
      score: ctx.cc * 14 + (ctx.assassin ? 6 : 0) + (allySetup && ctx.cc >= 2 ? 8 : 0),
      reason: allySetup
        ? 'Tenacity for jg skirmishes — finish R/Q3 when your jungler engages.'
        : 'Tenacity so R/Q3 chains are not cancelled.',
    },
    {
      item: ITEMS.STEELCAPS,
      score: ctx.ad * 8 + (ctx.enemyMid && ['Yasuo', 'Zed', 'Irelia', 'Tryndamere'].includes(ctx.enemyMid.id) ? 16 : 0),
      reason: 'Cut AA mid / diver damage.',
    },
  ];
  const threats = activeThreats(enemyTeam);
  const scoredBoots = applyThreatScoring(bootScores, threats);
  scoredBoots.sort((a, b) => b.score - a.score);
  const boots = { ...scoredBoots[0].item, reason: scoredBoots[0].reason };

  // Core: BotRK → Shieldbow default (OP.GG / Mobalytics patch 26.x); Kraken when kill threat needed
  const wantKraken = ctx.immobile || (ctx.enemyMid && EASY_IMMOBILE.includes(ctx.enemyMid.id));
  const core: Item[] = wantKraken
    ? [
        { ...ITEMS.KRAKEN, reason: 'Rush true damage — punish immobile mids once AS boots land.' },
        { ...ITEMS.SHIELDBOW, reason: 'Shield + crit to convert E all-ins without dying.' },
      ]
    : [
        { ...ITEMS.BOTRK, reason: '%HP on-hit in E — strongest when fights run long against high-HP targets.' },
        { ...ITEMS.SHIELDBOW, reason: 'Crit + lifeline — snap back alive after chunk.' },
      ];

  type Scored = { item: Item; score: number; reason: string };
  const situPool: Scored[] = [
    { item: ITEMS.IE, score: 55, reason: 'IE fourth — 100% crit is the relative power peak.' },
    {
      item: ITEMS.DEATHS_DANCE,
      score: 20 + ctx.ad * 8,
      reason: "Death's Dance + W shield — short-range AD threats.",
    },
    {
      item: ITEMS.JAKSHO,
      score: 18 + ctx.poke * 6 + (ctx.ap >= 3 ? 10 : 0),
      reason: "Jak'Sho vs ranged/mixed — stay alive, keep dealing.",
    },
    {
      item: ITEMS.GA,
      score: 16 + (ctx.assassin ? 12 : 0),
      reason: 'GA + E death = revive at spirit — burst insurance.',
    },
    {
      item: ITEMS.MAW,
      score: ctx.ap * 10 + (ctx.enemyMid && HARD_RANGE_POKE.includes(ctx.enemyMid.id) ? 8 : 0),
      reason: 'Maw vs AP burst so E windows finish.',
    },
    {
      item: ITEMS.WITEND,
      score: ctx.ap * 7 + (ctx.bully && ctx.ap > 0 ? 8 : 0),
      reason: "Wit's End — early MR + on-hit into AP lane.",
    },
    {
      item: ITEMS.MERCURIAL,
      score: enemyTeam.some((c) => ['Malzahar', 'Warwick', 'Skarner', 'Lissandra'].includes(c.id)) ? 45 : 5,
      reason: 'QSS — suppress/root chains delete Yone mid-E.',
    },
    {
      item: ITEMS.LDR,
      score: ctx.tanks * 14,
      reason: 'LDR when armor stacks — still focus squishies first.',
    },
  ];

  const coreIds = new Set(core.map((i) => i.id));
  const situational = applyThreatScoring(situPool, threats)
    .filter((s) => s.score >= 18 && !coreIds.has(s.item.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((s) => ({ ...s.item, reason: s.reason }));

  // Ensure IE is always visible in path if not already situational #1
  if (!situational.some((i) => i.id === ITEMS.IE.id)) {
    situational.unshift({ ...ITEMS.IE, reason: 'IE — crit damage floor after two legendaries.' });
    if (situational.length > 4) situational.pop();
  }

  const buildPath: Item[] = [
    starter[0],
    { ...ITEMS.POTION, reason: 'Open sustain — preserve HP for level 3 E trades.' },
    { ...boots, reason: 'BOOTS: ' + (boots.reason || '') },
    { ...core[0], reason: 'RUSH: ' + (core[0].reason || '') },
    { ...core[1], reason: 'SPIKE: ' + (core[1].reason || '') },
    ...situational,
  ];

  return {
    starter,
    boots,
    core,
    situational,
    buildPath,
    spells: ['Flash', 'Teleport'],
  };
}

export function calculateYoneRunes(
  enemyTeam: Champion[],
  allyJungle?: Champion | null
): RunePage {
  const ctx = scanMid(enemyTeam, allyJungle);
  const reasons: { [key: number]: string } = {};

  // Fleet only vs real poke bullies (Skill-Capped); Lethal Tempo otherwise — including immobile mages
  const rangedPoke = !!ctx.enemyMid && HARD_RANGE_POKE.includes(ctx.enemyMid.id);

  const keystone = rangedPoke ? 8021 : 8008;
  reasons[8008] = 'Lethal Tempo: AS stacks cut Q CD — extended melee skirmish default.';
  reasons[8021] =
    'Fleet Footwork: sustain + MS on Q2→run-up — aggressive vs poke (Skill-Capped).';

  reasons[9101] = 'Absorb Life: CS heals — preserve HP for E windows.';
  reasons[9104] = 'Alacrity: more AS → more Q cycles.';
  // Cut Down double-dips with E true-damage return (Skill-Capped); Last Stand when low-HP fights
  const finisher = rangedPoke || ctx.tanks >= 2 ? 8017 : 8299;
  reasons[8017] = 'Cut Down: E %current amp returns as true damage on snap-back — best Cut Down user.';
  reasons[8299] = 'Last Stand: win the low-HP E all-in.';

  // Resolve secondary: Second Wind + Overgrowth default; Bone Plating vs burst/assassin
  // Early-gank ally jg → Unflinching helps live the 2v2 / dive CC chain
  let sec1 = 8444;
  let sec2 = 8451;
  reasons[8444] = 'Second Wind: refill after poke — stay in lethal range.';
  reasons[8451] = 'Overgrowth: free HP for late skirmishes.';
  if (
    ctx.assassin ||
    (ctx.enemyMid && HARD_MELEE_BULLY.includes(ctx.enemyMid.id)) ||
    ctx.allyJungle?.style === 'early'
  ) {
    sec1 = 8473;
    sec2 = 8242;
    reasons[8473] = 'Bone Plating: blunt the first melee burst into your E.';
    reasons[8242] =
      ctx.allyJungle?.style === 'early'
        ? `Unflinching: survive ${ctx.allyJungle.champ.name} dive CC so E-R finishes.`
        : 'Unflinching: tenacity when sums down — complete R chains.';
  }

  // Stat shards (26.x+): Offense AS | Flex Adaptive | Defense HP/Tenacity
  // Armor/MR shards (5002/5003) removed — using them breaks LCU export.
  reasons[5005] = 'AS shard: Q CD is everything.';
  reasons[5008] = 'Adaptive: damage for E burst.';
  const defense =
    ctx.assassin || (ctx.enemyMid && HARD_MELEE_BULLY.includes(ctx.enemyMid.id))
      ? 5011
      : ctx.ap >= 3
        ? 5011
        : 5001;
  reasons[5011] = 'Flat Health: live the burst into your E-R window.';
  reasons[5001] = 'Health scaling: skirmish HP for late E fights.';

  return {
    name: 'One Trick',
    primaryStyleId: 8000,
    subStyleId: 8400,
    selectedPerkIds: [
      keystone,
      9101, // Absorb Life
      9104, // Alacrity
      finisher,
      sec1,
      sec2,
      5005, // AS
      5008, // Adaptive
      defense,
    ],
    reasons,
  };
}

export function analyzeYoneMatchup(
  enemyTeam: Champion[],
  build?: Build,
  allyJungle?: Champion | null
): MatchupAnalysis {
  const ctx = scanMid(enemyTeam, allyJungle);
  const mid = ctx.enemyMid;
  const jg = ctx.allyJungle;

  const analysis: MatchupAnalysis = {
    title: 'SCALE & SNAP',
    description:
      'Weak early — farm with max-range Q, preserve HP, take short E trades when Q3 is ready. Spikes on Berserker\'s then two legendaries.',
    winCondition: 'Reach BotRK/Shieldbow + boots, then side-lane duel and E-R pick angles.',
    aggressionLevel: 'MODERATE',
    primaryTargets: enemyTeam
      .filter((c) => c.id !== 'Yuumi' && c.name !== 'Yuumi')
      .filter((c) => c.tags.includes('Marksman') || c.tags.includes('Mage') || c.tags.includes('Assassin'))
      .filter((c) => !c.tags.includes('Tank'))
      .map((c) => c.name)
      .slice(0, 3),
    majorThreats: enemyTeam
      .filter((c) => HARD_MELEE_BULLY.includes(c.id) || HARD_RANGE_POKE.includes(c.id))
      .map((c) => c.name)
      .slice(0, 2),
    tips: [],
  };

  // Expert quirks — encode one-trick patterns, not fluff
  const quirks: string[] = [
    // Skill-Capped: Q on-hit only on first target — Q through minion avoids aggro
    'Q through minions: on-hit applies to first target only — poke melee through wave without aggro; heal by Q\'ing creeps one-by-one.',
    // Q3 body knock-up
    'Q3 has two knock-ups (slash + body) — end the dash on top of them to guarantee CC.',
    // E snap-back / don't open E into R early
    'E toward, not away: enter with E, land Q3/R, snap back before retaliate — opening E→R wastes the escape.',
    // Berserker spike
    "Berserker's Greaves is the real first item — before it, Q CD is too long to trade efficiently.",
    // Cut Down / BotRK E interaction
    'BotRK %HP in E returns as true damage on snap-back — chunk then finish; do not greed autos after E ends.',
  ];

  if (mid && HARD_RANGE_POKE.includes(mid.id)) {
    analysis.title = 'FLEET SURVIVE → SPIKE';
    analysis.description = `${mid.name} owns early poke. Doran's Shield + Fleet; let them push, farm Q range, all-in only on spent spells + Q3.`;
    analysis.winCondition = 'Outscale first item — freeze near tower when possible, then side after 2 items.';
    analysis.aggressionLevel = jg?.style === 'early' ? 'MODERATE' : 'LOW';
    analysis.tips = [
      `Vs ${mid.name}: Q2 minion → Fleet MS run-up → E>Q>W short trade, snap back.`,
      jg?.style === 'early'
        ? `Hard poke — still freeze for ${jg.champ.name}; you don't win 1v1 early, you win the gank.`
        : 'Never burn E as a gap closer into their full rotation — they chunk the spirit form.',
      ...quirks.slice(0, 2),
    ];
  } else if (mid && HARD_MELEE_BULLY.includes(mid.id)) {
    analysis.title = 'RESPECT WINDOWS';
    analysis.description = `${mid.name} wins early extended trades. Bone Plating; trade only when their gap-closer is down.`;
    analysis.aggressionLevel =
      mid.id === 'Pantheon' || mid.id === 'Renekton'
        ? jg?.style === 'early'
          ? 'MODERATE'
          : 'LOW'
        : 'MODERATE';
    analysis.tips = [
      mid.id === 'Pantheon'
        ? 'Pantheon E blocks Q3 — bait block, then go. Point-click W owns every naive trade.'
        : `Vs ${mid.name}: short E trades on Q3 only — you scale harder past boots + BotRK.`,
      jg
        ? `Freeze near tower for ${jg.champ.name} — blind all-ins before Berserker's are ego.`
        : "Freeze near tower for jg help; blind all-ins before Berserker's are ego.",
      quirks[2],
      quirks[3],
    ];
  } else if (mid && ctx.immobile) {
    analysis.title = 'LANE BOSS TIMELINE';
    analysis.description = `${mid.name} is punishable — crash, deny, look for E-Q3-R all-ins from 6.`;
    analysis.winCondition = jg
      ? `Plate + dive with ${jg.champ.name} after crash; mid is a kill lane post-6.`
      : 'Plate + roam tempo after crash; mid is a kill lane post-6.';
    analysis.aggressionLevel = 'HIGH';
    analysis.tips = [
      `Level 6 combo: E → Q3 → R → W → autos → Q → snap (aussyelo / OT pattern).`,
      jg?.style === 'setup' || jg?.style === 'early'
        ? `Stack Q3 when ${jg.champ.name} paths mid — enter river fights with knock-up ready.`
        : 'Stack Q3 on wave/camp before river fights — enter with knock-up ready.',
      quirks[0],
      quirks[4],
    ];
  } else {
    analysis.tips = [
      'Levels 1–2: farm, thin with Q. Level 3 E online = first real trade window.',
      'Post-6: E-Q3-R is the all-in — miss R and leave.',
      ...quirks,
    ].slice(0, 6);
  }

  // Ally jungler is the relevant partner lane (Yone IS mid)
  if (jg) {
    analysis.tips = [...jg.notes, ...analysis.tips];
    if (jg.style === 'early' && ctx.bully) {
      analysis.title = `PLAY FOR ${jg.champ.name.toUpperCase()}`;
      analysis.winCondition = `Survive until ${jg.champ.name}'s first mid look, then convert XP/plates — don't ego 1v1.`;
    } else if (jg.style === 'farm' && ctx.bully) {
      analysis.description =
        `${analysis.description} Ally ${jg.champ.name} farms — treat early as solo; no dive timer.`;
    } else if (jg.style === 'setup') {
      analysis.winCondition =
        analysis.winCondition +
        ` Chain after ${jg.champ.name}'s CC — your E-R cleans the skirmish.`;
    }
  }

  // Pathing advice: jungle sync, not "ally mid"
  if (jg?.style === 'early') {
    analysis.roamAdvice = `Sync with ${jg.champ.name}: thin/freeze for their mid path, then crash and take river/scuttle. After 1–2 items, side-lane duel — TP covers fights.`;
  } else if (jg?.style === 'setup') {
    analysis.roamAdvice = `Hover for ${jg.champ.name} engages — stack Q3, E-R after their CC. Post two items, take side and TP to their objective setups.`;
  } else if (jg?.style === 'farm') {
    analysis.roamAdvice = `${jg.champ.name} scales camps — you hold mid alone early. After boots + legendary, side-lane pressure; meet them at second dragon/Herald.`;
  } else {
    analysis.roamAdvice = jg
      ? `Track ${jg.champ.name}'s clear — trade aggressive only when they can path mid. After 1–2 items, prefer side over hovering; TP covers fights.`
      : 'Track your jungler path — freeze for ganks, crash when they invade. After 1–2 items, side-lane duel; TP covers fights.';
  }

  if (build?.boots.id === ITEMS.BERSERKERS.id) {
    analysis.tips = [`Boots path: ${build.boots.reason}`, ...analysis.tips].slice(0, 6);
  }

  const threats = activeThreats(enemyTeam);
  if (threats.length > 0) {
    analysis.majorThreats = [...threats.map((t) => t.name), ...analysis.majorThreats].slice(0, 3);
    analysis.tips = [...threatTips(threats), ...analysis.tips];
  }

  analysis.tips = [analysis.roamAdvice, ...analysis.tips].slice(0, 8);

  const midName = mid?.name || 'mid';
  analysis.loadingDoctrine = [
    analysis.title,
    `Vs ${midName}: ${analysis.description.slice(0, 120)}`,
    analysis.aggressionLevel === 'LOW'
      ? 'Lv1–3: max-range Q, Fleet/Shield, short E only on spent spells. No ego all-ins.'
      : 'Lv1–3: Q through minions, Q3 body knock-up trades, crash for plates/river.',
    analysis.roamAdvice.slice(0, 140),
    `Win con: ${analysis.winCondition.slice(0, 110)}`,
  ].slice(0, 5);

  return analysis;
}

export function calculateYoneDominance(
  enemyTeam: Champion[],
  build: Build,
  allyJungle?: Champion | null
): DominanceMetrics {
  const ctx = scanMid(enemyTeam, allyJungle);
  let score = 48;
  if (ctx.immobile) score += 18;
  if (ctx.bully) score -= 12;
  if (ctx.assassin) score -= 8;
  if (ctx.tanks >= 2) score -= 6;
  // Ally jungle swings early favor
  if (ctx.allyJungle?.style === 'early') score += ctx.bully ? 10 : 6;
  if (ctx.allyJungle?.style === 'setup') score += 5;
  if (ctx.allyJungle?.style === 'farm' && ctx.bully) score -= 4;
  if (build.core.some((i) => i.id === ITEMS.BOTRK.id || i.id === ITEMS.KRAKEN.id)) score += 4;
  score = Math.min(100, Math.max(0, score));

  let grade: DominanceMetrics['grade'] = 'C';
  if (score >= 85) grade = 'S';
  else if (score >= 70) grade = 'A';
  else if (score >= 55) grade = 'B';
  else if (score >= 40) grade = 'C';
  else grade = 'D';

  const titles: Record<string, string> = {
    S: 'LANE DOMINANCE',
    A: 'SCALING FAVOR',
    B: 'STANDARD YONE',
    C: 'SURVIVAL ROUTE',
    D: 'HARD MATCHUP',
  };

  const jgBit = ctx.allyJungle
    ? ctx.allyJungle.style === 'early'
      ? ` Play for ${ctx.allyJungle.champ.name} ganks.`
      : ctx.allyJungle.style === 'farm'
        ? ` Solo lane early — ${ctx.allyJungle.champ.name} farms.`
        : ` Chain with ${ctx.allyJungle.champ.name}.`
    : '';

  return {
    score,
    grade,
    title: titles[grade] || 'YONE',
    summary: (ctx.immobile
      ? 'Immobile mid — play for plates and level 6 all-ins, then side.'
      : ctx.bully
        ? 'Bully lane — Fleet/Shield, scale to Berserker + BotRK, then take over sides.'
        : 'Farm for boots spike; win through E timing and side-lane duels.') + jgBit,
    earlyGameScore: Math.min(
      100,
      (ctx.immobile ? 70 : ctx.bully ? 35 : 45) +
        (ctx.allyJungle?.style === 'early' ? 12 : ctx.allyJungle?.style === 'farm' && ctx.bully ? -8 : 0)
    ),
    midGameScore: 75,
    lateGameScore: 85,
  };
}
