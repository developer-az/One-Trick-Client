import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogRole } from '../catalog/types';
import { championSplashUrl } from '../data/ddragonAssets';
import type { Champion } from '../logic/pykeLogic';
import { IconDraft, IconHome, IconLoadout, IconMayhem, IconOverlay, IconStats, IconCheck, IconGauge } from './icons';
import { ChromeMark } from '../overlay/ChromeMark';
import {
  isDesktop,
  profileIdFor,
  ROLES,
  useAppSettings,
  useAutoImport,
  useCatalog,
  useMatchHistory,
  useDraft,
  useLeague,
  useProfile,
  useToasts,
  applyAppearance,
  APPEARANCE_THEME_OPTIONS,
  APPEARANCE_ACCENT_OPTIONS,
  APPEARANCE_DENSITY_OPTIONS,
  APPEARANCE_LAYOUT_OPTIONS,
  mainChampionId,
  useChampionAccent,
  useOrbitTier,
} from './hooks';
import { leagueStatus } from './status';
import { Button, Pill, Toasts, Portrait } from './ui';
import { Filigree, type BannerChampion } from './ornaments';
import { IconProfile, OrbitNav, type OrbitNavItem } from './OrbitNav';
import { addPin, movePin, pinHandlers, removePin } from './orbitLayout';
import { HomeView } from './views/HomeView';
import { DraftView } from './views/DraftView';
import { LoadoutView } from './views/LoadoutView';
import { OverlayView } from './views/OverlayView';
import { PerformanceView } from './views/PerformanceView';
import { ProfileView } from './views/ProfileView';
import { ReviewView } from './views/ReviewView';
import { StatsView } from './views/StatsView';
import { MayhemView } from './views/MayhemView';
import { PixelPet } from './PixelPet';
import { PET_DEFAULTS, PET_SPECIES, PET_COLORS, PET_SPECIES_LABELS, COLOR_HEX } from './pixelPetLogic';

export type ViewId = 'home' | 'draft' | 'loadout' | 'mayhem' | 'stats' | 'review' | 'overlay' | 'performance' | 'profile';

const NAV: OrbitNavItem[] = [
  { id: 'home', label: 'Home', icon: <IconHome /> },
  { id: 'draft', label: 'Draft', icon: <IconDraft /> },
  { id: 'loadout', label: 'Loadout', icon: <IconLoadout /> },
  { id: 'stats', label: 'Stats', icon: <IconStats /> },
  { id: 'review', label: 'Review', icon: <IconCheck /> },
  { id: 'mayhem', label: 'Mayhem', icon: <IconMayhem /> },
  { id: 'overlay', label: 'Overlay', icon: <IconOverlay /> },
  { id: 'performance', label: 'Performance', icon: <IconGauge /> },
  { id: 'profile', label: 'Profile', icon: <IconProfile /> },
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

/** Monogram for the profile chip: the app has no Riot profile icon yet. */
function monogram(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || 'OT'
  );
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
  const tier = useOrbitTier();

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

  // Home's build card always has something real to show: the live loadout when
  // enemies are known, else the champion profile's baseline plan.
  const planBuild = useMemo(() => {
    if (loadout?.build) return loadout.build;
    try {
      return profile.calculateBuild([]);
    } catch (error) {
      console.error('Baseline build failed:', error);
      return null;
    }
  }, [loadout, profile]);
  const { settings, update } = useAppSettings();
  // The champion banner needs the history even before Stats is opened: an
  // unset main champion defaults to the most-played one, and Home reads form.
  const wantsHistory =
    view === 'home' || view === 'stats' || view === 'profile' || draft.live || !settings?.appearance?.mainChampion;
  const history = useMatchHistory(league, wantsHistory);

  // Apply dashboard appearance (theme/accent/density/radius/glass/font scale)
  // straight to the app root so token.css / theme.css react immediately.
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  useEffect(() => {
    applyAppearance(settings);
  }, [settings]);

  // Glass backdrop-filter on cards is expensive while .ot-main scrolls — pause it briefly.
  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.ot-main');
    if (!main) return;
    let scrollEndTimer = 0;
    const onScroll = () => {
      document.documentElement.setAttribute('data-ot-scrolling', '');
      window.clearTimeout(scrollEndTimer);
      scrollEndTimer = window.setTimeout(() => {
        document.documentElement.removeAttribute('data-ot-scrolling');
      }, 140);
    };
    main.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      main.removeEventListener('scroll', onScroll);
      window.clearTimeout(scrollEndTimer);
      document.documentElement.removeAttribute('data-ot-scrolling');
    };
  }, [view]);
  const appearance = settings?.appearance;
  const ap: AppearanceSettings = appearance ?? {
    theme: 'gothic',
    accent: 'chrome',
    density: 'comfortable',
    radius: 6,
    glass: 0,
    fontScale: 1,
    mainChampion: '',
    layoutPreset: 'compact',
    ornament: 50,
  };
  const setAppearance = (patch: Partial<AppearanceSettings>) =>
    update({ appearance: patch as AppearanceSettings });

  // Champion-driven shell: explicit main champion, else the most-played in
  // history. The accent is sampled only when the champion palette is active.
  const mainChampionKey = mainChampionId(ap, history.games, catalog.champions);
  const mainChampion: BannerChampion | null = mainChampionKey
    ? catalog.champions.find((c) => c.id === mainChampionKey) || {
        id: mainChampionKey,
        name: mainChampionKey,
        key: '',
      }
    : null;
  useChampionAccent(mainChampion, ap.accent === 'champion');

  // Pinned champions live in settings (top-level, so old appearance files
  // migrate cleanly). Only an absent list falls back to the main champion; an
  // explicitly empty list means nothing is pinned.
  const storedPins = settings?.pinnedChampions;
  const pinnedChampions: string[] = Array.isArray(storedPins)
    ? storedPins
    : ap.mainChampion
      ? [ap.mainChampion]
      : [];

  const setPins = (next: string[]) => update({ pinnedChampions: next });
  const pinActions = pinHandlers({
    pins: pinnedChampions,
    setPins,
    setActive: (id: string) =>
      setAppearance({
        mainChampion: id,
        // Picking a champion opts into the champion palette unless the user
        // already chose a different one (kept from the old main-champion picker).
        accent: ap.accent === 'chrome' ? 'champion' : ap.accent,
      }),
  });

  // Dashboard pet: persisted species + color; hidden only during an active match.
  const pet = settings?.pet ?? PET_DEFAULTS;
  const setPet = (patch: Partial<PetSettings>) => update({ pet: { ...pet, ...patch } });
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

  const selectChampion = (champion: Champion, role: CatalogRole) => {
    setProfileId(profileIdFor(champion, role));
    setAppearance({ mainChampion: champion.id, accent: ap.accent === 'chrome' ? 'champion' : ap.accent });
    if (!pinnedChampions.includes(champion.id)) setPins(addPin(pinnedChampions, champion.id));
  };

  const summonerName = league.lcu?.summonerName || '';
  const connected = league.lcu?.state === 'connected';
  const navItems = useMemo(
    () =>
      NAV.map((item) => ({
        ...item,
        badge: (item.id === 'draft' && draft.live) || (item.id === 'overlay' && league.inGame),
      })),
    [draft.live, league.inGame]
  );

  return (
    <div className="ot-shell" data-ot-view={view}>
      <div className="ot-bg" aria-hidden="true">
        <div className="ot-bg-art">
          {mainChampionKey ? (
            <img
              key={mainChampionKey}
              src={championSplashUrl(mainChampionKey)}
              alt=""
              decoding="async"
              loading="eager"
              onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
            />
          ) : null}
        </div>
        <div className="ot-bg-ink" />
      </div>

      <header className="ot-titlebar">
        <div className="ot-brand">
          <span className="ot-brand-mark">
            <ChromeMark size={19} />
          </span>
          One Trick
        </div>
        <div className="flex items-center gap-2 ot-no-drag min-w-0" data-ot-geo="status">
          <Pill tone={status.tone} title={status.detail}>
            {status.short}
          </Pill>
          {catalog.patch ? <span className="text-xs ot-faint hidden md:inline">Patch {catalog.patch}</span> : null}
        </div>
        <div className="ot-titlebar-right ot-no-drag">
          <Button
            variant="ghost"
            icon={
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="2.5" y="2.5" width="19" height="19" rx="4" stroke="currentColor" strokeWidth="1.7" />
                <circle cx="8" cy="9" r="2" fill="currentColor" />
                <circle cx="16" cy="9" r="2" fill="currentColor" />
                <circle cx="8" cy="16" r="2" fill="currentColor" />
                <circle cx="16" cy="16" r="2" fill="currentColor" />
              </svg>
            }
            onClick={() => setAppearanceOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={appearanceOpen}
            aria-label="Appearance"
          >
            Appearance
          </Button>
          <button
            type="button"
            className="ot-profile-chip"
            data-ot-geo="profile"
            onClick={() => setView('profile')}
            aria-label={connected && summonerName ? `Profile: ${summonerName}` : 'Profile: connect your account'}
            aria-current={view === 'profile' ? 'page' : undefined}
          >
            <span className="ot-profile-chip-avatar" aria-hidden="true">
              {connected && summonerName ? monogram(summonerName) : <ChromeMark size={14} />}
            </span>
            <span className="ot-profile-chip-text">
              <span className="ot-profile-chip-name truncate">
                {connected && summonerName ? summonerName : 'Connect account'}
              </span>
              <span className="ot-profile-chip-sub truncate">
                {connected && summonerName ? 'Rank: not linked' : 'Riot API coming soon'}
              </span>
            </span>
          </button>
        </div>
      </header>

      <OrbitNav
        tier={tier}
        items={navItems}
        view={view}
        onSelect={setView}
        champion={mainChampion}
        championName={mainChampion?.name || ''}
        pins={pinnedChampions}
        champions={catalog.champions}
        activePinId={mainChampionKey || null}
        pinActions={{ ...pinActions, onPin: (id: string) => setPins(addPin(pinnedChampions, id)) }}
        onOpenProfile={() => setView('profile')}
      />

      <main className="ot-main">
        {view === 'home' ? (
          <HomeView
            league={league}
            status={status}
            draft={draft}
            profile={profile}
            champions={catalog.champions}
            mainChampion={mainChampion}
            games={history.games}
            loadout={loadout}
            plan={planBuild}
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
        {view === 'mayhem' ? (
          <MayhemView
            champions={catalog.champions}
            focusChampion={catalog.champions.find((c) => c.id === profile.championId) || null}
            onSelectChampion={(c) => selectChampion(c, 'Support')}
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
        {view === 'review' ? <ReviewView /> : null}
        {view === 'overlay' ? <OverlayView inGame={league.inGame} summoners={league.enemySummoners} /> : null}
        {view === 'performance' ? <PerformanceView /> : null}
        {view === 'profile' ? (
          <ProfileView
            league={league}
            draft={draft}
            champions={catalog.champions}
            pins={pinnedChampions}
            activePinId={mainChampionKey || null}
            activeChampion={mainChampion}
            pinActions={{
              ...pinActions,
              onPin: (id: string) => setPins(addPin(pinnedChampions, id)),
            }}
            onNavigate={setView}
          />
        ) : null}
      </main>

      <footer className="ot-shell-foot">
        <span className="ot-shell-foot-rule">
          <Filigree />
        </span>
        <p className="ot-shell-foot-text">
          {isDesktop ? 'Desktop' : 'Browser preview'} · not endorsed by Riot Games · Auto-clip plays FFmpeg 6.1.1
          (GPL-3.0) as a separate program — see THIRD_PARTY_NOTICES.txt
        </p>
      </footer>

      <PixelPet stage={status.stage} preference={pet} />

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {appearanceOpen ? <div className="ot-appearance-scrim" onClick={() => setAppearanceOpen(false)} /> : null}
      <div className={`ot-appearance-drawer ${appearanceOpen ? 'is-open' : ''}`} role="dialog" aria-modal="true" aria-label="Appearance">
        <AppearanceControls
          ap={ap}
          setAppearance={setAppearance}
          pet={pet}
          setPet={setPet}
          pins={pinnedChampions}
          champions={catalog.champions}
          onUnpin={(id) => setPins(removePin(pinnedChampions, id))}
          onReorder={(from, to) => setPins(movePin(pinnedChampions, from, to))}
          onClose={() => setAppearanceOpen(false)}
        />
      </div>
    </div>
  );
};

const ACCENT_SWATCH: Record<AppearanceAccent, string> = {
  champion: 'var(--ot-champ)',
  chrome: '#d6dae0',
  gold: '#c8a24e',
  blood: '#c0392b',
  teal: '#35c7b0',
  royal: '#5f7fd6',
};

type AppearanceControlsProps = {
  ap: AppearanceSettings;
  setAppearance: (patch: Partial<AppearanceSettings>) => void;
  pet: PetSettings;
  setPet: (patch: Partial<PetSettings>) => void;
  pins: readonly string[];
  champions: Champion[];
  onUnpin: (id: string) => void;
  onReorder: (from: number, to: number) => void;
  onClose: () => void;
};

function AppearanceControls({
  ap,
  setAppearance,
  pet,
  setPet,
  pins,
  champions,
  onUnpin,
  onReorder,
  onClose,
}: AppearanceControlsProps) {
  const currentTheme = APPEARANCE_THEME_OPTIONS.find((t) => t.id === ap.theme);
  const currentDensity = APPEARANCE_DENSITY_OPTIONS.find((d) => d.id === ap.density);
  const currentLayout = APPEARANCE_LAYOUT_OPTIONS.find((l) => l.id === ap.layoutPreset);
  const glassBlur = Math.round((ap.glass / 100) * 8);
  const pinnedRows = pins.map((id) => champions.find((c) => c.id === id) || { id, name: id });
  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="ot-card-title">Dashboard appearance</div>
          <p className="mt-1 text-sm ot-muted leading-relaxed">
            Theme, palette, density, type scale and your dashboard pet for the app window. Separate from the in-game
            overlay.
          </p>
        </div>
        <Button variant="ghost" onClick={onClose} aria-label="Close appearance">
          Close
        </Button>
      </div>

      <div className="ot-appearance-sample-wrap mb-4">
        <div
          className="ot-appearance-sample"
          style={{ borderRadius: ap.radius, backdropFilter: glassBlur > 0 ? `blur(${glassBlur}px)` : 'none' }}
        >
          <span className="ot-appearance-sample-swatch" style={{ background: ACCENT_SWATCH[ap.accent] }} />
          <div className="min-w-0">
            <div className="ot-appearance-sample-title">Match ahead</div>
            <div className="ot-appearance-sample-sub">
              {currentTheme?.label} · {ap.radius}px radius · glass {ap.glass}% · {(ap.fontScale * 100).toFixed(0)}% type
            </div>
          </div>
        </div>
      </div>

      <div className="overflow-y-auto min-h-0 space-y-4 pr-1">
        <div className="ot-appearance-field">
          <div className="ot-appearance-label">Theme</div>
          <div className="ot-segment" role="radiogroup" aria-label="Theme">
            {APPEARANCE_THEME_OPTIONS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={ap.theme === t.id}
                title={t.blurb}
                className={ap.theme === t.id ? 'is-active' : ''}
                onClick={() => setAppearance({ theme: t.id })}
              >
                {t.label}
              </button>
            ))}
          </div>
          {currentTheme ? <div className="ot-appearance-hint">{currentTheme.blurb}</div> : null}
        </div>

        <div className="ot-appearance-field">
          <div className="ot-appearance-label">Accent palette</div>
          <div className="flex items-center gap-2">
            {APPEARANCE_ACCENT_OPTIONS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`ot-appearance-swatch ${ap.accent === a.id ? 'is-active' : ''}`}
                aria-label={a.label}
                aria-pressed={ap.accent === a.id}
                title={a.label}
                onClick={() => setAppearance({ accent: a.id })}
                style={{ background: ACCENT_SWATCH[a.id] }}
              />
            ))}
          </div>
          <div className="ot-appearance-hint">Primary “yours” signal color across the dashboard.</div>
        </div>

        <div className="ot-appearance-field" role="group" aria-label="Pinned champions">
          <div className="ot-appearance-label">Pinned champions </div>
          <p className="ot-appearance-hint mb-2">
            Pins live on the disk's left arc and drive the backdrop, accent and hub. Manage them on the disk or in
            Profile — {pins.length} of 6 used.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {pinnedRows.map((champion, index) => (
              <span key={String(champion.id)} className="ot-appearance-pin">
                <Portrait champion={champion} size={26} />
                <button
                  type="button"
                  className="ot-appearance-pin-x"
                  aria-label={`Unpin ${champion.name}`}
                  onClick={() => onUnpin(String(champion.id))}
                >
                  ×
                </button>
                <span className="ot-appearance-pin-move">
                  <button
                    type="button"
                    aria-label={`Move ${champion.name} left`}
                    disabled={index === 0}
                    onClick={() => onReorder(index, index - 1)}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${champion.name} right`}
                    disabled={index === pinnedRows.length - 1}
                    onClick={() => onReorder(index, index + 1)}
                  >
                    ›
                  </button>
                </span>
              </span>
            ))}
            {pins.length ? null : <span className="ot-appearance-hint">No pins yet.</span>}
          </div>
        </div>

        <div className="ot-appearance-field">
          <div className="ot-appearance-label">Pet companion</div>
          <p className="ot-appearance-hint mb-2">
            A pixel pet for the dashboard corner. It idles, wanders and naps while you wait in queue or load in — it
            never appears over the game.
          </p>
          <div className="ot-segment" role="radiogroup" aria-label="Pet species">
            {PET_SPECIES.map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={pet.species === s}
                title={PET_SPECIES_LABELS[s]}
                className={pet.species === s ? 'is-active' : ''}
                onClick={() => setPet({ species: s })}
              >
                {PET_SPECIES_LABELS[s]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-3">
            {PET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={`ot-appearance-swatch ${pet.color === c ? 'is-active' : ''}`}
                aria-label={c}
                aria-pressed={pet.color === c}
                title={c}
                onClick={() => setPet({ color: c })}
                style={{ background: COLOR_HEX[c] }}
              />
            ))}
          </div>
          <PixelPet stage="idle" preference={pet} mode="static" />
        </div>

        <div className="ot-appearance-field">
          <div className="ot-appearance-label">Density</div>
          <div className="ot-segment" role="radiogroup" aria-label="Density">
            {APPEARANCE_DENSITY_OPTIONS.map((d) => (
              <button
                key={d.id}
                type="button"
                role="radio"
                aria-checked={ap.density === d.id}
                title={d.hint}
                className={ap.density === d.id ? 'is-active' : ''}
                onClick={() => setAppearance({ density: d.id })}
              >
                {d.label}
              </button>
            ))}
          </div>
          {currentDensity ? <div className="ot-appearance-hint">{currentDensity.hint}</div> : null}
        </div>

        <div className="ot-appearance-field">
          <div className="ot-appearance-label">Layout preset</div>
          <div className="ot-segment" role="radiogroup" aria-label="Layout preset">
            {APPEARANCE_LAYOUT_OPTIONS.map((l) => (
              <button
                key={l.id}
                type="button"
                role="radio"
                aria-checked={ap.layoutPreset === l.id}
                title={l.hint}
                className={ap.layoutPreset === l.id ? 'is-active' : ''}
                onClick={() => setAppearance({ layoutPreset: l.id })}
              >
                {l.label}
              </button>
            ))}
          </div>
          {currentLayout ? <div className="ot-appearance-hint">{currentLayout.hint}</div> : null}
        </div>

        <label className="ot-appearance-field ot-appearance-slider">
          <span className="ot-appearance-label">Ornament intensity </span>
          <span className="ot-appearance-value">{ap.ornament}%</span>
          <input
            type="range"
            className="ot-range"
            min={0}
            max={100}
            step={5}
            value={ap.ornament}
            onChange={(e) => setAppearance({ ornament: Number(e.target.value) })}
          />
          <span className="ot-appearance-hint">
            0 keeps today’s plain chrome, 50 adds engraved titles and hairline rules, 100 the full crest, filigree and
            corner flourishes.
          </span>
        </label>

        <label className="ot-appearance-field ot-appearance-slider">
          <span className="ot-appearance-label">Corner radius </span>
          <span className="ot-appearance-value">{ap.radius}px</span>
          <input
            type="range"
            className="ot-range"
            min={0}
            max={24}
            step={2}
            value={ap.radius}
            onChange={(e) => setAppearance({ radius: Number(e.target.value) })}
          />
        </label>

        <label className="ot-appearance-field ot-appearance-slider">
          <span className="ot-appearance-label">Glass level </span>
          <span className="ot-appearance-value">{ap.glass}%</span>
          <input
            type="range"
            className="ot-range"
            min={0}
            max={100}
            step={5}
            value={ap.glass}
            onChange={(e) => setAppearance({ glass: Number(e.target.value) })}
          />
          <span className="ot-appearance-hint">Frosted blur behind cards. 0 keeps surfaces opaque for performance.</span>
        </label>

        <label className="ot-appearance-field ot-appearance-slider">
          <span className="ot-appearance-label">Font scale </span>
          <span className="ot-appearance-value">{(ap.fontScale * 100).toFixed(0)}%</span>
          <input
            type="range"
            className="ot-range"
            min={85}
            max={120}
            step={5}
            value={Math.round(ap.fontScale * 100)}
            onChange={(e) => setAppearance({ fontScale: Number(e.target.value) / 100 })}
          />
          <span className="ot-appearance-hint">Scales the app’s base type (rem-based). Tighter text at large panels.</span>
        </label>
      </div>
    </div>
  );
}

export default App;
