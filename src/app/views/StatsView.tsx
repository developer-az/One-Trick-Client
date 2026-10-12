import React, { useMemo, useState } from 'react';
import type { Champion } from '../../logic/pykeLogic';
import { byChampion, pct, record, recordAgainst, type Record_ } from '../../logic/stats';
import { isDesktop } from '../hooks';
import { IconStats } from '../icons';
import { Badge, Card, CardHeader, EmptyState, Portrait } from '../ui';

const MIN_SAMPLE = 5;

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
  const focus = selected ?? rows[0]?.championId ?? null;
  const overall = useMemo(() => record(games || []), [games]);

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
  const opponentRows = [...opponents.entries()].sort((a, b) => b[1].games - a[1].games || a[1].winRate - b[1].winRate).slice(0, 12);

  return (
    <div className="ot-page">
      {header}

      <div className="grid gap-5 sm:grid-cols-3 mb-5">
        <Stat label="Games" value={String(overall.games)} hint={`${overall.wins} wins, ${overall.losses} losses`} />
        <Stat label="Win rate" value={pct(overall.winRate)} hint={`95% range ${pct(overall.low)} to ${pct(overall.high)}`} />
        <Stat label="Champions played" value={String(rows.length)} hint={`Most: ${byKey.get(rows[0].championId)?.name || '–'}`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3" pad={false}>
          <div className="ot-card-pad !pb-2">
            <CardHeader title="By champion" sub="Pick a row to see who you do well and badly against." />
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left ot-faint text-xs uppercase tracking-wide">
                <th className="py-2 pl-5 font-semibold">Champion</th>
                <th className="py-2 font-semibold text-right">Games</th>
                <th className="py-2 font-semibold text-right">Win rate</th>
                <th className="py-2 font-semibold text-right">KDA</th>
                <th className="py-2 pr-5 font-semibold text-right">CS/min</th>
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
                      <span className="flex items-center gap-2.5">
                        <Portrait champion={c || { key: r.championId }} size={28} />
                        <span className="font-medium">{c?.name || `#${r.championId}`}</span>
                        {r.mainRole ? <span className="ot-faint text-xs">{r.mainRole}</span> : null}
                      </span>
                    </td>
                    <td className="py-2 text-right">{r.games}</td>
                    <td className="py-2 text-right">
                      <WinRate r={r} />
                    </td>
                    <td className="py-2 text-right">{r.kda.toFixed(2)}</td>
                    <td className="py-2 pr-5 text-right">{r.csPerMin.toFixed(1)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title={focusRow ? `${byKey.get(focusRow.championId)?.name || 'Champion'} against` : 'Against'}
            sub={
              withDetails.length < focusGames.length
                ? `From ${withDetails.length} of ${focusGames.length} games so far. More load each refresh.`
                : `From ${withDetails.length} games.`
            }
          />
          {opponentRows.length ? (
            <ul className="space-y-2">
              {opponentRows.map(([id, r]) => {
                const c = byKey.get(id);
                return (
                  <li key={id} className="flex items-center gap-3">
                    <Portrait champion={c || { key: id }} size={30} ring="red" />
                    <span className="flex-1 min-w-0 truncate text-[15px]">{c?.name || `#${id}`}</span>
                    <span className="ot-num text-sm ot-muted">
                      {r.wins}–{r.losses}
                    </span>
                    <WinRate r={r} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm ot-muted">{loading ? 'Loading game details.' : 'No game details yet.'}</p>
          )}
          <p className="mt-4 text-xs ot-faint leading-relaxed">
            Faded numbers have fewer than {MIN_SAMPLE} games. The range is a 95% confidence interval.
          </p>
        </Card>
      </div>
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
