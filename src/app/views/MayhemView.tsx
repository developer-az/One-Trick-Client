import React, { useEffect, useMemo, useState } from 'react';
import { isDesktop } from '../hooks';
import type { Champion } from '../../logic/pykeLogic';
import { findAugment, rankMayhemChoices, searchAugments, suggestMayhemAugments } from '../../logic/mayhem';
import type { MayhemAugment } from '../../logic/mayhem/types';
import { useMayhemBundle } from '../mayhem/useMayhemBundle';
import { Badge, Card, CardHeader, EmptyState, Portrait } from '../ui';

const OWNED_KEY = 'onetrick.mayhem.owned';
const ROLL_KEY = 'onetrick.mayhem.roll';

function loadIds(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function saveIds(key: string, ids: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

const RarityBadge: React.FC<{ rarity: string }> = ({ rarity }) => {
  const tone = rarity === 'prismatic' ? 'teal' : rarity === 'gold' ? 'gold' : 'muted';
  return <Badge tone={tone}>{rarity}</Badge>;
};

export const MayhemView: React.FC<{
  champions: Champion[];
  focusChampion: Champion | null;
  onSelectChampion: (c: Champion) => void;
}> = ({ champions, focusChampion, onSelectChampion }) => {
  const { bundle, loading, refreshing, refresh, lastFromNetwork } = useMayhemBundle();
  const [query, setQuery] = useState('');
  const [ownedIds, setOwnedIds] = useState<string[]>(() => loadIds(OWNED_KEY));
  const [rollIds, setRollIds] = useState<string[]>(() => loadIds(ROLL_KEY));
  const [champQuery, setChampQuery] = useState('');

  const syncFromDesktop = () => {
    const api = window.electronAPI;
    if (!isDesktop || !api?.getMayhemOwned) return;
    void api.getMayhemOwned().then((res) => {
      if (res.success && res.owned) {
        setOwnedIds(res.owned);
        saveIds(OWNED_KEY, res.owned);
      }
    });
    void api.getMayhemRoll?.().then((res) => {
      if (res?.success && res.roll?.length) {
        setRollIds(res.roll.slice(0, 3));
        saveIds(ROLL_KEY, res.roll.slice(0, 3));
      }
    });
  };

  useEffect(() => {
    syncFromDesktop();
    if (!isDesktop) return;
    // Poll only while visible: the HUD tab can sit open all evening behind
    // the game, and each tick is three cross-process calls for data that
    // only changes when the player picks an augment.
    const tick = () => {
      if (document.hidden) return;
      syncFromDesktop();
    };
    const t = window.setInterval(tick, 2500);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);

  useEffect(() => {
    if (!isDesktop) return;
    const roll = loadIds(ROLL_KEY);
    if (roll.length) void window.electronAPI?.setMayhemRoll?.(roll);
    const owned = loadIds(OWNED_KEY);
    if (owned.length) void window.electronAPI?.setMayhemOwned?.(owned);
  }, []);

  const persistOwned = (ids: string[]) => {
    saveIds(OWNED_KEY, ids);
    void window.electronAPI?.setMayhemOwned?.(ids);
  };

  const persistRoll = (ids: string[]) => {
    saveIds(ROLL_KEY, ids);
    void window.electronAPI?.setMayhemRoll?.(ids);
  };

  const champion = focusChampion;
  const ownedAugments = useMemo(
    () => ownedIds.map((id) => bundle.augments.find((a) => a.id === id)).filter((a): a is MayhemAugment => !!a),
    [ownedIds, bundle]
  );

  const rollRanked = useMemo(() => {
    if (!champion || !rollIds.length) return [];
    return rankMayhemChoices(champion, ownedIds, rollIds, bundle);
  }, [champion, ownedIds, rollIds, bundle]);

  const suggestions = useMemo(() => {
    if (!champion) return [];
    return suggestMayhemAugments(champion, ownedIds, bundle, 10);
  }, [champion, ownedIds, bundle]);

  const searchHits = useMemo(() => searchAugments(query, bundle, 8), [query, bundle]);

  const champOptions = useMemo(() => {
    const q = champQuery.trim().toLowerCase();
    const list = q ? champions.filter((c) => c.name.toLowerCase().includes(q)) : champions;
    return list.slice(0, 12);
  }, [champions, champQuery]);

  const addAugment = (aug: MayhemAugment, slot: 'owned' | 'roll') => {
    const setter = slot === 'owned' ? setOwnedIds : setRollIds;
    setter((prev) => {
      const next = prev.includes(aug.id) ? prev : [...prev, aug.id];
      if (slot === 'owned') persistOwned(next);
      else persistRoll(next);
      return next;
    });
    setQuery('');
  };

  const removeAugment = (id: string, slot: 'owned' | 'roll') => {
    const setter = slot === 'owned' ? setOwnedIds : setRollIds;
    setter((prev) => {
      const next = prev.filter((x) => x !== id);
      if (slot === 'owned') persistOwned(next);
      else persistRoll(next);
      return next;
    });
  };

  const tryAddFromQuery = (slot: 'owned' | 'roll') => {
    const hit = findAugment(query, bundle);
    if (hit) addAugment(hit, slot);
  };

  const takeAugment = (id: string) => {
    if (ownedIds.includes(id)) return;
    const next = [...ownedIds, id];
    setOwnedIds(next);
    persistOwned(next);
    void window.electronAPI?.takeMayhemAugment?.(id).then((res) => {
      if (res && !res.success && rollIds.length > 0 && !rollIds.includes(id)) {
        console.warn('[mayhem] augment not on current OCR roll — fix roll under Manual fix');
      }
    });
    setRollIds((prev) => {
      const next = prev.filter((x) => x !== id);
      persistRoll(next);
      return next;
    });
  };

  const verdictBadge = (verdict: string) => {
    if (verdict === 'pick') return <Badge tone="teal">PICK</Badge>;
    if (verdict === 'alt') return <Badge tone="gold">ALT</Badge>;
    return <Badge tone="muted">SKIP</Badge>;
  };

  const redditSearch = champion
    ? `https://www.reddit.com/search/?q=${encodeURIComponent(`ARAM Mayhem ${champion.name} augment`)}`
    : 'https://www.reddit.com/search/?q=ARAM%20Mayhem%20augment';

  return (
    <div className="ot-page">
      <div className="ot-page-header">
        <div>
          <h1 className="ot-page-title flex flex-wrap items-center gap-2">
            ARAM Mayhem <Badge tone="gold">Beta</Badge>
          </h1>
          <p className="ot-page-sub">
            Experimental overlay + OCR for Mayhem only — ranked and classic SR are unchanged. Rank augment rolls for your
            champion and what you already took. Uses combo lists and pick-rate data from{' '}
            <a href="https://arammayhem.com/data/" className="text-[color:var(--ot-gold)]" target="_blank" rel="noreferrer">
              arammayhem.com
            </a>{' '}
            (CC BY). Win rates are not published there — scores are synergy + editorial combos, not live WR.
          </p>
        </div>
        <button type="button" className="ot-btn ot-btn-ghost shrink-0" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? 'Updating…' : 'Refresh data'}
        </button>
      </div>

      <p className="text-xs ot-faint mb-4">
        Patch {bundle.meta.patch}
        {bundle.meta.statsDate ? ` · stats ${bundle.meta.statsDate}` : ''}
        {loading ? ' · loading cache…' : ''}
        {lastFromNetwork === false ? ' · offline bundle (fetch failed)' : ''}
        {lastFromNetwork === true ? ' · updated from network' : ''}
      </p>

      <div className="grid gap-5 lg:grid-cols-2 mb-5">
        <Card>
          <CardHeader title="Your champion" sub="Match Riot's internal id (e.g. Pyke, Brand)." />
          {champion ? (
            <div className="flex items-center gap-3 mb-3">
              <Portrait champion={champion} size={40} />
              <div>
                <div className="font-medium">{champion.name}</div>
                <div className="text-xs ot-muted">{champion.tags.join(' · ')}</div>
              </div>
            </div>
          ) : (
            <p className="text-sm ot-muted mb-3">Pick a champion below or from Home.</p>
          )}
          <input
            className="ot-input w-full mb-2"
            placeholder="Search champions…"
            value={champQuery}
            onChange={(e) => setChampQuery(e.target.value)}
          />
          <ul className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
            {champOptions.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`text-sm px-2.5 py-1 rounded-md border border-[color:var(--ot-border)] hover:bg-[color:var(--ot-surface-2)] ${champion?.id === c.id ? 'bg-[color:var(--ot-surface-2)] font-medium' : ''}`}
                  onClick={() => onSelectChampion(c)}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Manual fix" sub="OCR fills the roll automatically in-game. Use this only if a name was misread." />
          <input
            className="ot-input w-full mb-2"
            placeholder="Type augment name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') tryAddFromQuery('roll');
            }}
          />
          {query ? (
            <ul className="space-y-1 mb-2">
              {searchHits.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="flex gap-1 shrink-0">
                    <button type="button" className="ot-btn ot-btn-ghost text-xs" onClick={() => addAugment(a, 'owned')}>
                      Owned
                    </button>
                    <button type="button" className="ot-btn ot-btn-ghost text-xs" onClick={() => addAugment(a, 'roll')}>
                      Roll
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs ot-faint">
            Community reads:{' '}
            <a href={redditSearch} target="_blank" rel="noreferrer" className="text-[color:var(--ot-gold)]">
              Reddit search
            </a>
          </p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 mb-5">
        <AugmentList
          title="Already owned"
          sub="Augments you picked at 3 / 7 / 11…"
          augments={ownedAugments}
          onRemove={(id) => removeAugment(id, 'owned')}
          onClear={() => {
            setOwnedIds([]);
            persistOwned([]);
          }}
        />
        <AugmentList
          title="On-screen roll"
          sub="HUD only when OCR sees augment cards · Page Down scan · Page Up close"
          augments={rollIds.map((id) => bundle.augments.find((a) => a.id === id)).filter((a): a is MayhemAugment => !!a)}
          onRemove={(id) => removeAugment(id, 'roll')}
          onClear={() => {
            setRollIds([]);
            persistRoll([]);
          }}
        />
      </div>

      {!champion ? (
        <Card>
          <EmptyState title="Select a champion" body="Choose who you're playing in Mayhem to rank augments." />
        </Card>
      ) : rollRanked.length ? (
        <Card pad={false}>
          <div className="ot-card-pad !pb-2">
            <CardHeader
              title="This roll — pick order"
              sub="Ranked from arammayhem.com combo data + what you already took. #1 is the yes; others are skip unless marked ALT."
            />
          </div>
          <ol className="divide-y divide-[color:var(--ot-border)]">
            {rollRanked.map((row) => (
              <li key={row.augmentId} className="ot-card-pad flex flex-col sm:flex-row sm:items-start gap-3">
                <span className="ot-num font-semibold text-lg w-8 shrink-0">{row.rank}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{row.name}</span>
                    <RarityBadge rarity={row.rarity} />
                    {verdictBadge(row.verdict)}
                  </div>
                  <p className="mt-1 text-sm">{row.headline}</p>
                  {row.reasons[1] ? <p className="text-xs ot-muted mt-0.5">{row.reasons[1]}</p> : null}
                </div>
                <button
                  type="button"
                  className="ot-btn ot-btn-ghost text-xs shrink-0"
                  onClick={() => takeAugment(row.augmentId)}
                  disabled={ownedIds.includes(row.augmentId)}
                >
                  {ownedIds.includes(row.augmentId) ? 'Owned' : 'I took this'}
                </button>
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <Card>
          <CardHeader
            title={`Best next augments for ${champion.name}`}
            sub="Page Down scans the shop; Page Up dismisses a stuck overlay until the next pick."
          />
          <ol className="space-y-3">
            {suggestions.map((row) => (
              <li key={row.augmentId} className="text-sm border-t border-[color:var(--ot-border)] pt-3 first:border-0 first:pt-0">
                <span className="ot-num ot-faint mr-2">{row.rank}.</span>
                <span className="font-medium">{row.name}</span>
                <RarityBadge rarity={row.rarity} />
                <p className="ot-muted mt-0.5 pl-6">{row.headline}</p>
              </li>
            ))}
          </ol>
        </Card>
      )}
    </div>
  );
};

const AugmentList: React.FC<{
  title: string;
  sub: string;
  augments: MayhemAugment[];
  onRemove: (id: string) => void;
  onClear: () => void;
}> = ({ title, sub, augments, onRemove, onClear }) => (
  <Card>
    <div className="flex items-start justify-between gap-2 mb-2">
      <CardHeader title={title} sub={sub} />
      {augments.length ? (
        <button type="button" className="ot-btn ot-btn-ghost text-xs shrink-0" onClick={onClear}>
          Clear
        </button>
      ) : null}
    </div>
    {augments.length ? (
      <ul className="flex flex-wrap gap-2">
        {augments.map((a) => (
          <li key={a.id}>
            <button
              type="button"
              className="text-sm px-2.5 py-1 rounded-md border border-[color:var(--ot-border)] hover:bg-[color:var(--ot-surface-2)]"
              onClick={() => onRemove(a.id)}
              title="Remove"
            >
              {a.name}
              <span className="opacity-60 ml-1">×</span>
            </button>
          </li>
        ))}
      </ul>
    ) : (
      <p className="text-sm ot-muted">None yet — search and add above.</p>
    )}
  </Card>
);
