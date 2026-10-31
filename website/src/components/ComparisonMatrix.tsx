export function ComparisonMatrix() {
  const rows = [
    {
      metric: 'Memory footprint',
      commercial: '450 MB – 850 MB RAM',
      onetrick: '< 150 MB RAM',
      note: 'No Chromium render processes in-game',
    },
    {
      metric: 'In-game FPS impact',
      commercial: '5% – 15% drop during teamfights',
      onetrick: '< 1% impact (0 dropped frames)',
      note: 'Static opaque layers, no blur shaders',
    },
    {
      metric: 'Ads and monetization',
      commercial: 'Video ads, paid tiers, telemetry',
      onetrick: '100% Free & Open Source (MIT)',
      note: 'No accounts, no trackers',
    },
    {
      metric: 'Mouse input',
      commercial: 'Can intercept clicks or steal focus',
      onetrick: '100% click-through window',
      note: 'Windows setIgnoreMouseEvents API',
    },
    {
      metric: 'Summoner hotkeys',
      commercial: 'Manual clicking or Alt-Tab',
      onetrick: 'Global low-level hook (PgUp/PgDn)',
      note: 'Works while League has exclusive focus',
    },
    {
      metric: 'Champion guidance',
      commercial: 'Scraped win-rate averages',
      onetrick: 'Authored doctrine (Pyke / Panth / Yone) + Live API',
      note: 'Item rush & runes derived from kit matchups',
    },
  ]

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0c0d12] shadow-[0_24px_80px_rgba(0,0,0,0.6)] gothic-bracket">
      <div className="border-b border-white/10 px-6 py-4">
        <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
          Resource usage
        </span>
        <h3 className="font-display text-xl font-semibold text-white tracking-wide">
          Measured comparison
        </h3>
        <p className="mt-1 text-xs text-zinc-400">
          Tested on Windows 11 running League of Legends (1440p borderless).
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-black/50 font-mono text-xs uppercase tracking-wider text-zinc-400">
              <th className="px-6 py-3.5 font-medium">Metric</th>
              <th className="px-6 py-3.5 font-medium text-zinc-400">Commercial overlays</th>
              <th className="px-6 py-3.5 font-medium text-white">One Trick</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 font-sans">
            {rows.map((r) => (
              <tr key={r.metric} className="hover:bg-white/[0.02] transition-colors">
                <td className="px-6 py-4">
                  <div className="font-medium text-white">{r.metric}</div>
                  <div className="text-xs text-zinc-400 mt-0.5">{r.note}</div>
                </td>
                <td className="px-6 py-4 text-zinc-400">{r.commercial}</td>
                <td className="px-6 py-4 font-medium text-emerald-400">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    <span>{r.onetrick}</span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
