import { exec } from 'child_process';
import { randomUUID } from 'crypto';
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

let credentials: LcuCredentials | null = null;

// Reused across every request — creating a new https.Agent per call (as this
// previously did) means a fresh TLS context/socket pool on every single LCU
// request. On a 1–1.5s poll cadence for the life of the app that's constant,
// avoidable socket churn competing with the game for CPU.
const lcuHttpsAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

export interface LcuCredentials {
    port: string;
    token: string;
    protocol: string;
    /** pid of LeagueClient — changes on every client restart. */
    pid?: number;
}

// Literal roots: path.join('C:', 'Riot Games') is drive-relative on Windows.
const DEFAULT_INSTALL_DIRS = [
    'C:\\Riot Games\\League of Legends',
    'D:\\Riot Games\\League of Legends',
    'E:\\Riot Games\\League of Legends',
    path.join(process.env['ProgramFiles'] || 'C:\\Program Files', 'Riot Games', 'League of Legends'),
];

/**
 * Riot's own installer metadata records where League actually lives, so custom
 * install folders work without PowerShell process scanning.
 */
const RIOT_PRODUCT_SETTINGS = path.join(
    process.env['ProgramData'] || 'C:\\ProgramData',
    'Riot Games',
    'Metadata',
    'league_of_legends.live',
    'league_of_legends.live.product_settings.yaml'
);

let installDirs: string[] | null = null;

async function discoverInstallDirs(): Promise<string[]> {
    if (installDirs) return installDirs;
    const dirs: string[] = [];
    try {
        const raw = await fs.promises.readFile(RIOT_PRODUCT_SETTINGS, 'utf8');
        const match = raw.match(/product_install_full_path:\s*"?([^"\r\n]+)"?/);
        if (match?.[1]) dirs.push(path.normalize(match[1].trim()));
    } catch {
        // Not installed in the default Riot layout — fall back to common folders.
    }
    for (const dir of DEFAULT_INSTALL_DIRS) {
        if (!dirs.includes(dir)) dirs.push(dir);
    }
    installDirs = dirs;
    return dirs;
}

/** Remember a folder learned from the process command line for future lockfile reads. */
function rememberInstallDir(dir: string): void {
    const normalized = path.normalize(dir);
    installDirs = [normalized, ...(installDirs || []).filter((d) => d !== normalized)];
}

function parseLockfile(raw: string): LcuCredentials | null {
    // Format: LeagueClient:pid:port:password:https
    const parts = raw.trim().split(':');
    if (parts.length < 5) return null;
    const pid = Number(parts[1]);
    const port = parts[2];
    const token = parts[3];
    const protocol = parts[4] || 'https';
    if (!/^\d+$/.test(port) || !token) return null;
    return { port, token, protocol, pid: Number.isFinite(pid) ? pid : undefined };
}

/**
 * The lockfile exists only while the League client runs, so reading it is both
 * the cheapest "is the client open?" probe and the credential source.
 */
export async function readLockfileCredentials(): Promise<LcuCredentials | null> {
    for (const dir of await discoverInstallDirs()) {
        try {
            const raw = await fs.promises.readFile(path.join(dir, 'lockfile'), 'utf8');
            const parsed = parseLockfile(raw);
            if (parsed) return parsed;
        } catch {
            // try next
        }
    }
    return null;
}

let lastPowerShellProbe = 0;
/** PowerShell + CIM can stall a machine for seconds; never run it more than once a minute. */
const POWERSHELL_MIN_INTERVAL_MS = 60000;

/** Slow fallback for unusual installs. Only used on explicit connect requests. */
async function connectViaPowerShell(): Promise<LcuCredentials> {
    const now = Date.now();
    if (now - lastPowerShellProbe < POWERSHELL_MIN_INTERVAL_MS) {
        throw new Error('League client not found — open the League client and try again');
    }
    lastPowerShellProbe = now;
    const command = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name = 'LeagueClientUx.exe'\\" | Select-Object -ExpandProperty CommandLine"`;
    const { stdout } = await execAsync(command, { timeout: 8000, windowsHide: true });
    if (!stdout?.trim()) {
        throw new Error('League client not found — open the League client and try again');
    }
    const portMatch = stdout.match(/--app-port=([0-9]*)/);
    const tokenMatch = stdout.match(/--remoting-auth-token=([\w-]*)/);
    const dirMatch = stdout.match(/--install-directory=([^"]+?)(?:"|\s--)/);
    if (dirMatch?.[1]) rememberInstallDir(dirMatch[1].trim());
    if (!portMatch || !tokenMatch) {
        throw new Error('Could not parse League client credentials from its command line');
    }
    return { port: portMatch[1], token: tokenMatch[1], protocol: 'https' };
}

export function getLcuCredentials(): LcuCredentials | null {
    return credentials;
}

export function setLcuCredentials(next: LcuCredentials | null): void {
    credentials = next;
}

/**
 * Resolve credentials. `allowSlowProbe` permits the PowerShell fallback and is
 * only set for user-initiated connects, never from background loops.
 */
export const connectToLCU = async (allowSlowProbe = false): Promise<LcuCredentials> => {
    const fromLock = await readLockfileCredentials();
    if (fromLock) {
        credentials = fromLock;
        return credentials;
    }
    if (process.platform === 'win32' && allowSlowProbe) {
        credentials = await connectViaPowerShell();
        return credentials;
    }
    throw new Error('League client not found — open the League client and try again');
};

/** Refresh credentials before write ops — tokens rotate when the client restarts. */
export const ensureLCUConnected = async (): Promise<void> => {
    if (credentials) {
        try {
            // Cheap health check; 401/connection errors force reconnect
            await makeLCURequest('GET', '/lol-summoner/v1/current-summoner', undefined, 3000);
            return;
        } catch {
            credentials = null;
        }
    }
    await connectToLCU();
};

/** Force a fresh credential read, then verify the client answers. */
async function reconnectLCU(): Promise<void> {
    credentials = null;
    await connectToLCU();
    await makeLCURequest('GET', '/lol-summoner/v1/current-summoner', undefined, 4000);
}

interface CurrentSummoner {
    summonerId?: number;
    accountId?: number;
    displayName?: string;
    /** false while the client is still on the login / patcher screen */
    summonerLevel?: number;
}

/**
 * The client answers /current-summoner with an empty object while it is still
 * booting or sitting on the login screen. Every write op depends on summonerId,
 * so resolve it once with a couple of short retries and a clear error.
 */
async function resolveCurrentSummoner(): Promise<CurrentSummoner> {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const summoner = (await makeLCURequest(
                'GET',
                '/lol-summoner/v1/current-summoner',
                undefined,
                5000
            )) as CurrentSummoner | null;
            if (summoner?.summonerId) return summoner;
            lastError = new Error('League client has no active summoner yet');
        } catch (error) {
            lastError = error;
            try {
                await reconnectLCU();
            } catch {
                // fall through to the retry delay
            }
        }
        await new Promise((resolve) => setTimeout(resolve, 400));
    }
    const detail = lastError instanceof Error ? ` (${lastError.message})` : '';
    throw new Error(
        `Could not read your summoner from the League client${detail} — finish logging in, then retry.`
    );
}

interface LCURunePage {
    name: string;
    id: number;
    primaryStyleId?: number;
    subStyleId?: number;
    selectedPerkIds?: number[];
    current?: boolean;
    isDeletable?: boolean;
    isEditable?: boolean;
    isActive?: boolean;
    order?: number;
}

export interface ExportRunePagePayload {
    name: string;
    primaryStyleId: number;
    subStyleId: number;
    selectedPerkIds: number[];
    current?: boolean;
}

/** Removed from client shard rows (26.x+). Exporting these makes LCU reject the page. */
const DEAD_SHARD_FALLBACK: Record<number, number> = {
    5002: 5011, // Armor → flat Health (defense)
    5003: 5011, // Magic Resist → flat Health (defense)
};

function sanitizePerkIds(ids: number[]): number[] {
    return ids.map((id) => DEAD_SHARD_FALLBACK[id] ?? id);
}

export const exportRunePage = async (runePage: ExportRunePagePayload): Promise<void> => {
    await ensureLCUConnected();

    if (!Array.isArray(runePage.selectedPerkIds) || runePage.selectedPerkIds.length !== 9) {
        throw new Error(`Invalid rune page: expected 9 perk IDs, got ${runePage.selectedPerkIds?.length ?? 0}`);
    }
    if (!runePage.primaryStyleId || !runePage.subStyleId) {
        throw new Error('Invalid rune page: missing primary or secondary tree');
    }

    const selectedPerkIds = sanitizePerkIds(runePage.selectedPerkIds);

    const readPages = async (): Promise<LCURunePage[]> => {
        const pages = await makeLCURequest('GET', '/lol-perks/v1/pages', undefined, 6000);
        return Array.isArray(pages) ? (pages as LCURunePage[]) : [];
    };

    let pages = await readPages();

    // Replace our own page if it already exists
    for (const page of pages.filter((p) => p.name === runePage.name && p.id != null)) {
        try {
            await makeLCURequest('DELETE', `/lol-perks/v1/pages/${page.id}`, undefined, 6000);
        } catch {
            // Non-fatal: the create below will surface the real problem
        }
    }

    const body = {
        name: runePage.name,
        primaryStyleId: runePage.primaryStyleId,
        subStyleId: runePage.subStyleId,
        selectedPerkIds,
        current: runePage.current !== false,
    };

    const create = async () => makeLCURequest('POST', '/lol-perks/v1/pages', body, 8000);

    try {
        await create();
    } catch (firstError) {
        const message = firstError instanceof Error ? firstError.message : String(firstError);

        // "Max pages reached" is the single most common export failure — free a
        // slot by deleting the oldest page the client says we are allowed to
        // delete, then try again.
        const outOfSlots = /max|limit|slot/i.test(message);
        if (outOfSlots) {
            pages = await readPages();
            const victim = pages
                .filter((p) => p.isDeletable !== false && !p.current && !p.isActive)
                .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0];
            if (victim?.id != null) {
                await makeLCURequest('DELETE', `/lol-perks/v1/pages/${victim.id}`, undefined, 6000);
                await create();
            } else {
                throw new Error(
                    'Rune page limit reached and no page could be deleted — delete a rune page in the client and retry.'
                );
            }
        } else {
            // Token may have rotated (client restart) — reconnect once and retry.
            await reconnectLCU();
            await create();
        }
    }

    // Verify: a 2xx from the client is not proof the page survived validation.
    const after = await readPages();
    const saved = after.find((p) => p.name === runePage.name);
    if (!saved) {
        throw new Error('League accepted the request but the rune page is not in your collection — try again with the client on the home screen.');
    }
    if (runePage.current !== false && saved.id != null && !saved.current) {
        try {
            await makeLCURequest('PUT', '/lol-perks/v1/currentpage', saved.id, 5000);
        } catch {
            // Selecting the page is a nicety — the export itself already worked.
        }
    }
};

interface ItemSetBlock {
    type: string;
    items: Array<{ id: string; count: number }>;
    showIfSummonerSpell: string;
    hideIfSummonerSpell: string;
}

interface LCUItemSetPage {
    title?: string;
    uid?: string;
    type?: string;
    map?: string;
    mode?: string;
    priority?: boolean;
    sortrank?: number;
    startedFrom?: string;
    associatedChampions?: number[];
    associatedMaps?: number[];
    preferredItemSlots?: unknown[];
    blocks?: ItemSetBlock[];
    [key: string]: unknown;
}

interface LCUItemSetsCollection {
    accountId?: number;
    itemSets?: LCUItemSetPage[];
    timestamp?: number;
}

export interface ExportBuildPayload {
    starter: Array<{ id: string }>;
    core: Array<{ id: string }>;
    boots: { id: string };
    situational: Array<{ id: string }>;
    buildPath: Array<{ id: string }>;
    /** LCU champion key (Pyke 555, Pantheon 80, Yone 777). Defaults to Pyke. */
    championKey?: number;
    /** Item-set title shown in shop. */
    title?: string;
}

/**
 * Items removed from SR shop / not valid in item-sets (patch 26.9+).
 * Exporting these can make LCU reject the entire collection PUT.
 * Verified against Data Dragon 16.15.1.
 */
const DEAD_ITEM_IDS = new Set([
    '3117', // Mobility Boots — removed (use 3170 Swiftmarch)
    '6701', // Opportunity — removed (use 6699 Voltaic / 3142 Youmuu's)
    '3867', // Bounty of Worlds — quest mid-step, not a starter (use 3865 World Atlas)
]);

/**
 * Boot recommendation → shop chain IDs (keep in sync with src/logic/bootChains.ts).
 * Mid-tier keys stop at mid — supports should not be pushed into Noxian upgrades.
 */
const BOOT_CHAINS: Record<string, string[]> = {
    '3009': ['1001', '3009'],
    '3158': ['1001', '3158'],
    '3111': ['1001', '3111'],
    '3047': ['1001', '3047'],
    '3006': ['1001', '3006'],
    '3170': ['1001', '3009', '3170'],
    '3171': ['1001', '3158', '3171'],
    '3173': ['1001', '3111', '3173'],
    '3174': ['1001', '3047', '3174'],
    '3172': ['1001', '3006', '3172'],
};

function expandBootChain(boots: { id: string } | undefined): Array<{ id: string }> {
    if (!boots?.id) return [];
    const chain = BOOT_CHAINS[boots.id];
    if (chain) return chain.map((id) => ({ id }));
    return [{ id: '1001' }, { id: boots.id }];
}

/** LCU rejects the whole collection if any item id is bad / unpurchasable junk. */
function sanitizeItems(items: Array<{ id: string }> | undefined): Array<{ id: string; count: number }> {
    const seen = new Set<string>();
    const out: Array<{ id: string; count: number }> = [];
    for (const item of items || []) {
        const id = String(item?.id ?? '').trim();
        if (!/^\d+$/.test(id) || id === '0') continue;
        if (DEAD_ITEM_IDS.has(id)) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ id, count: 1 });
    }
    return out;
}

function block(type: string, items: Array<{ id: string; count: number }>): ItemSetBlock {
    return { type, items, showIfSummonerSpell: '', hideIfSummonerSpell: '' };
}

/**
 * Export item set via the real LCU collection API:
 * GET/PUT `/lol-item-sets/v1/item-sets/{summonerId}/sets`
 *
 * The client validates the *entire* collection on write, so a single malformed
 * field (missing uid, non-numeric item id, wrong accountId) silently drops the
 * whole payload. Everything below is about making that impossible, and about
 * proving afterwards that the set really landed.
 */
export const exportItemSet = async (build: ExportBuildPayload): Promise<void> => {
    await ensureLCUConnected();

    const currentSummoner = await resolveCurrentSummoner();
    const summonerId = currentSummoner.summonerId!;
    const championKey = build.championKey ?? 555;
    const setTitle = build.title || 'One Trick';
    const setsEndpoint = `/lol-item-sets/v1/item-sets/${summonerId}/sets`;

    const readCollection = async (): Promise<LCUItemSetsCollection | null> =>
        (await makeLCURequest('GET', setsEndpoint, undefined, 8000)) as LCUItemSetsCollection | null;

    const existing = await readCollection();
    const existingSets = Array.isArray(existing?.itemSets) ? existing!.itemSets! : [];
    // Only our own same-titled set is replaced — other profiles' sets (and the
    // user's own sets) stay untouched.
    const prior = existingSets.find((s) => s.title === setTitle);
    const kept = existingSets.filter((s) => s.title !== setTitle);

    const blocks: ItemSetBlock[] = [];
    const starter = sanitizeItems(build.starter);
    const core = sanitizeItems(build.core);
    // Boots → mid-tier (supports). Upgrades only if build recommends an upgrade ID.
    const boots = sanitizeItems(expandBootChain(build.boots));
    const path = sanitizeItems(build.buildPath);
    const situational = sanitizeItems((build.situational || []).slice(0, 3));
    // Control Ward + Oracle Lens always available in the item set
    const vision = sanitizeItems([
        { id: '2055' }, // Control Ward
        { id: '3364' }, // Oracle Lens (sweeper)
        { id: '3340' }, // Stealth Ward (trinket)
    ]);

    if (starter.length) blocks.push(block('Starting — keep Atlas (never sell)', starter));
    if (core.length) blocks.push(block('Core Items', core));
    if (boots.length) blocks.push(block('Boots (mid-tier complete)', boots));
    if (vision.length) blocks.push(block('Vision — pinks + sweeper', vision));
    if (path.length) blocks.push(block('Build Path', path));
    if (situational.length) blocks.push(block('Situational (pick 1–2)', situational));

    if (blocks.length === 0) {
        throw new Error('Nothing to export — the build has no valid item IDs.');
    }

    // uid is required by LCU item-set validation — reuse prior uid on update
    const newSet: LCUItemSetPage = {
        uid: typeof prior?.uid === 'string' && prior.uid.length > 0 ? prior.uid : randomUUID(),
        title: setTitle,
        type: 'custom',
        map: 'any',
        mode: 'any',
        priority: false,
        sortrank: 0,
        startedFrom: 'blank',
        associatedChampions: championKey > 0 ? [championKey] : [],
        associatedMaps: [11, 12],
        preferredItemSlots: [],
        blocks,
    };

    // accountId must match the account that owns the sets. Prefer whatever the
    // collection already reports; fall back to the summoner endpoint.
    const accountId =
        typeof existing?.accountId === 'number' && existing.accountId > 0
            ? existing.accountId
            : typeof currentSummoner.accountId === 'number'
                ? currentSummoner.accountId
                : 0;

    const payload: LCUItemSetsCollection = {
        accountId,
        itemSets: [...kept, newSet],
        timestamp: Date.now(),
    };

    const errors: string[] = [];

    const put = async () => makeLCURequest('PUT', setsEndpoint, payload, 12000);

    try {
        await put();
    } catch (putErr) {
        errors.push(putErr instanceof Error ? putErr.message : String(putErr));
        try {
            // Token rotation / transient socket error — reconnect and retry once.
            await reconnectLCU();
            await put();
        } catch (retryErr) {
            errors.push(retryErr instanceof Error ? retryErr.message : String(retryErr));
            try {
                // Last resort: some client versions accept a single-page POST.
                await makeLCURequest('POST', setsEndpoint, newSet, 10000);
            } catch (postErr) {
                errors.push(postErr instanceof Error ? postErr.message : String(postErr));
                throw new Error(`Item set export failed: ${errors.join(' | ')}`);
            }
        }
    }

    // Verify the set actually persisted — the client can accept a write and then
    // drop the page during validation.
    try {
        const after = await readCollection();
        const saved = (after?.itemSets || []).some((s) => s.title === setTitle);
        if (!saved) {
            throw new Error(
                `League accepted the write but "${setTitle}" is not in your item sets. Close the in-client shop/item-set editor and retry.`
            );
        }
    } catch (verifyErr) {
        // A failed verification read alone shouldn't fail the export, but a
        // definite "not saved" result should.
        if (verifyErr instanceof Error && verifyErr.message.includes('not in your item sets')) {
            throw verifyErr;
        }
    }
};

export const makeLCURequest = async (
    method: string,
    endpoint: string,
    body?: unknown,
    timeoutMs = 4000
) => {
    if (!credentials) {
        throw new Error('Not connected to the League client');
    }

    const url = `${credentials.protocol}://127.0.0.1:${credentials.port}${endpoint}`;
    const auth = Buffer.from(`riot:${credentials.token}`).toString('base64');

    try {
        const response = await axios({
            method,
            url,
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            data: body,
            httpsAgent: lcuHttpsAgent,
            timeout: timeoutMs,
            validateStatus: (status) => {
                // Don't throw on 404 - it's expected when not in champ select
                return status < 500;
            }
        });

        if (response.status === 404) {
            return null;
        }

        if (response.status === 401 || response.status === 403) {
            credentials = null;
            throw new Error(`LCU auth expired (${response.status}) — reconnect and retry`);
        }

        if (response.status >= 400) {
            const detail = typeof response.data === 'object'
                ? JSON.stringify(response.data)
                : String(response.data ?? '');
            throw new Error(`LCU API ${method} ${endpoint} → ${response.status}${detail ? `: ${detail}` : ''}`);
        }

        return response.data;
    } catch (error: unknown) {
        const axiosError = error as {
            response?: { status?: number; data?: unknown };
            message?: string;
            code?: string;
        };
        if (
            axiosError.code === 'ECONNREFUSED' ||
            axiosError.code === 'ETIMEDOUT' ||
            axiosError.code === 'ECONNRESET' ||
            axiosError.code === 'EPIPE' ||
            axiosError.code === 'ECONNABORTED'
        ) {
            credentials = null;
            throw new Error(
                `League client not reachable (${axiosError.code}) — is it open and past the login screen?`
            );
        }
        if (axiosError.response && axiosError.response.status !== 404) {
            const detail =
                typeof axiosError.response.data === 'object'
                    ? JSON.stringify(axiosError.response.data)
                    : String(axiosError.response.data ?? '');
            throw new Error(
                `LCU API ${method} ${endpoint} → ${axiosError.response.status}${detail ? `: ${detail}` : ''}`
            );
        }
        throw error instanceof Error ? error : new Error(String(error));
    }
};
