import React, { useState } from 'react';
import type { CatalogRole } from '../../catalog/types';
import { championSplashUrl } from '../../data/ddragonAssets';
import type { Champion } from '../../logic/pykeLogic';
import { AUTHORED_PROFILES, isAuthoredProfileId, type ChampionProfile, type ProfileId } from '../../logic/profiles';
import type { ViewId } from '../App';
import { ROLES, isDesktop, useAppSettings, type DraftState, type LeagueState } from '../hooks';
import { IconArrowRight } from '../icons';
import { SpellTimers } from '../SpellTimers';
import type { LeagueStatus } from '../status';
import { Badge, Card, CardHeader, ChampionCombobox, Pill, Portrait, SettingRow, Switch } from '../ui';

const STAGE_TITLE: Record<LeagueStatus['stage'], string> = {
  preview: 'Browser preview',
  offline: 'Waiting for League',
  connecting: 'Connecting',
  idle: 'Ready when you are',
  queue: 'In queue',
  draft: 'Champ select is live',
  loading: 'Loading into the match',
  game: 'Match in progress',
  post: 'Match over',
};

export const HomeView: React.FC<{
  league: LeagueState;
  status: LeagueStatus;
  draft: DraftState;
  profile: ChampionProfile;
  champions: Champion[];
  onSelectChampion: (champion: Champion, role: CatalogRole) => void;
  onSelectProfile: (id: ProfileId) => void;
  onNavigate: (view: ViewId) => void;
}> = ({ league, status, draft, profile, champions, onSelectChampion, onSelectProfile, onNavigate }) => {
  const { settings, update } = useAppSettings();
  const [role, setRole] = useState<CatalogRole>(profile.role);
  const profileChampion = champions.find((c) => c.id === profile.championId) || {
    id: profile.championId,
    name: profile.shortLabel,
    key: String(profile.championKey),
    tags: [],
  };
  const authored = isAuthoredProfileId(profile.id);

  const cta =
    status.stage === 'draft' ? (
      <button type="button" className="ot-btn ot-btn-primary" onClick={() => onNavigate('draft')}>
        Open champ select <IconArrowRight />
      </button>
    ) : status.stage === 'preview' ? (
      <button type="button" className="ot-btn" onClick={() => onNavigate('draft')}>
        Try the draft board <IconArrowRight />
      </button>
    ) : null;

  return (
    <div className="ot-page">
      <Card className="ot-hero mb-5">
        <div className="ot-splash" aria-hidden>
          <img
            src={championSplashUrl(profile.championId)}
            alt=""
            onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')}
          />
        </div>
        <div className="flex flex-wrap items-end justify-between gap-6 py-2">
          <div className="min-w-0 max-w-xl">
            <Pill tone={status.tone}>{status.short}</Pill>
            <h1 className="ot-page-title mt-3">{STAGE_TITLE[status.stage]}</h1>
            <p className="mt-2 ot-muted leading-relaxed">{status.detail}</p>
            {status.next ? (
              <p className="mt-3 text-sm">
                <span className="ot-faint">Next: </span>
                {status.next}
              </p>
            ) : null}
          </div>
          {cta}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader
            title="Your champion"
            sub="Follows your champ select pick automatically. Set it here for practice or to plan ahead."
          />
          <div className="flex items-center gap-4 mb-5">
            <Portrait champion={profileChampion} size={64} ring="gold" />
            <div className="min-w-0">
              <div className="ot-card-heading truncate">{profile.label}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge tone="gold">{profile.role}</Badge>
                {authored ? <Badge tone="teal">Hand-tuned doctrine</Badge> : <Badge>Catalog build</Badge>}
              </div>
            </div>
          </div>

          <div className="ot-sidebar-label !px-0">Hand-tuned</div>
          <div className="flex flex-wrap gap-2 mb-4">
            {AUTHORED_PROFILES.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`ot-btn ot-btn-sm ${profile.id === p.id ? '!border-[color:var(--ot-gold)]' : ''}`}
                onClick={() => onSelectProfile(p.id)}
                aria-pressed={profile.id === p.id}
              >
                <Portrait champion={champions.find((c) => c.id === p.championId) || { id: p.championId, name: p.shortLabel }} size={20} />
                {p.label}
              </button>
            ))}
          </div>

          <div className="ot-sidebar-label !px-0">Any champion</div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[220px]">
              <ChampionCombobox
                champions={champions}
                value={null}
                onChange={(c) => c && onSelectChampion(c, role)}
                placeholder={champions.length ? 'Search a champion' : 'Loading champions'}
                disabled={!champions.length}
              />
            </div>
            <div className="ot-segment" role="group" aria-label="Role">
              {ROLES.map((r) => (
                <button key={r} type="button" className={role === r ? 'is-active' : ''} onClick={() => setRole(r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </Card>

        <div className="lg:col-span-2 space-y-5">
          {league.inGame && league.enemySummoners.length ? (
            <Card>
              <CardHeader title="Enemy summoners" sub="Click a spell when you see it used." />
              <SpellTimers lanes={league.enemySummoners} />
            </Card>
          ) : null}

          <Card>
            <CardHeader title="In-game overlay" />
            {isDesktop ? (
              <SettingRow
                title="Show the overlay in matches"
                hint="Off means nothing is drawn over League."
                control={
                  <Switch
                    label="Overlay"
                    checked={!!settings?.overlayEnabled}
                    disabled={!settings}
                    onChange={(v) => update({ overlayEnabled: v })}
                  />
                }
              />
            ) : (
              <p className="text-sm ot-muted">Available in the desktop app.</p>
            )}
            <button type="button" className="ot-btn ot-btn-ghost ot-btn-sm mt-2 -ml-2" onClick={() => onNavigate('overlay')}>
              Customise overlay <IconArrowRight />
            </button>
          </Card>

          <Card>
            <CardHeader title="Hotkeys" sub="Work while League has focus." />
            <dl className="space-y-2.5 text-sm">
              <Hotkey keys={['Page Up']} alt="Num 9" label="Enemy ADC used Flash" />
              <Hotkey keys={['Page Down']} alt="Num 3" label="Enemy support used Flash" />
              <Hotkey keys={['Ctrl', 'Shift', 'H']} label="Show or hide overlay" />
              <Hotkey keys={['Ctrl', 'Shift', 'U']} label="Unlock overlay to move it" />
            </dl>
          </Card>

          {draft.live ? null : (
            <p className="text-xs ot-faint px-1 leading-relaxed">
              Builds and matchup notes are heuristics from champion classes and the authored doctrines, not
              win-rate data.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

const Hotkey: React.FC<{ keys: string[]; alt?: string; label: string }> = ({ keys, alt, label }) => (
  <div className="flex items-center justify-between gap-4">
    <dt className="ot-muted">{label}</dt>
    <dd className="flex gap-1 flex-none">
      {keys.map((k) => (
        <kbd key={k} className="ot-kbd">
          {k}
        </kbd>
      ))}
      {alt ? (
        <>
          <span className="ot-faint text-xs self-center px-0.5">or</span>
          <kbd className="ot-kbd">{alt}</kbd>
        </>
      ) : null}
    </dd>
  </div>
);
