import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  type Champion,
  type Build,
  type MatchupAnalysis,
} from '../logic/pykeLogic';
import {
  getProfile,
  isProfileId,
  loadStoredProfileId,
  type ChampionProfile,
  type ProfileId,
} from '../logic/profiles';
import type { JungleThreat } from '../logic/jungleLogic';
import type { WardStatus } from '../logic/visionLogic';
import { trackBuildProgress } from '../logic/buildProgress';
import { catalogPriceLookup, type OrderedBuyStep, type PriceLookup } from '../logic/purchasePlan';
import {
  buildInGameCues,
  buyOrderPlanForState,
  enemyRespawns,
  formatGameTime,
  getGankStatus,
  getWardStatus,
  resolveAllyAdcName,
  resolveAllyMidName,
  resolveAllyJungleName,
  resolveProfileId,
  shouldRunMayhemDismissTick,
  shouldRunOverlayClock,
  situationFromState,
  type OverlayCue,
  type OverlayEnemy,
  type OverlayState,
} from './overlayLogic';
import { SummonerTimers } from '../components/SummonerTimers';
import { EnemyRespawns } from '../components/EnemyRespawns';
import { ChampionIcon, ItemIcon } from '../components/GameIcons';
import { ChromeGameHud } from './ChromeGameHud';
import { ChromeMark } from './ChromeMark';
import { WardIndicator } from './WardIndicator';
import { GankSquare } from './GankSquare';
import { catalogItemsById, getCatalog, subscribeCatalog, warmCatalog } from '../catalog/client';
import { warmDdragonVersion } from '../data/ddragonAssets';
import { ingestChampionCatalog } from '../data/championCatalog';
import { DEFAULT_HUD_MODULES, normalizeHudModules, type HudModules } from './hudModules';
import { OverlayStickers } from './OverlayStickers';
import {
  dualRailLayout,
  layoutElement,
  layoutStyle,
  layoutToHudModules,
  normalizeHudLayout,
  type HudLayout,
} from './hudLayout';
import { computeLeagueGeometry } from './leagueGeometry';
import bundledMayhem from '../data/mayhem/bundle.json';
import {
  adjustBuildForMayhem,
  championForMayhem,
  isMayhemGame,
  isAramOrMayhem,
  rankMayhemChoices,
} from '../logic/mayhem';
import type { MayhemBundle } from '../logic/mayhem/types';
import { OverlayMayhemPanel } from './OverlayMayhemPanel';
import { OverlayPet } from './OverlayPet';
import { PET_DEFAULTS, normalizePet, type PetSettings } from '../app/pixelPetLogic';

const mayhemBundle = bundledMayhem as MayhemBundle;

function damageTypeFromTags(tags: string[]): Champion['damageType'] {
  return tags.includes('Mage') || tags.includes('Support') ? 'Magic' : 'Physical';
}

/* ------------------------------------------------------------------ *
 * Isolated 1 Hz overlay clock
 * ------------------------------------------------------------------ *
 * The HUD used to own the 1 Hz tick as component state, so every second the
 * whole overlay tree re-rendered. The tick now lives in a tiny external
 * store: OverlayApp only decides *whether* the clock should run and feeds it
 * the base game time; leaf countdown components consume the value through
 * useOverlayClock() (a useSyncExternalStore subscription) and re-render on
 * their own. DOM output is identical — the same fields tick at the same
 * cadence — but the rest of the HUD no longer renders every second.
 */

interface OverlayClockSnapshot {
  /** Running game-time seconds (base + wall-clock elapsed); 0 before any tick. */
  sec: number;
  /** Wall-clock ms of the most recent tick, for expiry math (mayhem dismiss). */
  nowMs: number;
}

const CLOCK_IDLE: OverlayClockSnapshot = { sec: 0, nowMs: 0 };

let clockSnapshot: OverlayClockSnapshot = { sec: 0, nowMs: Date.now() };
const clockListeners = new Set<() => void>();

function publishClock(next: OverlayClockSnapshot): void {
  clockSnapshot = next;
  clockListeners.forEach((listener) => listener());
}

function subscribeOverlayClock(listener: () => void): () => void {
  clockListeners.add(listener);
  return () => {
    clockListeners.delete(listener);
  };
}

function getOverlayClock(): OverlayClockSnapshot {
  return clockSnapshot;
}

/**
 * Leaf hook for 1 Hz data (running game-time label, mayhem dismiss expiry).
 * Only components that call this re-render on the tick.
 * Exported for leaf components outside this file; the fast-refresh rule
 * cannot see that a use* hook is component-safe, so it is opted out here.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOverlayClock(): OverlayClockSnapshot {
  return useSyncExternalStore(
    subscribeOverlayClock,
    getOverlayClock,
    () => ({ ...CLOCK_IDLE })
  );
}

/** "12:34" while the clock runs, "Live" before the first tick. */
function OverlayClockLabel(): React.ReactNode {
  const { sec } = useOverlayClock();
  return sec > 0 ? formatGameTime(sec) : 'Live';
}

/** " · 12:34" when the clock runs, nothing before it (compact panel meta). */
function OverlayClockMeta(): React.ReactNode {
  const { sec } = useOverlayClock();
  return sec > 0 ? ` · ${formatGameTime(sec)}` : '';
}

/* ------------------------------------------------------------------ *
 * Right-rail panels — React.memo with stable props so a render of the
 * overlay app (alignment toggle, profile switch, a state payload that does
 * not touch a given panel) skips the untouched panels entirely.
 * ------------------------------------------------------------------ */

const RAIL_PANEL_SIZE = {
  width: '220px',
  maxWidth: 'calc(100vw - 24px)',
} as const;

const DEFAULT_GANK_ANCHOR = { x: 0.835, y: 0.078, scale: 1, opacity: 1, anchor: 'tr' as const };
const DEFAULT_VISION_ANCHOR = { x: 0.835, y: 0.26, scale: 1, opacity: 1, anchor: 'tr' as const };
const DEFAULT_ACTION_ANCHOR = { x: 0.835, y: 0.54, scale: 1, opacity: 1, anchor: 'tr' as const };
const DEFAULT_BUY_ANCHOR = { x: 0.835, y: 0.42, scale: 1, opacity: 1, anchor: 'tr' as const };

const GankRailPanel = React.memo(function GankRailPanel({
  status,
  style,
}: {
  status: JungleThreat | null;
  style: React.CSSProperties;
}) {
  return (
    <div className="hud-overlay-scale hud-overlay-scale--right" style={style}>
      <OverlayChromePanel>
        <div className="relative z-10 px-2 py-1.5">
          <GankSquare threat={status} compact />
        </div>
      </OverlayChromePanel>
    </div>
  );
});

const VisionRailPanel = React.memo(function VisionRailPanel({
  status,
  style,
}: {
  status: WardStatus | null;
  style: React.CSSProperties;
}) {
  return (
    <div className="hud-overlay-scale hud-overlay-scale--right" style={style}>
      <OverlayChromePanel>
        <div className="relative z-10 px-2 py-1.5">
          <WardIndicator status={status} compact />
        </div>
      </OverlayChromePanel>
    </div>
  );
});

const ActionRailPanel = React.memo(function ActionRailPanel({
  line,
  style,
}: {
  line: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <div className="hud-overlay-scale hud-overlay-scale--right" style={style}>
      <OverlayChromePanel>
        <div className="relative z-10 px-2 py-1.5">{line}</div>
      </OverlayChromePanel>
    </div>
  );
});

const BuyRailPanel = React.memo(function BuyRailPanel({
  row,
  style,
}: {
  row: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <div className="hud-overlay-scale hud-overlay-scale--right" style={style}>
      <OverlayChromePanel>
        <div className="relative z-10 px-2 py-1.5 min-w-0">{row}</div>
      </OverlayChromePanel>
    </div>
  );
});

const SwitchProfileRailPanel = React.memo(function SwitchProfileRailPanel({
  profile,
  liveChampionName,
  onCollapse,
}: {
  profile: ChampionProfile;
  liveChampionName?: string;
  onCollapse: () => void;
}) {
  return (
    <div className="hud-overlay-scale hud-overlay-scale--right absolute top-14 right-3" style={RAIL_PANEL_SIZE}>
      <OverlayChromePanel>
        <div className="hud-chrome-header !py-1 !px-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <ChampionIcon
              championId={profile.championId}
              championName={liveChampionName}
              size={16}
              className="hud-champ-icon shrink-0"
            />
            <div className="min-w-0">
              <div className="hud-chrome-title truncate min-w-0 text-[11px]">One Trick</div>
              <div className="hud-chrome-meta !text-[11px]">{profile.shortLabel}</div>
            </div>
          </div>
          <button type="button" onClick={onCollapse} className="hud-btn shrink-0" title="Collapse rails">
            –
          </button>
        </div>
        <div className="relative z-10 px-2 py-1.5">
          <div className="hud-chrome-cue hud-chrome-cue--warn !text-[12px] !py-1">
            Switch profile → {liveChampionName || '?'}
          </div>
        </div>
      </OverlayChromePanel>
    </div>
  );
});

function OverlayChromePanel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`hud-overlay-panel hud-overlay-panel--rail overflow-hidden ${className}`}>
      <span className="hud-corner hud-corner-tl" aria-hidden />
      <span className="hud-corner hud-corner-br" aria-hidden />
      <span className="hud-rail hud-rail-top" aria-hidden />
      {children}
    </div>
  );
}

function emptyCalibration(): FrameCalibration {
  return { dx: 0, dy: 0, dw: 0, dh: 0 };
}

function NudgeGroup({
  label,
  onNudge,
}: {
  label: string;
  onNudge: (field: 'dx' | 'dy' | 'dw' | 'dh', delta: number) => void;
}) {
  return (
    <div className="hud-nudge-group" title={`Nudge ${label} alignment`}>
      <span className="text-[11px] uppercase tracking-wider opacity-70 mr-1">{label}</span>
      <button type="button" className="hud-nudge-btn" onClick={() => onNudge('dx', -2)}>←</button>
      <button type="button" className="hud-nudge-btn" onClick={() => onNudge('dx', 2)}>→</button>
      <button type="button" className="hud-nudge-btn" onClick={() => onNudge('dy', 2)}>↑</button>
      <button type="button" className="hud-nudge-btn" onClick={() => onNudge('dy', -2)}>↓</button>
      <button type="button" className="hud-nudge-btn" onClick={() => onNudge('dw', -4)}>W-</button>
      <button type="button" className="hud-nudge-btn" onClick={() => onNudge('dw', 4)}>W+</button>
      <button type="button" className="hud-nudge-btn" onClick={() => onNudge('dh', -4)}>H-</button>
      <button type="button" className="hud-nudge-btn" onClick={() => onNudge('dh', 4)}>H+</button>
    </div>
  );
}

/** How often the overlay page tells the main process it is still drawing. Keep in step with OVERLAY_BEAT_EVERY_MS. */
const OVERLAY_HEARTBEAT_EVERY_MS = 5000;
/** How long one heartbeat waits for an animation frame before reporting that none came. */
const OVERLAY_HEARTBEAT_FRAME_WAIT_MS = 2000;

/** Tracks document visibility so HUD timers stop while the overlay window is hidden. */
function usePageVisible(): boolean {
  const [pageVisible, setPageVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState === 'visible'
  );

  useEffect(() => {
    const update = (): void => setPageVisible(document.visibilityState === 'visible');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  return pageVisible;
}

/* ------------------------------------------------------------------ *
 * Coarse state keys for the expensive HUD derivations.
 * ------------------------------------------------------------------ *
 * The cue builders and ward/gank reads used to memoize on the `state` object
 * identity, so every payload forced a full recompute. These keys cover the
 * fields each derivation actually reads (game time at the same 10 s bucket
 * the main-process fingerprint uses), so a payload that does not touch a
 * derivation keeps its previous result — and its memoized output object stays
 * referentially stable for the memoized rail panels.
 */

/**
 * Every enemy field the gank/ward derivations read — assessJungleThreat()
 * keys on champion name, position, level, creep score, both summoner spell
 * names (Smite detection) and death state, so a memo key that omits CS or
 * spells would keep a stale gank/ward read after those change.
 */
function enemyThreatKey(e: OverlayEnemy): string {
  return [
    e.championName,
    e.level ?? 0,
    e.position || '',
    e.scores?.creepScore ?? 0,
    e.summonerSpells?.summonerSpellOne?.displayName || '',
    e.summonerSpells?.summonerSpellTwo?.displayName || '',
    e.isDead ? 1 : 0,
  ].join(':');
}

/** Key of every field buildInGameCues() reads. */
function cueStateKey(state: OverlayState): string {
  const lp = state.localPlayer;
  return [
    state.inGame ? 1 : 0,
    state.gameflowPhase || '',
    state.gameMode || '',
    state.mapName || '',
    Math.floor((state.gameTime ?? 0) / 10),
    (state.momentCues || []).map((c) => `${c.id}:${c.label}:${c.detail}:${c.urgency}`).join(','),
    lp?.championName || '',
    lp?.level ?? 0,
    lp?.isDead ? 1 : 0,
    (lp?.items || []).map((i) => `${i.itemID}:${i.count}`).join(','),
    lp?.scores
      ? `${lp.scores.kills ?? 0}:${lp.scores.deaths ?? 0}:${lp.scores.assists ?? 0}:${lp.scores.wardScore ?? 0}`
      : '',
    Math.floor((lp?.currentGold ?? 0) / 100),
    (state.enemies || [])
      .map((e) => `${e.championName}:${e.level ?? 0}:${e.position || ''}:${e.isDead ? 1 : 0}`)
      .join('|'),
    (state.enemyBotSummoners || [])
      .map((l) => `${l.role}:${l.championName}:${l.spells.map((s) => `${s.short}:${s.remaining}:${s.ready ? 1 : 0}`).join(',')}`)
      .join('|'),
    state.mayhemOfferIds?.join(',') || '',
    state.mayhemOwnedIds?.join(',') || '',
    state.mayhemAugmentWindow ? 1 : 0,
    state.mayhemAugmentDismissedAt ?? 0,
  ].join('~');
}

/** Key of every field getWardStatus() reads. */
function wardStatusKey(state: OverlayState): string {
  const lp = state.localPlayer;
  return [
    state.gameMode || '',
    state.mapName || '',
    Math.floor((state.gameTime ?? 0) / 10),
    (lp?.items || [])
      .filter((i) => i.itemID === 2055 || i.itemID === 3179 || i.itemID === 3364)
      .map((i) => `${i.itemID}:${i.count}`)
      .join(','),
    lp?.scores?.wardScore ?? 0,
    (state.enemies || []).map(enemyThreatKey).join('|'),
  ].join('~');
}

/** Key of every field getGankStatus() reads. */
function gankStatusKey(state: OverlayState): string {
  return [
    state.gameMode || '',
    state.mapName || '',
    Math.floor((state.gameTime ?? 0) / 10),
    (state.enemies || []).map(enemyThreatKey).join('|'),
  ].join('~');
}


export const OverlayApp: React.FC = () => {
  const [state, setState] = useState<OverlayState>({ inGame: false });
  const pageVisible = usePageVisible();
  const [champions, setChampions] = useState<Champion[]>([]);
  const [clickThrough, setClickThrough] = useState(true);
  const [alignMode, setAlignMode] = useState(false);
  const [hudScale, setHudScale] = useState(20);
  const [mapScale, setMapScale] = useState(33);
  const [chromeColor, setChromeColor] = useState('#e8b84a');
  const [overlayTextScale, setOverlayTextScale] = useState(1);
  const [collapsed, setCollapsed] = useState(false);
  const [gameWidth, setGameWidth] = useState(1920);
  const [gameHeight, setGameHeight] = useState(1080);
  const [hudModules, setHudModules] = useState<HudModules>(DEFAULT_HUD_MODULES);
  const [hudLayout, setHudLayout] = useState<HudLayout>(() => dualRailLayout());
  const [viewport, setViewport] = useState(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1920,
    vh: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }));
  const [displaySize, setDisplaySize] = useState({ w: 1920, h: 1080 });
  const [slot, setSlot] = useState<{
    id: string;
    originX: number;
    originY: number;
    moduleIds: string[];
    stickerIds: string[];
    mode: 'locked' | 'compact' | 'align';
  } | null>(null);
  const [calibration, setCalibration] = useState<OverlayCalibration>({ ability: emptyCalibration(), minimap: emptyCalibration() });
  const [petPreference, setPetPreference] = useState<PetSettings>(PET_DEFAULTS);
  const compactPanel = !clickThrough && !alignMode;
  const [profileId, setProfileId] = useState<ProfileId>(() =>
    typeof window !== 'undefined' ? loadStoredProfileId() : 'pyke-support'
  );
  const resolvedProfileId = useMemo(() => resolveProfileId(state), [state]);
  const profile = useMemo(() => getProfile(resolvedProfileId), [resolvedProfileId]);

  // 1 Hz clock: the gating decision stays here, but the tick writes to the
  // external clock store instead of component state — only useOverlayClock()
  // leaves re-render, not the whole HUD. The game-time base is refreshed
  // whenever the gating inputs change, exactly like the old setClockSec effect.
  useEffect(() => {
    const base = state.gameTime ?? 0;
    const at = state.timestamp ?? Date.now();
    const locked = slot?.mode === 'locked';
    const wantsClock = shouldRunOverlayClock({
      inGame: state.inGame,
      gameTime: state.gameTime,
      locked,
      moduleIds: slot?.moduleIds ?? [],
      pageVisible,
    });
    if (!wantsClock) return;
    const tick = (): void => {
      publishClock({
        sec: base + Math.max(0, (Date.now() - at) / 1000),
        nowMs: Date.now(),
      });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [state.inGame, state.gameTime, state.timestamp, slot, pageVisible]);

  useEffect(() => {
    const onResize = () => setViewport({ vw: window.innerWidth, vh: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    void warmCatalog({
      electronGet: async () => {
        const res = await window.electronAPI?.getCatalog?.();
        return (res?.catalog as import('../catalog/types').CatalogBundle) || null;
      },
      // The cached/static catalog is what first paint draws; only the live
      // DDragon/CDragon refresh is deferred (see client.ts deferRefresh).
      deferRefresh: true,
    })
      .then((bundle) => {
        if (bundle?.champions?.length) {
          const list = bundle.champions.map((c) => ({
            id: c.id,
            key: c.key,
            name: c.name,
            tags: c.tags,
            damageType: c.damageType || damageTypeFromTags(c.tags),
          }));
          ingestChampionCatalog(list);
          setChampions(list);
          return;
        }
        return warmDdragonVersion()
          .then((latest) => fetch(`https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`))
          .then((res) => res.json())
          .then((data) => {
            interface ChampionData {
              id: string;
              key: string;
              name: string;
              tags: string[];
            }
            const list = (Object.values(data.data) as ChampionData[]).map((c) => ({
              id: c.id,
              key: c.key,
              name: c.name,
              tags: c.tags,
              damageType: damageTypeFromTags(c.tags),
            }));
            ingestChampionCatalog(list);
            setChampions(list);
          });
      })
      .catch((err) => console.error('Overlay champion load failed:', err));
  }, []);

  useEffect(() => {
    if (!window.electronAPI?.onOverlayUpdate) return;

    const applyMeta = (payload: unknown) => {
      const meta = payload as {
        clickThrough?: boolean;
        alignMode?: boolean;
        hudScale?: number;
        mapScale?: number;
        chromeColor?: string;
        overlayTextScale?: number;
        calibration?: OverlayCalibration;
        gameWidth?: number;
        gameHeight?: number;
        hudModules?: unknown;
        hudLayout?: unknown;
        displayWidth?: number;
        displayHeight?: number;
        slot?: {
          id: string;
          originX: number;
          originY: number;
          moduleIds: string[];
          stickerIds: string[];
          mode: 'locked' | 'compact' | 'align';
        };
        pet?: unknown;
      };
      if (meta.pet) setPetPreference(normalizePet(meta.pet));
      if (typeof meta.displayWidth === 'number' && typeof meta.displayHeight === 'number') {
        setDisplaySize({ w: meta.displayWidth, h: meta.displayHeight });
      }
      if (meta.slot) setSlot(meta.slot);
      if (typeof meta.clickThrough === 'boolean') setClickThrough(meta.clickThrough);
      if (typeof meta.alignMode === 'boolean') setAlignMode(meta.alignMode);
      if (typeof meta.hudScale === 'number') setHudScale(meta.hudScale);
      if (typeof meta.mapScale === 'number') setMapScale(meta.mapScale);
      if (typeof meta.chromeColor === 'string') setChromeColor(meta.chromeColor);
      if (typeof meta.overlayTextScale === 'number') setOverlayTextScale(meta.overlayTextScale);
      if (typeof meta.gameWidth === 'number') setGameWidth(meta.gameWidth);
      if (typeof meta.gameHeight === 'number') setGameHeight(meta.gameHeight);
      if (meta.calibration) setCalibration(meta.calibration);
      if (meta.hudLayout) {
        const nextLayout = normalizeHudLayout(meta.hudLayout);
        setHudLayout(nextLayout);
        setHudModules(layoutToHudModules(nextLayout));
      } else if (meta.hudModules) {
        setHudModules(normalizeHudModules(meta.hudModules));
      }
    };

    const unsubUpdate = window.electronAPI.onOverlayUpdate((payload) => {
      const next = payload as OverlayState;
      setState((prev) => {
        if (
          prev.inGame &&
          next.inGame &&
          (prev.gameTime || 0) > 0 &&
          (next.gameTime || 0) <= 0 &&
          (!next.enemies || next.enemies.length === 0)
        ) {
          return prev;
        }
        return next;
      });
      const resolved = resolveProfileId(next);
      if (isProfileId(resolved)) {
        setProfileId((prev) => (prev === resolved ? prev : resolved));
      }
    });

    const unsubMeta = window.electronAPI.onOverlayMeta?.((payload) => applyMeta(payload));

    window.electronAPI.getOverlayStatus?.().then((res) => {
      if (!res?.success) return;
      applyMeta(res);
    });

    return () => {
      unsubUpdate?.();
      unsubMeta?.();
    };
  }, []);

  const enemyKey =
    state.enemies && state.enemies.length > 0
      ? state.enemies.map((e) => e.championName).join('|')
      : (state.cachedChampSelectEnemies || []).map((e) => e.championName || `#${e.championId}`).join('|');
  const allyKey = (state.allies || []).map((a) => `${a.position || ''}:${a.championName}`).join('|');

  const enemyChampions: Champion[] = useMemo(() => {
    if (!champions.length || !enemyKey) return [];
    const findChampion = (token: string): Champion | null => {
      if (token.startsWith('#')) {
        return champions.find((c) => c.key === token.slice(1)) || null;
      }
      const lower = token.toLowerCase();
      return (
        champions.find((c) => c.name.toLowerCase() === lower || c.id.toLowerCase() === lower) || null
      );
    };
    return enemyKey
      .split('|')
      .map(findChampion)
      .filter((c): c is Champion => c !== null);
  }, [enemyKey, champions]);

  const allyChampions = useMemo(() => {
    if (!champions.length || !allyKey) {
      return { adc: null as Champion | null, mid: null as Champion | null, jungle: null as Champion | null };
    }
    const allies = allyKey.split('|').map((token) => {
      const [position, championName] = token.split(':');
      return { position, championName, level: 0 };
    });
    const byName = (name: string | null): Champion | null => {
      if (!name) return null;
      const lower = name.toLowerCase();
      return champions.find((c) => c.name.toLowerCase() === lower || c.id.toLowerCase() === lower) || null;
    };
    return {
      adc: byName(resolveAllyAdcName(allies, champions)),
      mid: byName(resolveAllyMidName(allies, champions)),
      jungle: byName(resolveAllyJungleName(allies, champions)),
    };
  }, [allyKey, champions]);

  const allyPartner = profile.focusAllies.includes('YourJungle') ? allyChampions.jungle : allyChampions.mid;
  const adcForProfile = profile.focusAllies.includes('YourADC') ? allyChampions.adc : null;

  const situationKey = `${state.localPlayer?.level ?? 0}:${state.localPlayer?.scores?.kills ?? 0}:${
    state.localPlayer?.scores?.deaths ?? 0
  }:${state.localPlayer?.scores?.assists ?? 0}:${Math.floor((state.gameTime ?? 0) / 60)}`;
  const situation = useMemo(
    () => situationFromState(state),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [situationKey, enemyKey]
  );

  const inMayhem = isMayhemGame(state.gameMode, state.mapName);
  const inAram = isAramOrMayhem(state.gameMode, state.mapName);

  const build: Build | null = useMemo(() => {
    const base = profile.calculateBuild(enemyChampions, adcForProfile, allyPartner, situation);
    if (inMayhem && base) {
      return adjustBuildForMayhem(base, state.mayhemOwnedIds || [], mayhemBundle);
    }
    return base;
  }, [
    enemyChampions,
    adcForProfile,
    allyPartner,
    profile,
    situation,
    inMayhem,
    state.mayhemOwnedIds,
  ]);

  const analysis: MatchupAnalysis | null = useMemo(
    () =>
      enemyChampions.length > 0 && build
        ? profile.analyzeMatchup(enemyChampions, build, adcForProfile, allyPartner, situation)
        : null,
    [enemyChampions, build, adcForProfile, allyPartner, profile, situation]
  );

  const cueKey = useMemo(() => cueStateKey(state), [state]);
  const rawCues = useMemo(
    () => buildInGameCues(state, { analysis, build, profileId, situation }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cueKey, analysis, build, profileId, situation]
  );

  const cueFirstSeen = useRef<Map<string, number>>(new Map());
  const selectedCueRef = useRef<{ id: string; chosenAt: number } | null>(null);
  useEffect(() => {
    if (!state.inGame) {
      cueFirstSeen.current.clear();
      selectedCueRef.current = null;
    }
  }, [state.inGame]);

  const cues = useMemo(() => {
    const gameTime = state.gameTime ?? 0;
    const seen = cueFirstSeen.current;
    const activeIds = new Set(rawCues.map((c) => c.id));
    for (const id of [...seen.keys()]) {
      if (!activeIds.has(id)) seen.delete(id);
    }
    const alive: typeof rawCues = [];
    for (const cue of rawCues) {
      if (!seen.has(cue.id)) seen.set(cue.id, gameTime);
      const age = Math.max(0, gameTime - (seen.get(cue.id) || gameTime));
      const maxAge = cue.maxAgeSec ?? 30;
      if (age <= maxAge) {
        alive.push(cue);
        continue;
      }
      seen.delete(cue.id);
    }
    if (alive.length === 0) {
      selectedCueRef.current = null;
      return [] as OverlayCue[];
    }

    const top = alive[0];
    const selected = selectedCueRef.current;
    if (!selected) {
      selectedCueRef.current = { id: top.id, chosenAt: gameTime };
      return [top];
    }

    const current = alive.find((cue) => cue.id === selected.id);
    if (!current) {
      selectedCueRef.current = { id: top.id, chosenAt: gameTime };
      return [top];
    }

    const HOLD_SEC = 6;
    const SWITCH_MARGIN = 12;
    const held = gameTime - selected.chosenAt < HOLD_SEC;
    const currentScore = current.confidence ?? 0;
    const topScore = top.confidence ?? 0;

    if (top.id !== current.id && !held && topScore >= currentScore + SWITCH_MARGIN) {
      selectedCueRef.current = { id: top.id, chosenAt: gameTime };
      return [top];
    }

    return [current];
  }, [rawCues, state.gameTime]);

  const wardKey = useMemo(() => wardStatusKey(state), [state]);
  const wardStatus = useMemo(
    () => getWardStatus(state, profileId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wardKey, profileId]
  );
  const gankKey = useMemo(() => gankStatusKey(state), [state]);
  const gankStatus = useMemo(
    () => getGankStatus(state, profileId),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [gankKey, profileId]
  );

  const buildProgress = useMemo(
    () => trackBuildProgress(state.localPlayer?.items, build),
    [state.localPlayer?.items, build]
  );

  const catalog = useSyncExternalStore(subscribeCatalog, getCatalog);
  const prices = useMemo<PriceLookup | null>(() => {
    const byId = catalogItemsById(catalog);
    if (byId.size === 0) return null;
    return catalogPriceLookup([...byId.values()]);
  }, [catalog]);

  /**
   * One ordered buy plan — the same numbered queue as the Build & runes view.
   * The sell-boots cue and this plan share a verdict inside buyOrderPlanForState,
   * so a "sell boots" cue never sits next to a contradictory "no free slot".
   */
  const buyOrder = useMemo(
    () => (inMayhem || inAram ? null : buyOrderPlanForState(state, build, prices)),
    [state, build, prices, inMayhem, inAram]
  );

  /** The numbered queue — live from the plan; Mayhem keeps icons up all match. */
  const buyQueue = useMemo((): OrderedBuyStep[] => {
    if (buyOrder?.steps.length) return buyOrder.steps;
    if (!build || !inMayhem) return [];
    const owned = new Set(buildProgress.ownedIds);
    const unowned = buildProgress.path.filter((i) => !owned.has(i.id));
    const tail = unowned.length > 0 ? unowned.slice(0, 3) : buildProgress.path.slice(-2);
    return tail.map((item, i) => ({
      rank: i + 1,
      id: item.id,
      name: item.name,
      segment: 'core' as const,
      owned: owned.has(item.id),
      cost: null,
      reason: item.reason,
    }));
  }, [buyOrder, build, buildProgress, inMayhem]);

  /** Pending respawn countdowns; keep in step with EnemyRespawns' own filter. */
  const showRespawns =
    enemyRespawns(state.enemies, state.timestamp, Date.now()).length > 0;

  const mayhemChampion = useMemo(
    () => championForMayhem(state.localPlayer?.championName, champions),
    [state.localPlayer?.championName, champions]
  );

  const [latchedMayhemOffers, setLatchedMayhemOffers] = useState<string[]>([]);

  useEffect(() => {
    if (!inMayhem || !state.mayhemAugmentWindow || state.mayhemAugmentDismissedAt) {
      setLatchedMayhemOffers([]);
      return;
    }
    const incoming = state.mayhemOfferIds ?? [];
    if (incoming.length >= 3) {
      setLatchedMayhemOffers(incoming.slice(0, 3));
      return;
    }
    if (incoming.length > 0) {
      setLatchedMayhemOffers((prev) => {
        if (prev.length >= 3 && incoming.length < 3) return prev;
        if (incoming.length < prev.length) return prev;
        return incoming.slice(0, 3);
      });
    }
  }, [inMayhem, state.mayhemOfferIds, state.mayhemAugmentWindow, state.mayhemAugmentDismissedAt]);

  const displayMayhemOfferIds = useMemo(() => {
    if (!state.mayhemAugmentWindow) return [];
    const incoming = state.mayhemOfferIds ?? [];
    if (incoming.length >= 3) return incoming.slice(0, 3);
    if (incoming.length > 0) {
      if (latchedMayhemOffers.length >= 3 && incoming.length < 3) return latchedMayhemOffers;
      return incoming.slice(0, 3);
    }
    if (latchedMayhemOffers.length > 0) return latchedMayhemOffers;
    return [];
  }, [state.mayhemOfferIds, state.mayhemAugmentWindow, latchedMayhemOffers]);

  const mayhemRanked = useMemo(() => {
    if (!mayhemChampion || !inMayhem || !displayMayhemOfferIds.length) return [];
    const owned = state.mayhemOwnedIds || [];
    return rankMayhemChoices(mayhemChampion, owned, displayMayhemOfferIds, mayhemBundle);
  }, [displayMayhemOfferIds, state.mayhemOwnedIds, mayhemChampion, inMayhem]);

  // Depend on a 1 Hz tick, not Date.now() at render time: without a ticking
  // value the 120 s dismiss window never expired until some unrelated update
  // re-rendered the overlay, so a dismissed augment panel could stay hidden
  // for the rest of the match. The tick lives in the isolated clock store;
  // this app only subscribes to the *derived* boolean, which flips at most
  // twice per dismissal (set, then expiry) instead of once per second.
  useEffect(() => {
    const shouldTick = shouldRunMayhemDismissTick({
      inMayhem,
      dismissedAt: state.mayhemAugmentDismissedAt,
      pageVisible,
    });
    if (!shouldTick) return;
    const tick = (): void => {
      publishClock({ ...clockSnapshot, nowMs: Date.now() });
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [inMayhem, state.mayhemAugmentDismissedAt, pageVisible]);

  const mayhemDismissedRecently = useSyncExternalStore(
    subscribeOverlayClock,
    () => {
      const dismissedAt = state.mayhemAugmentDismissedAt;
      const nowMs = getOverlayClock().nowMs;
      return typeof dismissedAt === 'number' && nowMs - dismissedAt < 120_000;
    },
    () => false
  );

  const mayhemPanelActive =
    inMayhem &&
    hudModules.mayhem &&
    !!state.mayhemAugmentWindow &&
    !mayhemDismissedRecently &&
    displayMayhemOfferIds.length > 0;

  const mayhemLayoutPos =
    layoutElement(hudLayout, 'mayhem') ||
    layoutElement(hudLayout, 'vision') || { x: 0.982, y: 0.26, scale: 1, opacity: 1, anchor: 'tr' as const };

  const handleHide = () => {
    void window.electronAPI?.toggleOverlay?.().catch((error) => {
      console.error('Unable to hide overlay:', error);
    });
  };

  /** Stable callback for the memoized switch-profile rail panel. */
  const handleCollapse = useCallback(() => setCollapsed(true), []);

  const handleToggleClicks = () => {
    void window.electronAPI?.toggleOverlayClickThrough?.()
      .then((res) => {
        if (res?.success && typeof res.clickThrough === 'boolean') {
          setClickThrough(res.clickThrough);
        }
        setAlignMode(false);
      })
      .catch((error) => console.error('Unable to change overlay mode:', error));
  };

  const handleAlignMode = (enabled: boolean) => {
    void window.electronAPI?.setOverlayAlignMode?.(enabled)
      .then((res) => {
        if (res?.success) {
          if (typeof res.alignMode === 'boolean') setAlignMode(res.alignMode);
          if (typeof res.clickThrough === 'boolean') setClickThrough(res.clickThrough);
        }
      })
      .catch((error) => console.error('Unable to change align mode:', error));
  };

  const nudge = (target: 'ability' | 'minimap', field: 'dx' | 'dy' | 'dw' | 'dh', delta: number) => {
    void window.electronAPI?.adjustOverlayCalibration?.(target, field, delta)
      .then((res) => {
        if (res?.success && res.calibration) setCalibration(res.calibration);
      })
      .catch(() => {});
  };

  const handleResetCalibration = () => {
    void window.electronAPI?.resetOverlayCalibration?.()
      .then((res) => {
        if (res?.success && res.calibration) setCalibration(res.calibration);
      })
      .catch(() => {});
  };

  const hotkeyHint =
    profile.role === 'Mid' || profile.role === 'Top' || profile.role === 'Jungle'
      ? 'PgUp/Num9 Mid Flash · PgDn/Num3 Ignite/TP'
      : 'PgUp/Num9 ADC Flash · PgDn/Num3 Supp Flash';

  const gameGeo = useMemo(
    () =>
      computeLeagueGeometry({
        vw: slot?.mode === 'locked' ? displaySize.w : viewport.vw,
        vh: slot?.mode === 'locked' ? displaySize.h : viewport.vh,
        hudScale,
        mapScale,
        gameWidth,
        gameHeight,
      }),
    [viewport, displaySize, slot, hudScale, mapScale, gameWidth, gameHeight]
  );

  const paintGeo = useMemo(() => {
    if (!slot || slot.mode !== 'locked') return gameGeo;
    return {
      ...gameGeo,
      offsetX: gameGeo.offsetX - slot.originX,
      offsetY: gameGeo.offsetY - slot.originY,
    };
  }, [gameGeo, slot]);

  // Until the main process says which slot this window is, draw nothing: with
  // no slot every window would paint every module (the doubled panels bug).
  const slotHasModule = (id: string): boolean => !!slot && (slot.mode !== 'locked' || slot.moduleIds.includes(id));
  const slotStickers =
    slot?.mode === 'locked'
      ? hudLayout.stickers.filter((sticker) => slot.stickerIds.includes(sticker.id))
      : hudLayout.stickers;

  // Locked mode: tell the main process whether this window has anything to
  // draw. Empty windows are hidden, so nothing sits over League's swap chain
  // until there is something worth showing.
  const lockedSlot = slot?.mode === 'locked';
  const slotHasContent = (() => {
    if (!state.inGame || !slot) return false;
    if (!lockedSlot) return true;
    if (slotStickers.length > 0) return true;
    const liveName = (state.localPlayer?.championName || '').toLowerCase().replace(/[^a-z]/g, '');
    const mismatch = !!liveName && liveName !== profile.championId.toLowerCase().replace(/[^a-z]/g, '');
    const sumsModuleOn =
      !inAram &&
      hudModules.sums &&
      slotHasModule('sums') &&
      layoutElement(hudLayout, 'sums')?.visible !== false;
    // Match what this window actually paints. A module that is toggled on but
    // draws nothing must not keep a transparent HWND over the game.
    const sumsHasRows = sumsModuleOn && (state.enemyBotSummoners?.length ?? 0) > 0;
    return (
      sumsHasRows ||
      (hudModules.frames && slotHasModule('frames')) ||
      (!inAram && hudModules.gank && !!gankStatus && slotHasModule('gank')) ||
      (!inAram && mismatch && slotHasModule('gank')) ||
      (!mayhemPanelActive && hudModules.vision && !!wardStatus && slotHasModule('vision')) ||
      (!inAram && hudModules.action && cues.length > 0 && slotHasModule('action')) ||
      ((!inAram || inMayhem) &&
        !mayhemPanelActive &&
        hudModules.buy &&
        buyQueue.length > 0 &&
        slotHasModule('buy')) ||
      (mayhemPanelActive &&
        (slotHasModule('mayhem') || slotHasModule('vision') || slot?.id === 'slot-center' || slot?.id === 'slot-0'))
    );
  })();

  useEffect(() => {
    window.electronAPI?.reportOverlayContent?.(state.loading || slotHasContent);
  }, [state.loading, slotHasContent]);

  const activePet = state.pet ? normalizePet(state.pet) : petPreference;

  // Paint heartbeat. The main process can see that this window is shown, but
  // only the page knows whether frames are still being produced. One
  // animation frame every few seconds is enough to tell, and costs nothing
  // measurable next to the 1 Hz clock.
  useEffect(() => {
    const report = window.electronAPI?.reportOverlayHeartbeat;
    if (!report) return;
    let frame = 0;
    let giveUp = 0;
    const beat = (): void => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(giveUp);
      let settled = false;
      const settle = (frames: boolean): void => {
        if (settled) return;
        settled = true;
        window.cancelAnimationFrame(frame);
        window.clearTimeout(giveUp);
        report({ frames, pageVisible: document.visibilityState === 'visible' });
      };
      frame = window.requestAnimationFrame(() => settle(true));
      giveUp = window.setTimeout(() => settle(false), OVERLAY_HEARTBEAT_FRAME_WAIT_MS);
    };
    beat();
    const id = window.setInterval(beat, OVERLAY_HEARTBEAT_EVERY_MS);
    return () => {
      window.clearInterval(id);
      window.cancelAnimationFrame(frame);
      window.clearTimeout(giveUp);
    };
  }, []);

  const showAction = hudModules.action && cues.length > 0 && !inAram;
  const showBuy =
    hudModules.buy && buyQueue.length > 0 && (!inAram || inMayhem) && !mayhemPanelActive;

  const buyRow = useMemo(() => {
    if (!showBuy) return null;
    // ONE highlighted BUY NEXT: the exact item to buy now. Queue icons that
    // follow carry numbered step chips — save/no-slot stay explicit text.
    const decision = buyOrder?.decision;
    const actionable =
      !!decision && (decision.action === 'buy-full' || decision.action === 'buy-component');
    const buyNow = actionable && decision.buy ? { ...decision.buy } : null;
    const queueIcons = buyNow ? buyQueue.filter((s) => s.id !== buyNow.id) : buyQueue;
    const fmtG = (v: number | null | undefined) => (v ?? 0).toLocaleString('en-US');
    const detail = (() => {
      if (!decision) return null;
      if (decision.action === 'buy-full' && decision.buy) {
        return {
          name: decision.targetName ?? decision.buy.name,
          cost: decision.buy.cost,
          kind: 'buy-full',
          status: 'Buy now',
          title: buyOrder?.bootsVsItem.reason || `${decision.targetName}: buy now.`,
        };
      }
      if (decision.action === 'buy-component' && decision.buy) {
        return {
          name: decision.buy.name,
          cost: decision.buy.cost,
          kind: 'buy-component',
          status: `Part of ${decision.targetName ?? ''}`.trim(),
          title: buyOrder?.bootsVsItem.reason || `Part of ${decision.targetName}.`,
        };
      }
      if (decision.action === 'save' || decision.action === 'no-slot') {
        const stepCost = buyQueue[0]?.cost ?? null;
        return {
          name: decision.targetName ?? buyQueue[0]?.name ?? '',
          cost: stepCost,
          kind: decision.action,
          status:
            decision.action === 'no-slot'
              ? 'No free slot'
              : `Need ${fmtG(decision.needGold)}g`,
          title: buyOrder?.bootsVsItem.reason || decision.targetName || '',
        };
      }
      return null;
    })();

    return (
      <div className="flex flex-wrap gap-0.5 items-center min-w-0">
        {buyNow ? (
          <span
            className="hud-buy-next"
            data-buy-step={0}
            title={buyOrder?.bootsVsItem.reason || `BUY NEXT: ${buyNow.name} (${fmtG(buyNow.cost)}g)`}
          >
            <ItemIcon
              itemId={buyNow.id}
              alt={`BUY NEXT: ${buyNow.name}`}
              size={22}
              className="hud-buy-icon is-next"
            />
            <span className="hud-buy-next-tag">BUY NEXT</span>
          </span>
        ) : null}
        {queueIcons.map((step) => (
          <span
            key={`buy-${step.id}`}
            className={`hud-buy-step${step.owned ? ' is-owned' : ''}`}
            data-buy-step={step.rank}
            title={step.reason || step.name}
          >
            <ItemIcon
              itemId={step.id}
              alt={step.name}
              size={22}
              className="hud-buy-icon"
            />
            <span className="hud-buy-step-num">{step.rank}</span>
          </span>
        ))}
        {detail ? (
          <div className="hud-buy-detail w-full min-w-0" title={detail.title}>
            <div className="hud-buy-detail-row">
              <span className="hud-buy-detail-name truncate min-w-0">{detail.name}</span>
              <span className="hud-buy-detail-price shrink-0">{fmtG(detail.cost)}g</span>
            </div>
            <div className={`hud-buy-detail-status hud-buy-detail-status--${detail.kind}`}>
              {detail.status}
            </div>
          </div>
        ) : null}
      </div>
    );
  }, [showBuy, buyOrder, buyQueue]);

  const actionLine = useMemo(() => {
    if (!showAction) return null;
    return (
      <div className={`hud-chrome-cue hud-chrome-cue--${cues[0].urgency} !py-1 !px-1.5`}>
        <div>{cues[0].label}</div>
        {cues[0].rationale ? (
          <div className="text-[12px] opacity-[0.85] leading-snug line-clamp-2">
            {cues[0].rationale}
          </div>
        ) : null}
      </div>
    );
  }, [showAction, cues]);

  // Panel width is fixed; the transform (--overlay-scale) scales the whole box once, and it never exceeds the
  // viewport, so a scaled panel cannot be cut at the display's right edge.
  // Right-rail anchors/styles are memoized so the memoized rail panels receive
  // referentially-stable style props and skip re-render when nothing moved.
  const gankAnchor = useMemo(() => layoutElement(hudLayout, 'gank') || DEFAULT_GANK_ANCHOR, [hudLayout]);
  const visionAnchor = useMemo(() => layoutElement(hudLayout, 'vision') || DEFAULT_VISION_ANCHOR, [hudLayout]);
  const actionAnchor = useMemo(() => layoutElement(hudLayout, 'action') || DEFAULT_ACTION_ANCHOR, [hudLayout]);
  const buyAnchor = useMemo(() => layoutElement(hudLayout, 'buy') || DEFAULT_BUY_ANCHOR, [hudLayout]);
  const gankStyle = useMemo(() => ({ ...layoutStyle(gankAnchor, paintGeo), ...RAIL_PANEL_SIZE }), [gankAnchor, paintGeo]);
  const visionStyle = useMemo(() => ({ ...layoutStyle(visionAnchor, paintGeo), ...RAIL_PANEL_SIZE }), [visionAnchor, paintGeo]);
  const actionStyle = useMemo(() => ({ ...layoutStyle(actionAnchor, paintGeo), ...RAIL_PANEL_SIZE }), [actionAnchor, paintGeo]);
  const buyStyle = useMemo(() => ({ ...layoutStyle(buyAnchor, paintGeo), ...RAIL_PANEL_SIZE }), [buyAnchor, paintGeo]);

  if (state.loading) {
    return (
      <div className="w-screen h-screen pointer-events-none bg-transparent">
        <OverlayPet preference={activePet} />
      </div>
    );
  }

  if (!state.inGame || !slot) {
    return <div className="w-screen h-screen pointer-events-none bg-transparent" />;
  }

  const liveCompact = (state.localPlayer?.championName || '').toLowerCase().replace(/[^a-z]/g, '');
  const profileCompact = profile.championId.toLowerCase().replace(/[^a-z]/g, '');
  const profileMatchesLocal = !liveCompact || liveCompact === profileCompact;

  const showFrames = alignMode || (hudModules.frames && !compactPanel);
  const sumsModuleOn =
    !inAram &&
    hudModules.sums &&
    slotHasModule('sums') &&
    layoutElement(hudLayout, 'sums')?.visible !== false;
  const showSumsRail = sumsModuleOn && (state.enemyBotSummoners?.length ?? 0) > 0;
  const showSums = showSumsRail;
  const showGank = hudModules.gank && !!gankStatus && !inAram;
  const showVision = hudModules.vision && !!wardStatus && !mayhemPanelActive;
  const objectiveTimers = state.objectiveTimers;
  const showObjectives =
    !inAram &&
    !!objectiveTimers &&
    (objectiveTimers.dragon || objectiveTimers.baron || objectiveTimers.herald);
  const mayhemOnThisWindow =
    !lockedSlot ||
    slotHasModule('mayhem') ||
    slotHasModule('vision') ||
    slot?.id === 'slot-center' ||
    slot?.id === 'slot-0';
  const showMayhem = mayhemPanelActive && mayhemOnThisWindow;
  const showRightRail =
    showGank || showVision || showAction || showBuy || showObjectives || !profileMatchesLocal;

  return (
    <div
      className={`w-screen h-screen bg-transparent overflow-hidden select-none${
        clickThrough && !alignMode ? ' pointer-events-none' : ''
      }`}
      style={{
        ['--overlay-scale' as string]: `${0.75 + hudScale / 200}`,
        ['--ov-text-scale' as string]: String(overlayTextScale),
      }}
    >
      <ChromeGameHud
        hudScale={Number.isFinite(hudScale) ? hudScale : 20}
        mapScale={Number.isFinite(mapScale) ? mapScale : 33}
        enabled={showFrames && (alignMode || slotHasModule('frames'))}
        chromeColor={chromeColor}
        calibration={calibration}
        showGuides={alignMode}
        gameWidth={gameWidth}
        gameHeight={gameHeight}
      />

      {alignMode && (
      <div className="hud-overlay-controls absolute top-3 left-1/2 -translate-x-1/2 pointer-events-auto z-10">
        <ChromeMark className="hud-chrome-mark" size={11} />
        <button
          type="button"
          onClick={() => handleAlignMode(false)}
          className="hud-btn"
          title="Leave fullscreen guides — back to movable panel"
        >
          Done aligning
        </button>
        <button
          type="button"
          onClick={handleToggleClicks}
          className="hud-btn"
          title="Lock overlay and pass clicks to League (Ctrl+Shift+U)"
        >
          Lock overlay
        </button>
        <NudgeGroup label="Ability" onNudge={(field, delta) => nudge('ability', field, delta)} />
        <NudgeGroup label="Map" onNudge={(field, delta) => nudge('minimap', field, delta)} />
        <button type="button" onClick={handleResetCalibration} className="hud-nudge-btn" title="Reset alignment marks to default">
          Reset fit
        </button>
        <button
          type="button"
          className="hud-btn"
          title="Re-read HUD/Minimap scales from League game.cfg"
          onClick={() => void window.electronAPI?.syncLeagueScales?.()}
        >
          Sync LoL
        </button>
        <span className="px-1 text-[11px] tracking-wider opacity-50">
          Match filled boxes to your League HUD / minimap
        </span>
      </div>
      )}

      {!compactPanel && !collapsed && (
        <>
          <OverlayStickers stickers={slotStickers} geo={paintGeo} />
          {showSumsRail && (
          <div
            className="hud-overlay-scale hud-overlay-scale--left"
            style={{ ...layoutStyle(layoutElement(hudLayout, 'sums') || { x: 0.018, y: 0.078, scale: 1, opacity: 1, anchor: 'tl' }, paintGeo), ...RAIL_PANEL_SIZE }}
          >
            <div className="hud-rail-stack" data-hud-rail="sums">
              <section className="hud-rail-card" data-hud-section="summoners">
                <h3 className="hud-rail-label">
                  <span className="hud-rail-label-text">Summoners</span>
                  <span className="hud-rail-label-meta">
                    <OverlayClockLabel />
                  </span>
                </h3>
                <div className="hud-rail-body">
                  <SummonerTimers lanes={state.enemyBotSummoners || []} compact />
                </div>
              </section>
              {showRespawns && (
                <section className="hud-rail-card" data-hud-section="respawns">
                  <h3 className="hud-rail-label">
                    <span className="hud-rail-label-text">Respawns</span>
                  </h3>
                  <div className="hud-rail-body">
                    <EnemyRespawns enemies={state.enemies} timestamp={state.timestamp} />
                  </div>
                </section>
              )}
              <p className="hud-rail-hint">{hotkeyHint}</p>
            </div>
          </div>
          )}

          {showGank && slotHasModule('gank') && (
            <GankRailPanel status={gankStatus} style={gankStyle} />
          )}

          {showVision && slotHasModule('vision') && (
            <VisionRailPanel status={wardStatus} style={visionStyle} />
          )}

          {showObjectives && slotHasModule('vision') && (
          <div className="hud-overlay-scale hud-overlay-scale--right w-[220px]" style={layoutStyle(layoutElement(hudLayout, 'vision') || { x: 0.982, y: 0.26, scale: 1, opacity: 1, anchor: 'tr' }, paintGeo)}>
            <OverlayChromePanel>
              <div className="relative z-10 px-2 py-1.5 text-[11px] space-y-0.5">
                {objectiveTimers?.dragon ? <div>Dragon {objectiveTimers.dragon.inSec}s</div> : null}
                {objectiveTimers?.baron ? <div>Baron {objectiveTimers.baron.inSec}s</div> : null}
                {objectiveTimers?.herald ? <div>Herald {objectiveTimers.herald.inSec}s</div> : null}
              </div>
            </OverlayChromePanel>
          </div>
          )}

          {showAction && slotHasModule('action') && (
            <ActionRailPanel line={actionLine} style={actionStyle} />
          )}

          {showBuy && slotHasModule('buy') && (
            <BuyRailPanel row={buyRow} style={buyStyle} />
          )}

          {showMayhem && (
          <div
            className="hud-overlay-scale hud-overlay-scale--right z-30"
            style={{
              ...layoutStyle(mayhemLayoutPos, paintGeo),
              width: 'min(380px, 92vw)',
              maxWidth: 'calc(100vw - 24px)',
            }}
          >
            <OverlayChromePanel>
              <div className="relative z-10 px-2 py-1.5">
                <OverlayMayhemPanel
                  championName={mayhemChampion?.name || state.localPlayer?.championName || 'You'}
                  ranked={mayhemRanked}
                  mode="roll"
                />
              </div>
            </OverlayChromePanel>
          </div>
          )}

          {showRightRail && !profileMatchesLocal && slotHasModule('gank') && (
            <SwitchProfileRailPanel
              profile={profile}
              liveChampionName={state.localPlayer?.championName}
              onCollapse={handleCollapse}
            />
          )}
        </>
      )}

      {!compactPanel && collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="hud-overlay-scale hud-overlay-scale--right absolute top-14 right-3 hud-overlay-panel !px-2 !py-1 hud-btn"
          title="Expand dual rails"
        >
          One Trick +
        </button>
      )}

      {compactPanel && (
      <div className="hud-overlay-scale hud-overlay-scale--right absolute inset-1.5">
        <OverlayChromePanel className="h-full">
          <div
            className="hud-chrome-header !py-1 !px-2"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <ChampionIcon
                championId={profile.championId}
                championName={state.localPlayer?.championName}
                size={16}
                className="hud-champ-icon shrink-0"
              />
              <div className="min-w-0">
                <div className="hud-chrome-title truncate min-w-0 text-[11px]">One Trick</div>
                <div className="hud-chrome-meta !text-[11px]">
                  {profile.shortLabel}
                  <OverlayClockMeta />
                </div>
              </div>
            </div>
            <div
              className="flex gap-0.5 justify-end shrink-0"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <button type="button" onClick={() => handleAlignMode(true)} className="hud-btn" title="Align HUD">
                Align
              </button>
              <button type="button" onClick={handleToggleClicks} className="hud-btn" title="Lock">
                Lock
              </button>
              <button type="button" onClick={handleHide} className="hud-btn" title="Hide">
                Hide
              </button>
              <button type="button" onClick={() => setCollapsed((c) => !c)} className="hud-btn">
                {collapsed ? '+' : '–'}
              </button>
            </div>
          </div>

          {!collapsed && (
            <div className="relative z-10 px-2 py-1.5 space-y-1 min-w-0">
              {!profileMatchesLocal ? (
                <div className="hud-chrome-cue hud-chrome-cue--warn !text-[12px] !py-1">
                  Switch profile → {state.localPlayer?.championName || '?'}
                </div>
              ) : null}
              {showMayhem ? (
                <OverlayMayhemPanel
                  championName={mayhemChampion?.name || state.localPlayer?.championName || 'You'}
                  ranked={mayhemRanked}
                  mode="roll"
                />
              ) : null}
              {!inAram && showGank ? <GankSquare threat={gankStatus} compact /> : null}
              {showVision ? <WardIndicator status={wardStatus} compact /> : null}
              {!inAram ? actionLine : null}
              {showSums ? <SummonerTimers lanes={state.enemyBotSummoners || []} compact /> : null}
              {showSums ? <EnemyRespawns enemies={state.enemies} timestamp={state.timestamp} /> : null}
              {buyRow}
            </div>
          )}
        </OverlayChromePanel>
      </div>
      )}
    </div>
  );
};
