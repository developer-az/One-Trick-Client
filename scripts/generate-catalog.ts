import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { buildCatalogBundle } from '../src/catalog/buildCatalog.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'website', 'public', 'api', 'v1');

async function main(): Promise<void> {
  const bundle = await buildCatalogBundle();
  mkdirSync(outDir, { recursive: true });

  const files: Record<string, unknown> = {
    'manifest.json': bundle.manifest,
    'champions.json': bundle.champions,
    'items.json': bundle.items,
    'runes.json': bundle.runes,
    'recommendations.json': bundle.recommendations,
    'profiles.json': bundle.profiles,
  };

  for (const [name, payload] of Object.entries(files)) {
    writeFileSync(join(outDir, name), `${JSON.stringify(payload)}\n`, 'utf8');
  }

  writeFileSync(
    join(outDir, 'index.json'),
    `${JSON.stringify(
      {
        version: 'v1',
        patch: bundle.manifest.patch,
        routes: Object.keys(files).map((name) => `/api/v1/${name}`),
      },
      null,
      2
    )}\n`,
    'utf8'
  );

  console.log(
    `catalog api v1: patch ${bundle.manifest.patch} · ${bundle.champions.length} champs · ${bundle.recommendations.length} recs → ${outDir}`
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
