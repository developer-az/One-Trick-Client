import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CatalogRole } from '../catalog/types';
import { championSplashUrl } from '../data/ddragonAssets';
import type { Champion } from '../logic/pykeLogic';
import { IconDraft, IconHome, IconLoadout, IconMayhem, IconOverlay, IconStats, IconCheck } from './icons';
import { ChromeMark } from '../overlay/ChromeMark';
import {
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
  useOrbitShell,
} from './hooks';
import { leagueStatus } from './status';
import { Button, Toasts, Portrait } from './ui';
import { OrbitNav, type OrbitNavItem } from './OrbitNav';
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

/**
 * The reference's nav set. Profile is reached from the profile pill and
 * Performance from the Stats page — nothing is dropped, nothing extra is
 * invented for the arc.
 */
const NAV: OrbitNavItem[] = [
  { id: 'home', label: 'Home', icon: <IconHome /> },
  { id: 'draft', label: 'Draft', icon: <IconDraft /> },
  { id: 'loadout', label: 'Loadout', icon: <IconLoadout /> },
  { id: 'stats', label: 'Stats', icon: <IconStats /> },
  { id: 'review', label: 'Review', icon: <IconCheck /> },
  { id: 'mayhem', label: 'Mayhem', icon: <IconMayhem /> },
  { id: 'overlay', label: 'Overlay', icon: <IconOverlay /> },
];

const VIEW_KEY = 'onetrick.view';
const VALID_VIEWS: ViewId[] = [...NAV.map((n) => n.id), 'performance', 'profile'];

function loadView(): ViewId {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    if (v && VALID_VIEWS.includes(v as ViewId)) return v as ViewId;
  } catch {
    /* ignore */
  }
  return 'home';
}

/** Monogram for the profile pill (the client has no Riot profile icon yet). */
function monogram(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || '')
      .join('') || ''
  );
}

/**
 * Where the profile pill sits. The mockup's spot is top-right; when the
 * frameless window reports its native min/max/close overlay the pill drops
 * just below that strip instead, so the two never collide. The browser
 * preview and the screenshot harness have no overlay: the reference's spot.
 */
function titlebarMetrics(): { right: number; top: number } {
  const overlay =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator as Navigator & {
          windowControlsOverlay?: { visible?: boolean; getTitlebarAreaRect?: () => { width: number } };
        }).windowControlsOverlay;
  if (overlay && overlay.visible) return { right: 16, top: 158 };
  return { right: 16, top: 14 };
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
  const { tier, disk } = useOrbitShell();
  const titlebar = titlebarMetrics();

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

  // Home's build card always has real numbers: the live loadout when enemies
  // are known, else the champion profile's baseline plan.
  const plan = useMemo(() => {
    if (loadout) return { build: loadout.build, runes: loadout.runes };
    try {
      const build = profile.calculateBuild([]);
      return { build, runes: profile.calculateRunes([], build) };
    } catch (error) {
      console.error('Baseline plan failed:', error);
      return null;
    }
  }, [loadout, profile]);

  const { settings, update } = useAppSettings();
  const wantsHistory =
    view === 'home' || view === 'stats' || view === 'profile' || draft.live || !settings?.appearance?.mainChampion;
  const history = useMatchHistory(league, wantsHistory);

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
  const setAppearance = (patch: Partial<AppearanceSettings>) => update({ appearance: patch as AppearanceSettings });

  // Champion-driven shell: explicit main champion, else the most-played in
  // history. The accent is sampled only when the champion palette is active.
  const mainChampionKey = mainChampionId(ap, history.games, catalog.champions);
  const mainChampion: Champion | { id: string; name: string; key: string } | null = mainChampionKey
    ? catalog.champions.find((c) => c.id === mainChampionKey) || {
        id: mainChampionKey,
        name: mainChampionKey,
        key: '',
      }
    : null;
  useChampionAccent(mainChampion, ap.accent === 'champion');

  // Pinned champions live in settings (top-level). Only an absent list falls
  // back to the main champion; an explicitly empty list means nothing is pinned.
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
      if (!res.ok) push({ tone: 'bad', title: `Auto-import: ${res.title}`, body: res.body });
      else if (first) push({ tone: 'good', title: 'Runes and items imported', body: res.body });
    },
  });

  const selectChampion = (champion: Champion, role: CatalogRole) => {
    setProfileId(profileIdFor(champion, role));
    setAppearance({ mainChampion: champion.id, accent: ap.accent === 'chrome' ? 'champion' : ap.accent });
    if (!pinnedChampions.includes(champion.id)) setPins(addPin(pinnedChampions, champion.id));
  };

  /**
   * The licence line is always on screen; its Licenses link jumps to the
   * Profile About card. The card is the last block on that view, so keep the
   * shell's scroll container pinned to the bottom while the view's portraits
   * and type finish laying out, then settle the card into view above the
   * fixed line.
   */
  const openLicences = () => {
    setView('profile');
    const aboutCard = () =>
      (Array.from(document.querySelectorAll<HTMLElement>('.ot-card-title')).find(
        (el) => (el.textContent || '').trim() === 'About'
      )?.closest('.ot-card') as HTMLElement | null) ?? null;
    const deadline = performance.now() + 1000;
    const reveal = () => {
      const shell = document.querySelector<HTMLElement>('.ot-shell');
      const main = document.querySelector<HTMLElement>('.ot-main');
      const inProfile = shell?.getAttribute('data-ot-view') === 'profile';
      if (main && inProfile) {
        // Keep the view pinned to the bottom while the profile's portraits and
        // type finish laying out; the About card is the last block.
        main.scrollTop = main.scrollHeight;
      }
      if (performance.now() < deadline) {
        window.setTimeout(reveal, 100);
        return;
      }
      if (inProfile) aboutCard()?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    };
    window.setTimeout(reveal, 0);
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

  // Room for the fan on ordinary views (the arc pills sit under the disk).
  const mainPad = tier === 'arc' ? Math.round(disk / 2 + 120) : Math.round(disk / 2 + 170);

  // Non-Home views: the disk fan is a reserved header band. Measure the
  // lowest nav/pin/hub node and hand its bottom to `.ot-main`, whose top edge
  // becomes the scroll container's top — so scrolled content is clipped below
  // the band and can never slide under the pills, pins or hub. The value is
  // written straight to the shell (layout effect, before paint); it is layout
  // state owned by the DOM, not React render state.
  const shellRef = useRef<HTMLDivElement | null>(null);
  const pinsKey = pinnedChampions.join('|');
  useLayoutEffect(() => {
    let raf = 0;
    const apply = () => {
      const shell = shellRef.current;
      if (!shell) return;
      if (view === 'home') {
        shell.style.removeProperty('--ot-shell-band');
        return;
      }
      const nodes = document.querySelectorAll<HTMLElement>(
        '.ot-disk [data-ot-geo="nav"], .ot-disk [data-ot-geo="pin"], .ot-disk [data-ot-geo="hub"], .ot-disk [data-ot-geo="hub-name"]'
      );
      let bottom = 0;
      nodes.forEach((node) => {
        const rect = node.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) bottom = Math.max(bottom, rect.bottom);
      });
      const next = bottom > 0 ? Math.ceil(bottom + 12) : mainPad;
      shell.style.setProperty('--ot-shell-band', `${next}px`);
    };
    apply();
    // OrbitNav measures its pills in a layout effect and re-renders once with
    // exact widths; one frame later the fan geometry is final.
    raf = window.requestAnimationFrame(apply);
    window.addEventListener('resize', apply);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', apply);
    };
    // Font scale and the pin set change pill widths/heights; the fan re-solves.
  }, [view, tier, disk, mainPad, pinsKey, ap.fontScale, ap.density]);

  return (
    <div
      className="ot-shell"
      ref={shellRef}
      data-ot-view={view}
      style={{
        ['--ot-disk-size' as string]: `${disk}px`,
        ['--ot-titlebar-right' as string]: `${titlebar.right}px`,
        ['--ot-titlebar-top' as string]: `${titlebar.top}px`,
        ['--ot-main-pad' as string]: `${mainPad}px`,
      }}
    >
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

      <div className="ot-drag" aria-hidden="true" />

      <div className="ot-status" data-ot-geo="status" title={status.detail}>
        <span className="ot-status-dot" />
        <span>{status.short}</span>
      </div>

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
          <b className="ot-profile-chip-name">{connected && summonerName ? summonerName : 'Profile'}</b>
          <span className="ot-profile-chip-sub">
            {connected && summonerName ? 'Profile' : 'Connect account'}
          </span>
        </span>
      </button>

      <OrbitNav
        tier={tier}
        disk={disk}
        items={navItems}
        view={view}
        onSelect={setView}
        champion={mainChampion}
        championName={mainChampion?.name || ''}
        pins={pinnedChampions}
        champions={catalog.champions}
        activePinId={mainChampionKey || null}
        pinActions={{ ...pinActions, onPin: (id: string) => setPins(addPin(pinnedChampions, id)) }}
      />

      <main className={`ot-main ${view === 'home' ? 'is-home' : ''}`}>
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
            plan={plan}
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
            champions={catalog.champions}
            onSelectChampion={selectChampion}
            onSelectProfile={setProfileId}
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
            onNavigate={setView}
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
            settings={settings}
            onOpenAppearance={() => setAppearanceOpen(true)}
            pinActions={{
              ...pinActions,
              onPin: (id: string) => setPins(addPin(pinnedChampions, id)),
            }}
            onNavigate={setView}
          />
        ) : null}
      </main>

      <a
        className="ot-licence"
        data-ot-geo="licence"
        href="#about"
        title="FFmpeg licence and third-party notices"
        onClick={(event) => {
          event.preventDefault();
          openLicences();
        }}
      >
        FFmpeg 6.1.1 · GPL-3.0 · <span className="ot-licence-link">Licenses</span>
      </a>

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
