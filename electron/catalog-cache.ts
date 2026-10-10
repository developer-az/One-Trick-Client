import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const CATALOG_APIS = [
    'https://one-trick-client.vercel.app/api/v1',
    'https://developer-az.github.io/One-Trick-Client/api/v1',
];
const DDRAGON_VERSIONS = 'https://ddragon.leagueoflegends.com/api/versions.json';

let memory: unknown = null;

function cachePath(): string {
    return path.join(app.getPath('userData'), 'catalog-v1.json');
}

export function loadCatalogCache(): unknown | null {
    if (memory) return memory;
    try {
        const raw = fs.readFileSync(cachePath(), 'utf8');
        const parsed = JSON.parse(raw) as { champions?: unknown[] };
        if (Array.isArray(parsed.champions) && parsed.champions.length > 0) {
            memory = parsed;
            return memory;
        }
    } catch {
        /* first launch */
    }
    return null;
}

function writeCache(bundle: unknown): void {
    memory = bundle;
    try {
        fs.writeFileSync(cachePath(), JSON.stringify(bundle), 'utf8');
    } catch (error) {
        console.warn('[catalog] failed to persist cache:', error);
    }
}

async function readJson(url: string): Promise<unknown> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
}

export async function refreshCatalogCache(): Promise<unknown | null> {
    for (const api of CATALOG_APIS) {
        try {
            const [manifest, champions, items, runes, recommendations, profiles] = await Promise.all([
                readJson(`${api}/manifest.json`),
                readJson(`${api}/champions.json`),
                readJson(`${api}/items.json`),
                readJson(`${api}/runes.json`),
                readJson(`${api}/recommendations.json`),
                readJson(`${api}/profiles.json`),
            ]);
            const bundle = { manifest, champions, items, runes, recommendations, profiles };
            writeCache(bundle);
            return bundle;
        } catch {
            /* try the next host */
        }
    }

    try {
        const versions = (await readJson(DDRAGON_VERSIONS)) as string[];
        const patch = versions[0];
        if (!patch) return loadCatalogCache();
        const champDoc = (await readJson(
            `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US/champion.json`
        )) as { data: Record<string, { id: string; key: string; name: string; tags: string[] }> };
        const existing = (loadCatalogCache() || {}) as {
            items?: unknown[];
            runes?: unknown[];
            recommendations?: unknown[];
            profiles?: unknown;
        };
        const champions = Object.values(champDoc.data).map((c) => ({
            id: c.id,
            key: c.key,
            name: c.name,
            tags: c.tags,
            roles: c.tags.includes('Support') ? ['Support'] : ['Mid'],
            damageType: c.tags.includes('Mage') ? 'Magic' : 'Physical',
        }));
        const bundle = {
            manifest: {
                patch,
                generatedAt: new Date().toISOString(),
                sources: {
                    ddragon: `https://ddragon.leagueoflegends.com/cdn/${patch}/data/en_US`,
                    cdragon: 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1',
                    versions: DDRAGON_VERSIONS,
                },
            },
            champions,
            items: existing.items || [],
            runes: existing.runes || [],
            recommendations: existing.recommendations || [],
            profiles: existing.profiles || {
                authored: [
                    { id: 'pyke-support', championId: 'Pyke', role: 'Support' },
                    { id: 'pantheon-support', championId: 'Pantheon', role: 'Support' },
                    { id: 'yone-mid', championId: 'Yone', role: 'Mid' },
                ],
            },
        };
        writeCache(bundle);
        return bundle;
    } catch {
        return loadCatalogCache();
    }
}
