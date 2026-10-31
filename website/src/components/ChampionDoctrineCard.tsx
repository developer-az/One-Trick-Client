import { useState } from 'react'

type ChampionKey = 'pyke' | 'pantheon' | 'yone'

interface DoctrineData {
  id: ChampionKey
  name: string
  role: string
  title: string
  archetype: string
  splashUrl: string
  iconUrl: string
  keystone: {
    name: string
    tree: string
    iconUrl: string
  }
  items: Array<{ id: string; name: string; tag: string }>
  strongInto: string[]
  weakInto: string[]
  earlySpike: string
  habit: string
  leak: string
}

const DOCTRINE: Record<ChampionKey, DoctrineData> = {
  pyke: {
    id: 'pyke',
    name: 'Pyke',
    role: 'Support',
    title: 'The Bloodharbor Ripper',
    archetype: 'Execute Roamer & Flank Assassin',
    splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Pyke_0.jpg',
    iconUrl: 'https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Pyke.png',
    keystone: {
      name: 'Hail of Blades',
      tree: 'Domination',
      iconUrl:
        'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/domination/hailofblades/hailofblades.png',
    },
    items: [
      { id: '3179', name: 'Umbral Glaive', tag: 'Rush 1st' },
      { id: '6701', name: 'Opportunity', tag: 'Core 2nd' },
      { id: '3877', name: 'Bloodsong', tag: 'Support Quest' },
      { id: '3814', name: 'Edge of Night', tag: 'Spell Shield' },
      { id: '3009', name: 'Boots of Swiftness', tag: 'Roam MS' },
    ],
    strongInto: ['Senna', 'Lux', 'Sona', "Vel'Koz"],
    weakInto: ['Nautilus', 'Leona', 'Morgana', 'Alistar'],
    earlySpike: 'Level 2 hook + E stun guarantees blown summoners or kill against squishy lanes.',
    habit: 'Crash wave 3, deep ward enemy jungle camps, and sweep river before objectives.',
    leak: 'Holding Death From Below for a multi-kill clip. Execute the first low target to reset and claim Your Cut.',
  },
  pantheon: {
    id: 'pantheon',
    name: 'Pantheon',
    role: 'Support',
    title: 'The Unbreakable Spear',
    archetype: 'Point-and-Click Dive & Lockdown',
    splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Pantheon_0.jpg',
    iconUrl: 'https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Pantheon.png',
    keystone: {
      name: 'Press the Attack',
      tree: 'Precision',
      iconUrl:
        'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/perk-images/styles/precision/presstheattack/presstheattack.png',
    },
    items: [
      { id: '6692', name: 'Eclipse', tag: 'Rush 1st' },
      { id: '6610', name: 'Sundered Sky', tag: 'Core 2nd' },
      { id: '3877', name: 'Bloodsong', tag: 'Support Quest' },
      { id: '3071', name: 'Black Cleaver', tag: 'Armor Shred' },
      { id: '3047', name: 'Plated Steelcaps', tag: 'Tower Dives' },
    ],
    strongInto: ['Yuumi', 'Janna', 'Lulu', 'Smolder'],
    weakInto: ['Thresh', 'Poppy', 'Braum', 'Renata Glasc'],
    earlySpike: '5-stack empowered W at level 2 triggers instant PtA burst and ignite lethal.',
    habit: 'Dive with empowered W, then turn your E shield backwards to block incoming tower shots.',
    leak: 'Spending full 5 mortal will stacks on raw ranged Q poke instead of saving it for the W stun.',
  },
  yone: {
    id: 'yone',
    name: 'Yone',
    role: 'Mid',
    title: 'The Unforgotten',
    archetype: 'Melee Hypercarry & Splitpusher',
    splashUrl: 'https://ddragon.leagueoflegends.com/cdn/img/champion/splash/Yone_0.jpg',
    iconUrl: 'https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Yone.png',
    keystone: {
      name: 'Lethal Tempo',
      tree: 'Precision',
      iconUrl:
        'https://ddragon.leagueoflegends.com/cdn/img/perk-images/Styles/Precision/LethalTempo/LethalTempoTemp.png',
    },
    items: [
      { id: '3006', name: "Berserker's Greaves", tag: 'First Back' },
      { id: '3153', name: 'Blade of the Ruined King', tag: 'Rush 1st' },
      { id: '3031', name: 'Infinity Edge', tag: 'Core 2nd' },
      { id: '3072', name: 'Immortal Shieldbow', tag: 'Lifeline' },
      { id: '3026', name: 'Guardian Angel', tag: 'Teamfight' },
    ],
    strongInto: ['Kassadin', 'Veigar', 'Aurelion Sol', 'Hwei'],
    weakInto: ['Pantheon', 'Renekton', 'Akali', 'Vex'],
    earlySpike: 'Berserker Greaves completed lowers Q and W cooldowns to maximum duel threshold.',
    habit: 'Cast Soul Unbound only after enemy crowd control is baited. Q3 in, shield with W, snap back.',
    leak: 'Lingering in Soul Unbound form while the enemy jungler approaches your stationary body anchor.',
  },
}

export function ChampionDoctrineCard() {
  const [selected, setSelected] = useState<ChampionKey>('pyke')
  const doc = DOCTRINE[selected]

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0c0d12] shadow-[0_24px_80px_rgba(0,0,0,0.6)] gothic-bracket">
      {/* Splash Art Banner with Gradient Fade */}
      <div className="relative h-40 w-full overflow-hidden border-b border-white/10 bg-black sm:h-32">
        <img
          src={doc.splashUrl}
          alt=""
          className="h-full w-full object-cover object-top opacity-40 transition-opacity duration-300"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0c0d12] via-[#0c0d12]/60 to-transparent" />

        {/* Header overlays inside banner */}
        <div className="absolute inset-0 flex flex-col justify-end gap-2 p-4 sm:flex-row sm:items-end sm:justify-between sm:gap-0 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src={doc.iconUrl}
              alt=""
              className="h-12 w-12 flex-none rounded-lg border border-white/20 shadow-md"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-display text-2xl font-semibold tracking-wide text-white">
                  {doc.name}
                </h3>
                <span className="flex-none rounded border border-white/15 bg-black/60 px-2 py-0.5 font-mono text-[11px] text-zinc-300">
                  {doc.role}
                </span>
              </div>
              <div className="text-xs text-zinc-400">{doc.archetype}</div>
            </div>
          </div>

          {/* Champion Selector Buttons */}
          <div
            role="group"
            aria-label="Champion doctrine"
            className="flex flex-none gap-1 self-start rounded-lg border border-white/15 bg-black/70 p-1 sm:self-auto"
          >
            {(['pyke', 'pantheon', 'yone'] as ChampionKey[]).map((key) => {
              const active = selected === key
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelected(key)}
                  aria-pressed={active}
                  className={`rounded px-2 py-1 font-display text-[11px] tracking-wider transition-colors sm:px-2.5 sm:text-xs ${
                    active
                      ? 'bg-zinc-200 text-black font-semibold'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {key.toUpperCase()}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Main Doctrine Details */}
      <div className="p-5 sm:p-6 space-y-5">
        {/* Core Item Build with Real DDragon Icons */}
        <div>
          <div className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
            Authored Item Build Sequence
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {doc.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded border border-white/10 bg-black/40 p-2"
              >
                <img
                  src={`https://ddragon.leagueoflegends.com/cdn/15.1.1/img/item/${item.id}.png`}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="h-8 w-8 flex-none rounded border border-white/15"
                />
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-white">{item.name}</div>
                  <div className="truncate font-mono text-[10px] text-zinc-400">{item.tag}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Keystones & Matchups */}
        <div className="grid gap-4 sm:grid-cols-2 border-t border-white/10 pt-4">
          {/* Rune Keystone */}
          <div className="rounded-lg border border-white/10 bg-black/30 p-3">
            <div className="text-xs uppercase tracking-wider text-zinc-400 mb-1.5">
              Primary Rune Keystone
            </div>
            <div className="flex items-center gap-2.5">
              <img
                src={doc.keystone.iconUrl}
                alt=""
                loading="lazy"
                decoding="async"
                className="h-7 w-7 rounded-full bg-black/60 p-0.5 border border-white/20"
              />
              <div>
                <span className="text-sm font-medium text-white">{doc.keystone.name}</span>
                <span className="ml-2 text-xs text-zinc-400">({doc.keystone.tree})</span>
              </div>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-300">{doc.earlySpike}</p>
          </div>

          {/* Matchup Context */}
          <div className="rounded-lg border border-white/10 bg-black/30 p-3 space-y-2">
            <div>
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Punishes:
              </span>
              <span className="ml-2 text-xs text-zinc-300">{doc.strongInto.join(', ')}</span>
            </div>
            <div>
              <span className="text-xs font-semibold text-rose-400 uppercase tracking-wider">
                Respect:
              </span>
              <span className="ml-2 text-xs text-zinc-300">{doc.weakInto.join(', ')}</span>
            </div>
          </div>
        </div>

        {/* Habits vs Leaks */}
        <div className="grid gap-3 sm:grid-cols-2 border-t border-white/10 pt-4 text-xs">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-950/20 p-3">
            <div className="font-semibold text-emerald-400 uppercase tracking-wider">
              Habit that Earns LP
            </div>
            <p className="mt-1 leading-relaxed text-zinc-300">{doc.habit}</p>
          </div>
          <div className="rounded-lg border border-rose-500/20 bg-rose-950/20 p-3">
            <div className="font-semibold text-rose-400 uppercase tracking-wider">
              Leak that Costs LP
            </div>
            <p className="mt-1 leading-relaxed text-zinc-300">{doc.leak}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
