import { useEffect, useState } from 'react'
import { ChromeMark } from './components/ChromeMark'
import { HudPreview } from './components/HudPreview'
import { Reveal } from './components/Reveal'
import {
  fetchLatestRelease,
  RELEASES_URL,
  REPO_URL,
  type ReleaseInfo,
} from './lib/release'

const features = [
  {
    kicker: '01 — Export',
    title: 'One click into the League Client.',
    body: 'Champ select fills the draft. Items and runes land in-client. You stay in the lobby — not in a second window of homework.',
  },
  {
    kicker: '02 — Timers',
    title: 'Enemy sums, gold when they are up.',
    body: 'Flash and combat spells as numbers and portraits. PageUp / PageDown toggle while League has focus. Click-through so it never steals the game.',
  },
  {
    kicker: '03 — HUD modules',
    title: 'A client overlay, not a coach.',
    body: 'Toggle sums, gank square, vision, buy icons, and a single time-critical line. No rotating tips. No lecture mid-fight.',
  },
]

const profiles = [
  {
    name: 'Pyke Support',
    line: 'Primary — bot tempo, all-in windows, roam-aware scoring.',
  },
  {
    name: 'Pantheon Support',
    line: 'Off-pick when Pyke is banned — same client, same HUD.',
  },
  {
    name: 'Yone Mid',
    line: 'Mid profile that tracks the enemy mid laner — jungle-aware when the draft asks.',
  },
  {
    name: 'Every other champion',
    line: 'Generic profiles from Data Dragon tags + Community Dragon rune recs — new champs resolve on the next patch ingest.',
  },
]

const steps = [
  { n: '01', title: 'Install', body: 'Grab One.Trick.Setup from the latest release and launch with League open.' },
  { n: '02', title: 'Lock in', body: 'Draft fills. Export runes and items. Leave the window.' },
  { n: '03', title: 'Play', body: 'HUD widgets stay up: timers, gank square, vision, next buy. Borderless mode.' },
]

const base = import.meta.env.BASE_URL

function DownloadButtons({ release }: { release: ReleaseInfo | null }) {
  const href = release?.downloadUrl || RELEASES_URL
  const label = release ? `Download ${release.tag}` : 'Download for Windows'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a className="btn-chrome" href={href}>
        <ChromeMark size={14} />
        {label}
      </a>
      <a className="btn-ghost" href={RELEASES_URL} target="_blank" rel="noreferrer">
        All releases
      </a>
    </div>
  )
}

export default function App() {
  const [release, setRelease] = useState<ReleaseInfo | null>(null)

  useEffect(() => {
    let alive = true
    fetchLatestRelease().then((info) => {
      if (alive) setRelease(info)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <>
      <div className="site-atmosphere" aria-hidden />
      <div className="site-content">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <a href="#top" className="flex items-center gap-2.5 text-chrome-bright no-underline">
            <ChromeMark size={22} />
            <span className="font-display text-lg tracking-tight">One Trick</span>
          </a>
          <nav className="hidden items-center gap-7 font-mono text-[11px] uppercase tracking-[0.18em] text-chrome-dim sm:flex">
            <a href="#features" className="hover:text-chrome-bright">
              Features
            </a>
            <a href="#profiles" className="hover:text-chrome-bright">
              Profiles
            </a>
            <a href={`${base}studio/`} className="hover:text-chrome-bright">
              Studio
            </a>
            <a href="#download" className="hover:text-chrome-bright">
              Download
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-chrome-bright">
              GitHub
            </a>
          </nav>
        </header>

        <main id="top">
          {/* Hero — brand + real app screenshot as one composition */}
          <section className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-4 sm:px-8 sm:pb-24">
            <div className="max-w-2xl">
              <p className="animate-fade-up font-mono text-[11px] uppercase tracking-[0.18em] text-chrome-dim">
                Windows · League of Legends
                {release?.prerelease ? ' · Public beta' : ''}
              </p>
              <h1 className="animate-fade-up mt-4 font-display text-[clamp(3.2rem,9vw,5.8rem)] leading-[0.92] tracking-tight text-chrome-bright">
                One Trick
              </h1>
              <p
                className="animate-fade-up mt-5 max-w-md text-lg leading-relaxed text-chrome-silver/85 sm:text-xl"
                style={{ animationDelay: '120ms' }}
              >
                Overlay client for every champion — authored Pyke / Pantheon / Yone doctrine, live catalog for the rest, and a HUD studio you can pin.
              </p>
              <div className="animate-fade-up mt-8" style={{ animationDelay: '220ms' }}>
                <DownloadButtons release={release} />
                {release && (
                  <p className="mt-3 font-mono text-[11px] tracking-[0.08em] text-chrome-dim">
                    Latest{release.prerelease ? ' beta' : ''}: {release.assetName}
                  </p>
                )}
              </div>
            </div>

            <div className="animate-fade-up mt-12" style={{ animationDelay: '180ms' }}>
              <HudPreview
                size="hero"
                src={`${base}screenshots/hero-app.png`}
                alt="One Trick app — enemy squad picker and Pyke Support standby"
                caption="In-app · Pyke Support · enemy squad"
              />
            </div>
          </section>

          <div className="chrome-rule mx-auto w-full max-w-6xl" />

          {/* Pitch + second real shot */}
          <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-8 sm:py-28">
            <div className="grid items-center gap-12 lg:grid-cols-[0.95fr_1.05fr] lg:gap-14">
              <Reveal>
                <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-chrome-gold">
                  Why it exists
                </p>
                <h2 className="mt-4 max-w-xl font-display text-3xl leading-tight tracking-tight text-chrome-bright sm:text-4xl">
                  Built to sit next to League — not on top of it.
                </h2>
                <p className="mt-5 max-w-lg text-base leading-relaxed text-chrome-dim sm:text-lg">
                  One Trick fills champ select, pushes a loadout into the client, and keeps a click-through HUD alive
                  while you play: summoner timers, gank square, vision, next buy. Pyke Support first; Pantheon and Yone
                  when the draft asks.
                </p>
              </Reveal>
              <Reveal delayMs={80}>
                <HudPreview
                  size="inline"
                  src={`${base}screenshots/panels-ally.png`}
                  alt="One Trick app — ally lanes and awaiting data"
                  caption="In-app · ally lanes · analysis standby"
                />
              </Reveal>
            </div>
          </section>

          {/* Features */}
          <section id="features" className="mx-auto w-full max-w-6xl px-5 pb-10 sm:px-8">
            <div className="space-y-16 sm:space-y-24">
              {features.map((f, i) => (
                <Reveal key={f.kicker} delayMs={i * 60}>
                  <article className="grid gap-4 border-t border-chrome-silver/15 pt-10 lg:grid-cols-[0.4fr_1fr] lg:gap-12">
                    <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-chrome-dim">
                      {f.kicker}
                    </p>
                    <div>
                      <h3 className="font-display text-2xl tracking-wide text-chrome-bright sm:text-3xl">
                        {f.title}
                      </h3>
                      <p className="mt-4 max-w-xl text-base leading-relaxed text-chrome-dim">
                        {f.body}
                      </p>
                    </div>
                  </article>
                </Reveal>
              ))}
            </div>
          </section>

          {/* Profiles */}
          <section id="profiles" className="mx-auto w-full max-w-6xl px-5 py-24 sm:px-8">
            <Reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-chrome-dim">
                Profiles
              </p>
              <h2 className="mt-3 font-display text-3xl tracking-wide text-chrome-bright sm:text-4xl">
                Authored one-tricks. Live catalog for everyone else.
              </h2>
            </Reveal>
            <div className="mt-12 grid gap-px bg-chrome-silver/15 sm:grid-cols-2 lg:grid-cols-4">
              {profiles.map((p, i) => (
                <Reveal key={p.name} delayMs={i * 80} className="bg-chrome-ink">
                  <div className="h-full px-6 py-8 sm:px-7 sm:py-10">
                    <ChromeMark size={18} className="text-chrome-silver" />
                    <h3 className="mt-5 font-display text-xl text-chrome-bright">{p.name}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-chrome-dim">{p.line}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* How it works */}
          <section className="mx-auto w-full max-w-6xl px-5 pb-24 sm:px-8">
            <Reveal>
              <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-chrome-dim">
                Flow
              </p>
              <h2 className="mt-3 font-display text-3xl tracking-wide text-chrome-bright">
                In. Out. Onto the Rift.
              </h2>
            </Reveal>
            <div className="mt-12 grid gap-10 sm:grid-cols-3">
              {steps.map((s, i) => (
                <Reveal key={s.n} delayMs={i * 70}>
                  <div>
                    <p className="font-mono text-sm tracking-[0.2em] text-chrome-blood">{s.n}</p>
                    <h3 className="mt-3 font-display text-xl text-chrome-bright">{s.title}</h3>
                    <p className="mt-3 text-sm leading-relaxed text-chrome-dim">{s.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </section>

          {/* Download CTA */}
          <section id="download" className="relative mx-auto w-full max-w-6xl px-5 pb-28 sm:px-8">
            <Reveal>
              <div className="hud-frame clip-panel relative overflow-hidden px-6 py-14 sm:px-12 sm:py-16">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_20%_0%,rgba(242,244,247,0.08),transparent_50%),radial-gradient(ellipse_at_90%_100%,rgba(155,28,46,0.16),transparent_45%)]" />
                <div className="relative max-w-xl">
                  <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-chrome-dim">
                    Get One Trick
                  </p>
                  <h2 className="mt-3 font-display text-3xl tracking-wide text-chrome-bright sm:text-4xl">
                    Download the latest Windows build.
                  </h2>
                  <p className="mt-4 text-base leading-relaxed text-chrome-dim">
                    Pulled live from GitHub Releases. Latest full Windows setup preferred.
                  </p>
                  <div className="mt-8">
                    <DownloadButtons release={release} />
                    {release && (
                      <p className="mt-3 font-mono text-[11px] tracking-[0.08em] text-chrome-dim">
                        {release.name}
                        {release.prerelease ? ' · pre-release' : ''}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </Reveal>
          </section>
        </main>

        <footer className="border-t border-chrome-silver/10">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <div className="flex items-center gap-2 text-chrome-dim">
              <ChromeMark size={16} />
              <span className="font-display tracking-wide text-chrome-silver">One Trick</span>
            </div>
            <p className="font-mono text-[11px] tracking-[0.12em] text-chrome-dim">
              Unofficial fan tool · Not affiliated with Riot Games
            </p>
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[11px] uppercase tracking-[0.16em] text-chrome-dim hover:text-chrome-bright"
            >
              Source on GitHub
            </a>
          </div>
        </footer>
      </div>
    </>
  )
}
