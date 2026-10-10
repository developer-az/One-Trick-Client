import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  type Champion,
  type Build,
  type MatchupAnalysis,
} from '../logic/pykeLogic';
import { getProfile, isProfileId, loadStoredProfileId, type ProfileId } from '../logic/profiles';
import {
  buildInGameCues,
  formatGameTime,
  getGankStatus,
  getWardStatus,
  remainingBuildItems,
  resolveAllyAdcName,
  resolveAllyMidName,
  resolveAllyJungleName,
  resolveProfileId,
  situationFromState,
  type OverlayCue,
  type OverlayState,
} from './overlayLogic';
import { SummonerTimers } from '../components/SummonerTimers';
import { ChampionIcon, ItemIcon } from '../components/GameIcons';
import { ChromeGameHud } from './ChromeGameHud';
import { ChromeMark } from './ChromeMark';
import { WardIndicator } from './WardIndicator';
import { GankSquare } from './GankSquare';
import { warmCatalog } from '../catalog/client';
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

function damageTypeFromTags(tags: string[]): Champion['damageType'] {
  return tags.includes('Mage') || tags.includes('Support') ? 'Magic' : 'Physical';
}

function OverlayChromePanel({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`hud-overlay-panel overflow-hidden ${className}`}>
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
      <span className="text-[8px] uppercase tracking-wider opacity-70 mr-1">{label}</span>
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

export const OverlayApp: React.FC = () => {
  const [state, setState] = useState<OverlayState>({ inGame: false });
  const [champions, setChampions] = useState<Champion[]>([]);
  const [clickThrough, setClickThrough] = useState(true);
  const [alignMode, setAlignMode] = useState(false);
  const [hudScale, setHudScale] = useState(20);
  const [mapScale, setMapScale] = useState(33);
  const [chromeColor, setChromeColor] = useState('#d4d8de');
  const [collapsed, setCollapsed] = useState(false);
  const [gameWidth, setGameWidth] = useState(1920);
  const [gameHeight, setGameHeight] = useState(1080);
  const [hudModules, setHudModules] = useState<HudModules>(DEFAULT_HUD_MODULES);
  const [hudLayout, setHudLayout] = useState<HudLayout>(() => dualRailLayout());
  const [viewport, setViewport] = useState(() => ({
    vw: typeof window !== 'undefined' ? window.innerWidth : 1920,
    vh: typeof window !== 'undefined' ? window.innerHeight : 1080,
  }));
  const [calibration, setCalibration] = useState<OverlayCalibration>({ ability: emptyCalibration(), minimap: emptyCalibration() });
  const compactPanel = !clickThrough && !alignMode;
  const [profileId, setProfileId] = useState<ProfileId>(() =>
    typeof window !== 'undefined' ? loadStoredProfileId() : 'pyke-support'
  );
  const profile = useMemo(() => getProfile(profileId), [profileId]);

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
        calibration?: OverlayCalibration;
        gameWidth?: number;
        gameHeight?: number;
        hudModules?: unknown;
        hudLayout?: unknown;
      };
      if (typeof meta.clickThrough === 'boolean') setClickThrough(meta.clickThrough);
      if (typeof meta.alignMode === 'boolean') setAlignMode(meta.alignMode);
      if (typeof meta.hudScale === 'number') setHudScale(meta.hudScale);
      if (typeof meta.mapScale === 'number') setMapScale(meta.mapScale);
      if (typeof meta.chromeColor === 'string') setChromeColor(meta.chromeColor);
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

  const build: Build | null = useMemo(
    () =>
      enemyChampions.length > 0
        ? profile.calculateBuild(enemyChampions, adcForProfile, allyPartner, situation)
        : null,
    [enemyChampions, adcForProfile, allyPartner, profile, situation]
  );

  const analysis: MatchupAnalysis | null = useMemo(
    () =>
      enemyChampions.length > 0 && build
        ? profile.analyzeMatchup(enemyChampions, build, adcForProfile, allyPartner, situation)
        : null,
    [enemyChampions, build, adcForProfile, allyPartner, profile, situation]
  );

  const rawCues = useMemo(
    () => buildInGameCues(state, { analysis, build, profileId, situation }),
    [state, analysis, build, profileId, situation]
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

  const wardStatus = useMemo(() => getWardStatus(state, profileId), [state, profileId]);
  const gankStatus = useMemo(() => getGankStatus(state, profileId), [state, profileId]);
  const itemsLeft = useMemo(() => remainingBuildItems(state, build).slice(0, 2), [state, build]);

  const handleHide = () => {
    void window.electronAPI?.toggleOverlay?.().catch((error) => {
      console.error('Unable to hide overlay:', error);
    });
  };

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
        vw: viewport.vw,
        vh: viewport.vh,
        hudScale,
        mapScale,
        gameWidth,
        gameHeight,
      }),
    [viewport, hudScale, mapScale, gameWidth, gameHeight]
  );

  if (!state.inGame) {
    return <div className="w-screen h-screen pointer-events-none bg-transparent" />;
  }

  const liveCompact = (state.localPlayer?.championName || '').toLowerCase().replace(/[^a-z]/g, '');
  const profileCompact = profile.championId.toLowerCase().replace(/[^a-z]/g, '');
  const profileMatchesLocal = !liveCompact || liveCompact === profileCompact;

  const showFrames = alignMode || (hudModules.frames && !compactPanel);
  const showSumsRail = hudModules.sums && (state.enemyBotSummoners?.length ?? 0) > 0;
  const showSums = showSumsRail;
  const showGank = hudModules.gank && !!gankStatus;
  const showVision = hudModules.vision && !!wardStatus;
  const showAction = hudModules.action && cues.length > 0;
  const showBuy = hudModules.buy && itemsLeft.length > 0;
  const showRightRail =
    showGank || showVision || showAction || showBuy || !profileMatchesLocal;

  const buyRow = showBuy ? (
    <div className="flex flex-wrap gap-0.5 items-center">
      {itemsLeft.map((item, index) => (
        <ItemIcon
          key={`buy-${item.id}`}
          itemId={item.id}
          alt={item.name}
          title={item.name}
          size={22}
          className={`hud-buy-icon${index === 0 ? ' is-next' : ''}`}
        />
      ))}
    </div>
  ) : null;

  const actionLine = showAction ? (
    <div className={`hud-chrome-cue hud-chrome-cue--${cues[0].urgency} !py-1 !px-1.5`}>
      <div>{cues[0].label}</div>
      {cues[0].rationale ? <div className="text-[8px] opacity-75">{cues[0].rationale}</div> : null}
    </div>
  ) : null;

  return (
    <div
      className={`w-screen h-screen bg-transparent overflow-hidden select-none${
        clickThrough && !alignMode ? ' pointer-events-none' : ''
      }`}
      style={{ ['--overlay-scale' as string]: `${0.75 + hudScale / 200}` }}
    >
      <ChromeGameHud
        hudScale={Number.isFinite(hudScale) ? hudScale : 20}
        mapScale={Number.isFinite(mapScale) ? mapScale : 33}
        enabled={showFrames}
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
        <span className="px-1 text-[8px] tracking-wider opacity-50">
          Match filled boxes to your League HUD / minimap
        </span>
      </div>
      )}

      {!compactPanel && !collapsed && (
        <>
          <OverlayStickers stickers={hudLayout.stickers} geo={gameGeo} />
          {showSumsRail && layoutElement(hudLayout, 'sums')?.visible !== false && (
          <div
            className="hud-overlay-scale hud-overlay-scale--left w-[220px]"
            style={layoutStyle(layoutElement(hudLayout, 'sums') || { x: 0.018, y: 0.078, scale: 1, opacity: 1, anchor: 'tl' }, gameGeo)}
          >
            <OverlayChromePanel>
              <div className="hud-chrome-header !py-1 !px-2">
                <div className="hud-chrome-title truncate text-[11px]">Enemy sums</div>
                <div className="hud-chrome-meta !text-[8px]">
                  {typeof state.gameTime === 'number' && state.gameTime > 0
                    ? formatGameTime(state.gameTime)
                    : 'Live'}
                </div>
              </div>
              <div className="relative z-10 px-2 py-1.5 space-y-1 overflow-hidden">
                <SummonerTimers lanes={state.enemyBotSummoners || []} compact />
                <p className="text-[8px] font-mono text-chrome-dim/60 tracking-wide pt-0.5">
                  {hotkeyHint}
                </p>
              </div>
            </OverlayChromePanel>
          </div>
          )}

          {showGank && (
          <div className="hud-overlay-scale hud-overlay-scale--right w-[220px]" style={layoutStyle(layoutElement(hudLayout, 'gank') || { x: 0.835, y: 0.078, scale: 1, opacity: 1, anchor: 'tr' }, gameGeo)}>
            <OverlayChromePanel>
              <div className="relative z-10 px-2 py-1.5"><GankSquare threat={gankStatus} compact /></div>
            </OverlayChromePanel>
          </div>
          )}

          {showVision && (
          <div className="hud-overlay-scale hud-overlay-scale--right w-[220px]" style={layoutStyle(layoutElement(hudLayout, 'vision') || { x: 0.835, y: 0.26, scale: 1, opacity: 1, anchor: 'tr' }, gameGeo)}>
            <OverlayChromePanel>
              <div className="relative z-10 px-2 py-1.5"><WardIndicator status={wardStatus} compact /></div>
            </OverlayChromePanel>
          </div>
          )}

          {showAction && (
          <div className="hud-overlay-scale hud-overlay-scale--right w-[220px]" style={layoutStyle(layoutElement(hudLayout, 'action') || { x: 0.835, y: 0.54, scale: 1, opacity: 1, anchor: 'tr' }, gameGeo)}>
            <OverlayChromePanel>
              <div className="relative z-10 px-2 py-1.5">{actionLine}</div>
            </OverlayChromePanel>
          </div>
          )}

          {showBuy && (
          <div className="hud-overlay-scale hud-overlay-scale--right w-[220px]" style={layoutStyle(layoutElement(hudLayout, 'buy') || { x: 0.835, y: 0.42, scale: 1, opacity: 1, anchor: 'tr' }, gameGeo)}>
            <OverlayChromePanel>
              <div className="relative z-10 px-2 py-1.5">{buyRow}</div>
            </OverlayChromePanel>
          </div>
          )}

          {showRightRail && !profileMatchesLocal && (
          <div className="hud-overlay-scale hud-overlay-scale--right w-[220px] absolute top-14 right-3">
            <OverlayChromePanel>
              <div className="hud-chrome-header !py-1 !px-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <ChampionIcon
                    championId={profile.championId}
                    championName={state.localPlayer?.championName}
                    size={16}
                    className="hud-champ-icon shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="hud-chrome-title truncate text-[11px]">One Trick</div>
                    <div className="hud-chrome-meta !text-[8px]">{profile.shortLabel}</div>
                  </div>
                </div>
                <button type="button" onClick={() => setCollapsed(true)} className="hud-btn" title="Collapse rails">
                  –
                </button>
              </div>
              <div className="relative z-10 px-2 py-1.5">
                <div className="hud-chrome-cue hud-chrome-cue--warn !text-[10px] !py-1">
                  Switch profile → {state.localPlayer?.championName || '?'}
                </div>
              </div>
            </OverlayChromePanel>
          </div>
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
                <div className="hud-chrome-title truncate text-[11px]">One Trick</div>
                <div className="hud-chrome-meta !text-[8px]">
                  {profile.shortLabel}
                  {typeof state.gameTime === 'number' && state.gameTime > 0
                    ? ` · ${formatGameTime(state.gameTime)}`
                    : ''}
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
            <div className="relative z-10 px-2 py-1.5 space-y-1 overflow-hidden">
              {!profileMatchesLocal ? (
                <div className="hud-chrome-cue hud-chrome-cue--warn !text-[10px] !py-1">
                  Switch profile → {state.localPlayer?.championName || '?'}
                </div>
              ) : null}
              {showGank ? <GankSquare threat={gankStatus} compact /> : null}
              {showVision ? <WardIndicator status={wardStatus} compact /> : null}
              {actionLine}
              {showSums ? <SummonerTimers lanes={state.enemyBotSummoners || []} compact /> : null}
              {buyRow}
            </div>
          )}
        </OverlayChromePanel>
      </div>
      )}
    </div>
  );
};
