import React from 'react';
import type { CatalogRole } from '../../catalog/types';
import type { Champion } from '../../logic/pykeLogic';
import { oneTrickPlan } from '../../logic/oneTrick';
import { Badge, Card, CardHeader } from '../ui';

/**
 * "How to play this champion" — the one-trick layer.
 *
 * Collapsed by default and deliberately short: the point is a reminder of the
 * three habits that earn LP on your champion, not a guide to read between
 * queues. Leaks are shown in red because they cost games; habits in teal.
 */
export const OneTrickCard: React.FC<{
  champion: Champion;
  role: CatalogRole;
}> = ({ champion, role }) => {
  const [open, setOpen] = React.useState(false);
  const plan = React.useMemo(() => oneTrickPlan(champion, role), [champion, role]);

  return (
    <Card>
      <CardHeader
        title={`One-tricking ${champion.name}`}
        sub={plan.winCondition}
        action={<Badge tone="gold">{plan.archetype}</Badge>}
      />

      <button
        type="button"
        className="ot-btn ot-btn-ghost ot-btn-sm -ml-2"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? 'Hide habits and leaks' : 'Habits, leaks, and their answer'}
      </button>

      {open ? (
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div>
            <div className="ot-card-title mb-2">Earn LP</div>
            <ul className="space-y-2 text-sm">
              {plan.habits.map((h) => (
                <li key={h} className="flex gap-2">
                  <span className="ot-dot ot-tone-live mt-1.5 shrink-0" />
                  <span className="ot-muted leading-relaxed">{h}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="ot-card-title mb-2">Leak LP</div>
            <ul className="space-y-2 text-sm">
              {plan.leaks.map((h) => (
                <li key={h} className="flex gap-2">
                  <span className="ot-dot ot-tone-bad mt-1.5 shrink-0" />
                  <span className="ot-muted leading-relaxed">{h}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="md:col-span-2">
            <div className="ot-callout ot-callout-warn mt-1">
              <span className="ot-dot ot-tone-warn mt-1.5 shrink-0" />
              <span className="leading-relaxed">
                <span className="font-medium">How they beat you: </span>
                {plan.enemyAnswer}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <p className="mt-3 text-xs ot-faint leading-relaxed">
        Guidance is derived from your champion’s kit and role, not from win-rate data.
      </p>
    </Card>
  );
};
