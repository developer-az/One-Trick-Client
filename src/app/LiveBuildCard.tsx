import React, { useEffect, useState } from 'react';
import type { LiveBuild, LiveBuildMode } from '../logic/liveBuild';
import { Card, CardHeader, Item } from './ui';

/** Most-picked build on the current patch (OP.GG). Pick rates only, never win rates (D1). */
export const LiveBuildCard: React.FC<{ championId: string; role: string; mode?: LiveBuildMode }> = ({
  championId,
  role,
  mode = 'ranked',
}) => {
  const [state, setState] = useState<{ key: string; build: LiveBuild | null; done: boolean }>({ key: '', build: null, done: false });
  const key = `${championId}:${role}:${mode}`;
  useEffect(() => {
    const api = window.electronAPI?.getLiveBuild;
    if (!api || !championId) return;
    let alive = true;
    api(championId, role, mode)
      .catch(() => null)
      .then((build) => {
        if (alive) setState({ key, build, done: true });
      });
    return () => {
      alive = false;
    };
  }, [championId, role, mode, key]);
  if (!window.electronAPI?.getLiveBuild || !championId) return null;
  const build = state.key === key ? state.build : null;
  const pct = (v: number | null): string => (v == null ? '' : ` · picked in ${Math.round(v * 100)}% of games`);
  const items = build?.core ? [...build.core.ids, ...(build.boots?.ids ?? [])] : [];
  const names = build?.core ? [...build.core.names, ...(build.boots?.names ?? [])] : [];
  return (
    <Card className="mb-4">
      <CardHeader title={mode === 'aram' ? 'Popular ARAM build this patch' : 'Popular build this patch'} />
      {!build ? (
        <p className="text-sm ot-muted">
          {state.key === key && state.done ? 'OP.GG has no build for this champion right now.' : 'Loading from OP.GG…'}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {build.core && (
            <div>
              <div className="flex flex-wrap gap-2">
                {items.map((id, i) => (
                  <Item key={`${id}-${i}`} id={String(id)} name={names[i] ?? String(id)} size={36} />
                ))}
              </div>
              <p className="text-xs ot-faint mt-1">Core + boots{pct(build.core.pickRate)}</p>
            </div>
          )}
          {build.runes && (
            <p className="text-sm">
              {build.runes.primary}: {build.runes.keystones.join(', ')} · {build.runes.secondary}:{' '}
              {build.runes.secondaryRunes.join(', ')}
            </p>
          )}
          {build.skillOrder.length > 0 && <p className="text-sm ot-muted">Skills: {build.skillOrder.join(' ')}</p>}
          <p className="text-xs ot-faint">Source: OP.GG, patch {build.patch}.</p>
        </div>
      )}
    </Card>
  );
};
