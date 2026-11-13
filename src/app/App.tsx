import React, { useEffect, useMemo, useState } from 'react';
import type { CatalogRole } from '../catalog/types';
import type { Champion } from '../logic/pykeLogic';
import { IconDraft, IconGauge, IconHome, IconLoadout, IconMayhem, IconOverlay, IconStats, IconCheck } from './icons';
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
} from './hooks';
import { leagueStatus } from './status';
import { Pill, Toasts } from './ui';
import { HomeView } from './views/HomeView';
import { DraftView } from './views/DraftView';
import { LoadoutView } from './views/LoadoutView';
import { OverlayView } from './views/OverlayView';
import { PerformanceView } from './views/PerformanceView';
import { ReviewView } from './views/ReviewView';
import { StatsView } from './views/StatsView';
import { MayhemView } from './views/MayhemView';
import { PixelPet } from './PixelPet';
import { PET_DEFAULTS, PET_SPECIES, PET_COLORS, PET_SPECIES_LABELS, COLOR_HEX } from './pixelPetLogic';

export type ViewId = 'home' | 'draft' | 'loadout' | 'mayhem' | 'stats' | 'review' | 'overlay' | 'performance';

const NAV: Array<{ id: ViewId; label: string; icon: React.ReactNode }> = [
  { id: 'home', label: 'Home', icon: <IconHome /> },
  { id: 'draft', label: 'Champ select', icon: <IconDraft /> },
  { id: 'loadout', label: 'Build & runes', icon: <IconLoadout /> },
  { id: 'mayhem', label: 'ARAM Mayhem (beta)', icon: <IconMayhem /> },
  { id: 'stats', label: 'Your stats', icon: <IconStats /> },
  { id: 'review', label: 'Match review', icon: <IconCheck /> },
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

  const { settings, update } = useAppSettings();
  const history = useMatchHistory(league, view === 'stats' || draft.live);

  // Apply dashboard appearance (theme/accent/density/radius/glass/font scale)
  // straight to the app root so token.css / theme.css react immediately.
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  useEffect(() => {
    applyAppearance(settings);
  }, [settings]);

  const appearance = settings?.appearance;
  const ap: AppearanceSettings = appearance ?? {
    theme: 'gothic',
    accent: 'chrome',
    density: 'comfortable',
    radius: 6,
    glass: 0,
    fontScale: 1,
  };
  const setAppearance = (patch: Partial<AppearanceSettings>) =>
    update({ appearance: patch as AppearanceSettings });

  // Dashboard pet: persisted species + color, shown only while idle/queue/loading.
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

  const selectChampion = (champion: Champion, role: CatalogRole) => setProfileId(profileIdFor(champion, role));

  return (
    <div className="ot-shell">
      <header className="ot-titlebar">
        <div className="ot-brand">
          <span className="ot-brand-mark">
            <ChromeMark size={19} />
          </span>
          One Trick
        </div>
        <div className="flex items-center gap-2 ot-no-drag min-w-0">
          <Pill tone={status.tone} title={status.detail}>
            {status.short}
          </Pill>
          {catalog.patch ? <span className="text-xs ot-faint hidden md:inline">Patch {catalog.patch}</span> : null}
          <button
            type="button"
            className="ot-btn ot-btn-sm ot-btn-ghost"
            onClick={() => setAppearanceOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={appearanceOpen}
            aria-label="Appearance"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="2.5" y="2.5" width="19" height="19" rx="4" stroke="currentColor" strokeWidth="1.7" />
              <circle cx="8" cy="9" r="2" fill="currentColor" />
              <circle cx="16" cy="9" r="2" fill="currentColor" />
              <circle cx="8" cy="16" r="2" fill="currentColor" />
              <circle cx="16" cy="16" r="2" fill="currentColor" />
            </svg>
            Appearance
          </button>
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
          <p>{isDesktop ? 'Desktop' : 'Browser preview'} · not endorsed by Riot Games</p>
          <p className="mt-2">
            Auto-clip plays FFmpeg 6.1.1 as a separate program. That build is GPL-3.0. License and source are in
            THIRD_PARTY_NOTICES.txt.
          </p>
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
      </main>

      <PixelPet stage={status.stage} preference={pet} />

      <Toasts toasts={toasts} onDismiss={dismiss} />

      {appearanceOpen ? <div className="ot-appearance-scrim" onClick={() => setAppearanceOpen(false)} /> : null}
      <div className={`ot-appearance-drawer ${appearanceOpen ? 'is-open' : ''}`} role="dialog" aria-modal="true" aria-label="Appearance">
        <AppearanceControls ap={ap} setAppearance={setAppearance} pet={pet} setPet={setPet} onClose={() => setAppearanceOpen(false)} />
      </div>
    </div>
  );
};

const ACCENT_SWATCH: Record<AppearanceAccent, string> = {
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
  onClose: () => void;
};

function AppearanceControls({ ap, setAppearance, pet, setPet, onClose }: AppearanceControlsProps) {
  const currentTheme = APPEARANCE_THEME_OPTIONS.find((t) => t.id === ap.theme);
  const currentDensity = APPEARANCE_DENSITY_OPTIONS.find((d) => d.id === ap.density);
  const glassBlur = Math.round((ap.glass / 100) * 8);
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
        <button type="button" className="ot-btn ot-btn-sm ot-btn-ghost" onClick={onClose} aria-label="Close appearance">
          Close
        </button>
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
