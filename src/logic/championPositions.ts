import type { CatalogRole } from '../catalog/types';

/**
 * Where each champion is usually played, most common first (Data Dragon ids).
 *
 * The LCU hides enemy positions in champ select and the Live Client often
 * reports an empty `position` outside ranked, so lanes have to be inferred.
 * Class tags alone can't do it (no tag means "jungle"), which is why this
 * table exists. Champions missing here fall back to tag heuristics.
 */
export const CHAMPION_POSITIONS: Record<string, CatalogRole[]> = {
  Aatrox: ['Top'],
  Ahri: ['Mid'],
  Akali: ['Mid', 'Top'],
  Akshan: ['Mid', 'Top'],
  Alistar: ['Support'],
  Ambessa: ['Top', 'Jungle'],
  Amumu: ['Jungle', 'Support'],
  Anivia: ['Mid'],
  Annie: ['Mid', 'Support'],
  Aphelios: ['Bot'],
  Ashe: ['Bot', 'Support'],
  AurelionSol: ['Mid'],
  Aurora: ['Mid', 'Top'],
  Azir: ['Mid'],
  Bard: ['Support'],
  Belveth: ['Jungle'],
  Blitzcrank: ['Support'],
  Brand: ['Support', 'Jungle', 'Mid'],
  Braum: ['Support'],
  Briar: ['Jungle'],
  Caitlyn: ['Bot'],
  Camille: ['Top'],
  Cassiopeia: ['Mid', 'Top'],
  Chogath: ['Top', 'Mid'],
  Corki: ['Mid'],
  Darius: ['Top'],
  Diana: ['Jungle', 'Mid'],
  DrMundo: ['Top', 'Jungle'],
  Draven: ['Bot'],
  Ekko: ['Jungle', 'Mid'],
  Elise: ['Jungle'],
  Evelynn: ['Jungle'],
  Ezreal: ['Bot'],
  Fiddlesticks: ['Jungle'],
  Fiora: ['Top'],
  Fizz: ['Mid'],
  Galio: ['Mid', 'Support'],
  Gangplank: ['Top'],
  Garen: ['Top'],
  Gnar: ['Top'],
  Gragas: ['Jungle', 'Top'],
  Graves: ['Jungle'],
  Gwen: ['Top', 'Jungle'],
  Hecarim: ['Jungle'],
  Heimerdinger: ['Mid', 'Top', 'Support'],
  Hwei: ['Mid', 'Support'],
  Illaoi: ['Top'],
  Irelia: ['Top', 'Mid'],
  Ivern: ['Jungle'],
  Janna: ['Support'],
  JarvanIV: ['Jungle'],
  Jax: ['Top', 'Jungle'],
  Jayce: ['Top', 'Mid'],
  Jhin: ['Bot'],
  Jinx: ['Bot'],
  KSante: ['Top'],
  Kaisa: ['Bot'],
  Kalista: ['Bot'],
  Karma: ['Support', 'Mid'],
  Karthus: ['Jungle'],
  Kassadin: ['Mid'],
  Katarina: ['Mid'],
  Kayle: ['Top'],
  Kayn: ['Jungle'],
  Kennen: ['Top'],
  Khazix: ['Jungle'],
  Kindred: ['Jungle'],
  Kled: ['Top'],
  KogMaw: ['Bot'],
  Leblanc: ['Mid'],
  LeeSin: ['Jungle'],
  Leona: ['Support'],
  Lillia: ['Jungle'],
  Lissandra: ['Mid'],
  Lucian: ['Bot', 'Mid'],
  Lulu: ['Support'],
  Lux: ['Support', 'Mid'],
  Malphite: ['Top', 'Support'],
  Malzahar: ['Mid'],
  Maokai: ['Support', 'Jungle', 'Top'],
  MasterYi: ['Jungle'],
  Mel: ['Mid', 'Support'],
  Milio: ['Support'],
  MissFortune: ['Bot'],
  MonkeyKing: ['Jungle', 'Top'],
  Mordekaiser: ['Top'],
  Morgana: ['Support'],
  Naafiri: ['Mid'],
  Nami: ['Support'],
  Nasus: ['Top'],
  Nautilus: ['Support'],
  Neeko: ['Mid', 'Support'],
  Nidalee: ['Jungle'],
  Nilah: ['Bot'],
  Nocturne: ['Jungle'],
  Nunu: ['Jungle'],
  Olaf: ['Top', 'Jungle'],
  Orianna: ['Mid'],
  Ornn: ['Top'],
  Pantheon: ['Support', 'Top', 'Mid', 'Jungle'],
  Poppy: ['Top', 'Jungle', 'Support'],
  Pyke: ['Support'],
  Qiyana: ['Mid', 'Jungle'],
  Quinn: ['Top'],
  Rakan: ['Support'],
  Rammus: ['Jungle'],
  RekSai: ['Jungle'],
  Rell: ['Support'],
  Renata: ['Support'],
  Renekton: ['Top'],
  Rengar: ['Jungle', 'Top'],
  Riven: ['Top'],
  Rumble: ['Top', 'Mid'],
  Ryze: ['Mid', 'Top'],
  Samira: ['Bot'],
  Sejuani: ['Jungle'],
  Senna: ['Support', 'Bot'],
  Seraphine: ['Support', 'Bot', 'Mid'],
  Sett: ['Top', 'Support'],
  Shaco: ['Jungle', 'Support'],
  Shen: ['Top', 'Support'],
  Shyvana: ['Jungle'],
  Singed: ['Top'],
  Sion: ['Top'],
  Sivir: ['Bot'],
  Skarner: ['Jungle', 'Top'],
  Smolder: ['Bot', 'Mid'],
  Sona: ['Support'],
  Soraka: ['Support'],
  Swain: ['Support', 'Mid', 'Bot'],
  Sylas: ['Mid', 'Jungle'],
  Syndra: ['Mid'],
  TahmKench: ['Top', 'Support'],
  Taliyah: ['Jungle', 'Mid'],
  Talon: ['Mid', 'Jungle'],
  Taric: ['Support'],
  Teemo: ['Top'],
  Thresh: ['Support'],
  Tristana: ['Bot', 'Mid'],
  Trundle: ['Jungle', 'Top'],
  Tryndamere: ['Top'],
  TwistedFate: ['Mid'],
  Twitch: ['Bot', 'Jungle'],
  Udyr: ['Jungle', 'Top'],
  Urgot: ['Top'],
  Varus: ['Bot', 'Mid'],
  Vayne: ['Bot', 'Top'],
  Veigar: ['Mid', 'Support'],
  Velkoz: ['Support', 'Mid'],
  Vex: ['Mid'],
  Vi: ['Jungle'],
  Viego: ['Jungle'],
  Viktor: ['Mid'],
  Vladimir: ['Mid', 'Top'],
  Volibear: ['Top', 'Jungle'],
  Warwick: ['Jungle', 'Top'],
  Xayah: ['Bot'],
  Xerath: ['Support', 'Mid'],
  XinZhao: ['Jungle'],
  Yasuo: ['Mid', 'Top', 'Bot'],
  Yone: ['Mid', 'Top'],
  Yorick: ['Top'],
  Yuumi: ['Support'],
  Yunara: ['Bot'],
  Zac: ['Jungle'],
  Zed: ['Mid', 'Jungle'],
  Zeri: ['Bot'],
  Ziggs: ['Bot', 'Mid'],
  Zilean: ['Support', 'Mid'],
  Zoe: ['Mid'],
  Zyra: ['Support', 'Jungle'],
};

const ROLES: CatalogRole[] = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];

/** How plausible is `role` for this champion? 0 (never) … 1 (main role). */
export function rolePlausibility(championId: string, tags: string[], role: CatalogRole): number {
  const known = CHAMPION_POSITIONS[championId];
  if (known) {
    const index = known.indexOf(role);
    if (index === 0) return 1;
    if (index > 0) return Math.max(0.35, 0.7 - 0.15 * (index - 1));
    return 0.02;
  }
  // Unknown (new) champion: lean on class tags.
  const has = (t: string) => tags.includes(t);
  switch (role) {
    case 'Bot':
      return has('Marksman') ? 0.9 : 0.05;
    case 'Support':
      return has('Support') ? 0.9 : has('Tank') ? 0.3 : 0.05;
    case 'Mid':
      return has('Mage') || has('Assassin') ? 0.8 : 0.2;
    case 'Top':
      return has('Fighter') || has('Tank') ? 0.8 : 0.15;
    case 'Jungle':
      return has('Fighter') || has('Assassin') ? 0.4 : 0.15;
    default:
      return 0.1;
  }
}

export interface RoleCandidate {
  /** Stable key for the slot (cell id, summoner name, …). */
  key: string;
  championId: string;
  tags: string[];
  /** A role the client already told us (ranked ally positions). */
  knownRole?: CatalogRole | null;
}

/**
 * Assign up to five champions to five distinct roles, maximising the product of
 * plausibilities. Known roles are fixed. Brute force is fine: 5! = 120.
 */
export function solveRoles(candidates: RoleCandidate[]): Map<string, CatalogRole> {
  const result = new Map<string, CatalogRole>();
  const taken = new Set<CatalogRole>();
  const open: RoleCandidate[] = [];
  for (const c of candidates.slice(0, 5)) {
    if (c.knownRole && !taken.has(c.knownRole)) {
      result.set(c.key, c.knownRole);
      taken.add(c.knownRole);
    } else {
      open.push(c);
    }
  }
  const freeRoles = ROLES.filter((r) => !taken.has(r));
  let best: CatalogRole[] | null = null;
  let bestScore = -Infinity;

  const permute = (index: number, used: Set<CatalogRole>, picked: CatalogRole[], score: number) => {
    if (index === open.length) {
      if (score > bestScore) {
        bestScore = score;
        best = [...picked];
      }
      return;
    }
    for (const role of freeRoles) {
      if (used.has(role)) continue;
      const p = rolePlausibility(open[index].championId, open[index].tags, role);
      used.add(role);
      picked.push(role);
      permute(index + 1, used, picked, score + Math.log(p));
      picked.pop();
      used.delete(role);
    }
  };
  permute(0, new Set(), [], 0);

  if (best) {
    (best as CatalogRole[]).forEach((role, i) => result.set(open[i].key, role));
  }
  return result;
}
