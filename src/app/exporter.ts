import type { ChampionProfile } from '../logic/profiles';
import { SUMMONER_SPELLS } from '../logic/summonerSpells';
import type { Loadout } from './views/LoadoutView';

export interface ExportResult {
  ok: boolean;
  title: string;
  body?: string;
}

function spellIds(names: string[]): [number, number] | null {
  const ids = names
    .map((n) => Object.values(SUMMONER_SPELLS).find((s) => s.name.toLowerCase() === n.toLowerCase())?.id)
    .filter((id): id is number => typeof id === 'number');
  return ids.length >= 2 ? [ids[0], ids[1]] : null;
}

/** Send the rune page and item set (and optionally spells) to the League client. */
export async function sendLoadout(
  profile: ChampionProfile,
  loadout: Loadout,
  opts: { spells?: boolean } = {}
): Promise<ExportResult> {
  const api = window.electronAPI;
  if (!api) return { ok: false, title: 'Desktop app needed' };
  const { build, runes } = loadout;
  try {
    if (runes.selectedPerkIds.length !== 9) {
      throw new Error(`Rune page is incomplete (${runes.selectedPerkIds.length} of 9 runes).`);
    }
    const runeRes = await api.exportRunePage({
      name: profile.runePageName,
      primaryStyleId: runes.primaryStyleId,
      subStyleId: runes.subStyleId,
      selectedPerkIds: [...runes.selectedPerkIds],
      current: true,
    });
    if (!runeRes.success) throw new Error(runeRes.error || 'The client rejected the rune page.');

    const itemRes = await api.exportItemSet({
      starter: build.starter,
      core: build.core,
      boots: build.boots,
      situational: build.situational,
      buildPath: build.buildPath,
      championKey: profile.championKey,
      title: profile.itemSetTitle,
    });
    if (!itemRes?.success) {
      return { ok: false, title: 'Runes sent, items failed', body: itemRes?.error || 'Item set export failed.' };
    }

    let spellNote = '';
    if (opts.spells && api.setSummonerSpells) {
      const ids = spellIds(build.spells);
      const res = ids ? await api.setSummonerSpells(ids) : null;
      if (res?.success) spellNote = ` Spells: ${build.spells.slice(0, 2).join(' and ')}.`;
    }
    return {
      ok: true,
      title: 'Sent to the League client',
      body: `Rune page "${profile.runePageName}" and item set "${profile.itemSetTitle}".${spellNote}`,
    };
  } catch (error) {
    return { ok: false, title: 'Export failed', body: (error as Error).message || 'Unknown error' };
  }
}
