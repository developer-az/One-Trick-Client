/**
 * Downloads arammayhem.com open data (CC BY 4.0) and writes a slim offline bundle.
 * Run: npm run sync:mayhem
 */
import fs from 'fs';
import path from 'path';
import { slimMayhemFromApi } from '../src/logic/mayhem/remote';

const AUG_URL = 'https://arammayhem.com/data/v1/latest/augments.json';
const COMBO_URL = 'https://arammayhem.com/data/v1/latest/combos.json';
const OUT = path.join(process.cwd(), 'src', 'data', 'mayhem', 'bundle.json');

async function readJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

async function main(): Promise<void> {
  const [augDoc, comboDoc] = await Promise.all([readJson(AUG_URL), readJson(COMBO_URL)]);
  const bundle = slimMayhemFromApi(augDoc, comboDoc);

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(bundle), 'utf8');
  console.log(`Wrote ${bundle.augments.length} augments, ${bundle.combos.length} combos → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
