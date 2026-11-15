import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';
import type { Champion } from './src/logic/pykeLogic';
import { getProfile, PROFILE_IDS } from './src/logic/profiles';
import { inferSituation, type ProfileSituation } from './src/logic/situation';

const WIN_RATE = /win\s*-?\s*rate|winrate|\bWR\b/i;

function ok(cond: boolean, msg: string): void {
  if (!cond) {
    console.error('FAIL', msg);
    process.exitCode = 1;
  } else {
    console.log('ok', msg);
  }
}

function champ(
  id: string,
  tags: string[],
  damageType?: Champion['damageType']
): Champion {
  return { id, key: id, name: id, tags, damageType };
}

const TEAMS: Array<{ label: string; enemies: Champion[] }> = [
  { label: 'empty', enemies: [] },
  {
    label: 'assassins',
    enemies: [
      champ('Zed', ['Assassin'], 'Physical'),
      champ('Akali', ['Assassin', 'Fighter'], 'Magic'),
      champ('Katarina', ['Assassin', 'Mage'], 'Magic'),
      champ('Talon', ['Assassin'], 'Physical'),
      champ('Rengar', ['Assassin', 'Fighter'], 'Physical'),
    ],
  },
  {
    label: 'tanks',
    enemies: [
      champ('Malphite', ['Tank', 'Mage'], 'Magic'),
      champ('Shen', ['Tank', 'Fighter'], 'Magic'),
      champ('Nautilus', ['Tank', 'Support'], 'Magic'),
      champ('Leona', ['Tank', 'Support'], 'Magic'),
      champ('Sion', ['Tank', 'Fighter'], 'Physical'),
    ],
  },
  {
    label: 'poke',
    enemies: [
      champ('Xerath', ['Mage'], 'Magic'),
      champ('Ziggs', ['Mage'], 'Magic'),
      champ('Lux', ['Mage', 'Support'], 'Magic'),
      champ('Brand', ['Mage', 'Support'], 'Magic'),
      champ('VelKoz', ['Mage'], 'Magic'),
    ],
  },
  {
    label: 'healers',
    enemies: [
      champ('Soraka', ['Support', 'Mage'], 'Magic'),
      champ('Yuumi', ['Support', 'Mage'], 'Magic'),
      champ('Aatrox', ['Fighter'], 'Magic'),
      champ('Vladimir', ['Mage'], 'Magic'),
      champ('Warwick', ['Fighter', 'Tank'], 'Physical'),
    ],
  },
];

const behind = inferSituation({
  level: 5,
  enemyLevels: [8, 8, 8, 8, 8],
  scores: { kills: 0, deaths: 4, assists: 0 },
  gameTime: 900,
});
const even = inferSituation({
  level: 8,
  enemyLevels: [8, 8, 8, 8, 8],
  scores: { kills: 1, deaths: 1, assists: 1 },
  gameTime: 900,
});
const ahead = inferSituation({
  level: 11,
  enemyLevels: [8, 8, 8, 8, 8],
  scores: { kills: 3, deaths: 0, assists: 5 },
  gameTime: 900,
});

ok(behind.state === 'behind', 'situation fixture: behind state');
ok(even.state === 'even', 'situation fixture: even state');
ok(ahead.state === 'ahead', 'situation fixture: ahead state');

const SITUATIONS: Array<{ label: string; situation: ProfileSituation | undefined }> = [
  { label: 'undefined', situation: undefined },
  { label: 'behind', situation: behind },
  { label: 'even', situation: even },
  { label: 'ahead', situation: ahead },
];

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const entry of value) collectStrings(entry, out);
  } else if (value && typeof value === 'object') {
    for (const entry of Object.values(value as Record<string, unknown>)) {
      collectStrings(entry, out);
    }
  }
  return out;
}

// Build-path entries prefix the same item reason with a slot label. Dedupe
// those to the underlying reason so one offending line is reported once.
function normalizeRuntimeText(text: string): string {
  return text.replace(/^(?:BOOTS|RUSH|SPIKE|KEEP|VISION|SWEEP|QUEST):\s+/, '');
}

// --- Runtime: no build reason/cue text may claim a win rate -----------------
const runtimeOffenders = new Map<string, { text: string; context: string }>();
const collectedReasons: string[] = [];

ok(PROFILE_IDS.length > 0, `profile registry has ids (${PROFILE_IDS.join(', ')})`);

for (const profileId of PROFILE_IDS) {
  const profile = getProfile(profileId);
  for (const team of TEAMS) {
    for (const { label, situation } of SITUATIONS) {
      const build = profile.calculateBuild(team.enemies, undefined, undefined, situation);
      const context = `${profileId} / ${team.label} / situation=${label}`;
      const items = [
        ...build.starter,
        ...build.core,
        ...build.situational,
        build.boots,
        ...build.buildPath,
      ];
      for (const item of items) {
        if (typeof item.reason === 'string') collectedReasons.push(item.reason);
      }
      for (const text of collectStrings(build)) {
        if (WIN_RATE.test(text)) {
          const key = normalizeRuntimeText(text);
          if (!runtimeOffenders.has(key)) {
            runtimeOffenders.set(key, { text: key, context });
          }
        }
      }
    }
  }
}

if (runtimeOffenders.size > 0) {
  console.error('Offending win-rate strings (runtime build text):');
  for (const { text, context } of runtimeOffenders.values()) {
    console.error(`  ${context}: ${JSON.stringify(text)}`);
  }
}

ok(
  collectedReasons.length >= 30,
  `collected at least 30 build reasons (got ${collectedReasons.length})`
);
ok(
  runtimeOffenders.size === 0,
  `no win-rate wording in runtime build text (${runtimeOffenders.size} offenders)`
);

// --- Static: no quoted string literal may claim a win rate ------------------
const ROOTS = ['src/logic', 'src/overlay', 'src/catalog', 'src/data', 'electron'];
const ALLOWLIST = new Set(['src/logic/stats.ts', 'src/logic/lossInsights.ts']);

function listSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full));
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function scannedStringText(node: ts.Node): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    node.kind === ts.SyntaxKind.TemplateHead ||
    node.kind === ts.SyntaxKind.TemplateMiddle ||
    node.kind === ts.SyntaxKind.TemplateTail
  ) {
    return (node as ts.TemplateLiteralLikeNode).text;
  }
  return null;
}

const staticOffenders = new Map<string, string>();
const sourceFiles = ROOTS.flatMap((root) => listSourceFiles(path.resolve(root)));

for (const file of sourceFiles) {
  const rel = path.relative(process.cwd(), file).replace(/\\/g, '/');
  if (ALLOWLIST.has(rel)) continue;

  const text = fs.readFileSync(file, 'utf8');
  const sourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  const visit = (node: ts.Node): void => {
    const stringText = scannedStringText(node);
    if (stringText !== null && WIN_RATE.test(stringText)) {
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      const location = `${rel}:${line + 1}`;
      if (!staticOffenders.has(location)) staticOffenders.set(location, stringText);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

if (staticOffenders.size > 0) {
  console.error('Offending win-rate strings (static quoted literals):');
  for (const [location, text] of staticOffenders) {
    console.error(`  ${location}: ${JSON.stringify(text)}`);
  }
}

ok(
  sourceFiles.length > 0,
  `scanned .ts/.tsx sources (${sourceFiles.length} files, ${ALLOWLIST.size} allowlisted)`
);
ok(
  staticOffenders.size === 0,
  `no win-rate wording in quoted string literals (${staticOffenders.size} offenders)`
);

if (process.exitCode) {
  console.error('verify:no-winrate-claims failed');
} else {
  console.log('verify:no-winrate-claims ok');
}
