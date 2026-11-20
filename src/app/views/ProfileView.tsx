/**
 * Profile (brief J) — the real shell for everything tied to the player account.
 *
 * Nothing here talks to Riot: the summoner header reads the League client's
 * connection state (the only account data the app already has), the pinned
 * champion section manages the orbit rail, and the Riot API section is a
 * visible, disabled placeholder so the next brief has a home. The key field
 * never stores or sends anything.
 */
import React, { useEffect, useState } from 'react';
import type { Champion } from '../../logic/pykeLogic';
import { isDesktop, type DraftState, type LeagueState } from '../hooks';
import type { ViewId } from '../App';
import { leagueStatus } from '../status';
import { IconArrowRight, IconInfo } from '../icons';
import { Badge, Button, Card, CardHeader, Portrait } from '../ui';
import { PinRail } from '../PinnedChampions';
import type { PinActions } from '../orbitLayout';
import type { BannerChampion } from '../ornaments';

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('') || '?';

export const ProfileView: React.FC<{
  league: LeagueState;
  draft: DraftState;
  champions: Champion[];
  pins: readonly string[];
  activePinId: string | null;
  activeChampion: BannerChampion | null;
  settings?: AppSettings | null;
  onOpenAppearance: () => void;
  pinActions: PinActions & { onPin: (id: string) => void };
  onNavigate: (view: ViewId) => void;
}> = ({
  league,
  draft,
  champions,
  pins,
  activePinId,
  activeChampion,
  settings,
  onOpenAppearance,
  pinActions,
  onNavigate,
}) => {
  const status = leagueStatus(league, draft);
  const [appVersion, setAppVersion] = useState('');
  useEffect(() => {
    window.electronAPI?.getAppVersion?.().then((v) => setAppVersion(v)).catch(() => undefined);
  }, []);
  const summoner = league.lcu?.summonerName || '';
  const connected = league.lcu?.state === 'connected';
  const activePinChampion = activeChampion
    ? champions.find((c) => c.id === activeChampion.id) || { id: activeChampion.id, name: activeChampion.name || '' }
    : null;

  return (
    <div className="ot-page ot-profile">
      <div className="ot-page-header">
        <div>
          <h1 className="ot-page-title ot-orn-title">Profile</h1>
          <p className="ot-page-sub">Your account, the champions you pin, and where league-wide data will live.</p>
        </div>
        <Badge tone={connected ? 'teal' : 'muted'}>{connected ? 'Client connected' : 'Client offline'}</Badge>
      </div>

      <Card className="ot-profile-head">
        <div className="ot-profile-identity">
          <span className="ot-profile-monogram" aria-hidden="true">
            {summoner ? initials(summoner) : '—'}
          </span>
          <div className="min-w-0">
            <div className="ot-profile-name truncate">{summoner || 'No summoner yet'}</div>
            <p className="ot-profile-sub">
              {summoner
                ? status.detail
                : isDesktop
                  ? 'No summoner yet. Sign in to the League client and it appears here.'
                  : 'Browser preview. Connect the desktop app to read your League client.'}
            </p>
          </div>
        </div>
        <dl className="ot-profile-facts">
          <div>
            <dt>Client</dt>
            <dd>{connected ? 'Connected' : 'Not connected'}</dd>
          </div>
          <div>
            <dt>Level</dt>
            <dd className="ot-faint" title="Needs the Riot API">Not linked</dd>
          </div>
          <div>
            <dt>Rank</dt>
            <dd className="ot-faint" title="Needs the Riot API">Not linked</dd>
          </div>
          <div>
            <dt>Active champion</dt>
            <dd>{activePinChampion?.name || 'None pinned'}</dd>
          </div>
        </dl>
      </Card>

      <div className="ot-profile-grid">
        <Card>
          <CardHeader
            title="Pinned champions"
            sub="The left arc of the disk. Click a pin to make it the champion the whole client is built around."
            action={<Badge tone="gold">{pins.length} / 6</Badge>}
          />
          {pins.length ? (
            <PinRail
              pins={pins}
              champions={champions}
              activeId={activePinId}
              onPick={pinActions.onPick}
              onUnpin={pinActions.onUnpin}
              onReorder={pinActions.onReorder}
              onPin={pinActions.onPin}
              manage
            />
          ) : (
            <div className="ot-profile-empty">
              <p>No pins yet. Add the champions you actually play — the disk keeps them one click away.</p>
              <div className="mt-3">
                <PinRail
                  pins={[]}
                  champions={champions}
                  activeId={activePinId}
                  onPick={pinActions.onPick}
                  onUnpin={pinActions.onUnpin}
                  onReorder={pinActions.onReorder}
                  onPin={pinActions.onPin}
                    />
              </div>
            </div>
          )}
          <div className="ot-profile-active">
            {activePinChampion ? (
              <>
                <Portrait champion={activePinChampion} size={36} ring="gold" />
                <div className="min-w-0">
                  <div className="ot-profile-active-name truncate">{activePinChampion.name || activePinChampion.id}</div>
                  <div className="ot-profile-active-sub">Active champion · backdrop, accent and hub</div>
                </div>
                <Button variant="secondary" iconAfter={<IconArrowRight />} onClick={() => onNavigate('loadout')}>
                  Open build
                </Button>
              </>
            ) : (
              <p className="ot-muted">Pin a champion to set the client's backdrop, accent and hub portrait.</p>
            )}
          </div>
        </Card>

        <Card className="ot-profile-riot">
          <CardHeader
            title="Riot API"
            sub="League-wide stats, rank history and champion mastery — coming soon."
            action={<Badge tone="amber">Not active</Badge>}
          />
          <label className="ot-profile-field">
            <span className="ot-profile-label">Riot API key</span>
            <input
              className="ot-input ot-profile-key"
              type="password"
              defaultValue=""
              placeholder="RGAPI-…"
              disabled
              aria-describedby="ot-riot-api-note"
            />
          </label>
          <div className="ot-profile-note" id="ot-riot-api-note">
            <IconInfo />
            <p>
              Coming soon: league-wide stats. One Trick does not accept, store or send a Riot API key yet — this field
              is disabled until that pipeline ships. Everything on this screen today comes from your own client.
            </p>
          </div>
          <Button variant="primary" disabled>
            Connect Riot API
          </Button>
        </Card>
      </div>

      <div className="ot-profile-grid">
        <Card>
          <CardHeader
            title="Appearance"
            sub="Theme, palette, accent, density, type scale, ornament and the dashboard pet."
            action={<Badge tone="gold">{settings?.appearance?.theme || 'gothic'}</Badge>}
          />
          <div className="ot-info-row">
            <span>Accent</span>
            <span>{settings?.appearance?.accent || 'chrome'}</span>
          </div>
          <div className="ot-info-row">
            <span>Density</span>
            <span>{settings?.appearance?.density || 'comfortable'}</span>
          </div>
          <div className="mt-3">
            <Button variant="primary" onClick={onOpenAppearance}>
              Open appearance
            </Button>
          </div>
        </Card>

        <Card>
          <CardHeader title="About" sub="Attribution and third-party licences." />
          <p className="ot-profile-about">
            {isDesktop ? 'Desktop' : 'Browser preview'} · not endorsed by Riot Games.
          </p>
          <p className="ot-profile-about">Version {appVersion ? `v${appVersion}` : ''}</p>
          <p className="ot-profile-about">
            Auto-clip plays FFmpeg 6.1.1 as a separate program. That build is GPL-3.0. License and source are in
            THIRD_PARTY_NOTICES.txt.
          </p>
        </Card>
      </div>
    </div>
  );
};
