import React, { useMemo, useState } from 'react';
import type { Champion } from '../../logic/pykeLogic';
import { championLossProfile, lossMatchupInsights } from '../../logic/lossInsights';
import { byChampion, pct, record, recordAgainst, recordWith, type Record_ } from '../../logic/stats';
import { isDesktop } from '../hooks';
import { IconStats } from '../icons';
import { Badge, Card, CardHeader, EmptyState, Portrait } from '../ui';

const MIN_SAMPLE = 5;

type MatchupTab = 'against' | 'with';

export const StatsView: React.FC<{
  champions: Champion[];
  games: MatchSummary[] | null;
  loading: boolean;
  error: string | null;
  connected: boolean;
  onReload: () => void;
}> = ({ champions, games, loading, error, connected, onReload }) => {
  const byKey = useMemo(() => new Map(champions.map((c) => [Number(c.key), c])), [champions]);
  const rows = useMemo(() => byChampion(games || []), [games]);
  const [selected, setSelected] = useState<number | null>(null);
  const [matchupTab, setMatchupTab] = useState<MatchupTab>('against');
  const focus = selected ?? rows[0]?.championId ?? null;
  const overall = useMemo(() => record(games || []), [games]);
  const lossInsights = useMemo(
    () => (focus != null && games?.length ? lossMatchupInsights(games, focus) : []),
    [games, focus]
  );
  const lossProfile = useMemo(
    () => (focus != null && games?.length ? championLossProfile(games, focus) : null),
    [games, focus]
  );

  const header = (
    <div className="ot-page-header">
      <div>
        <h1 className="ot-page-title">Your stats</h1>
        <p className="ot-page-sub">
          From your recent Summoner's Rift games in the League client. Remakes and other modes are left out.
        </p>
      </div>
      {isDesktop && connected ? (
        <button type="button" className="ot-btn ot-btn-ghost" onClick={onReload} disabled={loading}>
          {loading ? 'Loading' : 'Refresh'}
        </button>
      ) : null}
    </div>
  );

  if (!isDesktop || !connected || !games?.length) {
    return (
      <div className="ot-page">
        {header}
        <Card>
          <EmptyState
            icon={<IconStats size={28} />}
            title={
              !isDesktop
                ? 'Available in the desktop app'
                : !connected
                  ? 'Open the League client'
                  : loading
                    ? 'Reading your match history'
                    : error
                      ? 'Could not read match history'
                      : 'No Summoner’s Rift games yet'
            }
            body={error || 'Stats come straight from your own match history in the client. Nothing is sent anywhere.'}
          />
        </Card>
      </div>
    );
  }

  const focusRow = rows.find((r) => r.championId === focus) || null;
  const focusGames = games.filter((g) => g.championId === focus);
  const withDetails = focusGames.filter((g) => g.enemies?.length);
  const opponents = new Map<number, Record_>();
  for (const g of withDetails) {
    for (const id of g.enemies || []) {
      if (!opponents.has(id)) opponents.set(id, recordAgainst(withDetails, id));
    }
  }
  const opponentRows = [...opponents.entries()]
    .sort((a, b) => b[1].games - a[1].games || a[1].winRate - b[1].winRate)
    .slice(0, 8);

  const withAllyDetails = focusGames.filter((g) => g.allies?.length);
  const allies = new Map<number, Record_>();
  for (const g of withAllyDetails) {
    for (const id of g.allies || []) {
      if (!allies.has(id)) allies.set(id, recordWith(withAllyDetails, id, { championId: focus ?? undefined }));
    }
  }
  const allyRows = [...allies.entries()]
    .sort((a, b) => b[1].games - a[1].games || a[1].winRate - b[1].winRate)
    .slice(0, 8);

  const champName = focusRow ? byKey.get(focusRow.championId)?.name || 'Champion' : 'Champion';
  const activeRows = matchupTab === 'against' ? opponentRows : allyRows;
  const detailCount = matchupTab === 'against' ? withDetails.length : withAllyDetails.length;

  return (
    <div className="ot-page">
      {header}

      <div className="grid gap-5 sm:grid-cols-3 mb-5">
        <Stat label="Games" value={String(overall.games)} hint={`${overall.wins} wins, ${overall.losses} losses`} />
        <Stat label="Win rate" value={pct(overall.winRate)} hint={`95% range ${pct(overall.low)} to ${pct(overall.high)}`} />
        <Stat label="Champions played" value={String(rows.length)} hint={`Most: ${byKey.get(rows[0].championId)?.name || '–'}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" pad={false}>
          <div className="ot-card-pad !pb-2">
            <CardHeader title="By champion" sub="Select a row, then use Matchups for enemies or allies." />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left ot-faint text-xs uppercase tracking-wide">
                <th className="py-2 pl-5 font-semibold">Champion</th>
                <th className="py-2 font-semibold text-right">G</th>
                <th className="py-2 font-semibold text-right">WR</th>
                <th className="py-2 pr-5 font-semibold text-right">KDA</th>
              </tr>
            </thead>
            <tbody className="ot-num">
              {rows.map((r) => {
                const c = byKey.get(r.championId);
                const active = r.championId === focus;
                return (
                  <tr
                    key={r.championId}
                    className={`border-t border-[color:var(--ot-border)] cursor-pointer ${active ? 'bg-[color:var(--ot-surface-2)]' : 'hover:bg-[color:var(--ot-surface-2)]'}`}
                    onClick={() => setSelected(r.championId)}
                  >
                    <td className="py-2 pl-5">
                      <span className="flex items-center gap-2.5 min-w-0">
                        <Portrait champion={c || { key: r.championId }} size={28} />
                        <span className="font-medium truncate">{c?.name || `#${r.championId}`}</span>
                      </span>
                    </td>
                    <td className="py-2 text-right">{r.games}</td>
                    <td className="py-2 text-right">
                      <WinRate r={r} />
                    </td>
                    <td className="py-2 pr-5 text-right">{r.kda.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="lg:col-span-1 flex flex-col min-h-0">
          <div className="flex gap-1 mb-3 p-1 rounded-lg bg-[color:var(--ot-surface-2)]">
            <button
              type="button"
              className={`flex-1 text-sm py-1.5 rounded-md ${matchupTab === 'against' ? 'bg-[color:var(--ot-surface)] font-medium' : 'ot-muted'}`}
              onClick={() => setMatchupTab('against')}
            >
              Against
            </button>
            <button
              type="button"
              className={`flex-1 text-sm py-1.5 rounded-md ${matchupTab === 'with' ? 'bg-[color:var(--ot-surface)] font-medium' : 'ot-muted'}`}
              onClick={() => setMatchupTab('with')}
            >
              With
            </button>
          </div>
          <CardHeader
            title={`${champName} ${matchupTab}`}
            sub={
              detailCount < focusGames.length
                ? `${detailCount} of ${focusGames.length} games with detail.`
                : `${detailCount} games.`
            }
          />
          {activeRows.length ? (
            <ul className="space-y-1.5 overflow-y-auto max-h-[min(420px,50vh)] pr-1">
              {activeRows.map(([id, r]) => {
                const c = byKey.get(id);
                return (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <Portrait champion={c || { key: id }} size={26} ring={matchupTab === 'against' ? 'red' : 'blue'} />
                    <span className="flex-1 min-w-0 truncate">{c?.name || `#${id}`}</span>
                    <span className="ot-num ot-muted text-xs shrink-0">
                      {r.wins}–{r.losses}
                    </span>
                    <WinRate r={r} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm ot-muted">
              {loading
                ? 'Loading game details.'
                : matchupTab === 'with'
                  ? 'No ally details yet. Refresh after a few SR games.'
                  : 'No enemy details yet.'}
            </p>
          )}
          <p className="text-xs ot-faint leading-relaxed mt-3">
            Faded win rates have fewer than {MIN_SAMPLE} games.
          </p>
        </Card>
      </div>

      {focus != null && (lossInsights.length > 0 || (lossProfile && lossProfile.losses >= 2)) ? (
        <Card className="mt-5">
          <CardHeader
            title={`${champName} — loss patterns`}
            sub="Enemies that show up in losses and where your record is weak. Use for runes and build before queue."
          />
          {lossProfile && lossProfile.losses >= 2 ? (
            <p className="text-sm ot-muted mb-4">
              On losses you average{' '}
              <span className="ot-num">{lossProfile.avgKdaLoss.toFixed(2)}</span> KDA and{' '}
              <span className="ot-num">{lossProfile.avgCsPerMinLoss.toFixed(1)}</span> CS/min vs{' '}
              <span className="ot-num">{lossProfile.avgKdaWin.toFixed(2)}</span> KDA and{' '}
              <span className="ot-num">{lossProfile.avgCsPerMinWin.toFixed(1)}</span> CS/min on wins.
            </p>
          ) : null}
          {lossInsights.length ? (
            <ul className="space-y-3">
              {lossInsights.map((row) => {
                const c = byKey.get(row.enemyChampionId);
                const small = row.games < MIN_SAMPLE;
                return (
                  <li
                    key={row.enemyChampionId}
                    className="flex flex-col sm:flex-row sm:items-start gap-2 text-sm border-t border-[color:var(--ot-border)] pt-3 first:border-0 first:pt-0"
                  >
                    <span className="flex items-center gap-2 shrink-0 min-w-[140px]">
                      <Portrait champion={c || { key: row.enemyChampionId }} size={28} ring="red" />
                      <span className="font-medium truncate">{c?.name || `#${row.enemyChampionId}`}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 ot-muted text-xs sm:text-sm">
                      <span className="ot-num">
                        {row.wins}–{row.losses}
                      </span>
                      <WinRate r={row} />
                      <span title="Share of your losses on this champ that included them">
                        In {pct(row.lossShare)} of losses
                      </span>
                      {row.avgDeathsWhenLoss > 0 ? (
                        <span className="ot-num">
                          ~{row.avgDeathsWhenLoss.toFixed(1)} deaths in losses
                          {row.avgDeathsWhenWin > 0 ? ` vs ${row.avgDeathsWhenWin.toFixed(1)} in wins` : ''}
                        </span>
                      ) : null}
                    </span>
                    <p className={`sm:flex-1 text-sm ${small ? 'opacity-80' : ''} ot-muted leading-snug`}>{row.hint}</p>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm ot-muted">No enemy patterns yet — need a few losses with matchup detail.</p>
          )}
        </Card>
      ) : null}
    </div>
  );
};

const WinRate: React.FC<{ r: Record_ }> = ({ r }) => {
  const small = r.games < MIN_SAMPLE;
  const tone = small ? 'muted' : r.low > 0.5 ? 'teal' : r.high < 0.5 ? 'red' : 'muted';
  return (
    <span title={`${pct(r.low)} to ${pct(r.high)} (95%)`} className={small ? 'opacity-50' : ''}>
      <Badge tone={tone}>{pct(r.winRate)}</Badge>
    </span>
  );
};

const Stat: React.FC<{ label: string; value: string; hint: string }> = ({ label, value, hint }) => (
  <Card>
    <div className="text-xs ot-faint uppercase tracking-wide">{label}</div>
    <div className="ot-stat-big ot-num mt-1">{value}</div>
    <div className="text-sm ot-muted mt-1">{hint}</div>
  </Card>
);
