import {
  compactChampToken,
  ingestChampionCatalog,
  resolveChampionRef,
} from './src/data/championCatalog';

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

ingestChampionCatalog([
  { id: 'MonkeyKing', key: '62', name: 'Wukong' },
  { id: 'Kaisa', key: '145', name: "Kai'Sa" },
  { id: 'Nunu', key: '20', name: 'Nunu & Willump' },
  { id: 'Renata', key: '888', name: 'Renata Glasc' },
  { id: 'Chogath', key: '31', name: "Cho'Gath" },
  { id: 'Pyke', key: '555', name: 'Pyke' },
]);

assert(compactChampToken("Kai'Sa") === 'kaisa', 'compact KaiSa');
assert(resolveChampionRef({ name: 'Wukong' })?.id === 'MonkeyKing', 'Wukong → MonkeyKing');
assert(resolveChampionRef({ name: "Kai'Sa" })?.id === 'Kaisa', "Kai'Sa by name");
assert(resolveChampionRef({ name: 'KaiSa' })?.id === 'Kaisa', 'KaiSa compact');
assert(resolveChampionRef({ id: 'MonkeyKing' })?.name === 'Wukong', 'MonkeyKing id');
assert(resolveChampionRef({ key: 62 })?.id === 'MonkeyKing', 'numeric key 62');
assert(resolveChampionRef({ key: '145' })?.id === 'Kaisa', 'string key');
assert(resolveChampionRef({ name: 'Nunu & Willump' })?.id === 'Nunu', 'Nunu display name');
assert(resolveChampionRef({ name: 'Renata Glasc' })?.id === 'Renata', 'Renata display name');
assert(resolveChampionRef({ name: "Cho'Gath" })?.id === 'Chogath', "Cho'Gath");
assert(resolveChampionRef({ name: '#555' })?.id === 'Pyke', 'hash key token');
assert(resolveChampionRef({ name: 'NotAChamp' }) === null, 'unknown stays null');

console.log('champion catalog resolve: ok');
