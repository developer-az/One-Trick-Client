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
  type OverlayState,
} from './overlayLogic';
import { SummonerTimers } from '../components/SummonerTimers';
import { ChromeMark } from './ChromeMark';
import { ChromeGameHud } from './ChromeGameHud';
import { WardIndicator } from './WardIndicator';
import { GankSquare } from './GankSquare';
import { championSquareUrl } from '../data/ddragonAssets';

function damageTypeFromTags(tags: string[]): Champion['damageType'] {
  return tags.includes('Mage') || tags.includes('Support') ? 'Magic' : 'Physical';
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
  const [calibration, setCalibration] = useState<OverlayCalibration>({ ability: emptyCalibration(), minimap: emptyCalibration() });
  const compactPanel = !clickThrough && !alignMode;
  const [profileId, setProfileId] = useState<ProfileId>(() =>
    typeof window !== 'undefined' ? loadStoredProfileId() : 'pyke-support'
  );
  const profile = useMemo(() => getProfile(profileId), [profileId]);

  // Load champion catalog for profile logic
  useEffect(() => {
    fetch('https://ddragon.leagueoflegends.com/api/versions.json')
      .then((res) => res.json())
      .then((versions) => {
        const latest = versions[0] || '15.1.1';
        return fetch(`https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`);
      })
      .catch(() => fetch('https://ddragon.leagueoflegends.com/cdn/15.1.1/data/en_US/champion.json'))
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
        setChampions(list);
      })
      .catch((err) => console.error('Overlay champion load failed:', err));
  }, []);

  // Subscribe to main-process overlay pushes
  useEffect(() => {
    if (!window.electronAPI?.onOverlayUpdate) return;

    const unsubUpdate = window.electronAPI.onOverlayUpdate((payload) => {
      const next = payload as OverlayState;
      // Guard: never let an empty mid-match blip wipe living HUD state
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

    const unsubMeta = window.electronAPI.onOverlayMeta?.((payload) => {
      const meta = payload as {
        clickThrough?: boolean;
        alignMode?: boolean;
        hudScale?: number;
        mapScale?: number;
        chromeColor?: string;
        calibration?: OverlayCalibration;
        gameWidth?: number;
        gameHeight?: number;
      };
      if (typeof meta.clickThrough === 'boolean') {
        setClickThrough(meta.clickThrough);
      }
      if (typeof meta.alignMode === 'boolean') {
        setAlignMode(meta.alignMode);
      }
      if (typeof meta.hudScale === 'number') {
        setHudScale(meta.hudScale);
      }
      if (typeof meta.mapScale === 'number') {
        setMapScale(meta.mapScale);
      }
      if (typeof meta.chromeColor === 'string') {
        setChromeColor(meta.chromeColor);
      }
      if (typeof meta.gameWidth === 'number') setGameWidth(meta.gameWidth);
      if (typeof meta.gameHeight === 'number') setGameHeight(meta.gameHeight);
      if (meta.calibration) {
        setCalibration(meta.calibration);
      }
    });

    window.electronAPI.getOverlayStatus?.().then((res) => {
      if (res?.success && typeof res.clickThrough === 'boolean') {
        setClickThrough(res.clickThrough);
      }
      if (res?.success && typeof res.alignMode === 'boolean') {
        setAlignMode(res.alignMode);
      }
      if (res?.success && typeof res.hudScale === 'number') {
        setHudScale(res.hudScale);
      }
      if (res?.success && typeof res.mapScale === 'number') {
        setMapScale(res.mapScale);
      }
      if (res?.success && typeof res.chromeColor === 'string') {
        setChromeColor(res.chromeColor);
      }
      if (res?.success && typeof res.gameWidth === 'number') setGameWidth(res.gameWidth);
      if (res?.success && typeof res.gameHeight === 'number') setGameHeight(res.gameHeight);
      if (res?.success && res.calibration) {
        setCalibration(res.calibration);
      }
    });

    return () => {
      unsubUpdate?.();
      unsubMeta?.();
    };
  }, []);

  // Payloads arrive with fresh array identities every push; key on content so the
  // (expensive) build/rune/matchup math only re-runs when something real changed.
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

  const allyPartner = profileId === 'yone-mid' ? allyChampions.jungle : allyChampions.mid;
  const adcForProfile = profileId === 'yone-mid' ? null : allyChampions.adc;

  // Behind / even / ahead — only Pantheon changes recommendations on it, but the
  // read itself is cheap and drives cues for every profile.
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

  // Cue TTLs — expire then allow re-show (sticky ids must not die forever).
  // Prefer gameTime-driven expiry so a 1Hz wall clock isn't required.
  const cueFirstSeen = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    if (!state.inGame) cueFirstSeen.current.clear();
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
      // Expired — clear so the next matching id can reappear with a fresh TTL
      seen.delete(cue.id);
    }
    // Keep the rail populated: take next non-expired candidates after sticky expiry
    return alive.slice(0, 3);
  }, [rawCues, state.gameTime]);

  const wardStatus = useMemo(() => getWardStatus(state, profileId), [state, profileId]);
  const gankStatus = useMemo(() => getGankStatus(state, profileId), [state, profileId]);

  // Items still to buy — anything already in the inventory (by item ID) drops off.
  const itemsLeft = useMemo(() => remainingBuildItems(state, build).slice(0, 3), [state, build]);

  const hotkeyHint =
    profileId === 'yone-mid'
      ? 'PgUp/Num9 Mid Flash · PgDn/Num3 Ignite/TP'
      : 'PgUp/Num9 ADC Flash · PgDn/Num3 Supp Flash';

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

  if (!state.inGame) {
    return (
      <div className="w-screen h-screen pointer-events-none bg-transparent">
        <div className="hud-overlay-controls absolute top-4 right-4 text-[10px] pointer-events-auto">
          <ChromeMark className="hud-chrome-mark" size={12} />
          <span className="tracking-[0.2em] uppercase">Waiting for match</span>
        </div>
      </div>
    );
  }

  const profileMatchesLocal =
    !state.localPlayer?.championName ||
    state.localPlayer.championName.toLowerCase() === profile.championId.toLowerCase();

  return (
    <div
      className={`w-screen h-screen bg-transparent overflow-hidden select-none${
        clickThrough && !alignMode ? ' pointer-events-none' : ''
      }`}
      style={{ ['--overlay-scale' as string]: `${0.75 + hudScale / 200}` }}
    >
      {/* HUD frames: fullscreen pass-through or align mode only — never on the compact panel */}
      <ChromeGameHud
        hudScale={Number.isFinite(hudScale) ? hudScale : 20}
        mapScale={Number.isFinite(mapScale) ? mapScale : 33}
        enabled={!compactPanel}
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

      {/* Dual-rail HUD when locked: sums left, cues/buy right — uses both sides of the screen */}
      {!compactPanel && !collapsed && (
        <>
          <div className={`hud-overlay-scale absolute top-14 left-3 w-[220px] ${collapsed ? 'opacity-70' : 'opacity-100'}`}>
            <div className="hud-overlay-panel overflow-hidden">
              <span className="hud-corner hud-corner-tl" aria-hidden />
              <span className="hud-corner hud-corner-br" aria-hidden />
              <span className="hud-rail hud-rail-top" aria-hidden />
              <div className="hud-chrome-header !py-1 !px-2">
                <div className="hud-chrome-title truncate text-[11px]">Enemy sums</div>
                <div className="hud-chrome-meta !text-[8px]">
                  {typeof state.gameTime === 'number' && state.gameTime > 0
                    ? formatGameTime(state.gameTime)
                    : 'Live'}
                </div>
              </div>
              <div className="relative z-10 px-2 py-1.5 space-y-1 overflow-hidden">
                {state.enemyBotSummoners && state.enemyBotSummoners.length > 0 ? (
                  <SummonerTimers lanes={state.enemyBotSummoners} compact />
                ) : (
                  <p className="text-[10px] text-[#6b7280] font-mono tracking-wide">
                    Waiting for bot / mid sums…
                  </p>
                )}
                <p className="text-[8px] font-mono text-chrome-dim/60 tracking-wide pt-0.5">
                  {hotkeyHint}
                </p>
              </div>
            </div>
          </div>

          <div className={`hud-overlay-scale absolute top-14 right-3 w-[220px] ${collapsed ? 'opacity-70' : 'opacity-100'}`}>
            <div className="hud-overlay-panel overflow-hidden">
              <span className="hud-corner hud-corner-tl" aria-hidden />
              <span className="hud-corner hud-corner-br" aria-hidden />
              <span className="hud-rail hud-rail-top" aria-hidden />
              <div className="hud-chrome-header !py-1 !px-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <img
                    src={championSquareUrl(profile.championId)}
                    alt=""
                    width={16}
                    height={16}
                    className="hud-champ-icon shrink-0"
                    decoding="async"
                    draggable={false}
                  />
                  <div className="min-w-0">
                    <div className="hud-chrome-title truncate text-[11px]">One Trick</div>
                    <div className="hud-chrome-meta !text-[8px]">
                      {profile.shortLabel}
                      {state.localPlayer ? ` · ${state.localPlayer.level}` : ''}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={() => setCollapsed(true)} className="hud-btn" title="Collapse rails">
                  –
                </button>
              </div>
              <div className="relative z-10 px-2 py-1.5 space-y-1 overflow-hidden">
                {!profileMatchesLocal ? (
                  <div className="hud-chrome-cue hud-chrome-cue--warn !text-[10px] !py-1">
                    Switch profile → {state.localPlayer?.championName || '?'}
                  </div>
                ) : null}
                <GankSquare threat={gankStatus} compact />
                <WardIndicator status={wardStatus} compact />
                {cues.map((cue) => (
                  <div
                    key={cue.id}
                    className={`hud-chrome-cue hud-chrome-cue--${cue.urgency} !py-1 !px-1.5`}
                  >
                    <div className="font-semibold uppercase tracking-[0.1em] text-[8px] opacity-90">
                      {cue.label}
                    </div>
                    <div className="mt-0.5 opacity-85 text-[10px] leading-snug">{cue.detail}</div>
                  </div>
                ))}
                {itemsLeft.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 items-center">
                    {itemsLeft.map((item, index) => (
                      <span
                        key={`left-${item.id}`}
                        className={`hud-chip !text-[9px] !py-0${index === 0 ? ' hud-accent-blood' : ''}`}
                        title={item.reason}
                      >
                        {index === 0 ? '▸ ' : ''}
                        {item.name}
                      </span>
                    ))}
                  </div>
                )}
                {analysis?.preyFocus && !cues.some((c) => c.id === 'prey-focus') && (
                  <div className="text-[10px] text-[#e4e6ea] leading-snug opacity-90">
                    {analysis.preyFocus}
                  </div>
                )}
                {!build && (
                  <p className="text-[10px] text-[#6b7280] font-mono tracking-wide">
                    Waiting for enemy data…
                  </p>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {!compactPanel && collapsed && (
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          className="hud-overlay-scale absolute top-14 right-3 hud-overlay-panel !px-2 !py-1 hud-btn"
          title="Expand dual rails"
        >
          One Trick +
        </button>
      )}

      {/* Unlocked compact panel — single movable surface */}
      {compactPanel && (
      <div className={`hud-overlay-scale absolute inset-1.5 ${collapsed ? 'opacity-70' : 'opacity-100'}`}>
        <div className="hud-overlay-panel h-full overflow-hidden">
          <span className="hud-corner hud-corner-tl" aria-hidden />
          <span className="hud-corner hud-corner-br" aria-hidden />
          <span className="hud-rail hud-rail-top" aria-hidden />

          <div
            className="hud-chrome-header !py-1 !px-2"
            style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <img
                src={championSquareUrl(profile.championId)}
                alt=""
                width={16}
                height={16}
                className="hud-champ-icon shrink-0"
                decoding="async"
                draggable={false}
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
              <GankSquare threat={gankStatus} compact />
              <WardIndicator status={wardStatus} compact />
              {cues.slice(0, 3).map((cue) => (
                <div
                  key={cue.id}
                  className={`hud-chrome-cue hud-chrome-cue--${cue.urgency} !py-1 !px-1.5`}
                >
                  <div className="font-semibold uppercase tracking-[0.1em] text-[8px] opacity-90">
                    {cue.label}
                  </div>
                  <div className="mt-0.5 opacity-85 text-[10px] leading-snug">{cue.detail}</div>
                </div>
              ))}
              {state.enemyBotSummoners && state.enemyBotSummoners.length > 0 && (
                <SummonerTimers lanes={state.enemyBotSummoners} compact />
              )}
              {itemsLeft.length > 0 && (
                <div className="flex flex-wrap gap-0.5 items-center">
                  {itemsLeft.map((item, index) => (
                    <span
                      key={`left-${item.id}`}
                      className={`hud-chip !text-[9px] !py-0${index === 0 ? ' hud-accent-blood' : ''}`}
                      title={item.reason}
                    >
                      {index === 0 ? '▸ ' : ''}
                      {item.name}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
      )}
    </div>
  );
};
