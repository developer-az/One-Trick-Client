import React, { useMemo, useState } from 'react';
import type { CatalogRole } from '../catalog/types';
import type { Champion } from '../logic/pykeLogic';
import { IconDraft, IconGauge, IconHome, IconLoadout, IconMark, IconOverlay, IconStats } from './icons';
import { isDesktop, profileIdFor, ROLES, useAppSettings, useAutoImport, useCatalog, useMatchHistory, useDraft, useLeague, useProfile, useToasts } from './hooks';
import { leagueStatus } from './status';
import { Pill, Toasts } from './ui';
import { HomeView } from './views/HomeView';
import { DraftView } from './views/DraftView';
import { LoadoutView } from './views/LoadoutView';
import { OverlayView } from './views/OverlayView';
import { PerformanceView } from './views/PerformanceView';
import { StatsView } from './views/StatsView';

export type ViewId = 'home' | 'draft' | 'loadout' | 'stats' | 'overlay' | 'performance';

const NAV: Array<{ id: ViewId; label: string; icon: React.ReactNode }> = [
  { id: 'home', label: 'Home', icon: <IconHome /> },
  { id: 'draft', label: 'Champ select', icon: <IconDraft /> },
  { id: 'loadout', label: 'Build & runes', icon: <IconLoadout /> },
  { id: 'stats', label: 'Your stats', icon: <IconStats /> },
  { id: 'overlay', label: 'In-game overlay', icon: <IconOverlay /> },
  { id: 'performance', label: 'Performance', icon: <IconGauge /> },
];

const VIEW_KEY = 'onetrick.view';

function loadView(): ViewId {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v && NAV.some((n) => n.id === v)) return v as ViewId;
  } catch {
    /* ignore */
  }
  return 'home';
}

export const App: React.FC = () => {
  const [view, setViewState] = useState<ViewId>(loadView);
  const setView = (next: ViewId) => {
    setViewState(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* ignore */
    }
  };

  const catalog = useCatalog();
  const league = useLeague();
  const { draft, setManual, clearManual } = useDraft(catalog.champions, league.inGame);
  const { profile, setProfileId } = useProfile(draft, league, catalog.stamp);
  const { toasts, push, dismiss } = useToasts();
  const status = leagueStatus(league, draft);

  // Jump to champ select when it starts; a lobby is the one moment the user
  // needs this screen without having to look for it.
  const [prevDraftLive, setPrevDraftLive] = useState(draft.live);
  if (prevDraftLive !== draft.live) {
    setPrevDraftLive(draft.live);
    if (draft.live && view === 'home') setViewState('draft');
  }

  const enemies = useMemo(
    () => ROLES.map((r) => draft.enemy[r]?.champion).filter((c): c is Champion => !!c),
    [draft.enemy]
  );
  const allyAdc = draft.ally.Bot?.isLocal ? null : draft.ally.Bot?.champion || null;
  const allyPartner = profile.focusAllies.includes('YourJungle')
    ? draft.ally.Jungle?.champion || null
    : draft.ally.Mid?.isLocal
      ? null
      : draft.ally.Mid?.champion || null;

  const loadout = useMemo(() => {
    if (!enemies.length) return null;
    const adc = profile.focusAllies.includes('YourADC') ? allyAdc : null;
    try {
      const build = profile.calculateBuild(enemies, adc, allyPartner);
      return {
        build,
        runes: profile.calculateRunes(enemies, build, adc, allyPartner),
        analysis: profile.analyzeMatchup(enemies, build, adc, allyPartner),
        dominance: profile.calculateDominance(enemies, build, adc, allyPartner),
      };
    } catch (error) {
      console.error('Loadout failed:', error);
      return null;
    }
  }, [enemies, allyAdc, allyPartner, profile]);

  const { settings } = useAppSettings();
  const history = useMatchHistory(league, view === 'stats' || draft.live);
  useAutoImport({
    draft,
    profile,
    loadout,
    settings,
    onResult: (res, first) => {
      // The first send per lobby and any failure are worth a toast; silent
      // re-sends as enemies lock in would just be noise.
      if (!res.ok) push({ tone: 'bad', title: `Auto-import: ${res.title}`, body: res.body });
      else if (first) push({ tone: 'good', title: 'Runes and items imported', body: res.body });
    },
  });

  const selectChampion = (champion: Champion, role: CatalogRole) => setProfileId(profileIdFor(champion, role));

  return (
    <div className="ot-shell">
      <header className="ot-titlebar">
        <div className="ot-brand">
          <span className="ot-brand-mark">
            <IconMark />
          </span>
          One Trick
        </div>
        <div className="flex items-center gap-2 ot-no-drag min-w-0">
          <Pill tone={status.tone} title={status.detail}>
            {status.short}
          </Pill>
          {catalog.patch ? <span className="text-xs ot-faint hidden md:inline">Patch {catalog.patch}</span> : null}
        </div>
      </header>

      <nav className="ot-sidebar" aria-label="Main">
        {NAV.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`ot-nav ${view === item.id ? 'is-active' : ''}`}
            onClick={() => setView(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            {item.icon}
            {item.label}
            {item.id === 'draft' && draft.live ? <span className="ot-nav-badge" title="Champ select is live" /> : null}
            {item.id === 'overlay' && league.inGame ? <span className="ot-nav-badge" title="Match in progress" /> : null}
          </button>
        ))}
        <div className="mt-auto px-3 pt-6 text-xs ot-faint leading-relaxed">
          {isDesktop ? 'Desktop' : 'Browser preview'} · not endorsed by Riot Games
        </div>
      </nav>

      <main className="ot-main">
        {view === 'home' ? (
          <HomeView
            league={league}
            status={status}
            draft={draft}
            profile={profile}
            champions={catalog.champions}
            onSelectChampion={selectChampion}
            onSelectProfile={setProfileId}
            onNavigate={setView}
          />
        ) : null}
        {view === 'draft' ? (
          <DraftView
            draft={draft}
            champions={catalog.champions}
            profile={profile}
            loadout={loadout}
            history={history.games}
            onManual={setManual}
            onClear={clearManual}
            onNavigate={setView}
          />
        ) : null}
        {view === 'loadout' ? (
          <LoadoutView
            profile={profile}
            loadout={loadout}
            connected={league.lcu?.state === 'connected'}
            onNavigate={setView}
            onToast={push}
          />
        ) : null}
        {view === 'stats' ? (
          <StatsView
            champions={catalog.champions}
            games={history.games}
            loading={history.loading}
            error={history.error}
            connected={league.lcu?.state === 'connected'}
            onReload={history.reload}
          />
        ) : null}
        {view === 'overlay' ? <OverlayView inGame={league.inGame} summoners={league.enemySummoners} /> : null}
        {view === 'performance' ? <PerformanceView /> : null}
      </main>

      <Toasts toasts={toasts} onDismiss={dismiss} />
    </div>
  );
};

export default App;
