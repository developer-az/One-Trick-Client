/**
 * Live popular builds from the OP.GG MCP server (`lol_get_champion_analysis`),
 * cached per game patch on disk.
 *
 * D1: only pick rates and game counts are requested and kept, never win rates.
 * Every number carries its source and patch.
 */
import fs from 'fs';
import path from 'path';
import { userDataDir } from './paths';

const OPGG_MCP = 'https://mcp-api.op.gg/mcp';
const CDRAGON_META = 'https://raw.communitydragon.org/latest/content-metadata.json';

import type { LiveBuild, LiveBuildMode, LiveBuildRole, LiveItemSet } from '../src/logic/liveBuild';

export type { LiveBuild, LiveBuildMode, LiveBuildRole };

const POSITION: Record<LiveBuildRole, string> = { Top: 'top', Jungle: 'jungle', Mid: 'mid', Bot: 'adc', Support: 'support' };

/** Data Dragon id → OP.GG champion name: MissFortune → MISS_FORTUNE, KSante → KSANTE. */
export function opggChampionName(ddragonId: string): string {
    return ddragonId.replace(/([a-z])([A-Z])/g, '$1_$2').replace(/[^A-Za-z_]/g, '').toUpperCase();
}

// ---- Parser for OP.GG's text format -------------------------------------
// "class Name: f1,f2\n...\n\nName(value, ...)" where values are Name(...),
// [..], "str", numbers, None/null/True/False. Args map to the class fields by position.

type Val = string | number | boolean | null | Val[] | { [k: string]: Val };

export function parseOpggText(text: string): Val {
    const fields = new Map<string, string[]>();
    const blank = text.indexOf('\n\n');
    const head = blank >= 0 ? text.slice(0, blank) : '';
    const body = blank >= 0 ? text.slice(blank + 2) : text;
    for (const line of head.split('\n')) {
        const m = /^class (\w+): (.*)$/.exec(line.trim());
        if (m) fields.set(m[1], m[2].split(',').map((s) => s.trim()));
    }
    let i = 0;
    const ws = (): void => {
        while (i < body.length && /\s/.test(body[i])) i++;
    };
    const value = (): Val => {
        ws();
        const ch = body[i];
        if (ch === '"' || ch === "'") {
            const q = ch;
            let out = '';
            i++;
            while (i < body.length && body[i] !== q) {
                if (body[i] === '\\') i++;
                out += body[i++];
            }
            i++;
            return out;
        }
        if (ch === '[') {
            i++;
            const list = args(']');
            return list;
        }
        const word = /^[A-Za-z_]\w*/.exec(body.slice(i));
        if (word) {
            i += word[0].length;
            ws();
            if (body[i] === '(') {
                i++;
                const list = args(')');
                const names = fields.get(word[0]) ?? [];
                const obj: { [k: string]: Val } = {};
                list.forEach((v, n) => {
                    obj[names[n] ?? `_${n}`] = v;
                });
                return obj;
            }
            if (word[0] === 'True' || word[0] === 'true') return true;
            if (word[0] === 'False' || word[0] === 'false') return false;
            return null; // None / null
        }
        const num = /^-?\d+(\.\d+)?([eE][-+]?\d+)?/.exec(body.slice(i));
        if (num) {
            i += num[0].length;
            return Number(num[0]);
        }
        throw new Error(`OP.GG parse error at ${i}`);
    };
    const args = (close: string): Val[] => {
        const list: Val[] = [];
        ws();
        if (body[i] === close) {
            i++;
            return list;
        }
        for (;;) {
            list.push(value());
            ws();
            if (body[i] === ',') {
                i++;
                continue;
            }
            if (body[i] === close) {
                i++;
                return list;
            }
            throw new Error(`OP.GG parse error at ${i}`);
        }
    };
    return value();
}

const obj = (v: Val | undefined): { [k: string]: Val } | null =>
    v && typeof v === 'object' && !Array.isArray(v) ? v : null;
const num = (v: Val | undefined): number | null => (typeof v === 'number' ? v : null);
const strs = (v: Val | undefined): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const nums = (v: Val | undefined): number[] => (Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []);

function itemSet(v: Val | undefined): LiveItemSet | null {
    const o = obj(v);
    if (!o) return null;
    const ids = nums(o.ids);
    return ids.length ? { ids, names: strs(o.ids_names), pickRate: num(o.pick_rate), games: num(o.play) } : null;
}

export function liveBuildFromText(
    text: string,
    meta: { champion: string; role: LiveBuildRole; mode: LiveBuildMode; fetchedAt: number }
): LiveBuild | null {
    const data = obj(obj(parseOpggText(text))?.data);
    if (!data) return null;
    const runes = obj(data.runes);
    const patch = obj(obj(obj(data.trends)?.pick))?.version;
    const build: LiveBuild = {
        source: 'OP.GG',
        patch: typeof patch === 'string' ? patch : 'unknown',
        ...meta,
        core: itemSet(data.core_items),
        boots: itemSet(data.boots),
        starter: itemSet(data.starter_items),
        runes: runes
            ? {
                  primary: String(runes.primary_page_name ?? ''),
                  keystones: strs(runes.primary_rune_names),
                  secondary: String(runes.secondary_page_name ?? ''),
                  secondaryRunes: strs(runes.secondary_rune_names),
                  pickRate: num(runes.pick_rate),
              }
            : null,
        skillOrder: strs(obj(data.skills)?.order),
    };
    return build.core || build.boots || build.runes ? build : null;
}

// ---- Network + cache ------------------------------------------------------

/** Closed field set from the tool schema. No win / win_rate fields (D1). */
const FIELDS = [
    'data.core_items.{ids[],ids_names[],pick_rate,play}',
    'data.boots.{ids[],ids_names[],pick_rate,play}',
    'data.starter_items.{ids[],ids_names[],pick_rate,play}',
    'data.runes.{primary_page_name,primary_rune_names[],secondary_page_name,secondary_rune_names[],pick_rate}',
    'data.skills.{order[],pick_rate}',
    'data.trends.pick.{version}',
];

async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.text();
}

let patchPromise: Promise<string> | null = null;
/** Current game patch ("16.23") from CommunityDragon, once per app run. */
export function currentPatch(): Promise<string> {
    patchPromise ??= fetchJson(CDRAGON_META, {}, 10_000)
        .then((t) => /^(\d+\.\d+)/.exec(String(JSON.parse(t).version))?.[1] ?? 'unknown')
        .catch(() => {
            patchPromise = null;
            return 'unknown';
        });
    return patchPromise;
}

async function fetchFromOpgg(champion: string, role: LiveBuildRole, mode: LiveBuildMode): Promise<LiveBuild | null> {
    const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
            name: 'lol_get_champion_analysis',
            arguments: {
                champion: opggChampionName(champion),
                position: POSITION[role],
                game_mode: mode,
                desired_output_fields: FIELDS,
                client_app: 'OneTrick',
            },
        },
    });
    let raw = await fetchJson(
        OPGG_MCP,
        { method: 'POST', body, headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' } },
        15_000
    );
    // Streamable HTTP may answer as SSE: keep the data lines.
    if (/^\s*(event|data):/.test(raw)) {
        raw = raw
            .split('\n')
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5))
            .join('');
    }
    const msg = JSON.parse(raw) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
    const text = msg.result?.content?.[0]?.text;
    if (!text || msg.result?.isError) return null;
    return liveBuildFromText(text, { champion, role, mode, fetchedAt: Date.now() });
}

const cacheFile = (patch: string, champion: string, role: LiveBuildRole, mode: LiveBuildMode): string =>
    path.join(userDataDir(), 'live-builds', patch, `${champion}-${role}-${mode}.json`.replace(/[^\w.-]/g, '_'));

/**
 * Popular build for a champion. Disk cache per patch: one request per champion,
 * role and mode per patch. Returns null when OP.GG has no data or is down.
 */
export async function getLiveBuild(champion: string, role: LiveBuildRole, mode: LiveBuildMode = 'ranked'): Promise<LiveBuild | null> {
    if (!/^[A-Za-z]+$/.test(champion) || !(role in POSITION)) return null;
    const patch = await currentPatch();
    const file = cacheFile(patch, champion, role, mode);
    if (patch !== 'unknown') {
        try {
            return JSON.parse(fs.readFileSync(file, 'utf8')) as LiveBuild;
        } catch {
            /* not cached yet */
        }
    }
    const build = await fetchFromOpgg(champion, role, mode).catch(() => null);
    if (build && patch !== 'unknown') {
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(file, JSON.stringify(build));
        } catch {
            /* cache is best-effort */
        }
    }
    return build;
}
