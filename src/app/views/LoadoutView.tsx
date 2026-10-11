import React, { useState } from 'react';
import { getRuneIconUrl, getRuneMeta, getStyleMeta } from '../../data/runeService';
import type { Build, DominanceMetrics, Item as BuildItem, MatchupAnalysis, RunePage } from '../../logic/pykeLogic';
import type { ChampionProfile } from '../../logic/profiles';
import type { ViewId } from '../App';
import { IconArrowRight, IconLoadout, IconUpload } from '../icons';
import { Badge, Card, CardHeader, EmptyState, Item, type Toast } from '../ui';

export interface Loadout {
  build: Build;
  runes: RunePage;
  analysis: MatchupAnalysis;
  dominance: DominanceMetrics;
}

export const LoadoutView: React.FC<{
  profile: ChampionProfile;
  loadout: Loadout | null;
  connected: boolean;
  onNavigate: (view: ViewId) => void;
  onToast: (toast: Omit<Toast, 'id'>) => void;
}> = ({ profile, loadout, connected, onNavigate, onToast }) => {
  const [busy, setBusy] = useState(false);

  if (!loadout) {
    return (
      <div className="ot-page">
        <div className="ot-page-header">
          <div>
            <h1 className="ot-page-title">Build & runes</h1>
            <p className="ot-page-sub">{profile.label}</p>
          </div>
        </div>
        <Card>
          <EmptyState
            icon={<IconLoadout size={28} />}
            title="No enemies yet"
            body="Runes and items are tailored to the enemy team. They appear as soon as one enemy is known, either from champ select or added by hand."
            action={
              <button type="button" className="ot-btn" onClick={() => onNavigate('draft')}>
                Go to champ select <IconArrowRight />
              </button>
            }
          />
        </Card>
      </div>
    );
  }

  const { build, runes } = loadout;

  const exportToClient = async () => {
    const api = window.electronAPI;
    if (!api) return;
    setBusy(true);
    try {
      if (runes.selectedPerkIds.length !== 9) {
        throw new Error(`Rune page is incomplete (${runes.selectedPerkIds.length} of 9 runes).`);
      }
      const runeRes = await api.exportRunePage({
        name: profile.runePageName,
        primaryStyleId: runes.primaryStyleId,
        subStyleId: runes.subStyleId,
        selectedPerkIds: [...runes.selectedPerkIds],
        current: true,
      });
      if (!runeRes.success) throw new Error(runeRes.error || 'The client rejected the rune page.');

      const itemRes = await api.exportItemSet({
        starter: build.starter,
        core: build.core,
        boots: build.boots,
        situational: build.situational,
        buildPath: build.buildPath,
        championKey: profile.championKey,
        title: profile.itemSetTitle,
      });
      if (!itemRes?.success) {
        onToast({ tone: 'bad', title: 'Runes sent, items failed', body: itemRes?.error || 'Item set export failed.' });
        return;
      }
      onToast({
        tone: 'good',
        title: 'Sent to the League client',
        body: `Rune page "${profile.runePageName}" and item set "${profile.itemSetTitle}".`,
      });
    } catch (error) {
      onToast({ tone: 'bad', title: 'Export failed', body: (error as Error).message || 'Unknown error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ot-page">
      <div className="ot-page-header">
        <div>
          <h1 className="ot-page-title">Build & runes</h1>
          <p className="ot-page-sub">
            {profile.label} into this enemy team. Hover anything to see why it was picked.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            className="ot-btn ot-btn-primary ot-btn-lg"
            disabled={!connected || busy}
            onClick={() => void exportToClient()}
            title={connected ? 'Create the rune page and item set in the client' : 'Open the League client first'}
          >
            <IconUpload />
            {busy ? 'Sending' : 'Send to client'}
          </button>
          {!connected ? <span className="text-xs ot-faint">Needs the League client open</span> : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <RunePanel runes={runes} />
        </Card>

        <div className="lg:col-span-3 space-y-5">
          <Card>
            <CardHeader title="Build order" />
            <div className="flex flex-wrap items-center gap-2">
              {build.buildPath.map((item, i) => (
                <React.Fragment key={`${item.id}-${i}`}>
                  {i > 0 ? <IconArrowRight className="ot-step-arrow" /> : null}
                  <Item id={item.id} name={item.name} size={44} title={itemTitle(item)} />
                </React.Fragment>
              ))}
            </div>
            <div className="ot-divider my-4" />
            <div className="grid gap-5 sm:grid-cols-2">
              <ItemGroup title="Start" items={build.starter} />
              <ItemGroup title="Boots" items={[build.boots]} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Core items" />
            <ItemList items={build.core} />
          </Card>

          {build.situational.length ? (
            <Card>
              <CardHeader title="Situational" sub="Swap in when the game asks for it." />
              <ItemList items={build.situational} />
            </Card>
          ) : null}

          {build.spells.length ? (
            <Card>
              <CardHeader title="Summoner spells" />
              <div className="flex gap-2">
                {build.spells.map((s) => (
                  <Badge key={s} tone="gold">
                    {s}
                  </Badge>
                ))}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
};

function itemTitle(item: BuildItem): string {
  return item.reason ? `${item.name}: ${item.reason}` : item.name;
}

const ItemGroup: React.FC<{ title: string; items: BuildItem[] }> = ({ title, items }) => (
  <div>
    <div className="text-xs ot-faint uppercase tracking-wide mb-2">{title}</div>
    <div className="flex flex-wrap gap-2">
      {items.map((item, i) => (
        <Item key={`${item.id}-${i}`} id={item.id} name={item.name} size={40} title={itemTitle(item)} />
      ))}
    </div>
  </div>
);

const ItemList: React.FC<{ items: BuildItem[] }> = ({ items }) => (
  <ul className="space-y-3">
    {items.map((item, i) => (
      <li key={`${item.id}-${i}`} className="flex items-start gap-3">
        <Item id={item.id} name={item.name} size={40} />
        <div className="min-w-0">
          <div className="text-[15px] font-medium">{item.name}</div>
          {item.reason ? <div className="text-sm ot-muted leading-relaxed">{item.reason}</div> : null}
        </div>
      </li>
    ))}
  </ul>
);

const RuneIcon: React.FC<{ id: number; size: number; keystone?: boolean }> = ({ id, size, keystone }) => {
  const meta = getRuneMeta(id);
  return (
    <span className={`ot-rune ${keystone ? 'ot-rune-keystone' : ''}`} style={{ width: size, height: size }}>
      <img
        src={meta.icon}
        alt=""
        onError={(e) => {
          const img = e.target as HTMLImageElement;
          const fallback = getRuneIconUrl(id);
          if (img.src !== fallback) img.src = fallback;
          else img.style.visibility = 'hidden';
        }}
      />
    </span>
  );
};

/** Reasons are written as "Rune Name: why"; the name is already shown. */
function stripName(reason: string | undefined, name: string): string | undefined {
  if (!reason) return reason;
  const prefix = `${name}:`;
  return reason.startsWith(prefix) ? reason.slice(prefix.length).trim() : reason;
}

const RuneRow: React.FC<{ id: number; reason?: string; keystone?: boolean; size?: number }> = ({
  id,
  reason,
  keystone,
  size = 34,
}) => (
  <li className="flex items-start gap-3" title={reason}>
    <RuneIcon id={id} size={keystone ? 52 : size} keystone={keystone} />
    <div className="min-w-0 pt-1">
      <div className={keystone ? 'ot-card-heading' : 'text-[15px] font-medium'}>{getRuneMeta(id).name}</div>
      {reason ? <div className="text-sm ot-muted leading-snug">{stripName(reason, getRuneMeta(id).name)}</div> : null}
    </div>
  </li>
);

const RunePanel: React.FC<{ runes: RunePage }> = ({ runes }) => {
  const perks = runes.selectedPerkIds;
  const [keystone, ...rest] = perks;
  const primary = rest.slice(0, 3);
  const secondary = rest.slice(3, 5);
  const shards = rest.slice(5, 8);
  return (
    <>
      <CardHeader title="Runes" sub={`${getStyleMeta(runes.primaryStyleId).name} with ${getStyleMeta(runes.subStyleId).name}`} />
      <ul className="space-y-3">
        {keystone ? <RuneRow id={keystone} reason={runes.reasons[keystone]} keystone /> : null}
        {primary.map((id) => (
          <RuneRow key={id} id={id} reason={runes.reasons[id]} />
        ))}
      </ul>
      <div className="ot-divider my-4" />
      <ul className="space-y-3">
        {secondary.map((id) => (
          <RuneRow key={id} id={id} reason={runes.reasons[id]} />
        ))}
      </ul>
      {shards.length ? (
        <>
          <div className="ot-divider my-4" />
          <div className="flex flex-wrap gap-3">
            {shards.map((id, i) => (
              <span key={`${id}-${i}`} className="flex items-center gap-2 text-sm ot-muted">
                <RuneIcon id={id} size={24} />
                {getRuneMeta(id).name}
              </span>
            ))}
          </div>
        </>
      ) : null}
    </>
  );
};
