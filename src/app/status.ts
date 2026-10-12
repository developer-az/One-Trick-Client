import type { DraftState, LeagueState } from './hooks';
import { isDesktop } from './hooks';
import type { Tone } from './ui';

export interface LeagueStatus {
  tone: Tone;
  /** Two or three words for the titlebar pill. */
  short: string;
  /** One sentence saying what One Trick is doing right now. */
  detail: string;
  /** What the user should do next, if anything. */
  next: string | null;
  stage: 'preview' | 'offline' | 'connecting' | 'idle' | 'queue' | 'draft' | 'loading' | 'game' | 'post';
}

const QUEUE_PHASES = new Set(['Matchmaking', 'ReadyCheck']);
const LOADING_PHASES = new Set(['GameStart']);
const GAME_PHASES = new Set(['InProgress', 'Reconnect']);
const POST_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame']);

/** Single source of truth for "what is the app doing", shown everywhere. */
export function leagueStatus(league: LeagueState, draft: DraftState): LeagueStatus {
  if (!isDesktop) {
    return {
      stage: 'preview',
      tone: 'muted',
      short: 'Preview',
      detail: 'Browser preview. Live client features need the desktop app.',
      next: 'Pick enemies by hand on Champ select to see a loadout.',
    };
  }

  const lcu = league.lcu;
  const phase = lcu?.phase || null;

  if (league.inGame || (phase && GAME_PHASES.has(phase))) {
    return {
      stage: 'game',
      tone: 'live',
      short: 'In match',
      detail: 'Match running. The overlay is live and this window stays out of the way.',
      next: null,
    };
  }

  if (!lcu || lcu.state === 'searching') {
    return {
      stage: 'offline',
      tone: 'muted',
      short: 'Client closed',
      detail: 'Waiting for the League client. One Trick connects on its own when it opens.',
      next: 'Open League of Legends.',
    };
  }

  if (lcu.state === 'connecting') {
    return {
      stage: 'connecting',
      tone: 'warn',
      short: 'Connecting',
      detail: 'Found the League client, connecting to it.',
      next: null,
    };
  }

  if (draft.live || phase === 'ChampSelect') {
    return {
      stage: 'draft',
      tone: 'gold',
      short: 'Champ select',
      detail: draft.localLocked
        ? 'You are locked in. Your loadout is ready to send to the client.'
        : 'Champ select is live. Picks fill in as they happen.',
      next: draft.localLocked ? 'Export your runes and items.' : null,
    };
  }

  if (phase && LOADING_PHASES.has(phase)) {
    return {
      stage: 'loading',
      tone: 'live',
      short: 'Loading',
      detail: 'Loading into the match. The overlay appears when the game starts.',
      next: null,
    };
  }

  if (phase && QUEUE_PHASES.has(phase)) {
    return {
      stage: 'queue',
      tone: 'live',
      short: phase === 'ReadyCheck' ? 'Match found' : 'In queue',
      detail: 'In queue. Champ select opens here automatically.',
      next: null,
    };
  }

  if (phase && POST_PHASES.has(phase)) {
    return {
      stage: 'post',
      tone: 'live',
      short: 'Post game',
      detail: 'Match over. The board resets for your next lobby.',
      next: null,
    };
  }

  const who = lcu.summonerName ? ` as ${lcu.summonerName}` : '';
  return {
    stage: 'idle',
    tone: 'live',
    short: 'Client connected',
    detail: `Connected to the League client${who}.`,
    next: 'Queue up. Champ select fills in here automatically.',
  };
}
