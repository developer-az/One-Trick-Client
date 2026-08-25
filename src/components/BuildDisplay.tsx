import React from 'react';
import type { Build, RunePage, Item, MatchupAnalysis } from '../logic/pykeLogic';
import { getRuneIconUrl, getRuneMeta, getStyleMeta } from '../data/runeService';
import { HudFrame } from './HudFrame';
import { ChromeMark } from '../overlay/ChromeMark';
import { ItemIcon as AssetItemIcon } from './GameIcons';

interface Props {
    build: Build;
    runes: RunePage;
    analysis: MatchupAnalysis;
    onExport: () => void;
    canExport: boolean;
    exportStatus: 'idle' | 'working' | 'success' | 'error';
    /** Message from a failed export — shown verbatim so the cause is actionable. */
    exportError?: string | null;
    /** Extra context on success / partial success. */
    exportDetail?: string | null;
    accentColor?: string;
    profileLabel?: string;
}

const ItemIcon: React.FC<{ item: Item; size?: string; profileLabel?: string }> = ({ item, size = "w-12 h-12", profileLabel }) => (
    <div className="group relative">
        <AssetItemIcon
            itemId={item.id}
            alt={item.name}
            className={`${size} border border-chrome-dim/40 group-hover:border-chrome-silver transition-all duration-200 cursor-help shadow-lg`}
        />
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-chrome-ink/95 border border-chrome-silver/40 text-chrome-silver text-xs opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity shadow-lg">
            <div className="font-bold text-chrome-bright mb-1">{item.name}</div>
            <div>{item.reason || `Selected for this ${profileLabel || 'matchup'}.`}</div>
        </div>
    </div>
);

const RuneIcon: React.FC<{ id: number; reason?: string; size?: string }> = ({ id, reason, size = 'w-8 h-8' }) => {
    const meta = getRuneMeta(id);

    return (
        <div className="group relative">
            <img
                src={meta.icon}
                alt={meta.name}
                className={`${size} border border-chrome-dim/40 group-hover:border-chrome-silver transition-colors cursor-help`}
                onError={(e) => {
                    const target = e.target as HTMLImageElement;
                    const fallback = getRuneIconUrl(id);
                    if (target.src !== fallback) {
                        target.src = fallback;
                    }
                }}
            />
            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-chrome-ink/95 border border-chrome-silver/40 text-chrome-silver text-xs opacity-0 group-hover:opacity-100 pointer-events-none z-50 transition-opacity shadow-lg">
                <div className="font-bold text-chrome-bright mb-1">{meta.name}</div>
                <div>{reason || 'Selected for this matchup.'}</div>
            </div>
        </div>
    );
};

export const BuildDisplay: React.FC<Props> = ({
    build,
    runes,
    analysis,
    onExport,
    canExport,
    exportStatus,
    exportError,
    exportDetail,
    accentColor,
    profileLabel,
}) => {
    // Pages are always [keystone, 3 primary minors, 2 secondary, 3 shards]
    const perks = runes.selectedPerkIds;
    const keystoneId = perks[0];
    const keystone = getRuneMeta(keystoneId);
    const primaryMinorIds = perks.slice(1, 4);
    const secondaryIds = perks.slice(4, 6);
    const shardIds = perks.slice(6, 9);
    const primaryStyle = getStyleMeta(runes.primaryStyleId);
    const secondaryStyle = getStyleMeta(runes.subStyleId);

    return (
        <div className="space-y-8 animate-fade-in relative" style={{ zIndex: 1, position: 'relative', ['--build-accent' as string]: accentColor || 'var(--chrome-silver)' }}>
            {/* Header */}
            <div className="flex flex-wrap justify-between items-center gap-3 border-b border-chrome-silver/20 pb-4 relative">
                <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-chrome-silver/60 via-transparent to-chrome-blood/40" />
                <h2 className="hud-heading text-2xl text-chrome-bright drop-shadow-[0_0_8px_rgba(242,244,247,0.2)]">
                    <ChromeMark size={16} style={{ color: accentColor }} /> One Trick Loadout
                    {profileLabel ? <span className="text-chrome-dim font-mono text-sm tracking-[0.18em] ml-2 uppercase">{profileLabel}</span> : null}
                </h2>
                {canExport && (
                    <button
                        onClick={onExport}
                        disabled={exportStatus === 'working'}
                        className={`px-5 py-2.5 border-2 transition-all duration-200 uppercase font-bold text-sm tracking-wider shadow-lg clip-path-none ${
                            exportStatus === 'success' 
                                ? 'bg-emerald-600 text-white border-emerald-500' 
                                : exportStatus === 'error' 
                                    ? 'bg-chrome-blood text-white border-chrome-blood' 
                                    : 'bg-chrome-ink/80 hover:bg-chrome-silver hover:text-chrome-ink text-chrome-silver border-chrome-silver hover:scale-105 active:scale-95'
                        }`}
                        style={{ clipPath: 'polygon(8px 0, 100% 0, calc(100% - 8px) 100%, 0 100%)' }}
                    >
                        {exportStatus === 'success' ? '✓ Exported!' :
                            exportStatus === 'working' ? '… Exporting' :
                                exportStatus === 'error' ? '✕ Retry Export' :
                                    '→ Export Build'}
                    </button>
                )}
            </div>
            {canExport && (
                <div className="-mt-6 space-y-1">
                    <p className="text-xs text-chrome-dim">
                        Exports runes and item set. Item set appears in-game shop.
                    </p>
                    {exportStatus === 'error' && exportError && (
                        <div className="text-xs text-rose-300 border border-chrome-blood/50 bg-chrome-blood/10 px-3 py-2">
                            <div className="font-bold uppercase tracking-wider mb-1">Export failed</div>
                            <div className="font-mono break-words">{exportError}</div>
                            {exportDetail && <div className="mt-1 opacity-80">{exportDetail}</div>}
                            <div className="mt-1 opacity-70">
                                Make sure the League client is open and fully logged in (not on the login screen),
                                then press Retry Export.
                            </div>
                        </div>
                    )}
                    {exportStatus === 'success' && exportDetail && (
                        <p className="text-xs text-emerald-300">{exportDetail}</p>
                    )}
                </div>
            )}

            {/* STRATEGIC ANALYSIS SECTION */}
            <HudFrame accent="green" label="Doctrine" className="p-6 hud-scanlines">
                <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                    <h1 className="text-9xl font-black text-pyke-green font-display">?</h1>
                </div>

                <div className="relative z-10">
                    <div className="flex justify-between items-start mb-4">
                        <div>
                            <h3 className="text-[10px] font-mono text-slate-500 uppercase tracking-[0.22em] mb-1">Mission Objective</h3>
                            <h2 className="text-3xl font-display text-white uppercase tracking-wide">{analysis.title}</h2>
                        </div>
                        <div className={`hud-chip ${analysis.aggressionLevel === 'EXTREME' ? 'hud-accent-blood !text-red-400' :
                            analysis.aggressionLevel === 'HIGH' ? 'hud-accent-blood !text-orange-400' :
                                analysis.aggressionLevel === 'MODERATE' ? '!text-yellow-400' :
                                    'hud-accent-cyan !text-cyan-300'
                            }`}>
                            Aggression: {analysis.aggressionLevel}
                        </div>
                    </div>

                    <p className="text-slate-300 text-lg mb-6 italic border-l-4 border-pyke-green pl-4">
                        "{analysis.description}"
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <h4 className="text-xs font-bold text-pyke-green uppercase tracking-wider mb-2">Win Condition</h4>
                            <p className="text-sm text-slate-400">{analysis.winCondition}</p>
                            {analysis.roamAdvice && (
                                <p className="text-sm text-cyan-300/90 mt-3 border-l-2 border-cyan-500/40 pl-3">
                                    {analysis.roamAdvice}
                                </p>
                            )}
                        </div>
                        <div>
                            <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-2">Primary Targets</h4>
                            <div className="flex flex-wrap gap-2">
                                {analysis.primaryTargets.map(t => (
                                    <span key={t} className="px-2 py-0.5 bg-red-500/10 border border-red-500/30 text-red-300 text-xs rounded">
                                        {t}
                                    </span>
                                ))}
                                {analysis.primaryTargets.length === 0 && <span className="text-slate-500 text-xs">None visible</span>}
                            </div>
                        </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-800">
                        <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Tactical Tips</h4>
                        <ul className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {analysis.tips.map((tip, i) => (
                                <li key={i} className="flex items-start gap-2 text-sm text-slate-400">
                                    <span className="text-pyke-green mt-1">›</span>
                                    {tip}
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Bot Lane Matchup Analysis */}
                    {analysis.botLaneMatchup && (
                        <div className="mt-6 pt-4 border-t border-slate-800">
                            <h4 className="text-xs font-bold text-pyke-green uppercase tracking-wider mb-3">Bot Lane Matchup</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <span className="text-slate-400 text-sm">Difficulty:</span>
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${
                                            analysis.botLaneMatchup.matchupDifficulty === 'EASY' ? 'bg-green-500/20 text-green-400 border border-green-500/50' :
                                            analysis.botLaneMatchup.matchupDifficulty === 'MEDIUM' ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/50' :
                                            analysis.botLaneMatchup.matchupDifficulty === 'HARD' ? 'bg-orange-500/20 text-orange-400 border border-orange-500/50' :
                                            'bg-red-500/20 text-red-400 border border-red-500/50'
                                        }`}>
                                            {analysis.botLaneMatchup.matchupDifficulty}
                                        </span>
                                    </div>
                                    <p className="text-sm text-slate-400 mb-2">{analysis.botLaneMatchup.lanePhase}</p>
                                    <p className="text-sm text-slate-400"><strong className="text-slate-300">All-in Potential:</strong> {analysis.botLaneMatchup.allInPotential}</p>
                                </div>
                                <div>
                                    {analysis.botLaneMatchup.keyCooldowns.length > 0 && (
                                        <>
                                            <h5 className="text-xs font-bold text-slate-500 uppercase mb-2">Key Cooldowns</h5>
                                            <ul className="space-y-1">
                                                {analysis.botLaneMatchup.keyCooldowns.map((cd, i) => (
                                                    <li key={i} className="text-xs text-slate-400">• {cd}</li>
                                                ))}
                                            </ul>
                                        </>
                                    )}
                                </div>
                            </div>

                        </div>
                    )}

                    {/* Bot Lane Damage Comparison - At Bottom */}
                    {analysis.botLaneMatchup?.damageComparison && (
                        <div className="mt-6 pt-4 border-t border-slate-800">
                            <h4 className="text-xs font-bold text-pyke-green uppercase tracking-wider mb-3">2v2 Damage Comparison</h4>
                            <p className="text-xs text-slate-500 mb-4">Enemy Bot + Support vs Your Bot + Pyke</p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                                        {/* Enemy Damage */}
                                        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
                                            <div className="text-xs text-red-400 uppercase font-bold mb-2">Enemy Combo</div>
                                            <div className="text-xs text-slate-400 mb-2">{analysis.botLaneMatchup.damageComparison.enemyCombo.description}</div>
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <div className="text-xs text-slate-500">Level 3</div>
                                                    <div className="text-lg font-bold text-red-400">{analysis.botLaneMatchup.damageComparison.enemyCombo.level3}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-slate-500">Level 6</div>
                                                    <div className="text-lg font-bold text-red-400">{analysis.botLaneMatchup.damageComparison.enemyCombo.level6}</div>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Your Damage */}
                                        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-4">
                                            <div className="text-xs text-green-400 uppercase font-bold mb-2">Your Combo</div>
                                            <div className="text-xs text-slate-400 mb-2">{analysis.botLaneMatchup.damageComparison.yourCombo.description}</div>
                                            <div className="grid grid-cols-3 gap-2">
                                                <div>
                                                    <div className="text-xs text-slate-500">Level 3</div>
                                                    <div className="text-lg font-bold text-green-400">{analysis.botLaneMatchup.damageComparison.yourCombo.level3}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-slate-500">Level 6</div>
                                                    <div className="text-lg font-bold text-green-400">{analysis.botLaneMatchup.damageComparison.yourCombo.level6}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-slate-500">L6 + Ult</div>
                                                    <div className="text-lg font-bold text-pyke-green">{analysis.botLaneMatchup.damageComparison.yourCombo.level6WithUlt}</div>
                                                </div>
                                            </div>
                            </div>
                            </div>

                            {/* Advantage Indicator */}
                            <div className={`p-3 rounded-lg border ${
                                analysis.botLaneMatchup.damageComparison.advantage === 'FAVORABLE' 
                                    ? 'bg-green-500/10 border-green-500/30' 
                                    : analysis.botLaneMatchup.damageComparison.advantage === 'EVEN'
                                    ? 'bg-yellow-500/10 border-yellow-500/30'
                                    : 'bg-red-500/10 border-red-500/30'
                            }`}>
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-bold uppercase">Advantage:</span>
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${
                                        analysis.botLaneMatchup.damageComparison.advantage === 'FAVORABLE' 
                                            ? 'bg-green-500/20 text-green-400' 
                                            : analysis.botLaneMatchup.damageComparison.advantage === 'EVEN'
                                            ? 'bg-yellow-500/20 text-yellow-400'
                                            : 'bg-red-500/20 text-red-400'
                                    }`}>
                                        {analysis.botLaneMatchup.damageComparison.advantage}
                                    </span>
                                </div>
                                <ul className="space-y-1">
                                    {analysis.botLaneMatchup.damageComparison.notes.map((note, i) => (
                                        <li key={i} className="text-xs text-slate-400">• {note}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}

                    {/* Damage Analysis */}
                    {analysis.damageAnalysis && (
                        <div className="mt-6 pt-4 border-t border-slate-800">
                            <h4 className="text-xs font-bold text-pyke-green uppercase tracking-wider mb-3">Damage Analysis</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-3">
                                <div className="bg-slate-800/50 p-3 rounded border border-slate-700/50">
                                    <div className="text-xs text-slate-500 mb-1">Level 3 Combo</div>
                                    <div className="text-lg font-bold text-red-400">{analysis.damageAnalysis.level3Combo} damage</div>
                                </div>
                                <div className="bg-slate-800/50 p-3 rounded border border-slate-700/50">
                                    <div className="text-xs text-slate-500 mb-1">Level 6 Combo</div>
                                    <div className="text-lg font-bold text-orange-400">{analysis.damageAnalysis.level6Combo} damage</div>
                                </div>
                                <div className="bg-slate-800/50 p-3 rounded border border-slate-700/50">
                                    <div className="text-xs text-slate-500 mb-1">Level 6 + Ult</div>
                                    <div className="text-lg font-bold text-pyke-green">{analysis.damageAnalysis.level6WithUlt} damage</div>
                                </div>
                            </div>
                            <div className="text-sm text-slate-400 mb-2">
                                <strong className="text-slate-300">Execute Threshold:</strong> {analysis.damageAnalysis.killThreshold}
                            </div>
                            <ul className="space-y-1">
                                {analysis.damageAnalysis.notes.map((note, i) => (
                                    <li key={i} className="text-xs text-slate-500">• {note}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </HudFrame>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Items Section */}
                <HudFrame accent="steel" label="Arsenal" className="space-y-6 p-6">
                    <h3 className="hud-heading text-xl text-slate-300">
                        <ChromeMark size={14} className="text-chrome-bright" /> Item Build
                    </h3>

                    <p className="text-[11px] text-chrome-dim font-mono tracking-wide border border-chrome-silver/15 bg-chrome-ink/40 px-3 py-2">
                        Keep World Atlas — it quests into Bloodsong in the same slot. Never sell your support item.
                        Boots stop at mid-tier (Ionian / Swiftness / Mercs / Steelcaps); Noxian upgrades are optional.
                    </p>

                    {/* Full Build Path */}
                    <div className="space-y-2">
                        <label className="text-xs text-slate-500 uppercase tracking-wider">Build Path</label>
                        <div className="flex flex-wrap gap-2 items-center bg-slate-800/50 p-3 rounded-lg border border-slate-700">
                            {build.buildPath.map((item, i) => (
                                <React.Fragment key={i}>
                                    <ItemIcon item={item} />
                                    {i < build.buildPath.length - 1 && (
                                        <span className="text-slate-600">→</span>
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs text-slate-500 uppercase tracking-wider">Starting Items</label>
                        <div className="flex gap-2">
                            {build.starter.map((item, i) => <ItemIcon key={i} item={item} />)}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs text-slate-500 uppercase tracking-wider">Core + Boots</label>
                        <div className="flex gap-2 items-center">
                            <ItemIcon item={build.boots} />
                            <div className="w-4 h-px bg-slate-700"></div>
                            {build.core.map((item, i) => <ItemIcon key={i} item={item} size="w-14 h-14" />)}
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs text-slate-500 uppercase tracking-wider">Situational (pick 1–2)</label>
                        <div className="flex gap-2">
                            {build.situational.map((item, i) => <ItemIcon key={i} item={item} />)}
                        </div>
                    </div>
                </HudFrame>

                {/* Runes Section */}
                <HudFrame accent="blood" label="Perks" className="space-y-6 p-6">
                    <h3 className="hud-heading text-xl text-slate-300">
                        <ChromeMark size={14} className="text-chrome-blood" /> Runes Reforged
                    </h3>

                    <div className="bg-pyke-accent/20 p-4 rounded border border-slate-700">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-2">
                                <img
                                    src={primaryStyle.icon}
                                    alt={primaryStyle.name}
                                    className="w-8 h-8"
                                />
                                <span className="text-pyke-green font-bold text-lg">{keystone.name}</span>
                            </div>
                            <span className="text-xs text-slate-400">{primaryStyle.name}</span>
                        </div>

                        <div className="space-y-3">
                            {/* Keystone */}
                            <div className="flex items-center gap-3">
                                <RuneIcon id={keystoneId} reason={runes.reasons[keystoneId]} size="w-10 h-10" />
                                <span className="text-white font-bold">{keystone.name}</span>
                            </div>

                            {/* Primary tree minor runes */}
                            <div className="flex gap-4 pl-2">
                                {primaryMinorIds.map((id) => (
                                    <RuneIcon key={id} id={id} reason={runes.reasons[id]} />
                                ))}
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-700">
                            <div className="flex items-center gap-2 mb-2">
                                <span className="text-xs text-slate-400">Secondary Tree</span>
                                <img src={secondaryStyle.icon} alt={secondaryStyle.name} className="w-5 h-5" />
                                <span className="text-xs text-slate-500">{secondaryStyle.name}</span>
                            </div>

                            <div className="flex gap-4 pl-2">
                                {secondaryIds.map((id) => (
                                    <RuneIcon key={id} id={id} reason={runes.reasons[id]} />
                                ))}
                            </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-slate-700">
                            <div className="text-xs text-slate-400 mb-2">Stat Shards</div>
                            <div className="flex gap-4 pl-2">
                                {shardIds.map((id, i) => (
                                    <RuneIcon key={`${id}-${i}`} id={id} reason={runes.reasons[id]} size="w-6 h-6" />
                                ))}
                            </div>
                        </div>
                    </div>
                </HudFrame>
            </div>
        </div>
    );
};
