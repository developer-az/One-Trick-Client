import React, { useState, useEffect, useMemo } from 'react';
import { BuildDisplay } from './components/BuildDisplay';
import { ChampionSelect } from './components/ChampionSelect';
import { DominanceGauge } from './components/DominanceGauge';
import { HudFrame } from './components/HudFrame';
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
  championSquareUrl,
  championSplashUrl,
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
      }
    });

    const unsubVis = window.electronAPI.onOverlayVisibilityChanged?.((payload) => {
      setOverlayVisible(payload.visible);
    });
    const unsubMeta = window.electronAPI.onOverlayMeta?.((payload) => {
      const meta = payload as { clickThrough?: boolean; hudScale?: number; mapScale?: number; chromeColor?: string };
      if (typeof meta.clickThrough === 'boolean') setOverlayClickThrough(meta.clickThrough);
      if (typeof meta.hudScale === 'number') setHudScale(meta.hudScale);
      if (typeof meta.mapScale === 'number') setMapScale(meta.mapScale);
      if (typeof meta.chromeColor === 'string') setChromeColor(meta.chromeColor);
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

  return (
    <div
      className="hud-app-shell text-chrome-silver font-sans selection:bg-chrome-silver/25 selection:text-chrome-ink overflow-x-hidden"
      style={{
        ['--chrome-user' as string]: normalizeChromeColor(chromeColor),
        ['--chrome-silver' as string]: normalizeChromeColor(chromeColor),
        ['--chrome-bright' as string]: normalizeChromeColor(chromeColor),
        ['--pyke-green' as string]: normalizeChromeColor(chromeColor),
      }}
    >
      {/* Site-matched atmosphere — CSS only, no filters / no extra layers that cost GPU */}
      <div className="app-atmosphere" aria-hidden />

      {/* Draggable Title Bar */}
      {window.electronAPI && (
        <div
          className="hud-titlebar h-10 flex items-center justify-between px-4 fixed top-0 left-0 right-0 z-50"
          style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
        >
          <div className="flex items-center gap-2.5 text-xs text-chrome-dim font-semibold">
            <ChromeMark size={14} className="text-chrome-silver shrink-0" />
            <span className="font-display tracking-[0.22em] uppercase text-chrome-bright">One Trick</span>
            <span className="text-chrome-dim/40">·</span>
            <img
              src={championSquareUrl(profile.championId)}
              alt=""
              width={16}
              height={16}
              className="hud-champ-icon hud-champ-icon--title"
              decoding="async"
              draggable={false}
            />
            <span className="font-mono text-[9px] tracking-[0.16em] uppercase text-chrome-dim">
              {profile.shortLabel}
            </span>
          </div>
          <div className="flex items-center gap-0.5" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <button
              onClick={handleMinimize}
              className="w-10 h-10 flex items-center justify-center hover:bg-white/5 transition-colors duration-150 text-chrome-dim hover:text-chrome-bright active:bg-white/10"
              title="Minimize"
            >
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="0" y1="6" x2="12" y2="6" />
              </svg>
            </button>
            <button
              onClick={handleMaximize}
              className="w-10 h-10 flex items-center justify-center hover:bg-white/5 transition-colors duration-150 text-chrome-dim hover:text-chrome-bright active:bg-white/10"
              title="Maximize / Restore"
            >
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="2" width="8" height="8" />
              </svg>
            </button>
            <button
              onClick={handleClose}
              className="w-10 h-10 flex items-center justify-center hover:bg-chrome-blood/30 transition-colors duration-150 text-chrome-dim hover:text-rose-300 active:bg-chrome-blood/40"
              title="Close"
            >
              <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="2" y1="2" x2="10" y2="10" />
                <line x1="10" y1="2" x2="2" y2="10" />
              </svg>
            </button>
          </div>
        </div>
      )}
      <div className={`app-content container mx-auto px-5 sm:px-6 pb-10 max-w-7xl ${window.electronAPI ? 'pt-16' : 'pt-6'}`}>
        <header className="hud-main-header mb-7 relative overflow-hidden">
          {/* Profile splash — CSS opacity only, no blur / no GPU filters */}
          <div
            className="hud-header-splash"
            style={{ backgroundImage: `url(${championSplashUrl(profile.championId)})` }}
            aria-hidden
          />
          <div className="hud-header-splash-fade" aria-hidden />

          <div className="relative z-[1] flex flex-wrap items-end justify-between gap-5 mb-5">
            <div className="flex items-center gap-4 min-w-0">
              <div className="hud-brand-mark shrink-0" aria-hidden>
                <ChromeMark size={28} className="text-chrome-silver" />
              </div>
              <div className="hud-profile-portrait shrink-0">
                <img
                  src={championSquareUrl(profile.championId)}
                  alt={profile.shortLabel}
                  width={56}
                  height={56}
                  decoding="async"
                  draggable={false}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-mono text-[10px] tracking-[0.28em] uppercase text-chrome-dim">
                    Windows · League of Legends
                  </span>
                  <span className="hud-chip hud-chip--quiet !py-0.5 !text-[8px]">v1.0.2</span>
                </div>
                <h1 className="hud-brand text-3xl md:text-5xl truncate leading-none">One Trick</h1>
                <p className="mt-2 font-mono text-[10px] tracking-[0.22em] uppercase text-chrome-dim/90">
                  {profile.label} · matchup doctrine · live overlay
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <div className="hud-profile-switch" role="group" aria-label="Champion profile">
                {PROFILES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProfileChange(p.id)}
                    className={`hud-profile-tab ${profileId === p.id ? 'is-active' : ''}`}
                    title={`Switch to ${p.label}`}
                  >
                    <img
                      src={championSquareUrl(p.championId)}
                      alt=""
                      width={18}
                      height={18}
                      className="hud-champ-icon"
                      decoding="async"
                      draggable={false}
                    />
                    {p.shortLabel}
                  </button>
                ))}
              </div>
              <div
                className={`hud-chip flex items-center gap-2 ${
                  overlayInGame
                    ? 'hud-accent-blood !text-chrome-bright'
                    : lcuConnected
                      ? 'hud-accent-green !text-chrome-bright'
                      : 'text-chrome-dim'
                }`}
              >
                <span className={`hud-status-dot ${overlayInGame || lcuConnected ? 'text-chrome-bright' : 'text-chrome-dim'}`} />
                {overlayInGame ? 'In Match' : lcuConnected ? 'Client Live' : 'Demo'}
              </div>
            </div>
          </div>

          <div className="chrome-rule relative z-[1] mb-4" />

          {window.electronAPI && (
            <div className="hud-toolbar-panel relative z-[1]">
              <div className="hud-toolbar">
              <button
                type="button"
                onClick={handleToggleOverlay}
                className={`hud-btn ${
                  overlayVisible
                    ? 'hud-btn--active'
                    : ''
                }`}
                title="Toggle in-game overlay (Ctrl+Shift+H)"
              >
                Overlay {overlayVisible ? 'On' : 'Off'}
                {overlayInGame ? ' · Live' : ''}
              </button>
              <button
                type="button"
                onClick={handleToggleClickThrough}
                className="hud-btn"
                title="Lock/unlock a compact movable overlay (Ctrl+Shift+U)"
              >
                {overlayClickThrough ? 'Locked · Pass-through' : 'Unlocked · Move'}
              </button>
              <label className="hud-scale-control" title="Match League Interface › HUD Scale (0–100)">
                <span>HUD {hudScale}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={hudScale}
                  onChange={(event) => void handleHudScaleChange(Number(event.target.value))}
                />
              </label>
              <label className="hud-scale-control" title="Match League Interface › Minimap Scale (0–100)">
                <span>Map {mapScale}</span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={mapScale}
                  onChange={(event) => void handleMapScaleChange(Number(event.target.value))}
                />
              </label>
              <button
                type="button"
                className="hud-btn"
                title="Read GlobalScale / MinimapScale from League game.cfg"
                onClick={() => void handleSyncLeagueScales()}
              >
                Sync LoL
              </button>
              <label className="chrome-color-control" title="Chrome frame + accent color">
                <span>Chrome</span>
                <input
                  type="color"
                  value={normalizeChromeColor(chromeColor)}
                  onChange={(event) => void handleChromeColorChange(event.target.value)}
                />
                <span className="chrome-color-presets">
                  {CHROME_COLOR_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`chrome-color-swatch${normalizeChromeColor(chromeColor) === preset.value.toLowerCase() ? ' is-active' : ''}`}
                      style={{ background: preset.value }}
                      title={preset.label}
                      onClick={() => void handleChromeColorChange(preset.value)}
                    />
                  ))}
                </span>
              </label>
              </div>
              <p className="hud-toolbar-hint">
                Borderless · Sync LoL then Align ·{' '}
                <strong>PageUp</strong> / <strong>PageDown</strong> Flash (Numpad 9/3) · Ctrl+Shift+U unlock · Ctrl+Shift+H hide
              </p>
            </div>
          )}
        </header>

        {/* In-match: main UI goes static — overlay owns CPU; avoid rebuild churn */}
        {overlayInGame ? (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
            <HudFrame accent="steel" label="Match Live" className="p-6 lg:col-span-5">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <ChromeMark size={28} className="opacity-70 text-chrome-silver" />
                  <div>
                    <h2 className="hud-heading text-xl text-chrome-bright">Overlay Active</h2>
                    <p className="text-xs text-chrome-dim font-mono tracking-wide mt-1">
                      Main window is parked to save FPS — the overlay owns the live HUD
                      (sums, wards, gank square, buy path). PageUp / PageDown toggle Flash
                      while League has focus (elevate One Trick if League is admin).
                    </p>
                  </div>
                </div>
                {analysis && (
                  <p className="text-xs text-chrome-dim/80 border-t border-white/10 pt-3">
                    Plan: <span className="text-chrome-bright">{analysis.title}</span> · {profile.label}
                  </p>
                )}
                <p className="text-[10px] font-mono text-chrome-dim/70">
                  Restore this window after the match for export / next lobby. Mid-game: watch the overlay.
                </p>
              </div>
            </HudFrame>
            <div className="lg:col-span-7">
              {enemyBotSummoners.length > 0 ? (
                <SummonerTimers lanes={enemyBotSummoners} accentColor={chromeColor} />
              ) : (
                <HudFrame accent="cyan" label="Sums" className="p-6">
                  <p className="text-sm text-chrome-dim font-mono">Waiting for enemy summoner data…</p>
                </HudFrame>
              )}
            </div>
          </div>
        ) : (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-7 relative">
          {/* Left Panel: Enemy Selection */}
          <div className="xl:col-span-3 space-y-5 animate-slide-in relative" style={{ zIndex: 100 }}>
            <HudFrame accent="green" label="Hostiles" className="p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-chrome-dim mb-1">01 — Draft</p>
              <h2 className="hud-heading text-xl text-chrome-bright mb-4">
                <ChromeMark size={14} className="text-chrome-silver inline-block align-[-2px] mr-1.5" /> Enemy Squad
              </h2>
              <p className="text-[10px] font-mono text-chrome-dim/75 mb-3 tracking-wide leading-relaxed">
                Auto-fills from champ select when the client is live.
              </p>
              <ChampionSelect
                champions={champions}
                selections={selections}
                onSelectionChange={handleSelectionChange}
                roles={['Top', 'Jungle', 'Mid', 'Bot', 'Support']}
                layout="stack"
              />
            </HudFrame>

            {enemyBotSummoners.length > 0 && (
              <SummonerTimers lanes={enemyBotSummoners} accentColor={chromeColor} />
            )}

            {/* Dominance Gauge */}
            {dominance && (
              <div className="animate-slide-in" style={{ animationDelay: '0.1s' }}>
                <DominanceGauge metrics={dominance} />
              </div>
            )}

            {/* Ally lanes relevant to active profile */}
            <HudFrame accent="cyan" label="Bond" className="p-5">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-chrome-dim mb-1">02 — Allies</p>
              <h2 className="hud-heading text-xl text-chrome-bright mb-4">
                <ChromeMark size={14} className="text-chrome-dim inline-block align-[-2px] mr-1.5" />{' '}
                {profile.id === 'yone-mid' ? 'Ally Jungle' : 'Ally Lanes'}
              </h2>
              <p className="text-[10px] font-mono text-chrome-dim/75 mb-3 tracking-wide leading-relaxed">
                {profile.id === 'yone-mid'
                  ? 'You are mid — matchup math uses your jungler, not another mid.'
                  : profile.id === 'pantheon-support'
                    ? 'ADC first — you play through them. Mid decides whether a roam is free.'
                    : 'ADC + mid for roam / 2v2 scoring.'}
              </p>
              <ChampionSelect
                champions={champions}
                selections={selections}
                onSelectionChange={handleSelectionChange}
                roles={profile.focusAllies}
                layout="stack"
              />
            </HudFrame>
          </div>

          {/* Right Panel: Build & Analysis */}
          <div className="xl:col-span-9 space-y-5 relative" style={{ zIndex: 1 }}>
            {build && runes && analysis ? (
              <BuildDisplay
                build={build}
                runes={runes}
                analysis={analysis}
                onExport={handleExport}
                canExport={lcuConnected}
                exportStatus={exportStatus}
                exportError={exportError}
                exportDetail={exportDetail}
                accentColor={chromeColor}
              />
            ) : (
              <HudFrame accent="steel" label="Standby" className="hud-standby min-h-[420px] p-10 sm:p-14 animate-fade-in">
                <div className="h-full flex flex-col items-center justify-center text-center text-chrome-dim max-w-md mx-auto">
                  <div className="hud-standby-mark mb-6">
                    <ChromeMark size={36} className="text-chrome-silver/70" />
                  </div>
                  <img
                    src={championSquareUrl(profile.championId)}
                    alt=""
                    width={64}
                    height={64}
                    className="mb-5 opacity-55 hud-champ-icon hud-champ-icon--xl"
                    decoding="async"
                    draggable={false}
                  />
                  <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-chrome-dim mb-2">Standby</p>
                  <p className="hud-heading text-2xl text-chrome-bright/90">Awaiting draft</p>
                  <p className="text-sm mt-3 text-chrome-dim/80 font-mono border-t border-white/10 pt-3 tracking-wide leading-relaxed">
                    Select enemies — or enter champ select — for {profile.label} doctrine, runes, and export.
                  </p>
                </div>
              </HudFrame>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

export default App;
