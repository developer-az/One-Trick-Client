import React, { useMemo } from 'react';
import type { Champion } from '../../logic/pykeLogic';
import type { ChampionProfile } from '../../logic/profiles';
import type { ViewId } from '../App';
import { ROLES, type DraftMember, type DraftState, type Role } from '../hooks';
import { IconArrowRight, IconDraft } from '../icons';
import type { Loadout } from './LoadoutView';
import { Badge, Card, CardHeader, ChampionCombobox, EmptyState, Portrait } from '../ui';

const PHASE_LABEL: Record<string, string> = {
  PLANNING: 'Declaring picks',
  BAN_PICK: 'Bans and picks',
  FINALIZATION: 'Finalising',
  GAME_STARTING: 'Game starting',
};

const AGGRESSION_TONE = { EXTREME: 'red', HIGH: 'amber', MODERATE: 'gold', LOW: 'muted' } as const;

export const DraftView: React.FC<{
  draft: DraftState;
  champions: Champion[];
  profile: ChampionProfile;
  loadout: Loadout | null;
  onManual: (side: 'ally' | 'enemy', role: Role, champion: Champion | null) => void;
  onClear: () => void;
  onNavigate: (view: ViewId) => void;
}> = ({ draft, champions, profile, loadout, onManual, onClear, onNavigate }) => {
  const taken = useMemo(() => {
    const ids = new Set<string>();
    for (const r of ROLES) {
      if (draft.ally[r]?.champion) ids.add(draft.ally[r]!.champion!.id);
      if (draft.enemy[r]?.champion) ids.add(draft.enemy[r]!.champion!.id);
    }
    return ids;
  }, [draft.ally, draft.enemy]);
  const anyPicked = taken.size > 0;
  const bans = [...draft.bans.ally, ...draft.bans.enemy];

  return (
    <div className="ot-page">
      <div className="ot-page-header">
        <div>
          <h1 className="ot-page-title">Champ select</h1>
          <p className="ot-page-sub">
            {draft.live
              ? `Live from the client${draft.timerPhase ? ` · ${PHASE_LABEL[draft.timerPhase] || draft.timerPhase}` : ''}. Click any slot to correct it.`
              : 'Fills in by itself in champ select. Until then, add champions by hand to plan a matchup.'}
          </p>
        </div>
        <div className="flex gap-2">
          {anyPicked && !draft.live ? (
            <button type="button" className="ot-btn ot-btn-ghost" onClick={onClear}>
              Clear board
            </button>
          ) : null}
          {loadout ? (
            <button type="button" className="ot-btn ot-btn-primary" onClick={() => onNavigate('loadout')}>
              Build & runes <IconArrowRight />
            </button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <TeamColumn
          title="Your team"
          tone="blue"
          side="ally"
          members={draft.ally}
          champions={champions}
          taken={taken}
          onManual={onManual}
        />
        <TeamColumn
          title="Enemy team"
          tone="red"
          side="enemy"
          members={draft.enemy}
          champions={champions}
          taken={taken}
          onManual={onManual}
        />
      </div>

      {bans.length ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs ot-faint uppercase tracking-wide mr-1">Bans</span>
          {bans.map((c, i) => (
            <Portrait key={`${c.id}-${i}`} champion={c} size={28} className="opacity-50 grayscale" />
          ))}
        </div>
      ) : null}

      <div className="mt-6">
        {loadout ? (
          <MatchupCard loadout={loadout} profile={profile} />
        ) : (
          <Card>
            <EmptyState
              icon={<IconDraft size={28} />}
              title="Add at least one enemy"
              body={`The matchup read for ${profile.label} appears as soon as one enemy champion is known.`}
            />
          </Card>
        )}
      </div>
    </div>
  );
};

const TeamColumn: React.FC<{
  title: string;
  tone: 'blue' | 'red';
  side: 'ally' | 'enemy';
  members: Record<Role, DraftMember | null>;
  champions: Champion[];
  taken: Set<string>;
  onManual: (side: 'ally' | 'enemy', role: Role, champion: Champion | null) => void;
}> = ({ title, tone, side, members, champions, taken, onManual }) => (
  <Card>
    <CardHeader title={title} action={<span className={`ot-dot ${tone === 'blue' ? '' : 'ot-tone-bad'}`} style={tone === 'blue' ? { background: 'var(--ot-blue)' } : undefined} />} />
    <div className="space-y-2">
      {ROLES.map((role) => {
        const m = members[role];
        return (
          <div key={role} className={`ot-slot ${m?.isLocal ? 'is-local' : ''} ${m?.champion ? '' : 'is-empty'}`}>
            <Portrait champion={m?.champion} size={44} ring={m?.isLocal ? 'gold' : m?.champion ? tone : undefined} />
            <span className="ot-role">{role}</span>
            <div className={`flex-1 min-w-0 ${m?.hovering ? 'opacity-60' : ''}`}>
              <ChampionCombobox
                champions={champions}
                value={m?.champion || null}
                onChange={(c) => onManual(side, role, c)}
                placeholder="Add champion"
                exclude={taken}
              />
            </div>
            <div className="flex gap-1.5">
              {m?.isLocal ? <Badge tone="gold">You</Badge> : null}
              {m?.hovering ? <Badge>Hovering</Badge> : null}
            </div>
          </div>
        );
      })}
    </div>
  </Card>
);

const MatchupCard: React.FC<{ loadout: Loadout; profile: ChampionProfile }> = ({ loadout, profile }) => {
  const { analysis, dominance } = loadout;
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0 max-w-2xl">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge tone="gold">{profile.label}</Badge>
            <Badge tone={AGGRESSION_TONE[analysis.aggressionLevel]}>{titleCase(analysis.aggressionLevel)} aggression</Badge>
          </div>
          <h2 className="ot-card-heading text-xl">{analysis.title}</h2>
          <p className="mt-2 ot-muted leading-relaxed">{analysis.description}</p>
        </div>
        <div className="text-right flex-none">
          <div className="text-xs ot-faint uppercase tracking-wide">Matchup read</div>
          <div className="ot-stat-big ot-num">{dominance.grade}</div>
          <div className="text-sm ot-muted ot-num">{dominance.score} / 100</div>
        </div>
      </div>

      <div className="ot-divider my-5" />

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="ot-card-title mb-2">Win condition</h3>
          <p className="text-[15px] leading-relaxed">{analysis.winCondition}</p>
          {analysis.roamAdvice ? <p className="mt-2 text-sm ot-muted leading-relaxed">{analysis.roamAdvice}</p> : null}
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Phase label="Early" value={dominance.earlyGameScore} />
            <Phase label="Mid" value={dominance.midGameScore} />
            <Phase label="Late" value={dominance.lateGameScore} />
          </div>
        </div>
        <div className="space-y-4">
          {analysis.primaryTargets.length ? (
            <ChampList title="Focus" names={analysis.primaryTargets} tone="teal" />
          ) : null}
          {analysis.majorThreats.length ? <ChampList title="Respect" names={analysis.majorThreats} tone="red" /> : null}
        </div>
      </div>

      {analysis.tips.length || analysis.loadingDoctrine?.length ? (
        <>
          <div className="ot-divider my-5" />
          <h3 className="ot-card-title mb-2">{analysis.loadingDoctrine?.length ? 'First 90 seconds' : 'Tips'}</h3>
          <ul className="space-y-2 text-[15px] leading-relaxed">
            {(analysis.loadingDoctrine?.length ? analysis.loadingDoctrine : analysis.tips).slice(0, 6).map((t, i) => (
              <li key={i} className="flex gap-3">
                <span className="ot-faint ot-num w-4 flex-none">{i + 1}</span>
                <span>{t}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {analysis.botLaneMatchup ? (
        <>
          <div className="ot-divider my-5" />
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h3 className="ot-card-title">Bot lane</h3>
            <Badge tone={analysis.botLaneMatchup.matchupDifficulty === 'EASY' ? 'teal' : analysis.botLaneMatchup.matchupDifficulty === 'MEDIUM' ? 'gold' : 'red'}>
              {titleCase(analysis.botLaneMatchup.matchupDifficulty.replace('_', ' '))}
            </Badge>
          </div>
          <p className="text-[15px] leading-relaxed">{analysis.botLaneMatchup.lanePhase}</p>
          <p className="mt-1 text-sm ot-muted leading-relaxed">{analysis.botLaneMatchup.allInPotential}</p>
        </>
      ) : null}

      <p className="mt-5 text-xs ot-faint">
        A heuristic read from champion classes and {profile.shortLabel}'s doctrine. It is not based on win-rate data.
      </p>
    </Card>
  );
};

const Phase: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-lg border border-[color:var(--ot-border)] px-3 py-2">
    <div className="text-xs ot-faint">{label}</div>
    <div className="mt-1 h-1.5 rounded-full bg-[color:var(--ot-surface-3)] overflow-hidden">
      <div className="h-full rounded-full" style={{ width: `${Math.max(4, Math.min(100, value))}%`, background: 'var(--ot-gold)' }} />
    </div>
  </div>
);

const ChampList: React.FC<{ title: string; names: string[]; tone: 'teal' | 'red' }> = ({ title, names, tone }) => (
  <div>
    <h3 className="ot-card-title mb-2">{title}</h3>
    <div className="flex flex-wrap gap-1.5">
      {names.map((n) => (
        <Badge key={n} tone={tone}>
          {n}
        </Badge>
      ))}
    </div>
  </div>
);

function titleCase(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
