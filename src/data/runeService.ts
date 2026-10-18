// Rune service using official Data Dragon API
// API: https://ddragon.leagueoflegends.com/cdn/{version}/data/en_US/runesReforged.json

interface RuneData {
    id: number;
    key: string;
    icon: string;
    name: string;
    shortDesc: string;
    longDesc: string;
}

interface RuneTree {
    id: number;
    key: string;
    icon: string;
    name: string;
    slots: Array<{
        runes: RuneData[];
    }>;
}

let runeCache: Map<number, RuneData> | null = null;
let ddragonVersion: string = '15.1.1';

// Fetch latest Data Dragon version
export const fetchLatestVersion = async (): Promise<string> => {
    try {
        const response = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
        const versions = await response.json();
        return versions[0]; // Latest version is first in array
    } catch (error) {
        console.warn('Failed to fetch latest version, using fallback:', error);
        return ddragonVersion;
    }
};

// Fetch all rune data from Data Dragon
export const fetchRunes = async (): Promise<Map<number, RuneData>> => {
    if (runeCache) {
        return runeCache;
    }

    try {
        const version = await fetchLatestVersion();
        ddragonVersion = version;
        const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/runesReforged.json`);
        const runeTrees: RuneTree[] = await response.json();
        
        const runeMap = new Map<number, RuneData>();
        
        // Flatten all runes from all trees into a map
        runeTrees.forEach(tree => {
            tree.slots.forEach(slot => {
                slot.runes.forEach(rune => {
                    runeMap.set(rune.id, rune);
                });
            });
        });
        
        runeCache = runeMap;
        return runeMap;
    } catch (error) {
        console.error('Failed to fetch runes:', error);
        return new Map();
    }
};

// Get rune icon URL using official Data Dragon format
export const getRuneIconUrl = (runeId: number, version?: string): string => {
    const v = version || ddragonVersion;
    // Official format: https://ddragon.leagueoflegends.com/cdn/{version}/img/perk/{runeId}.png
    return `https://ddragon.leagueoflegends.com/cdn/${v}/img/perk/${runeId}.png`;
};

// Get rune data by ID
export const getRuneData = async (runeId: number): Promise<RuneData | null> => {
    const runes = await fetchRunes();
    return runes.get(runeId) || null;
};

const STYLE_ICON_BASE = 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles';
const STAT_ICON_BASE = 'https://ddragon.leagueoflegends.com/cdn/img/perk-images/StatMods';

export interface RuneMeta {
    name: string;
    icon: string;
}

/**
 * Static metadata for every perk the profiles can select. Data Dragon's
 * `img/perk/{id}.png` route only covers stat shards, so keystones and minor
 * runes need their Styles path — this keeps the panel correct for all profiles
 * without an extra network round trip on first paint.
 */
export const RUNE_META: Record<number, RuneMeta> = {
    // Domination
    9923: { name: 'Hail of Blades', icon: `${STYLE_ICON_BASE}/Domination/HailOfBlades/HailOfBlades.png` },
    8112: { name: 'Electrocute', icon: `${STYLE_ICON_BASE}/Domination/Electrocute/Electrocute.png` },
    8143: { name: 'Sudden Impact', icon: `${STYLE_ICON_BASE}/Domination/SuddenImpact/SuddenImpact.png` },
    8126: { name: 'Cheap Shot', icon: `${STYLE_ICON_BASE}/Domination/CheapShot/CheapShot.png` },
    8137: { name: 'Sixth Sense', icon: `${STYLE_ICON_BASE}/Domination/SixthSense/SixthSense.png` },
    8141: { name: 'Deep Ward', icon: `${STYLE_ICON_BASE}/Domination/DeepWard/DeepWard.png` },
    8140: { name: 'Grisly Mementos', icon: `${STYLE_ICON_BASE}/Domination/GrislyMementos/GrislyMementos.png` },
    8106: { name: 'Ultimate Hunter', icon: `${STYLE_ICON_BASE}/Domination/UltimateHunter/UltimateHunter.png` },
    // Resolve
    8439: { name: 'Aftershock', icon: `${STYLE_ICON_BASE}/Resolve/VeteranAftershock/VeteranAftershock.png` },
    8463: { name: 'Font of Life', icon: `${STYLE_ICON_BASE}/Resolve/FontOfLife/FontOfLife.png` },
    8473: { name: 'Bone Plating', icon: `${STYLE_ICON_BASE}/Resolve/BonePlating/BonePlating.png` },
    8444: { name: 'Second Wind', icon: `${STYLE_ICON_BASE}/Resolve/SecondWind/SecondWind.png` },
    8451: { name: 'Overgrowth', icon: `${STYLE_ICON_BASE}/Resolve/Overgrowth/Overgrowth.png` },
    8242: { name: 'Unflinching', icon: `${STYLE_ICON_BASE}/Sorcery/Unflinching/Unflinching.png` },
    // Precision
    8008: { name: 'Lethal Tempo', icon: `${STYLE_ICON_BASE}/Precision/LethalTempo/LethalTempoTemp.png` },
    8021: { name: 'Fleet Footwork', icon: `${STYLE_ICON_BASE}/Precision/FleetFootwork/FleetFootwork.png` },
    9101: { name: 'Absorb Life', icon: `${STYLE_ICON_BASE}/Precision/AbsorbLife/AbsorbLife.png` },
    9104: { name: 'Legend: Alacrity', icon: `${STYLE_ICON_BASE}/Precision/LegendAlacrity/LegendAlacrity.png` },
    8009: { name: 'Presence of Mind', icon: `${STYLE_ICON_BASE}/Precision/PresenceOfMind/PresenceOfMind.png` },
    8017: { name: 'Cut Down', icon: `${STYLE_ICON_BASE}/Precision/CutDown/CutDown.png` },
    8299: { name: 'Last Stand', icon: `${STYLE_ICON_BASE}/Precision/LastStand/LastStand.png` },
    8014: { name: 'Coup de Grace', icon: `${STYLE_ICON_BASE}/Precision/CoupDeGrace/CoupDeGrace.png` },
    // Stat shards (26.x+ rows: Offense 5008/5005/5007 | Flex 5008/5010/5001 | Defense 5011/5013/5001)
    5001: { name: 'Health Scaling', icon: `${STAT_ICON_BASE}/StatModsHealthScalingIcon.png` },
    5005: { name: 'Attack Speed', icon: `${STAT_ICON_BASE}/StatModsAttackSpeedIcon.png` },
    5007: { name: 'Ability Haste', icon: `${STAT_ICON_BASE}/StatModsCDRScalingIcon.png` },
    5008: { name: 'Adaptive Force', icon: `${STAT_ICON_BASE}/StatModsAdaptiveForceIcon.png` },
    5010: { name: 'Move Speed', icon: `${STAT_ICON_BASE}/StatModsMovementSpeedIcon.png` },
    5011: { name: 'Health', icon: `${STAT_ICON_BASE}/StatModsHealthPlusIcon.png` },
    5013: { name: 'Tenacity and Slow Resist', icon: `${STAT_ICON_BASE}/StatModsTenacityIcon.png` },
};

export const STYLE_META: Record<number, RuneMeta> = {
    8000: { name: 'Precision', icon: `${STYLE_ICON_BASE}/7201_Precision.png` },
    8100: { name: 'Domination', icon: `${STYLE_ICON_BASE}/7200_Domination.png` },
    8200: { name: 'Sorcery', icon: `${STYLE_ICON_BASE}/7202_Sorcery.png` },
    8300: { name: 'Inspiration', icon: `${STYLE_ICON_BASE}/7203_Whimsy.png` },
    8400: { name: 'Resolve', icon: `${STYLE_ICON_BASE}/7204_Resolve.png` },
};

export const getRuneMeta = (id: number): RuneMeta =>
    RUNE_META[id] || { name: `Perk ${id}`, icon: getRuneIconUrl(id) };

export const getStyleMeta = (id: number): RuneMeta =>
    STYLE_META[id] || { name: 'Tree', icon: `${STYLE_ICON_BASE}/7201_Precision.png` };



