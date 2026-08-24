import React, { useState } from 'react';
import type { Build, RunePage, Item, MatchupAnalysis, DominanceMetrics } from '../logic/pykeLogic';
import { getRuneMeta, getRuneIconUrl, getStyleMeta } from '../data/runeService';
import { itemIconUrl } from '../data/ddragonAssets';
import { DominanceGauge } from './DominanceGauge';

interface Props {
    build: Build;
    runes: RunePage;
    analysis: MatchupAnalysis;
    dominance?: DominanceMetrics | null;
    onExport: () => void;
    canExport: boolean;
    exportStatus: 'idle' | 'working' | 'success' | 'error';
    exportError?: string | null;
    exportDetail?: string | null;
    profileLabel?: string;
}

const ItemIcon: React.FC<{ item: Item; size?: string; next?: boolean }> = ({ item, size = 'w-10 h-10', next }) => (
    <div className="group relative">
        <img
            src={itemIconUrl(item.id)}
            alt={item.name}
            className={`${size} rounded border ${next ? 'border-chrome-gold/70' : 'border-white/15'} group-hover:border-chrome-silver`}
            onError={(e) => {
                (e.target as HTMLImageElement).src = itemIconUrl('1001');
            }}
        />
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 p-2 bg-chrome-ink/95 border border-white/15 rounded text-chrome-silver text-xs opacity-0 group-hover:opacity-100 pointer-events-none z-50">
            <div className="font-semibold text-chrome-bright mb-0.5">{item.name}</div>
            <div className="text-chrome-dim">{item.reason || 'On path.'}</div>
        </div>
    </div>
);

const RuneIcon: React.FC<{ id: number; reason?: string; size?: string }> = ({ id, reason, size = 'w-7 h-7' }) => {
    const meta = getRuneMeta(id);
    return (
        <div className="group relative">
            <img
                src={meta.icon}
                alt={meta.name}
                className={`${size} rounded border border-white/15 group-hover:border-chrome-silver`}
                onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    const fallback = getRuneIconUrl(id);
                    if (target.src !== fallback) target.src = fallback;
                }}
            />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-44 p-2 bg-chrome-ink/95 border border-white/15 rounded text-chrome-silver text-xs opacity-0 group-hover:opacity-100 pointer-events-none z-50">
                <div className="font-semibold text-chrome-bright mb-0.5">{meta.name}</div>
                <div className="text-chrome-dim">{reason || 'For this matchup.'}</div>
            </div>
        </div>
    );
};

export const BuildDisplay: React.FC<Props> = ({
    build,
    runes,
    analysis,
    dominance,
    onExport,
    canExport,
    exportStatus,
    exportError,
    exportDetail,
    profileLabel = 'You',
}) => {
    const [matchupOpen, setMatchupOpen] = useState(false);
    const perks = runes.selectedPerkIds;
    const keystoneId = perks[0];
    const keystone = getRuneMeta(keystoneId);
    const primaryMinorIds = perks.slice(1, 4);
    const secondaryIds = perks.slice(4, 6);
    const shardIds = perks.slice(6, 9);
    const primaryStyle = getStyleMeta(runes.primaryStyleId);
    const secondaryStyle = getStyleMeta(runes.subStyleId);

    const exportLabel =
        exportStatus === 'success' ? 'Exported' :
        exportStatus === 'working' ? 'Exporting…' :
        exportStatus === 'error' ? 'Retry export' :
        'Export';

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {dominance ? <DominanceGauge metrics={dominance} /> : null}
                        <p className="text-sm text-chrome-bright min-w-0 truncate">
                            {analysis.title}
                        </p>
                    </div>
                </div>
                {canExport && (
                    <button
                        type="button"
                        onClick={onExport}
                        disabled={exportStatus === 'working'}
                        className={`hud-btn hud-btn--primary ${exportStatus === 'error' ? '!bg-chrome-blood !text-white' : ''}`}
                    >
                        {exportLabel}
                    </button>
                )}
            </div>
            {exportStatus === 'error' && exportError && (
                <p className="text-xs text-chrome-blood">{exportError}{exportDetail ? ` · ${exportDetail}` : ''}</p>
            )}
            {exportStatus === 'success' && exportDetail && (
                <p className="text-xs text-chrome-gold">{exportDetail}</p>
            )}

            <div className="flex flex-wrap items-center gap-1.5">
                {build.buildPath.map((item, i) => (
                    <React.Fragment key={`${item.id}-${i}`}>
                        <ItemIcon item={item} next={i === 0} />
                        {i < build.buildPath.length - 1 && <span className="text-chrome-dim/50 text-xs">→</span>}
                    </React.Fragment>
                ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
                <img src={primaryStyle.icon} alt="" className="w-5 h-5 opacity-80" />
                <RuneIcon id={keystoneId} reason={runes.reasons[keystoneId]} size="w-9 h-9" />
                <span className="text-xs text-chrome-dim hidden sm:inline">{keystone.name}</span>
                <div className="flex gap-1.5">
                    {primaryMinorIds.map((id) => (
                        <RuneIcon key={id} id={id} reason={runes.reasons[id]} />
                    ))}
                </div>
                <img src={secondaryStyle.icon} alt="" className="w-4 h-4 opacity-70 ml-1" />
                <div className="flex gap-1.5">
                    {secondaryIds.map((id) => (
                        <RuneIcon key={id} id={id} reason={runes.reasons[id]} />
                    ))}
                </div>
                <div className="flex gap-1">
                    {shardIds.map((id, i) => (
                        <RuneIcon key={`${id}-${i}`} id={id} reason={runes.reasons[id]} size="w-5 h-5" />
                    ))}
                </div>
            </div>

            <div>
                <button
                    type="button"
                    className="hud-btn"
                    aria-expanded={matchupOpen}
                    onClick={() => setMatchupOpen((o) => !o)}
                >
                    Matchup {matchupOpen ? '▴' : '▾'}
                </button>
                {matchupOpen && (
                    <div className="mt-3 space-y-3 text-sm text-chrome-dim border-t border-white/10 pt-3">
                        <p className="text-chrome-silver">{analysis.description}</p>
                        <p><span className="text-chrome-bright">Win: </span>{analysis.winCondition}</p>
                        {analysis.roamAdvice && <p>{analysis.roamAdvice}</p>}
                        {analysis.primaryTargets.length > 0 && (
                            <p>
                                <span className="text-chrome-bright">Prey: </span>
                                {analysis.primaryTargets.join(', ')}
                            </p>
                        )}
                        {analysis.tips.length > 0 && (
                            <ul className="grid gap-1.5 sm:grid-cols-2">
                                {analysis.tips.map((tip, i) => (
                                    <li key={i} className="text-xs">· {tip}</li>
                                ))}
                            </ul>
                        )}
                        {analysis.botLaneMatchup && (
                            <div className="text-xs space-y-1">
                                <p>
                                    Lane {analysis.botLaneMatchup.matchupDifficulty}
                                    {analysis.botLaneMatchup.damageComparison
                                        ? ` · 2v2 ${analysis.botLaneMatchup.damageComparison.advantage}`
                                        : ''}
                                    {' · '}
                                    {profileLabel}
                                </p>
                                <p>{analysis.botLaneMatchup.lanePhase}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
