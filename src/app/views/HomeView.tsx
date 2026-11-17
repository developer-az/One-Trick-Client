/**
 * Home (brief K) — exactly the approved mockup's composition, nothing else:
 *
 *   bottom-left   eyebrow · huge Cinzel name · one facts line
 *   bottom-right  one chrome action + caption (+ a quiet secondary action)
 *   bottom        4-card dock (recent form, build, matchups, last game)
 *
 * Everything the mockup does not show lives elsewhere: the champion picker and
 * the doctrine card are in Loadout, the overlay toggle and hotkeys in Overlay,
 * the legal/attribution line in Profile → About.
 */
import React from 'react';
import type { Champion } from '../../logic/pykeLogic';
import type { Build } from '../../logic/pykeLogic';
import { getRuneMeta } from '../../data/runeService';
import { byChampion, pct, record } from '../../logic/stats';
import type { ViewId } from '../App';
import type { DraftState, LeagueState } from '../hooks';
import { IconArrowRight } from '../icons';
import type { LeagueStatus } from '../status';
import { Button } from '../ui';

type HomeLoadout = {
  build: Build;
  runes: { selectedPerkIds: number[] };
  analysis: { winCondition?: string };
} | null;

const FORM_GAMES = 10;

function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export const HomeView: React.FC<{
  league: LeagueState;
  status: LeagueStatus;
  draft: DraftState;
  profile: { role: string; primaryEnemyRole: string; championId: string; championKey: number; label: string };
  champions: Champion[];
  mainChampion: { id?: string | null; name?: string | null } | null;
  games: MatchSummary[] | null;
  loadout: HomeLoadout;
  /** Baseline plan (build + runes) when no enemy team is known yet. */
  plan?: { build: Build; runes: { selectedPerkIds: number[] } } | null;
  onNavigate: (view: ViewId) => void;
}> = ({ status, draft, profile, champions, mainChampion, games, loadout, plan, onNavigate }) => {
  const history = React.useMemo(() => games || [], [games]);
  const championKey = Number(profile.championKey);
  const championRow = React.useMemo(
    () => byChampion(history).find((row) => row.championId === championKey) || null,
    [history, championKey]
  );
  const overall = React.useMemo(() => record(history), [history]);
  const form = history.slice(0, FORM_GAMES);
  const formRecord = React.useMemo(() => record(form), [form]);
  const lastGame = history[0] || null;

  const name = mainChampion?.name || mainChampion?.id || 'No champion';
  const role = profile.role;
  const gamesPlayed = championRow ? championRow.games : overall.games;
  const winRate = championRow ? championRow.winRate : overall.winRate;
  const facts = `${role} · ${gamesPlayed} games this season · ${championRow ? pct(winRate) : '—'} wins`;

  // Build card: core count + keystone name from the real rune page.
  const planBuild = loadout?.build || plan?.build || null;
  const coreCount = planBuild?.core?.length ?? null;
  const keystoneId = loadout?.runes?.selectedPerkIds?.[0] ?? plan?.runes?.selectedPerkIds?.[0];
  const keystone = keystoneId != null ? getRuneMeta(keystoneId)?.name || '—' : null;

  // Matchups card: best/worst lane opponent from your own history.
  const opponents = React.useMemo(() => {
    const groups = new Map<number, number[]>();
    for (const game of history) {
      if (!game.laneOpponent) continue;
      const list = groups.get(game.laneOpponent) || [];
      list.push(game.win ? 1 : 0);
      groups.set(game.laneOpponent, list);
    }
    const rows = [...groups.entries()].map(([id, results]) => ({
      id,
      wins: results.reduce((a, b) => a + b, 0),
      games: results.length,
      winRate: results.reduce((a, b) => a + b, 0) / results.length,
    }));
    const best = rows.length ? rows.reduce((a, b) => (b.winRate > a.winRate ? b : a)) : null;
    const worst = rows.length ? rows.reduce((a, b) => (b.winRate < a.winRate ? b : a)) : null;
    const nameOf = (id: number) => champions.find((c) => Number(c.key) === id)?.name || 'Unknown';
    return {
      best: best ? { name: nameOf(best.id), line: `${best.wins}-${best.games - best.wins}` } : null,
      worst: worst ? { name: nameOf(worst.id), line: `${worst.wins}-${worst.games - worst.wins}` } : null,
    };
  }, [history, champions]);
  const focusEnemy = draft.enemy[profile.primaryEnemyRole as 'Top' | 'Jungle' | 'Mid' | 'Bot' | 'Support']?.champion;

  const caption =
    status.stage === 'draft'
      ? 'Champ select is live'
      : status.stage === 'game'
        ? 'In match · overlay live'
        : status.stage === 'idle'
          ? `${role} · draft helper ready`
          : status.short;

  return (
    <div className="ot-home">
      <section className="ot-home-hero min-w-0" aria-labelledby="ot-home-champion" data-ot-geo="hero">
        <div className="ot-home-eyebrow">
          <span>One Trick</span>
          <span className="ot-home-eyebrow-sep" aria-hidden="true">
            ·
          </span>
          <span className="ot-home-eyebrow-main">Your main</span>
        </div>
        <h1 id="ot-home-champion" className="ot-home-champion ot-orn-title truncate">
          {name}
        </h1>
        <p className="ot-home-facts ot-num">{facts}</p>
      </section>

      <section className="ot-home-play min-w-0" aria-label="Actions" data-ot-geo="primary">
        <Button variant="primary" size="lg" className="ot-home-primary" onClick={() => onNavigate('loadout')}>
          Open build
        </Button>
        <div className="ot-home-caption">{caption}</div>
        <button type="button" className="ot-home-secondary" onClick={() => onNavigate('draft')}>
          Draft helper <IconArrowRight size={12} />
        </button>
      </section>

      <div className="ot-home-dock grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-ot-geo="dock">
        <article className="ot-info-card" aria-labelledby="ot-home-form">
          <h2 className="ot-info-card-head" id="ot-home-form">
            Recent form
          </h2>
          <div className="ot-info-card-big ot-num">
            {form.length ? pct(formRecord.winRate) : '—'}
            <span className="ot-info-card-note">last {form.length || 0}</span>
          </div>
          <div className="ot-form-bar" role="img" aria-label={`Last ${form.length} games: ${form.map((g) => (g.win ? 'win' : 'loss')).join(', ')}`}>
            {form.length ? (
              form.map((g) => <span key={g.gameId} className={`ot-form-pip ${g.win ? 'is-win' : 'is-loss'}`} />)
            ) : (
              <span className="ot-info-card-empty">No games read yet</span>
            )}
          </div>
        </article>

        <article className="ot-info-card" aria-labelledby="ot-home-build">
          <h2 className="ot-info-card-head" id="ot-home-build">
            Build
          </h2>
          <div className="ot-info-row">
            <span>Core</span>
            <span className="ot-num">{coreCount != null ? `${coreCount} items` : 'No enemies yet'}</span>
          </div>
          <div className="ot-info-row">
            <span>Runes</span>
            <span className="truncate">{keystone || 'No enemies yet'}</span>
          </div>
        </article>

        <article className="ot-info-card" aria-labelledby="ot-home-matchup">
          <h2 className="ot-info-card-head" id="ot-home-matchup">
            Matchups
          </h2>
          {opponents.best && opponents.worst && opponents.best.name !== opponents.worst.name ? (
            <>
              <div className="ot-info-row">
                <span>Best</span>
                <span className="truncate">
                  vs {opponents.best.name} <span className="ot-num ot-info-card-note">{opponents.best.line}</span>
                </span>
              </div>
              <div className="ot-info-row">
                <span>Worst</span>
                <span className="truncate">
                  vs {opponents.worst.name} <span className="ot-num ot-info-card-note">{opponents.worst.line}</span>
                </span>
              </div>
            </>
          ) : (
            <div className="ot-info-row">
              <span>{focusEnemy ? 'Focus' : 'Lane focus'}</span>
              <span className="truncate">{focusEnemy ? focusEnemy.name : profile.primaryEnemyRole}</span>
            </div>
          )}
        </article>

        <article className="ot-info-card" aria-labelledby="ot-home-last">
          <h2 className="ot-info-card-head" id="ot-home-last">
            Last game
          </h2>
          {lastGame ? (
            <>
              <div className="ot-info-row">
                <span className={lastGame.win ? 'ot-info-win' : 'ot-info-loss'}>{lastGame.win ? 'Victory' : 'Defeat'}</span>
                <span className="ot-num">
                  {lastGame.kills}/{lastGame.deaths}/{lastGame.assists}
                </span>
              </div>
              <div className="ot-info-row">
                <span>Duration</span>
                <span className="ot-num">
                  {clock(lastGame.durationSec)}
                </span>
              </div>
            </>
          ) : (
            <div className="ot-info-row">
              <span>No game</span>
              <span>—</span>
            </div>
          )}
        </article>
      </div>
    </div>
  );
};
