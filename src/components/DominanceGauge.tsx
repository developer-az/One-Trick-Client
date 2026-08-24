import React from 'react';
import type { DominanceMetrics } from '../logic/pykeLogic';

interface DominanceGaugeProps {
    metrics: DominanceMetrics;
}

function gradeTone(g: string): string {
    if (g === 'S+' || g === 'S') return 'text-chrome-gold';
    if (g === 'A' || g === 'B') return 'text-chrome-silver';
    if (g === 'C') return 'text-orange-400';
    return 'text-chrome-blood';
}

function barTone(val: number): string {
    if (val >= 70) return 'bg-chrome-gold';
    if (val >= 45) return 'bg-chrome-dim';
    return 'bg-chrome-blood';
}

export const DominanceGauge: React.FC<DominanceGaugeProps> = ({ metrics }) => {
    const { score, grade, earlyGameScore, midGameScore, lateGameScore } = metrics;
    const phases = [
        { k: 'E', v: earlyGameScore },
        { k: 'M', v: midGameScore },
        { k: 'L', v: lateGameScore },
    ];

    return (
        <div className="flex items-center gap-3 min-w-0" title={`Score ${score}/100`}>
            <div className={`text-2xl font-semibold leading-none ${gradeTone(grade)}`}>{grade}</div>
            <div className="flex-1 min-w-[7rem] space-y-1">
                {phases.map((p) => (
                    <div key={p.k} className="flex items-center gap-1.5">
                        <span className="text-[9px] font-mono text-chrome-dim w-3">{p.k}</span>
                        <div className="flex-1 h-1 bg-white/10 rounded-full overflow-hidden">
                            <div className={`h-full ${barTone(p.v)}`} style={{ width: `${p.v}%` }} />
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};
