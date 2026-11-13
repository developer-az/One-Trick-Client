// Visual hierarchy for enemy summoner-spell chips on the HUD.
// Pure: no React, no clock. The component feeds it the live remaining seconds.

export type ChipPriority = 'primary' | 'secondary';
export type ChipState = 'ready' | 'down' | 'soon';

export interface ChipTone {
    priority: ChipPriority;
    state: ChipState;
    /** Share of the cooldown still remaining, integer 0..100 (0 when ready). */
    fillPct: number;
}

/** A cooldown that ends within this many seconds is flagged as "soon". */
export const SOON_SECONDS = 15;

interface ChipSpell {
    name?: string;
    short?: string;
    baseCd?: number;
    remaining?: number;
    ready?: boolean;
}

function num(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function chipTone(spell: ChipSpell): ChipTone {
    const name = (spell.name ?? '').trim().toLowerCase();
    const short = (spell.short ?? '').trim().toLowerCase();
    const priority: ChipPriority = name === 'flash' || short === 'f' || short === 'flash' ? 'primary' : 'secondary';
    const remaining = num(spell.remaining);
    const baseCd = num(spell.baseCd);
    if (spell.ready || remaining <= 0) return { priority, state: 'ready', fillPct: 0 };
    const state: ChipState = remaining <= SOON_SECONDS ? 'soon' : 'down';
    const fillPct = baseCd > 0 ? Math.min(100, Math.max(0, Math.round((remaining / baseCd) * 100))) : 0;
    return { priority, state, fillPct };
}
