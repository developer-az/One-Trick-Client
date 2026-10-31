import { useState } from 'react'

type ChampionKey = 'pyke' | 'pantheon' | 'yone'

interface DoctrineData {
  id: ChampionKey
  name: string
  role: string
  title: string
  archetype: string
  dominancePct: number
  dominanceLabel: string
  runes: {
    primary: string
    keystone: string
    sub1: string
    sub2: string
    sub3: string
    secondary: string
  }
  items: Array<{ name: string; tag: string }>
  habit: string
  leak: string
}

const DOCTRINE: Record<ChampionKey, DoctrineData> = {
  pyke: {
    id: 'pyke',
    name: 'Pyke',
    role: 'Support',
    title: 'The Bloodharbor Ripper',
    archetype: 'Execute Roamer & Vision Denial',
    dominancePct: 84,
    dominanceLabel: 'High Kill Threat',
    runes: {
      primary: 'Domination',
      keystone: 'Hail of Blades',
      sub1: 'Sudden Impact',
      sub2: 'Zombie Ward',
      sub3: 'Relentless Hunter',
      secondary: 'Resolve (Bone Plating + Unflinching)',
    },
    items: [
      { name: 'Umbral Glaive', tag: 'Core 1st' },
      { name: 'Opportunity', tag: 'Core 2nd' },
      { name: 'Bloodsong', tag: 'Support Quest' },
      { name: 'Edge of Night', tag: 'Situational' },
    ],
    habit: 'Crash wave 3, deep ward enemy camps, and sweep mid river. Never fish hooks when E dash is on cooldown.',
    leak: 'Holding Death From Below for a 5-man montage. Execute the first low target to reset and distribute Your Cut gold.',
  },
  pantheon: {
    id: 'pantheon',
    name: 'Pantheon',
    role: 'Support',
    title: 'The Unbreakable Spear',
    archetype: 'Early Dive & Targeted Lockdown',
    dominancePct: 88,
    dominanceLabel: 'Extreme Early 2v2 Priority',
    runes: {
      primary: 'Precision',
      keystone: 'Press the Attack',
      sub1: 'Triumph',
      sub2: 'Legend: Alacrity',
      sub3: 'Coup de Grace',
      secondary: 'Inspiration (Cosmic Insight + Hexflash)',
    },
    items: [
      { name: 'Eclipse', tag: 'Core 1st' },
      { name: 'Sundered Sky', tag: 'Core 2nd' },
      { name: 'Bloodsong', tag: 'Support Quest' },
      { name: 'Black Cleaver', tag: 'Vs Armor' },
    ],
    habit: 'Empowered W at level 2 with Ignite guarantees a blown Flash or First Blood. Face E away to absorb tower agro after diving.',
    leak: 'Wasting Mortal Will 5-stacks on raw Q poke instead of holding it for the instant 3-hit W burst.',
  },
  yone: {
    id: 'yone',
    name: 'Yone',
    role: 'Mid',
    title: 'The Unforgotten',
    archetype: 'Mid-Lane Melee Hypercarry',
    dominancePct: 76,
    dominanceLabel: 'Favorable Mid Spacing',
    runes: {
      primary: 'Precision',
      keystone: 'Lethal Tempo',
      sub1: 'Triumph',
      sub2: 'Legend: Alacrity',
      sub3: 'Last Stand',
      secondary: 'Resolve (Second Wind + Overgrowth)',
    },
    items: [
      { name: "Berserker's Greaves", tag: 'First Buy' },
      { name: 'Blade of the Ruined King', tag: 'Core 1st' },
      { name: 'Infinity Edge', tag: 'Core 2nd' },
      { name: 'Immortal Shieldbow', tag: 'Defensive' },
    ],
    habit: 'Cast Soul Unbound only once enemy high-impact CC is committed. Trade with Q3 knockup + W shield, then snap back safely.',
    leak: 'Overstaying in Soul Unbound form when enemy jungle paths toward your stationary return anchor.',
  },
}

export function ChampionDoctrineCard() {
  const [selected, setSelected] = useState<ChampionKey>('pyke')
  const doc = DOCTRINE[selected]

  return (
    <div className="rounded-xl border border-chrome-gold/25 bg-[#0e0f14]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)] sm:p-7 gothic-bracket">
      {/* Top Header & Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-chrome-gold">
            Authored Doctrine
          </span>
          <h3 className="font-display text-xl font-medium tracking-wide text-chrome-bright">
            {doc.name} <span className="text-sm font-normal text-chrome-dim">({doc.role})</span>
          </h3>
        </div>

        {/* Tab pills */}
        <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 p-1">
          {(['pyke', 'pantheon', 'yone'] as ChampionKey[]).map((key) => {
            const active = selected === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setSelected(key)}
                className={`rounded px-3 py-1.5 font-display text-xs tracking-wider transition-colors ${
                  active
                    ? 'bg-chrome-silver text-black font-semibold'
                    : 'text-chrome-dim hover:text-chrome-bright'
                }`}
              >
                {key.toUpperCase()}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main content grid */}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        {/* Left: Archetype & Dominance */}
        <div>
          <div className="text-xs uppercase tracking-wider text-chrome-dim">Combat Archetype</div>
          <div className="mt-1 font-medium text-chrome-bright">{doc.archetype}</div>

          {/* Dominance Gauge */}
          <div className="mt-4 rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-chrome-dim">Draft Dominance Gauge</span>
              <span className="font-mono font-medium text-chrome-gold">{doc.dominancePct}%</span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-gradient-to-r from-chrome-gold to-chrome-silver transition-all duration-300"
                style={{ width: `${doc.dominancePct}%` }}
              />
            </div>
            <div className="mt-1.5 text-[11px] text-chrome-dim">{doc.dominanceLabel}</div>
          </div>

          {/* Runes */}
          <div className="mt-4">
            <div className="text-xs uppercase tracking-wider text-chrome-dim">Tailored Rune Tree</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 font-mono text-xs text-amber-300">
                {doc.runes.keystone}
              </span>
              <span className="text-xs text-chrome-dim">{doc.runes.primary}</span>
            </div>
            <div className="mt-1 text-xs text-chrome-dim/90">{doc.runes.secondary}</div>
          </div>
        </div>

        {/* Right: Core Item Rush */}
        <div>
          <div className="text-xs uppercase tracking-wider text-chrome-dim">Optimal Item Rush</div>
          <div className="mt-2 space-y-2">
            {doc.items.map((item) => (
              <div
                key={item.name}
                className="flex items-center justify-between rounded border border-white/5 bg-black/25 px-3 py-2 text-xs"
              >
                <span className="font-medium text-chrome-bright">{item.name}</span>
                <span className="font-mono text-[11px] text-chrome-dim">{item.tag}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom: Tactical Habits */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="grid gap-3 sm:grid-cols-2 text-xs leading-relaxed">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/15 p-3">
            <div className="font-medium text-emerald-400">Habit that Earns LP</div>
            <p className="mt-1 text-chrome-silver/90">{doc.habit}</p>
          </div>
          <div className="rounded-lg border border-red-500/20 bg-red-950/15 p-3">
            <div className="font-medium text-red-400">Leak that Costs LP</div>
            <p className="mt-1 text-chrome-silver/90">{doc.leak}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
