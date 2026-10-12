import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCatalog, subscribeCatalog, warmCatalog, findChampionInCatalog } from '../catalog/client';
import type { CatalogBundle, CatalogRole } from '../catalog/types';
import { CATALOG_ROLES } from '../catalog/types';
import { roleFromLcuPosition } from '../catalog/roles';
import { ingestChampionCatalog } from '../data/championCatalog';
import { solveRoles } from '../logic/championPositions';
import type { Champion } from '../logic/pykeLogic';
import {
  genericProfileId,
  getProfile,
  isAuthoredProfileId,
  isGenericProfileId,
  isProfileId,
  loadStoredProfileId,
  parseGenericProfileId,
  storeProfileId,
  AUTHORED_PROFILES,
  type ChampionProfile,
  type ProfileId,
} from '../logic/profiles';
import type { OverlayBotSummoner } from '../overlay/overlayLogic';
import type { Toast } from './ui';
import { sendLoadout, type ExportResult } from './exporter';
import type { Loadout } from './views/LoadoutView';

export const isDesktop = typeof window !== 'undefined' && !!window.electronAPI;

/* ------------------------------------------------------------------ catalog */

function toChampion(c: CatalogBundle['champions'][number]): Champion {
  return { id: c.id, key: c.key, name: c.name, tags: c.tags, damageType: c.damageType };
}

/** Champion list + a stamp that changes whenever the catalog is replaced. */
export function useCatalog(): { champions: Champion[]; stamp: string; patch: string | null } {
  const [bundle, setBundle] = useState<CatalogBundle | null>(() => getCatalog());

  useEffect(() => {
    const unsub = subscribeCatalog(() => setBundle(getCatalog()));
    void warmCatalog({
      electronGet: async () => {
        const res = await window.electronAPI?.getCatalog?.();
        return (res?.catalog as CatalogBundle) || null;
      },
    }).then((b) => {
      if (b) setBundle(b);
    });
    return unsub;
  }, []);

  const champions = useMemo(() => {
    const list = (bundle?.champions || []).map(toChampion).sort((a, b) => a.name.localeCompare(b.name));
    if (list.length) ingestChampionCatalog(list);
    return list;
  }, [bundle]);

  return {
    champions,
    stamp: bundle ? `${bundle.manifest.patch}:${bundle.manifest.generatedAt}:${bundle.champions.length}` : '',
    patch: bundle?.manifest.patch || null,
  };
}

/* ------------------------------------------------------------- league state */

export interface LeagueState {
  lcu: LcuStatus | null;
  inGame: boolean;
  enemySummoners: OverlayBotSummoner[];
  /** Live-reported champion of the local player (in game). */
  liveChampionName: string | null;
  liveProfileHint: string | null;
}

export function useLeague(): LeagueState {
  const [lcu, setLcu] = useState<LcuStatus | null>(null);
  const [inGame, setInGame] = useState(false);
  const [enemySummoners, setEnemySummoners] = useState<OverlayBotSummoner[]>([]);
  const [liveChampionName, setLiveChampionName] = useState<string | null>(null);
  const [liveProfileHint, setLiveProfileHint] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;
    void api.getLcuStatus?.().then(setLcu);
    const unsubLcu = api.onLcuStatus?.(setLcu);
    void api.getOverlayStatus?.().then((res) => {
      if (res?.success) setInGame(!!res.inGame);
    });
    const unsubUpdate = api.onOverlayUpdate?.((payload) => {
      const data = payload as {
        inGame?: boolean;
        enemyBotSummoners?: OverlayBotSummoner[];
        profileHint?: string | null;
        localPlayer?: { championName?: string } | null;
      };
      if (typeof data.inGame === 'boolean') {
        setInGame(data.inGame);
        if (!data.inGame) {
          setLiveChampionName(null);
          setLiveProfileHint(null);
        }
      }
      if (Array.isArray(data.enemyBotSummoners)) setEnemySummoners(data.enemyBotSummoners);
      if (data.localPlayer?.championName) setLiveChampionName(data.localPlayer.championName);
      if (typeof data.profileHint === 'string') setLiveProfileHint(data.profileHint);
    });
    return () => {
      unsubLcu?.();
      unsubUpdate?.();
    };
  }, []);

  return { lcu, inGame, enemySummoners, liveChampionName, liveProfileHint };
}

/* -------------------------------------------------------------------- draft */

export type Role = CatalogRole;
export const ROLES: Role[] = CATALOG_ROLES;

export interface DraftMember {
  key: string;
  champion: Champion | null;
  role: Role | null;
  isLocal: boolean;
  /** Hovered but not locked (ally pick intent). */
  hovering: boolean;
}

export interface DraftState {
  /** True while the client reports a champ select session. */
  live: boolean;
  timerPhase: string | null;
  ally: Record<Role, DraftMember | null>;
  enemy: Record<Role, DraftMember | null>;
  localRole: Role | null;
  localChampion: Champion | null;
  localLocked: boolean;
  bans: { ally: Champion[]; enemy: Champion[] };
}

interface SessionMember {
  cellId?: number;
  championId?: number;
  championPickIntent?: number;
  assignedPosition?: string;
}

interface Session {
  myTeam?: SessionMember[];
  theirTeam?: SessionMember[];
  localPlayerCellId?: number;
  bans?: { myTeamBans?: number[]; theirTeamBans?: number[] };
  timer?: { phase?: string };
  actions?: Array<Array<{ actorCellId?: number; type?: string; completed?: boolean }>>;
}

const emptyRoles = (): Record<Role, DraftMember | null> => ({
  Top: null,
  Jungle: null,
  Mid: null,
  Bot: null,
  Support: null,
});

function byKey(champions: Champion[], id: number | undefined): Champion | null {
  if (!id || id <= 0) return null;
  return champions.find((c) => c.key === String(id)) || null;
}

function placeTeam(
  members: SessionMember[],
  champions: Champion[],
  localCellId: number | undefined,
  useAssigned: boolean,
  localLocked: boolean
): Record<Role, DraftMember | null> {
  const rows = members.map((m, i) => {
    const locked = byKey(champions, m.championId);
    const intent = byKey(champions, m.championPickIntent);
    const isLocal = localCellId !== undefined && m.cellId === localCellId;
    const champion = locked || intent;
    return {
      key: `cell-${m.cellId ?? i}`,
      champion,
      hovering: !locked && !!intent,
      isLocal,
      knownRole: useAssigned ? roleFromLcuPosition(m.assignedPosition) : null,
      locked: isLocal ? localLocked : !!locked,
    };
  });
  const roles = solveRoles(
    rows
      .filter((r) => r.champion || r.knownRole)
      .map((r) => ({
        key: r.key,
        championId: r.champion?.id || '',
        tags: r.champion?.tags || [],
        knownRole: r.knownRole,
      }))
  );
  const out = emptyRoles();
  for (const r of rows) {
    const role = roles.get(r.key);
    if (!role || out[role]) continue;
    out[role] = { key: r.key, champion: r.champion, role, isLocal: r.isLocal, hovering: r.hovering };
  }
  return out;
}

function parseSession(session: Session | null, champions: Champion[]): DraftState | null {
  if (!session || !champions.length) return null;
  const local = session.localPlayerCellId;
  const me = (session.myTeam || []).find((m) => m.cellId === local);
  const myPickDone = (session.actions || [])
    .flat()
    .some((a) => a.actorCellId === local && a.type === 'pick' && a.completed);
  const ally = placeTeam(session.myTeam || [], champions, local, true, myPickDone);
  const enemy = placeTeam(session.theirTeam || [], champions, undefined, false, true);
  const localRole = (Object.keys(ally) as Role[]).find((r) => ally[r]?.isLocal) || roleFromLcuPosition(me?.assignedPosition);
  const localChampion = byKey(champions, me?.championId) || byKey(champions, me?.championPickIntent);
  const bans = {
    ally: (session.bans?.myTeamBans || []).map((id) => byKey(champions, id)).filter((c): c is Champion => !!c),
    enemy: (session.bans?.theirTeamBans || []).map((id) => byKey(champions, id)).filter((c): c is Champion => !!c),
  };
  return {
    live: true,
    timerPhase: session.timer?.phase || null,
    ally,
    enemy,
    localRole: localRole || null,
    localChampion,
    localLocked: myPickDone || !!(me?.championId && me.championId > 0),
    bans,
  };
}

export interface DraftApi {
  draft: DraftState;
  setManual: (side: 'ally' | 'enemy', role: Role, champion: Champion | null) => void;
  clearManual: () => void;
}

/** Champ select board: live from the client, editable by hand when not in a lobby. */
export function useDraft(champions: Champion[], inGame: boolean): DraftApi {
  const [session, setSession] = useState<Session | null>(null);
  const [manual, setManualState] = useState<{ ally: Partial<Record<Role, Champion | null>>; enemy: Partial<Record<Role, Champion | null>> }>(
    { ally: {}, enemy: {} }
  );
  // The last session seen, kept through loading and the match itself.
  const [lastSession, setLastSession] = useState<Session | null>(null);

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onChampSelect) return;
    const apply = (next: unknown) => {
      const s = (next as Session) || null;
      setSession(s);
      if (s) setLastSession(s);
    };
    void api.getChampSelect?.().then((res) => apply(res?.session ?? null));
    return api.onChampSelect(apply);
  }, []);

  // A fresh lobby starts clean; hand edits from the last one would be stale.
  // After a match the next lobby should start empty too.
  const sessionActive = !!session;
  const [prev, setPrev] = useState({ sessionActive, inGame });
  if (prev.sessionActive !== sessionActive || prev.inGame !== inGame) {
    setPrev({ sessionActive, inGame });
    if (sessionActive && !prev.sessionActive) setManualState({ ally: {}, enemy: {} });
    if (prev.inGame && !inGame) {
      setLastSession(null);
      setManualState({ ally: {}, enemy: {} });
    }
  }

  const liveDraft = useMemo(() => parseSession(session, champions), [session, champions]);
  const lastLive = useMemo(() => parseSession(lastSession, champions), [lastSession, champions]);
  // Keep the board from the last champ select visible through loading/in-game.
  const base = liveDraft || (inGame ? lastLive : null);

  const draft = useMemo<DraftState>(() => {
    const ally = base ? { ...base.ally } : emptyRoles();
    const enemy = base ? { ...base.enemy } : emptyRoles();
    for (const role of ROLES) {
      if (role in manual.ally) {
        const c = manual.ally[role] || null;
        ally[role] = c ? { key: `manual-ally-${role}`, champion: c, role, isLocal: ally[role]?.isLocal || false, hovering: false } : null;
      }
      if (role in manual.enemy) {
        const c = manual.enemy[role] || null;
        enemy[role] = c ? { key: `manual-enemy-${role}`, champion: c, role, isLocal: false, hovering: false } : null;
      }
    }
    return {
      live: !!liveDraft,
      timerPhase: base?.timerPhase || null,
      ally,
      enemy,
      localRole: base?.localRole || null,
      localChampion: base?.localChampion || null,
      localLocked: base?.localLocked || false,
      bans: base?.bans || { ally: [], enemy: [] },
    };
  }, [base, liveDraft, manual]);

  const setManual = useCallback((side: 'ally' | 'enemy', role: Role, champion: Champion | null) => {
    setManualState((prev) => ({ ...prev, [side]: { ...prev[side], [role]: champion } }));
  }, []);
  const clearManual = useCallback(() => setManualState({ ally: {}, enemy: {} }), []);

  return { draft, setManual, clearManual };
}

/* ------------------------------------------------------------------ profile */

/** Normalise a profile id coming from the live game (display names → catalog ids). */
function normaliseProfileId(raw: string | null): ProfileId | null {
  if (!raw) return null;
  if (isAuthoredProfileId(raw)) return raw;
  const parsed = isGenericProfileId(raw) ? parseGenericProfileId(raw) : null;
  if (!parsed) return null;
  const hit = findChampionInCatalog(getCatalog(), { id: parsed.championId, name: parsed.championId });
  if (!hit) return null;
  const authored = AUTHORED_PROFILES.find((p) => p.championId === hit.id);
  return authored ? authored.id : genericProfileId(hit.id, parsed.role);
}

export function profileIdFor(champion: Champion, role: Role | null): ProfileId {
  const authored = AUTHORED_PROFILES.find((p) => p.championId === champion.id);
  if (authored && (!role || authored.role === role)) return authored.id;
  if (authored && role) return genericProfileId(champion.id, role);
  return genericProfileId(champion.id, role || 'Mid');
}

/**
 * Active champion profile. Follows your champ select pick and the live game
 * automatically; manual choice sticks until the next pick.
 */
export function useProfile(draft: DraftState, league: LeagueState, catalogStamp: string) {
  const [profileId, setProfileId] = useState<ProfileId>(() =>
    typeof window !== 'undefined' ? loadStoredProfileId() : 'pyke-support'
  );
  useEffect(() => storeProfileId(profileId), [profileId]);

  // Follow your champ select pick, and the champion the live game reports.
  // Both are derived during render so a manual choice sticks until they change.
  const pickChampion = draft.live ? draft.localChampion : null;
  const pickKey = pickChampion ? `${pickChampion.id}:${draft.localRole || ''}` : '';
  const liveHint = league.inGame ? league.liveProfileHint : null;
  const hintKey = liveHint ? `${liveHint}|${catalogStamp}` : '';
  const [seen, setSeen] = useState({ pickKey: '', hintKey: '' });
  if (seen.pickKey !== pickKey || seen.hintKey !== hintKey) {
    setSeen({ pickKey, hintKey });
    if (pickChampion && pickKey !== seen.pickKey) {
      setProfileId(profileIdFor(pickChampion, draft.localRole));
    } else if (hintKey && hintKey !== seen.hintKey) {
      const id = normaliseProfileId(liveHint);
      if (id && isProfileId(id)) setProfileId(id);
    }
  }

  // Rebuild generic profiles once the catalog arrives (they're stubs before that).
  const profile = useMemo(() => getProfile(profileId), [profileId, catalogStamp]); // eslint-disable-line react-hooks/exhaustive-deps

  return { profileId, profile, setProfileId };
}

/* ------------------------------------------------------------------- toasts */


export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (toast: Omit<Toast, 'id'>, ttlMs = 5000) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-3), { ...toast, id }]);
      if (ttlMs > 0) window.setTimeout(() => dismiss(id), ttlMs);
    },
    [dismiss]
  );
  return { toasts, push, dismiss };
}

/* ------------------------------------------------------------- app settings */

// One copy for the whole renderer, so a switch flipped on one screen is seen
// everywhere (auto-import reads it from the shell).
let settingsCache: AppSettings | null = null;
let restartPending = false;
const settingsListeners = new Set<() => void>();
const emitSettings = () => settingsListeners.forEach((l) => l());
let settingsLoad: Promise<void> | null = null;

export function useAppSettings() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    settingsListeners.add(listener);
    if (!settingsCache && !settingsLoad) {
      settingsLoad = Promise.resolve(window.electronAPI?.getAppSettings?.()).then((next) => {
        if (next) {
          settingsCache = next;
          emitSettings();
        }
      });
    }
    return () => {
      settingsListeners.delete(listener);
    };
  }, []);

  const update = useCallback((patch: Partial<AppSettings>) => {
    if (settingsCache) settingsCache = { ...settingsCache, ...patch };
    emitSettings();
    void window.electronAPI?.setAppSettings?.(patch).then((res) => {
      settingsCache = res.settings;
      if (res.restartRequired) restartPending = true;
      emitSettings();
    });
  }, []);

  return { settings: settingsCache, update, restartRequired: restartPending };
}

/* -------------------------------------------------------------- auto import */

/**
 * Sends runes and items to the client once you lock in, and again whenever
 * the enemy team changes after that. Waits for picks to settle first so a
 * fast enemy lock-in sequence becomes one export, not five.
 */
export function useAutoImport(args: {
  draft: DraftState;
  profile: ChampionProfile;
  loadout: Loadout | null;
  settings: AppSettings | null;
  onResult: (res: ExportResult, first: boolean) => void;
}) {
  const { draft, profile, loadout, settings, onResult } = args;
  const lastKey = useRef('');
  const spellsDone = useRef(false);
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  const enabled = !!settings?.autoImport && draft.live && draft.localLocked && !!loadout;
  const enemyKey = ROLES.map((r) => draft.enemy[r]?.champion?.id || '-').join(',');
  const key = enabled ? `${profile.id}|${enemyKey}|${loadout!.runes.selectedPerkIds.join('.')}` : '';
  const autoSpells = !!settings?.autoSpells;

  useEffect(() => {
    if (!draft.live) {
      lastKey.current = '';
      spellsDone.current = false;
    }
  }, [draft.live]);

  useEffect(() => {
    if (!key || key === lastKey.current || !loadout) return;
    const timer = window.setTimeout(() => {
      const first = lastKey.current === '';
      lastKey.current = key;
      const withSpells = autoSpells && !spellsDone.current;
      void sendLoadout(profile, loadout, { spells: withSpells }).then((res) => {
        if (res.ok && withSpells) spellsDone.current = true;
        onResultRef.current(res, first);
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [key, loadout, profile, autoSpells]);
}

/* ------------------------------------------------------------ match history */

interface HistoryState {
  games: MatchSummary[] | null;
  loading: boolean;
  error: string | null;
  loadedAt: number;
}
let historyState: HistoryState = { games: null, loading: false, error: null, loadedAt: 0 };
const historyListeners = new Set<() => void>();
function setHistory(next: Partial<HistoryState>) {
  historyState = { ...historyState, ...next };
  historyListeners.forEach((l) => l());
}

function loadHistory() {
  const api = window.electronAPI;
  if (!api?.getMatchHistory || historyState.loading) return;
  setHistory({ loading: true, error: null });
  void api
    .getMatchHistory()
    .then((res) =>
      setHistory({
        loading: false,
        games: res.success ? res.games : historyState.games,
        error: res.success ? null : res.error || 'Could not read match history',
        loadedAt: Date.now(),
      })
    )
    .catch((e: Error) => setHistory({ loading: false, error: e.message }));
}

/**
 * Your recent games, shared by every screen. Loads when first needed while the
 * client is connected and not in a match, and again after each match ends.
 */
export function useMatchHistory(league: LeagueState, wanted: boolean) {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    historyListeners.add(l);
    return () => {
      historyListeners.delete(l);
    };
  }, []);

  const connected = league.lcu?.state === 'connected';
  const inGame = league.inGame;
  const wasInGame = useRef(inGame);
  useEffect(() => {
    // A finished match adds a game, so the cached list is stale.
    if (wasInGame.current && !inGame) historyState = { ...historyState, loadedAt: 0 };
    wasInGame.current = inGame;
    if (!wanted || !connected || inGame) return;
    // Otherwise the list only changes when a game ends.
    if (historyState.games && Date.now() - historyState.loadedAt < 10 * 60_000) return;
    loadHistory();
  }, [wanted, connected, inGame]);

  return { ...historyState, reload: loadHistory };
}
