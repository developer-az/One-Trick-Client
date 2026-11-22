/** Live popular build (OP.GG), shared by the main process and the UI. No win rates (D1). */
export type LiveBuildRole = 'Top' | 'Jungle' | 'Mid' | 'Bot' | 'Support';
export type LiveBuildMode = 'ranked' | 'aram';

export interface LiveItemSet {
    ids: number[];
    names: string[];
    pickRate: number | null;
    games: number | null;
}

export interface LiveBuild {
    source: 'OP.GG';
    patch: string;
    champion: string;
    role: LiveBuildRole;
    mode: LiveBuildMode;
    fetchedAt: number;
    core: LiveItemSet | null;
    boots: LiveItemSet | null;
    starter: LiveItemSet | null;
    runes: { primary: string; keystones: string[]; secondary: string; secondaryRunes: string[]; pickRate: number | null } | null;
    skillOrder: string[];
}
