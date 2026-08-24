import React, { useState, useEffect, useMemo } from 'react';
import { BuildDisplay } from './components/BuildDisplay';
import { ChampionSelect } from './components/ChampionSelect';
import { HudModulesBar } from './components/HudModulesBar';
import { SummonerTimers } from './components/SummonerTimers';
import type { Champion, Build, RunePage, MatchupAnalysis, DominanceMetrics } from './logic/pykeLogic';
import {
  PROFILES,
  getProfile,
  isProfileId,
  loadStoredProfileId,
  storeProfileId,
  profileFromChampionName,
  type ProfileId,
} from './logic/profiles';
import type { OverlayBotSummoner } from './overlay/overlayLogic';
import { ChromeMark } from './overlay/ChromeMark';
import { CHROME_COLOR_PRESETS, normalizeChromeColor } from './overlay/chromeTheme';
import {
  DEFAULT_HUD_MODULES,
  normalizeHudModules,
  type HudModuleId,
  type HudModules,
} from './overlay/hudModules';
import {
  championSquareUrl,
  warmDdragonVersion,
} from './data/ddragonAssets';



const App: React.FC = () => {
  const [champions, setChampions] = useState<Champion[]>([]);
  const emptySelections = (): { [key: string]: Champion | null } => ({
    Top: null,
    Jungle: null,
    Mid: null,
    Bot: null,
    Support: null,
    YourADC: null,
    YourMid: null,
    YourJungle: null,
  });
  const [selections, setSelections] = useState<{ [key: string]: Champion | null }>(emptySelections);
  const [build, setBuild] = useState<Build | null>(null);
  const [runes, setRunes] = useState<RunePage | null>(null);
  const [analysis, setAnalysis] = useState<MatchupAnalysis | null>(null);
  const [dominance, setDominance] = useState<DominanceMetrics | null>(null);
  const [lcuConnected, setLcuConnected] = useState(false);
  const [exportStatus, setExportStatus] = useState<'idle' | 'working' | 'success' | 'error'>('idle');
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportDetail, setExportDetail] = useState<string | null>(null);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [overlayInGame, setOverlayInGame] = useState(false);
  const wasInGameRef = React.useRef(false);
  const [overlayClickThrough, setOverlayClickThrough] = useState(true);
  const [hudScale, setHudScale] = useState(20);
  const [mapScale, setMapScale] = useState(33);
  const [chromeColor, setChromeColor] = useState('#d4d8de');
  const [hudModules, setHudModules] = useState<HudModules>(DEFAULT_HUD_MODULES);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileId, setProfileId] = useState<ProfileId>(() =>
    typeof window !== 'undefined' ? loadStoredProfileId() : 'pyke-support'
  );
  const [enemyBotSummoners, setEnemyBotSummoners] = useState<OverlayBotSummoner[]>([]);
  const profile = useMemo(() => getProfile(profileId), [profileId]);

  const handleProfileChange = (id: ProfileId) => {
    setProfileId(id);
    storeProfileId(id);
  };

  // Fetch Champions + warm Data Dragon version for icon/splash URLs
  useEffect(() => {
    void warmDdragonVersion()
      .then((latestVersion) =>
        fetch(`https://ddragon.leagueoflegends.com/cdn/${latestVersion}/data/en_US/champion.json`)
      )
      .catch(() => fetch('https://ddragon.leagueoflegends.com/cdn/15.1.1/data/en_US/champion.json'))
      .then((res) => res.json())
      .then((data) => {
        interface ChampionData {
          id: string;
          key: string;
          name: string;
          tags: string[];
        }

        const championsData = Object.values(data.data) as ChampionData[];
        const list: Champion[] = championsData.map((c: ChampionData) => ({
          id: c.id,
          key: c.key,
          name: c.name,
          tags: c.tags,
          damageType: c.tags.includes('Mage') || c.tags.includes('Support') ? 'Magic' : 'Physical',
        }));
        setChampions(list);
      })
      .catch((error) => {
        console.error('Failed to fetch champions:', error);
      });
  }, []);

  // LCU Connection via IPC — retry until Live (client may launch after the app)
  useEffect(() => {
    if (!window.electronAPI) return;

    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    // Each attempt spawns a PowerShell process to read the client's command line,
    // so back off instead of hammering it every 5s while League is closed.
    const tryConnect = () => {
      if (!window.electronAPI || cancelled) return;
      window.electronAPI.connectLCU().then(res => {
        if (cancelled) return;
        if (res && res.success) {
          setLcuConnected(true);
          return;
        }
        scheduleRetry();
      }).catch(() => scheduleRetry());
    };

    const scheduleRetry = () => {
      if (cancelled) return;
      attempts += 1;
      const delay = Math.min(30000, 5000 * Math.min(attempts, 6));
      retryTimer = setTimeout(tryConnect, delay);
    };

    tryConnect();

    window.electronAPI.getOverlayStatus?.().then((res) => {
      if (res?.success) {
        setOverlayVisible(res.visible);
        setOverlayInGame(res.inGame);
        setOverlayClickThrough(res.clickThrough);
        setHudScale(res.hudScale);
        if (typeof res.mapScale === 'number') setMapScale(res.mapScale);
        if (typeof res.chromeColor === 'string') setChromeColor(res.chromeColor);
        if (res.hudModules) setHudModules(normalizeHudModules(res.hudModules));
      }
    });

    const unsubVis = window.electronAPI.onOverlayVisibilityChanged?.((payload) => {
      setOverlayVisible(payload.visible);
    });
    const unsubMeta = window.electronAPI.onOverlayMeta?.((payload) => {
      const meta = payload as { clickThrough?: boolean; hudScale?: number; mapScale?: number; chromeColor?: string; hudModules?: unknown };
      if (typeof meta.clickThrough === 'boolean') setOverlayClickThrough(meta.clickThrough);
      if (typeof meta.hudScale === 'number') setHudScale(meta.hudScale);
      if (typeof meta.mapScale === 'number') setMapScale(meta.mapScale);
      if (typeof meta.chromeColor === 'string') setChromeColor(meta.chromeColor);
      if (meta.hudModules) setHudModules(normalizeHudModules(meta.hudModules));
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubVis?.();
      unsubMeta?.();
    };
  }, []);

  // Track overlay in-game state + pregame summoner intel (shared channel)
  useEffect(() => {
    if (!window.electronAPI?.onOverlayUpdate) return;
    const unsub = window.electronAPI.onOverlayUpdate((payload) => {
      const data = payload as {
        inGame?: boolean;
        enemyBotSummoners?: OverlayBotSummoner[];
        profileHint?: ProfileId | null;
        localPlayer?: { championName?: string } | null;
      };
      if (Array.isArray(data.enemyBotSummoners)) {
        setEnemyBotSummoners(data.enemyBotSummoners);
      }
      // Auto-switch profile when live client reports local champion
      if (isProfileId(data.profileHint)) {
        const hint = data.profileHint;
        setProfileId((prev) => {
          if (prev !== hint) {
            storeProfileId(hint);
            return hint;
          }
          return prev;
        });
      } else if (data.localPlayer?.championName) {
        const matched = profileFromChampionName(data.localPlayer.championName);
        if (matched) {
          setProfileId((prev) => {
            if (prev !== matched.id) {
              storeProfileId(matched.id);
              return matched.id;
            }
            return prev;
          });
        }
      }
      if (typeof data.inGame === 'boolean') {
        setOverlayInGame(data.inGame);
        // Match ended → clear champ-select / live leftovers so UI is ready for next lobby
        if (wasInGameRef.current && !data.inGame) {
          setSelections(emptySelections());
          setBuild(null);
          setRunes(null);
          setAnalysis(null);
          setDominance(null);
          setEnemyBotSummoners([]);
          setExportStatus('idle');
        }
        wasInGameRef.current = data.inGame;
      }
    });
    return () => {
      unsub?.();
    };
  }, []);

  // Auto-Detect Logic (Polling)
  useEffect(() => {
    // While a match is live the main window is minimized and champ select is
    // irrelevant — do not even schedule the timer, so League keeps the CPU.
    if (!lcuConnected || !window.electronAPI || champions.length === 0 || overlayInGame) return;

    let pollInFlight = false;

    const poll = async () => {
      if (document.hidden) return;
      // Avoid stacking overlapping requests if one poll runs long
      if (pollInFlight) return;

      if (!window.electronAPI) return;
      pollInFlight = true;
      try {
        const res = await window.electronAPI.requestLCU('GET', '/lol-champ-select/v1/session');

        // Handle 404 gracefully (not in champ select) or other errors
        if (!res.success) {
          // If it's a 404, that's expected when not in champ select - silently ignore
          if (res.error && res.error.includes('404')) {
            return; // Not in champ select, this is normal
          }
          // Other errors might be connection issues, but don't spam console
          return;
        }

        if (res.success && res.data) {
          interface TeamMember {
            championId?: number;
            cellId?: number;
            assignedPosition?: string;
            teamPosition?: string;
            position?: string;
            spell1Id?: number;
            spell2Id?: number;
          }

          interface LCUSession {
            theirTeam?: TeamMember[];
            myTeam?: TeamMember[];
            localPlayerCellId?: number;
          }

          const sessionData = res.data as LCUSession;
          const theirTeam = sessionData.theirTeam;
          const myTeam = sessionData.myTeam;
          const localPlayerCellId = sessionData.localPlayerCellId;

          // Auto-pick profile from locked-in champion in champ select
          if (Array.isArray(myTeam) && localPlayerCellId !== undefined) {
            const me = myTeam.find((m) => m.cellId === localPlayerCellId);
            if (me?.championId && me.championId !== 0) {
              const myChamp = champions.find((c) => c.key === String(me.championId));
              const matched = profileFromChampionName(myChamp?.id || myChamp?.name);
              if (matched) {
                setProfileId((prev) => {
                  if (prev !== matched.id) {
                    storeProfileId(matched.id);
                    return matched.id;
                  }
                  return prev;
                });
              }
            }
          }

          if (Array.isArray(theirTeam) || Array.isArray(myTeam)) {
            setSelections(prev => {
              const newSelections = { ...prev };
              let hasUpdates = false;

              // Map LCU role names to our role names
              const roleMap: { [key: string]: string } = {
                'TOP': 'Top',
                'JUNGLE': 'Jungle',
                'MIDDLE': 'Mid',
                'BOTTOM': 'Bot',
                'UTILITY': 'Support'
              };

              if (Array.isArray(theirTeam)) {
                theirTeam.forEach((member: TeamMember) => {
                  const championId = member.championId;
                  if (championId !== undefined && championId !== 0) {
                    const found = champions.find(c => c.key === championId.toString());
                    if (found) {
                      // Use assignedPosition or teamPosition from LCU API
                      const lcuRole = member.assignedPosition || member.teamPosition || member.position;
                      const role = lcuRole ? roleMap[lcuRole] || null : null;

                      if (role) {
                        if (newSelections[role]?.id !== found.id) {
                          newSelections[role] = found;
                          hasUpdates = true;
                        }
                      } else {
                        // Check if champion is already assigned to ANY role to prevent duplication
                        const isAlreadyAssigned = Object.values(newSelections).some(s => s?.id === found.id);

                        if (!isAlreadyAssigned) {
                          // Fallback: try to infer role from champion tags if LCU doesn't provide it
                          // This is less accurate but better than index-based assignment
                          const inferredRole = inferRoleFromChampion(found, newSelections);
                          if (inferredRole && newSelections[inferredRole]?.id !== found.id) {
                            newSelections[inferredRole] = found;
                            hasUpdates = true;
                          }
                        }
                      }
                    }
                  }
                });
              }

              // Ally lanes from myTeam (exclude local player cell)
              if (Array.isArray(myTeam)) {
                const isAllyNotSelf = (m: TeamMember) =>
                  m.championId !== undefined &&
                  m.championId !== 0 &&
                  (localPlayerCellId === undefined || m.cellId !== localPlayerCellId);

                const bottomMember = myTeam.find((m) => {
                  const pos = (m.assignedPosition || m.teamPosition || m.position || '').toUpperCase();
                  return pos === 'BOTTOM' && isAllyNotSelf(m);
                });
                const marksmanFallback = !bottomMember
                  ? myTeam.find((m) => {
                      if (!isAllyNotSelf(m)) return false;
                      const champ = champions.find(c => c.key === String(m.championId));
                      const pos = (m.assignedPosition || m.teamPosition || m.position || '').toUpperCase();
                      return !!champ?.tags.includes('Marksman') && pos !== 'UTILITY';
                    })
                  : null;
                const adcMember = bottomMember || marksmanFallback;
                if (adcMember?.championId) {
                  const adcChamp = champions.find(c => c.key === String(adcMember.championId));
                  if (adcChamp && newSelections.YourADC?.id !== adcChamp.id) {
                    newSelections.YourADC = adcChamp;
                    hasUpdates = true;
                  }
                }

                const midMember = myTeam.find((m) => {
                  const pos = (m.assignedPosition || m.teamPosition || m.position || '').toUpperCase();
                  return (pos === 'MIDDLE' || pos === 'MID') && isAllyNotSelf(m);
                });
                if (midMember?.championId) {
                  const midChamp = champions.find(c => c.key === String(midMember.championId));
                  if (midChamp && newSelections.YourMid?.id !== midChamp.id) {
                    newSelections.YourMid = midChamp;
                    hasUpdates = true;
                  }
                }

                // Ally jungler — Yone Mid's partner lane (Yone is mid himself)
                const jgMember = myTeam.find((m) => {
                  const pos = (m.assignedPosition || m.teamPosition || m.position || '').toUpperCase();
                  return pos === 'JUNGLE' && isAllyNotSelf(m);
                });
                if (jgMember?.championId) {
                  const jgChamp = champions.find((c) => c.key === String(jgMember.championId));
                  if (jgChamp && newSelections.YourJungle?.id !== jgChamp.id) {
                    newSelections.YourJungle = jgChamp;
                    hasUpdates = true;
                  }
                }
              }

              return hasUpdates ? newSelections : prev;
            });
          }
        }
      } catch (e) {
        // Session likely not active or other expected errors, ignore silently
        // Only log unexpected errors
        if (e && typeof e === 'object' && 'message' in e) {
          const errorMessage = String((e as { message?: unknown }).message || '');
          if (!errorMessage.includes('404')) {
            console.debug('LCU polling error:', e);
          }
        }
      } finally {
        pollInFlight = false;
      }
    };

    // Poll every 1.5s when active (slower = less LCU contention with the game client)
    const intervalId = setInterval(poll, 1500);

    // Listener to handle visibility changes immediately
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void poll(); // Poll immediately when becoming visible
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [lcuConnected, champions, overlayInGame]);

  // Recalculate Build & Analysis — skip while in-game (overlay owns the hot path)
  useEffect(() => {
    if (overlayInGame) return;

    const enemyRoles = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
    const enemies = enemyRoles.map(role => selections[role]).filter(c => c !== null) as Champion[];
    // Pyke partners: ADC + Mid. Yone is mid — partner is Jungle only.
    const yourADC = profile.id === 'yone-mid' ? null : selections.YourADC;
    const allyPartner =
      profile.id === 'yone-mid' ? selections.YourJungle : selections.YourMid;

    if (enemies.length > 0) {
      const currentBuild = profile.calculateBuild(enemies, yourADC, allyPartner);
      setBuild(currentBuild);
      setRunes(profile.calculateRunes(enemies, currentBuild, yourADC, allyPartner));
      setAnalysis(profile.analyzeMatchup(enemies, currentBuild, yourADC, allyPartner));
      setDominance(profile.calculateDominance(enemies, currentBuild, yourADC, allyPartner));
    } else {
      setBuild(null);
      setRunes(null);
      setAnalysis(null);
      setDominance(null);
    }
  }, [selections, profile, overlayInGame]);

  // Helper function to infer role from champion tags when LCU doesn't provide role
  const inferRoleFromChampion = (champion: Champion, currentSelections: { [key: string]: Champion | null }): string | null => {
    // Check if role is already taken
    const isRoleTaken = (role: string) => currentSelections[role] !== null;

    // Marksman = Bot
    if (champion.tags.includes('Marksman') && !isRoleTaken('Bot')) {
      return 'Bot';
    }
    // Support tag = Support
    if (champion.tags.includes('Support') && !isRoleTaken('Support')) {
      return 'Support';
    }
    // Tank/Fighter often = Top
    if ((champion.tags.includes('Tank') || champion.tags.includes('Fighter')) && !isRoleTaken('Top')) {
      return 'Top';
    }
    // Assassin/Mage often = Mid
    if ((champion.tags.includes('Assassin') || champion.tags.includes('Mage')) && !isRoleTaken('Mid')) {
      return 'Mid';
    }

    // Fill remaining slots
    const roles = ['Top', 'Jungle', 'Mid', 'Bot', 'Support'];
    for (const role of roles) {
      if (!isRoleTaken(role)) return role;
    }

    return null;
  };

  const handleSelectionChange = (role: string, champion: Champion | null) => {
    setSelections(prev => ({ ...prev, [role]: champion }));
  };

  const handleExport = async () => {
    if (!runes || !window.electronAPI) return;
    try {
      setExportStatus('working');
      setExportError(null);
      setExportDetail(null);

      const selectedPerkIds = [...runes.selectedPerkIds];
      if (selectedPerkIds.length !== 9) {
        throw new Error(`Invalid rune configuration: expected 9 runes, got ${selectedPerkIds.length}`);
      }

      const runePagePayload = {
        name: runes.name,
        primaryStyleId: runes.primaryStyleId,
        subStyleId: runes.subStyleId,
        selectedPerkIds,
        current: true,
      };

      // Prefer dedicated main-process exporters (correct LCU paths + error bodies)
      if (window.electronAPI.exportRunePage) {
        const runeRes = await window.electronAPI.exportRunePage(runePagePayload);
        if (!runeRes.success) throw new Error(runeRes.error || 'Failed to export rune page');
      } else {
        const res = await window.electronAPI.requestLCU('GET', '/lol-perks/v1/pages');
        if (!res.success) throw new Error(res.error);
        interface ExistingRunePage { name: string; id: number }
        const pages = Array.isArray(res.data) ? (res.data as ExistingRunePage[]) : [];
        const existingPage = pages.find((p) => p.name === runes.name);
        if (existingPage) {
          await window.electronAPI.requestLCU('DELETE', `/lol-perks/v1/pages/${existingPage.id}`);
        }
        const createRes = await window.electronAPI.requestLCU('POST', '/lol-perks/v1/pages', runePagePayload);
        if (!createRes.success) throw new Error(createRes.error || 'Failed to create rune page');
      }

      if (build && window.electronAPI.exportItemSet) {
        const itemRes = await window.electronAPI.exportItemSet({
          starter: build.starter,
          core: build.core,
          boots: build.boots,
          situational: build.situational,
          buildPath: build.buildPath,
          championKey: profile.championKey,
          title: profile.itemSetTitle,
        });
        if (!itemRes?.success) {
          // Runes landed — surface partial failure instead of silent success
          setExportDetail('Runes exported. Item set failed.');
          throw new Error(itemRes?.error || 'Item set export failed');
        }
      }

      setExportStatus('success');
      setExportDetail(`${profile.runePageName} + item set sent to the client.`);
      setTimeout(() => setExportStatus('idle'), 4000);
    } catch (error: unknown) {
      const err = error as { message?: string };
      const message = err.message || 'Unknown export error';
      console.error('Export failed:', message);
      setExportError(message);
      setExportStatus('error');
    }
  };

  const handleMinimize = () => {
    if (window.electronAPI) {
      window.electronAPI.windowMinimize();
    }
  };

  const handleMaximize = () => {
    if (window.electronAPI) {
      window.electronAPI.windowMaximize();
    }
  };

  const handleClose = () => {
    if (window.electronAPI) {
      window.electronAPI.windowClose();
    }
  };

  const handleToggleOverlay = async () => {
    if (!window.electronAPI?.toggleOverlay) return;
    try {
      const res = await window.electronAPI.toggleOverlay();
      if (res?.success) {
        setOverlayVisible(res.visible);
      }
    } catch (error) {
      console.error('Unable to toggle overlay:', error);
    }
  };

  const handleToggleClickThrough = async () => {
    if (!window.electronAPI?.toggleOverlayClickThrough) return;
    try {
      const res = await window.electronAPI.toggleOverlayClickThrough();
      if (res?.success) {
        setOverlayClickThrough(res.clickThrough);
      }
    } catch (error) {
      console.error('Unable to change overlay interaction mode:', error);
    }
  };

  const handleHudScaleChange = async (scale: number) => {
    setHudScale(scale);
    try {
      const res = await window.electronAPI?.setOverlayHudScale(scale);
      if (res?.success) setHudScale(res.hudScale);
    } catch (error) {
      console.error('Unable to save HUD scale:', error);
    }
  };

  const handleMapScaleChange = async (scale: number) => {
    setMapScale(scale);
    try {
      const res = await window.electronAPI?.setOverlayMapScale?.(scale);
      if (res?.success) setMapScale(res.mapScale);
    } catch (error) {
      console.error('Unable to save Map scale:', error);
    }
  };

  const handleSyncLeagueScales = async () => {
    try {
      const res = await window.electronAPI?.syncLeagueScales?.();
      if (res?.success) {
        setHudScale(res.hudScale);
        setMapScale(res.mapScale);
      }
    } catch (error) {
      console.error('Unable to sync League scales:', error);
    }
  };

  const handleChromeColorChange = async (color: string) => {
    setChromeColor(color);
    try {
      const res = await window.electronAPI?.setOverlayChromeColor?.(color);
      if (res?.success) setChromeColor(res.chromeColor);
    } catch (error) {
      console.error('Unable to save chrome color:', error);
    }
  };

  const handleHudModuleToggle = async (id: HudModuleId) => {
    const next = { ...hudModules, [id]: !hudModules[id] };
    setHudModules(next);
    try {
      const res = await window.electronAPI?.setOverlayHudModules?.(next);
      if (res?.success && res.hudModules) setHudModules(normalizeHudModules(res.hudModules));
    } catch (error) {
      console.error('Unable to save HUD modules:', error);
    }
  };

  return (
    <div className="hud-app-shell text-chrome-silver overflow-x-hidden">
      <div className="app-atmosphere" aria-hidden />

      {window.electronAPI && (
        <div
          className="hud-titlebar h-10 flex items-center justify-between px-3 fixed top-0 left-0 right-0 z-50"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2 text-xs text-chrome-dim">
            <ChromeMark size={14} className="text-chrome-silver shrink-0" />
            <span className="hud-brand text-sm text-chrome-bright">One Trick</span>
            <img
              src={championSquareUrl(profile.championId)}
              alt=""
              width={16}
              height={16}
              className="hud-champ-icon hud-champ-icon--title"
              decoding="async"
              draggable={false}
            />
            <span className="text-[11px] text-chrome-dim">{profile.shortLabel}</span>
          </div>
          <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button onClick={handleMinimize} className="w-10 h-10 flex items-center justify-center text-chrome-dim hover:text-chrome-bright hover:bg-white/5" title="Minimize">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><line x1="0" y1="6" x2="12" y2="6" /></svg>
            </button>
            <button onClick={handleMaximize} className="w-10 h-10 flex items-center justify-center text-chrome-dim hover:text-chrome-bright hover:bg-white/5" title="Maximize">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="8" height="8" /></svg>
            </button>
            <button onClick={handleClose} className="w-10 h-10 flex items-center justify-center text-chrome-dim hover:text-rose-300 hover:bg-chrome-blood/30" title="Close">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2"><line x1="2" y1="2" x2="10" y2="10" /><line x1="10" y1="2" x2="2" y2="10" /></svg>
            </button>
          </div>
        </div>
      )}

      <div className={`app-content mx-auto px-4 pb-5 max-w-5xl ${window.electronAPI ? 'pt-14' : 'pt-4'}`}>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="hud-profile-switch" role="group" aria-label="Champion profile">
            {PROFILES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleProfileChange(p.id)}
                className={`hud-profile-tab ${profileId === p.id ? 'is-active' : ''}`}
                title={p.label}
              >
                <img src={championSquareUrl(p.championId)} alt="" width={18} height={18} className="hud-champ-icon" decoding="async" draggable={false} />
                {p.shortLabel}
              </button>
            ))}
          </div>
          <div className={`hud-chip flex items-center gap-1.5 ${overlayInGame ? 'hud-accent-blood' : lcuConnected ? 'hud-accent-green' : 'hud-chip--quiet'}`}>
            <span className="hud-status-dot" />
            {overlayInGame ? 'In match' : lcuConnected ? 'Live' : 'Demo'}
          </div>
          {window.electronAPI && (
            <>
              <button type="button" onClick={handleToggleOverlay} className={`hud-btn ${overlayVisible ? 'hud-btn--active' : ''}`} title="Ctrl+Shift+H">
                Overlay {overlayVisible ? 'on' : 'off'}
              </button>
              <button type="button" onClick={() => setSettingsOpen((o) => !o)} className={`hud-btn ${settingsOpen ? 'hud-btn--active' : ''}`} aria-expanded={settingsOpen}>
                Settings
              </button>
            </>
          )}
        </div>

        {settingsOpen && window.electronAPI && (
          <div className="hud-panel p-3 mb-4">
            <div className="hud-toolbar">
              <button type="button" onClick={handleToggleClickThrough} className="hud-btn">
                {overlayClickThrough ? 'Locked' : 'Unlocked'}
              </button>
              <label className="hud-scale-control" title="League HUD Scale">
                <span>HUD {hudScale}</span>
                <input type="range" min="0" max="100" value={hudScale} onChange={(e) => void handleHudScaleChange(Number(e.target.value))} />
              </label>
              <label className="hud-scale-control" title="League Minimap Scale">
                <span>Map {mapScale}</span>
                <input type="range" min="0" max="100" value={mapScale} onChange={(e) => void handleMapScaleChange(Number(e.target.value))} />
              </label>
              <button type="button" className="hud-btn" onClick={() => void handleSyncLeagueScales()}>Sync LoL</button>
              <label className="chrome-color-control">
                <span>Accent</span>
                <input type="color" value={normalizeChromeColor(chromeColor)} onChange={(e) => void handleChromeColorChange(e.target.value)} />
                <span className="chrome-color-presets">
                  {CHROME_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className="chrome-color-swatch"
                      style={{ background: preset.value }}
                      title={preset.label}
                      onClick={() => void handleChromeColorChange(preset.value)}
                    />
                  ))}
                </span>
              </label>
            </div>
          </div>
        )}

        {overlayInGame ? (
          <div className="hud-panel p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-chrome-bright">In match</p>
              {analysis && <p className="text-xs text-chrome-dim truncate">{analysis.title}</p>}
            </div>
            {enemyBotSummoners.length > 0 && (
              <SummonerTimers lanes={enemyBotSummoners} accentColor={chromeColor} />
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="hud-panel p-3 relative" style={{ zIndex: 20 }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-chrome-dim mb-2">Enemies</p>
              <ChampionSelect
                champions={champions}
                selections={selections}
                onSelectionChange={handleSelectionChange}
                roles={['Top', 'Jungle', 'Mid', 'Bot', 'Support']}
                layout="row"
                compact
              />
            </div>
            <div className="hud-panel p-3 relative" style={{ zIndex: 10 }}>
              <p className="text-[10px] font-mono uppercase tracking-wider text-chrome-dim mb-2">
                {profile.id === 'yone-mid' ? 'Jungle' : 'Allies'}
              </p>
              <ChampionSelect
                champions={champions}
                selections={selections}
                onSelectionChange={handleSelectionChange}
                roles={profile.focusAllies}
                layout="row"
                compact
              />
            </div>

            {enemyBotSummoners.length > 0 && (
              <div className="hud-panel p-3">
                <SummonerTimers lanes={enemyBotSummoners} accentColor={chromeColor} />
              </div>
            )}

            {build && runes && analysis ? (
              <div className="hud-panel p-4">
                <BuildDisplay
                  build={build}
                  runes={runes}
                  analysis={analysis}
                  dominance={dominance}
                  onExport={handleExport}
                  canExport={lcuConnected}
                  exportStatus={exportStatus}
                  exportError={exportError}
                  exportDetail={exportDetail}
                  profileLabel={profile.shortLabel}
                />
              </div>
            ) : (
              <div className="hud-panel p-8 text-center text-chrome-dim">
                <img
                  src={championSquareUrl(profile.championId)}
                  alt=""
                  width={40}
                  height={40}
                  className="mx-auto mb-3 opacity-50 hud-champ-icon hud-champ-icon--xl"
                  decoding="async"
                  draggable={false}
                />
                <p className="text-sm text-chrome-bright">Awaiting draft</p>
                <p className="text-xs mt-1">Lock in or pick enemies for {profile.shortLabel}.</p>
              </div>
            )}

            <HudModulesBar modules={hudModules} onToggle={(id) => void handleHudModuleToggle(id)} />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
