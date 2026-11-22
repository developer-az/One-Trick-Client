// Live builds (OP.GG MCP): offline parser checks, then the Phase 4 live gate —
// Pyke (authored doctrine) plus two champions without one resolve with a patch.
// The network gate runs only with --live (npm run verify:live-builds:live).
import os from 'os';
import { getLiveBuild, liveBuildFromText, opggChampionName, parseOpggText } from './electron/live-builds';
import { getProfile } from './src/logic/profiles';

let failed = 0;
const check = (name: string, ok: boolean): void => {
    console.log(`${ok ? 'ok' : 'FAIL'} ${name}`);
    if (!ok) failed++;
};

// Captured verbatim from mcp-api.op.gg on 2026-11-22.
const PYKE =
    'class LolGetChampionAnalysis: data\nclass Data: core_items,boots,starter_items,runes,skills,trends\nclass CoreItems: ids,ids_names,play,pick_rate\nclass Runes: primary_page_name,primary_rune_names,secondary_page_name,secondary_rune_names,pick_rate\nclass Skills: order,pick_rate\nclass Trends: pick\nclass Pick: version\n\n' +
    'LolGetChampionAnalysis(Data(CoreItems([3179,3142,3814],["Umbral Glaive","Youmuu\'s Ghostblade","Edge of Night"],2442,0.17),CoreItems([3009],["Boots of Swiftness"],26254,0.73),CoreItems([2003,2003],["Health Potion","Health Potion"],34951,0.95),Runes("Domination",["Hail of Blades","Cheap Shot","Sixth Sense","Ultimate Hunter"],"Resolve",["Unflinching","Bone Plating"],0.37),Skills(["Q","E","W","Q","Q","R","Q","E","Q","E","R","E","E","W","W"],0.84),Trends(Pick("16.23"))))';
const NO_DATA =
    'class LolGetChampionAnalysis: data\nclass Data: trends,counters_meta\nclass Trends: pick\nclass Pick: version\nclass CountersMeta: message\n\nLolGetChampionAnalysis(Data(Trends(Pick("16.23")),CountersMeta("Insufficient matchup sample.")))';

const meta = { champion: 'Pyke', role: 'Support' as const, mode: 'ranked' as const, fetchedAt: 0 };
const pyke = liveBuildFromText(PYKE, meta);
check('parses core items with names', pyke?.core?.ids.join() === '3179,3142,3814' && pyke.core.names[1] === "Youmuu's Ghostblade");
check('positional fields: games and pick rate', pyke?.core?.games === 2442 && pyke.core.pickRate === 0.17);
check('boots, starter, runes, skills', pyke?.boots?.ids[0] === 3009 && pyke.starter?.ids.length === 2 && pyke.runes?.keystones[0] === 'Hail of Blades' && pyke.skillOrder.length === 15);
check('patch comes from the response', pyke?.patch === '16.23');
check('no build data -> null', liveBuildFromText(NO_DATA, meta) === null);
check('garbage throws, never returns a fake build', (() => { try { parseOpggText('\n\nFoo(['); return false; } catch { return true; } })());
check('champion names', opggChampionName('MissFortune') === 'MISS_FORTUNE' && opggChampionName('KSante') === 'KSANTE' && opggChampionName('Pyke') === 'PYKE');
check('no win-rate field anywhere (D1)', !/win/i.test(JSON.stringify(Object.keys(pyke ?? {}))) && !/"win/i.test(JSON.stringify(pyke)));

async function live(): Promise<void> {
    if (!process.argv.includes('--live')) return;
    process.env.APPDATA ??= os.tmpdir();
    const cases = [
        { champion: 'Pyke', role: 'Support' as const },
        { champion: 'Ornn', role: 'Top' as const },
        { champion: 'MissFortune', role: 'Bot' as const },
    ];
    for (const c of cases) {
        const b = await getLiveBuild(c.champion, c.role);
        check(`live ${c.champion} ${c.role}: resolves with patch`, !!b && /^\d+\.\d+$/.test(b.patch) && !!b.core?.ids.length);
        if (b) console.log(`   ${b.source} patch ${b.patch}: ${b.core?.names.join(' > ')} | ${b.boots?.names[0]} | ${b.runes?.keystones[0]} (pick ${Math.round((b.core?.pickRate ?? 0) * 100)}%)`);
    }
    const aram = await getLiveBuild('Ornn', 'Top', 'aram');
    console.log(`   aram Ornn: ${aram ? aram.core?.names.join(' > ') : 'no data'}`);

    // Doctrine comparison (report, not a gate): authored Pyke core vs live core.
    const doctrine = getProfile('pyke').calculateBuild([]).core.map((i) => Number(i.id));
    const livePyke = await getLiveBuild('Pyke', 'Support');
    const shared = doctrine.filter((id) => livePyke?.core?.ids.includes(id));
    console.log(`   doctrine Pyke core ${doctrine.join(',')} vs live ${livePyke?.core?.ids.join(',')}: ${shared.length} shared`);
    check('Pyke doctrine and live share Umbral Glaive', shared.includes(3179));

    const t0 = Date.now();
    await getLiveBuild('Pyke', 'Support');
    check(`second read is served from the patch cache (${Date.now() - t0} ms)`, Date.now() - t0 < 50);
}

live()
    .catch((e) => {
        console.log('FAIL live gate threw', e);
        failed++;
    })
    .then(() => {
        if (failed) {
            console.log(`${failed} failed`);
            process.exit(1);
        }
        console.log('verify_live_builds: all ok');
    });
