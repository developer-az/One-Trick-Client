import React, { useEffect, useState } from 'react';
import { Card, CardHeader, Pill, type Tone } from '../ui';
import type { PlayRecapEntry } from '../../logic/playMoments';

/**
 * Post-game review (chess.com Game Review model): a vertical timeline of the
 * match's plays, each labelled Brilliant / Great / Good / Mistake / Blunder
 * with the reasons the scoring engine produced. Data comes from the live
 * play-moment pipeline — nothing is re-derived here.
 */

type ReviewLabel = 'Brilliant' | 'Great' | 'Good' | 'Mistake' | 'Blunder';

function reviewLabel(entry: PlayRecapEntry): ReviewLabel {
  if (entry.playLabel) return entry.playLabel;
  // Older entries (pre-scoring) map from the moment kind.
  if (entry.kind === 'blunder') return 'Mistake';
  return 'Good';
}

const LABEL_TONE: Record<ReviewLabel, Tone> = {
  Brilliant: 'live',
  Great: 'live',
  Good: 'muted',
  Mistake: 'bad',
  Blunder: 'bad',
};

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

interface ReviewSummary {
  counts: Record<ReviewLabel, number>;
  best: PlayRecapEntry | null;
}

function summarize(entries: PlayRecapEntry[]): ReviewSummary {
  const counts: Record<ReviewLabel, number> = {
    Brilliant: 0,
    Great: 0,
    Good: 0,
    Mistake: 0,
    Blunder: 0,
  };
  let best: PlayRecapEntry | null = null;
  for (const entry of entries) {
    counts[reviewLabel(entry)] += 1;
    if (entry.kind === 'brilliant' && typeof entry.score === 'number') {
      if (!best || (entry.score ?? 0) > (best.score ?? 0)) best = entry;
    }
  }
  return { counts, best };
}

export const ReviewView: React.FC = () => {
  const [entries, setEntries] = useState<PlayRecapEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void window.electronAPI?.getMatchRecap?.().then((next) => {
        if (!cancelled) {
          setEntries(next || []);
          setLoaded(true);
        }
      });
    };
    load();
    // Poll lightly so a match that just ended fills the view without a restart.
    const id = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const summary = summarize(entries);
  const scoreLabel =
    summary.counts.Brilliant + summary.counts.Great > summary.counts.Mistake
      ? 'Winning habits'
      : 'Leaking LP';

  return (
    <div className="ot-page">
      <div className="ot-page-header">
        <h1 className="ot-page-title">Match review</h1>
        <p className="ot-page-sub">Every moment the live pipeline scored, oldest first.</p>
      </div>

      {!loaded ? (
        <Card>
          <p className="ot-muted">Loading recap…</p>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <p className="ot-muted">
            Play a match with the overlay on. Scored moments appear here after the game ends.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Card>
              <div className="text-xs ot-faint uppercase tracking-wide">Plays scored</div>
              <div className="ot-stat-big ot-num mt-1">{entries.length}</div>
              <div className="text-sm ot-muted mt-1">{scoreLabel}</div>
            </Card>
            <Card>
              <div className="text-xs ot-faint uppercase tracking-wide">Brilliant / Great</div>
              <div className="ot-stat-big ot-num mt-1">
                {summary.counts.Brilliant} / {summary.counts.Great}
              </div>
              <div className="text-sm ot-muted mt-1">Standout plays</div>
            </Card>
            <Card>
              <div className="text-xs ot-faint uppercase tracking-wide">Mistakes</div>
              <div className="ot-stat-big ot-num mt-1">
                {summary.counts.Mistake + summary.counts.Blunder}
              </div>
              <div className="text-sm ot-muted mt-1">Deaths and misses</div>
            </Card>
            <Card>
              <div className="text-xs ot-faint uppercase tracking-wide">Best moment</div>
              <div className="ot-stat-big ot-num mt-1">
                {summary.best ? fmtClock(summary.best.gameTime) : '—'}
              </div>
              <div className="text-sm ot-muted mt-1 truncate">
                {summary.best ? summary.best.label : 'No scored kills'}
              </div>
            </Card>
          </div>

          <Card className="mt-4">
            <CardHeader title="Timeline" />
            <ol className="relative ml-3 border-l border-[color:var(--ot-border)] space-y-4 mt-2">
              {entries.map((entry, i) => {
                const label = reviewLabel(entry);
                const dot =
                  label === 'Brilliant'
                    ? '#e8b84a'
                    : label === 'Mistake' || label === 'Blunder'
                      ? '#c0504d'
                      : 'var(--ot-border, #555)';
                return (
                  <li key={`${entry.gameTime}-${entry.label}-${i}`} className="ml-4 relative">
                    <span
                      className="absolute -left-[21px] top-1.5 w-2.5 h-2.5 rounded-full"
                      style={{ background: dot }}
                    />
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="ot-num text-xs ot-faint">{fmtClock(entry.gameTime)}</span>
                      <Pill tone={LABEL_TONE[label]}>{label}</Pill>
                      <span className="font-medium">{entry.label}</span>
                      {typeof entry.score === 'number' ? (
                        <span className="ot-num text-xs ot-faint" title="Weighted score from the play engine">
                          {entry.score}
                        </span>
                      ) : null}
                    </div>
                    <p className="ot-muted mt-1 text-[13px]">{entry.detail}</p>
                    {entry.reasons?.length ? (
                      <p className="ot-faint mt-0.5 text-xs">Why: {entry.reasons.join(' · ')}</p>
                    ) : null}
                    {entry.hint ? <p className="ot-faint mt-0.5 text-xs">{entry.hint}</p> : null}
                  </li>
                );
              })}
            </ol>
          </Card>
        </>
      )}
    </div>
  );
};
