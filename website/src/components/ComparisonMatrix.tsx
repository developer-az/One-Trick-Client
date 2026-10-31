export function ComparisonMatrix() {
  const rows = [
    {
      metric: 'Memory Footprint',
      commercial: '450 MB – 850 MB RAM',
      onetrick: '< 150 MB RAM',
      winner: true,
    },
    {
      metric: 'In-Game FPS Impact',
      commercial: '5% – 15% drops in teamfights',
      onetrick: '< 1% impact (0 dropped frames)',
      winner: true,
    },
    {
      metric: 'Monetization & Ads',
      commercial: 'Video ads, subscriptions, trackers',
      onetrick: '100% Free & Open Source (MIT)',
      winner: true,
    },
    {
      metric: 'Mouse Click-Through',
      commercial: 'Can block clicks or steal focus',
      onetrick: '100% click-through window',
      winner: true,
    },
    {
      metric: 'Summoner Hotkeys',
      commercial: 'Requires manual mouse clicking or Alt-Tab',
      onetrick: 'Low-level Windows keyboard hook (PgUp/PgDn)',
      winner: true,
    },
    {
      metric: 'Champion Builds',
      commercial: 'Automated generic win-rate aggregates',
      onetrick: 'Authored doctrine (Pyke / Panth / Yone) + Live API',
      winner: true,
    },
  ]

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0e0f14]/90 shadow-[0_24px_80px_rgba(0,0,0,0.4)] gothic-bracket">
      <div className="border-b border-white/10 px-6 py-4">
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-chrome-gold">
          Engineered for Performance
        </span>
        <h3 className="font-display text-xl font-medium tracking-wide text-chrome-bright">
          The Zero-Debuff Benchmark
        </h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-black/40 font-mono text-xs uppercase tracking-wider text-chrome-dim">
              <th className="px-6 py-3.5">Standard</th>
              <th className="px-6 py-3.5 text-zinc-400">Typical Commercial Overlays</th>
              <th className="px-6 py-3.5 text-chrome-bright font-semibold">One Trick</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            {rows.map((r) => (
              <tr key={r.metric} className="hover:bg-white/[0.02] transition-colors">
                <td className="px-6 py-4 font-medium text-chrome-bright">{r.metric}</td>
                <td className="px-6 py-4 text-zinc-400">{r.commercial}</td>
                <td className="px-6 py-4 font-medium text-emerald-400 flex items-center gap-2">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {r.onetrick}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
