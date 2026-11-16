/**
 * Home (brief J) — champion-first landing screen.
 *
 * Left: the champion you main, named in Cinzel on one ink plate with a single
 * line of facts. Right: the actions that actually exist (open the build, open
 * the draft board) — never a fake "find match". Bottom: four dense info cards
 * from data the app already has (recent form, core build, matchup focus, last
 * game). Numbers are tabular; nothing here animates.
 */
import React from 'react';
import type { CatalogRole } from '../../catalog/types';
import type { Champion } from '../../logic/pykeLogic';
import type { Build } from '../../logic/pykeLogic';
import { AUTHORED_PROFILES, isAuthoredProfileId, type ChampionProfile, type ProfileId } from '../../logic/profiles';
import { byChampion, pct, record } from '../../logic/stats';
import type { ViewId } from '../App';
import { ROLES, isDesktop, useAppSettings, type DraftState, type LeagueState } from '../hooks';
import { IconArrowRight, IconDraft, IconLoadout } from '../icons';
import { SpellTimers } from '../SpellTimers';
import type { LeagueStatus } from '../status';
import { Badge, Button, Card, CardHeader, ChampionCombobox, Item, Pill, Portrait, SettingRow, Switch } from '../ui';
import { CrestMark, type BannerChampion } from '../ornaments';
import { OneTrickCard } from './OneTrickCard';

const STAGE_TITLE: Record<LeagueStatus['stage'], string> = {
  preview: 'Browser preview',
  offline: 'Waiting for League',
  connecting: 'Connecting',
  idle: 'Ready when you are',
  queue: 'In queue',
  draft: 'Champ select is live',
  loading: 'Loading into the match',
  game: 'Match in progress',
  post: 'Match over',
};

type HomeLoadout = {
  build: Build;
  analysis: { winCondition?: string; aggressionLevel?: string; majorThreats?: string[] };
} | null;

const FORM_GAMES = 10;

export const HomeView: React.FC<{
  league: LeagueState;
  status: LeagueStatus;
  draft: DraftState;
  profile: ChampionProfile;
  champions: Champion[];
  /** Resolved main champion (explicit or most-played); null = no banner identity. */
  mainChampion?: BannerChampion | null;
  games: MatchSummary[] | null;
  loadout: HomeLoadout;
  /** Baseline plan when no enemy team is known yet. */
  plan?: Build | null;
  onSelectChampion: (champion: Champion, role: CatalogRole) => void;
  onSelectProfile: (id: ProfileId) => void;
  onNavigate: (view: ViewId) => void;
}> = ({ league, status, draft, profile, champions, mainChampion, games, loadout, plan, onSelectChampion, onSelectProfile, onNavigate }) => {
  const { settings, update } = useAppSettings();
  const [role, setRole] = React.useState<CatalogRole>(profile.role);
  const profileChampion = champions.find((c) => c.id === profile.championId) || {
    id: profile.championId,
    name: profile.shortLabel,
    key: String(profile.championKey),
    tags: [],
  };
  const authored = isAuthoredProfileId(profile.id);
  const bannerChampion = mainChampion || profileChampion;
  const bannerName = bannerChampion.name || bannerChampion.id || profile.shortLabel;

  const history = React.useMemo(() => games || [], [games]);
  const championKey = Number(profile.championKey);
  const championRow = React.useMemo(
    () => byChampion(history).find((row) => row.championId === championKey) || null,
    [history, championKey]
  );
  const overall = React.useMemo(() => record(history), [history]);
  const form = history.slice(0, FORM_GAMES);
  const lastGame = history[0] || null;
  const lastChampion = lastGame ? champions.find((c) => Number(c.key) === lastGame.championId) || null : null;
  const enemyFocus = draft.enemy[profile.primaryEnemyRole]?.champion || null;

  const planBuild = loadout?.build || plan || null;
  const coreItems = planBuild?.core?.slice(0, 3) || [];
  const boots = planBuild?.boots || null;
  const actions = (
    <div className="ot-home-cta">
      <Button variant="primary" icon={<IconLoadout />} onClick={() => onNavigate('loadout')}>
        {status.stage === 'draft' ? 'Open your loadout' : 'Open build'}
      </Button>
      <Button
        variant="secondary"
        icon={status.stage === 'draft' ? <IconDraft /> : <IconArrowRight />}
        onClick={() => onNavigate('draft')}
      >
        {status.stage === 'draft' ? 'Champ select' : 'Draft helper'}
      </Button>
    </div>
  );

  return (
    <div className="ot-page ot-home">
      <div className="ot-home-top">
        <section className="ot-home-title" aria-labelledby="ot-home-champion">
          <div className="ot-home-eyebrow">
            <CrestMark size={14} />
            <span>Your main</span>
          </div>
          <h1 id="ot-home-champion" className="ot-home-champion ot-orn-title truncate">
            {bannerName}
          </h1>
          <p className="ot-home-facts ot-num">
            <span>{profile.role}</span>
            <span className="ot-home-sep" aria-hidden="true">
              ·
            </span>
            <span>{championRow ? `${championRow.games} games` : `${overall.games} games`}</span>
            <span className="ot-home-sep" aria-hidden="true">
              ·
            </span>
            <span>{championRow ? `KDA ${championRow.kda.toFixed(2)}` : 'KDA —'}</span>
            <span className="ot-home-sep" aria-hidden="true">
              ·
            </span>
            <span>{championRow ? `${pct(championRow.winRate)} of ${championRow.games}` : 'no record yet'}</span>
          </p>
          <div className="ot-home-status">
            <Pill tone={status.tone}>{status.short}</Pill>
            <span className="ot-home-status-text">{status.detail}</span>
          </div>
          {draft.live || league.inGame ? (
            <div className="ot-home-live">
              <Badge tone={league.inGame ? 'teal' : 'gold'}>{league.inGame ? 'In match' : 'Champ select'}</Badge>
              <span className="ot-muted">
                {league.inGame ? 'The overlay is live.' : STAGE_TITLE[status.stage]}
              </span>
            </div>
          ) : null}
        </section>

        <section className="ot-home-side min-w-0" aria-label="Champion and actions">
          <div className="ot-home-identity">
            <Portrait champion={profileChampion} size={56} ring="gold" />
            <div className="min-w-0">
              <div className="ot-home-identity-name truncate">{profile.label}</div>
              <div className="ot-home-identity-tags">
                <Badge tone="gold">{profile.role}</Badge>
                {authored ? <Badge tone="teal">Hand-tuned</Badge> : <Badge>Catalog build</Badge>}
              </div>
            </div>
          </div>
          {actions}
          <p className="ot-home-next">
            {status.next || 'Nothing queued. Your build and matchups are ready when champ select starts.'}
          </p>
        </section>
      </div>

      <div className="ot-home-dock grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article className="ot-info-card" aria-labelledby="ot-home-form">
          <div className="ot-info-card-head" id="ot-home-form">
            Recent form
          </div>
          <div className="ot-info-card-value ot-num">
            {overall.wins}
            <span className="ot-info-card-unit">W</span>
            <span className="ot-info-card-sep">·</span>
            {overall.losses}
            <span className="ot-info-card-unit">L</span>
          </div>
          <div className="ot-form-bar" role="img" aria-label={`Last ${form.length} games: ${form.map((g) => (g.win ? 'win' : 'loss')).join(', ')}`}>
            {form.length ? (
              form.map((g) => <span key={g.gameId} className={`ot-form-pip ${g.win ? 'is-win' : 'is-loss'}`} />)
            ) : (
              <span className="ot-info-card-empty">No games read yet</span>
            )}
          </div>
          <div className="ot-info-card-foot ot-num">
            {overall.games ? `${pct(overall.winRate)} across ${overall.games} games` : 'Waiting for match history'}
          </div>
        </article>

        <article className="ot-info-card" aria-labelledby="ot-home-build">
          <div className="ot-info-card-head" id="ot-home-build">
            Build
          </div>
          {coreItems.length ? (
            <div className="ot-info-card-items">
              {coreItems.map((item) => (
                <Item key={item.id} id={item.id} name={item.name} size={28} />
              ))}
              {boots ? <Item id={boots.id} name={boots.name} size={28} /> : null}
            </div>
          ) : (
            <div className="ot-info-card-value">—</div>
          )}
          <div className="ot-info-card-foot">
            {coreItems.length ? coreItems.map((item) => item.name).join(' · ') : 'Fills in when the enemy team is known'}
          </div>
        </article>

        <article className="ot-info-card" aria-labelledby="ot-home-matchup">
          <div className="ot-info-card-head" id="ot-home-matchup">
            Matchups
          </div>
          <div className="ot-info-card-value truncate">{enemyFocus ? enemyFocus.name : profile.primaryEnemyRole}</div>
          <div className="ot-info-card-foot">
            {enemyFocus
              ? loadout?.analysis?.winCondition || `${profile.primaryEnemyRole} is the lane that decides this one.`
              : `Lane focus · waits on a ${profile.primaryEnemyRole.toLowerCase()} pick`}
          </div>
        </article>

        <article className="ot-info-card" aria-labelledby="ot-home-last">
          <div className="ot-info-card-head" id="ot-home-last">
            Last game
          </div>
          {lastGame ? (
            <>
              <div className="ot-info-card-value ot-num">
                {lastGame.kills}
                <span className="ot-info-card-sep">/</span>
                {lastGame.deaths}
                <span className="ot-info-card-sep">/</span>
                {lastGame.assists}
              </div>
              <div className="ot-info-card-foot">
                <Badge tone={lastGame.win ? 'teal' : 'red'}>{lastGame.win ? 'Win' : 'Loss'}</Badge>
                <span className="truncate">{lastChampion?.name || 'Champion'}</span>
              </div>
            </>
          ) : (
            <>
              <div className="ot-info-card-value">—</div>
              <div className="ot-info-card-foot">No Summoner&apos;s Rift game read yet</div>
            </>
          )}
        </article>
      </div>

      <div className="ot-home-lower">
        <Card>
          <CardHeader title="Your champion" sub="Follows your champ select pick. Pick one here to plan ahead." />
          <div className="ot-home-pick">
            <div className="flex-1 min-w-[200px]">
              <ChampionCombobox
                champions={champions}
                value={null}
                onChange={(c) => c && onSelectChampion(c, role)}
                placeholder={champions.length ? 'Search a champion' : 'Loading champions'}
                disabled={!champions.length}
              />
            </div>
            <div className="ot-segment" role="group" aria-label="Role">
              {ROLES.map((r) => (
                <button key={r} type="button" className={role === r ? 'is-active' : ''} onClick={() => setRole(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="ot-home-authored">
            {AUTHORED_PROFILES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`ot-home-authored-item ${profile.id === p.id ? 'is-active' : ''}`}
                onClick={() => onSelectProfile(p.id)}
                aria-pressed={profile.id === p.id}
              >
                <Portrait champion={champions.find((c) => c.id === p.championId) || { id: p.championId, name: p.shortLabel }} size={20} />
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </div>
        </Card>

        <div className="ot-home-rail">
          <OneTrickCard champion={profileChampion as Champion} role={profile.role} />

          {league.inGame && league.enemySummoners.length ? (
            <Card>
              <CardHeader title="Enemy summoners" sub="Click a spell when you see it used." />
              <SpellTimers lanes={league.enemySummoners} />
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Overlay" />
            {isDesktop ? (
              <SettingRow
                title="Show the overlay in matches"
                hint="Off means nothing is drawn over League."
                control={
                  <Switch
                    label="Overlay"
                    checked={!!settings?.overlayEnabled}
                    disabled={!settings}
                    onChange={(v) => update({ overlayEnabled: v })}
                  />
                }
              />
            ) : (
              <p className="text-sm ot-muted">Available in the desktop app.</p>
            )}
            <div className="mt-2">
              <Button variant="ghost" iconAfter={<IconArrowRight />} onClick={() => onNavigate('overlay')}>
                Customise overlay
              </Button>
            </div>
          </Card>
        </div>
      </div>

      <p className="ot-home-note text-xs ot-faint">
        Builds and matchup notes are heuristics from champion classes and the authored doctrines, not win-rate data.
      </p>
      <div className="ot-home-hotkeys">
        <Hotkey keys={['Page Up']} alt="Num 9" label="Enemy ADC used Flash" />
        <Hotkey keys={['Page Down']} alt="Num 3" label="Enemy support used Flash" />
        <Hotkey keys={['Ctrl', 'Shift', 'H']} label="Show or hide overlay" />
      </div>
    </div>
  );
};

const Hotkey: React.FC<{ keys: string[]; alt?: string; label: string }> = ({ keys, alt, label }) => (
  <div className="ot-home-hotkey">
    <span className="ot-muted">{label}</span>
    <span className="flex gap-1 flex-none">
      {keys.map((k) => (
        <kbd key={k} className="ot-kbd">
          {k}
        </kbd>
      ))}
      {alt ? (
        <>
          <span className="ot-faint text-xs self-center px-0.5">or</span>
          <kbd className="ot-kbd">{alt}</kbd>
        </>
      ) : null}
    </span>
  </div>
);
