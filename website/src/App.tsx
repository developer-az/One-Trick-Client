import { ChampionDoctrineCard } from './components/ChampionDoctrineCard'
import { ComparisonMatrix } from './components/ComparisonMatrix'
import { DemoVideo } from './components/DemoVideo'
import { DownloadActions } from './components/DownloadActions'
import { InteractiveSummonerTimers } from './components/InteractiveSummonerTimers'
import { Reveal } from './components/Reveal'
import { SiteFooter } from './components/SiteFooter'
import { SiteHeader } from './components/SiteHeader'
import { siteHref } from './lib/site'
import { useLatestRelease } from './lib/useRelease'

const features = [
  {
    title: 'Client export',
    body: 'Items and runes go directly into the League client from champion select with one click. You stay in the lobby.',
    href: '/getting-started/',
    link: 'Setting up One Trick',
  },
  {
    title: 'Summoner timers',
    body: 'Enemy Flash and combat sums toggled with PageUp and PageDown while League has exclusive focus.',
    href: '/overlay/',
    link: 'Overlay and hotkeys',
  },
  {
    title: 'Click-through HUD',
    body: 'Gank probability radar, vision warnings, next buy, and action line. The mouse strictly belongs to the game.',
    href: '/overlay/',
    link: 'HUD modules',
  },
  {
    title: 'Web HUD studio',
    body: 'Pin modules on an interactive League HUD map in your browser, then load that layout in the overlay.',
    href: '/studio/',
    link: 'Open the studio',
  },
  {
    title: 'Every champion',
    body: 'Deep authored doctrine for Pyke, Pantheon, and Yone. All other champions resolve from the live Community Dragon catalog.',
    href: '/getting-started/',
    link: 'What you get in champion select',
  },
  {
    title: 'Zero API keys',
    body: 'Region, lobby, and draft come from the local League Client API. Nothing to register with Riot or configure.',
    href: '/about/',
    link: 'About and FAQ',
  },
]

const zipSteps = [
  { n: '01', title: 'Download the zip', body: 'One file from the latest release. No store account or registration needed.' },
  { n: '02', title: 'Extract the folder', body: 'Keep it somewhere permanent, such as Documents\\One Trick.' },
  { n: '03', title: 'Run OneTrick.exe', body: 'Start League, export in champion select, and play without lag.' },
]

const setupSteps = [
  { n: '01', title: 'Download the setup', body: 'The optional setup installer installs for your Windows user without administrator rights.' },
  { n: '02', title: 'Run it', body: 'It installs for your Windows user and adds a Start menu shortcut.' },
  { n: '03', title: 'Open One Trick', body: 'Start League, export in champion select, and play without lag.' },
]

export default function App() {
  const { release, loaded } = useLatestRelease()
  const installSteps = loaded && release?.kind === 'setup' ? setupSteps : zipSteps

  return (
    <>
      <SiteHeader />
      <main>
        {/* Hero Section */}
        <section className="hero-band border-b border-white/10">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-chrome-gold/30 bg-chrome-gold/10 px-3 py-1 text-[11px] font-medium tracking-[0.2em] text-chrome-gold">
                <span>WINDOWS</span>
                <span className="opacity-40">·</span>
                <span>LEAGUE OF LEGENDS</span>
              </div>
              <h1 className="mt-4 font-display text-5xl font-medium tracking-wide text-chrome-bright sm:text-6xl lg:text-7xl">
                One Trick
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-chrome-silver/90">
                A high-precision, zero-bloat companion that fills champion select and keeps a click-through tactical HUD on the Rift. No video ads. No electron stutters. Zero in-game framerate penalty.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <DownloadActions release={release} />
                <a href={siteHref('/studio/')} className="btn-line">
                  Open HUD Studio
                </a>
              </div>

              {/* Performance Spec Badges */}
              <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/10 pt-6 font-mono text-xs text-chrome-dim">
                <span className="flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  &lt; 150 MB RAM
                </span>
                <span className="flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  &lt; 1% FPS Impact
                </span>
                <span className="flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  100% Click-Through
                </span>
                <span className="flex items-center gap-1.5 rounded border border-white/10 bg-black/40 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  0 API Keys
                </span>
              </div>

              {release ? (
                <p className="mt-3 text-xs text-chrome-dim">
                  {release.kind === 'zip' ? 'Latest zip' : 'Latest file'}: {release.assetName}
                </p>
              ) : null}
            </div>

            {/* Right: Live Interactive Champion Doctrine Card */}
            <div>
              <ChampionDoctrineCard />
            </div>
          </div>
        </section>

        {/* Demo Video Section */}
        <section className="demo-band border-b border-white/10" aria-labelledby="demo-heading">
          <div className="mx-auto w-full max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
            <Reveal>
              <div className="text-center">
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-chrome-gold">
                  Match Workflow
                </span>
                <h2
                  id="demo-heading"
                  className="mt-2 font-display text-3xl font-medium tracking-wide text-chrome-bright sm:text-4xl"
                >
                  From Champion Select to the Rift
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-chrome-dim">
                  See how One Trick auto-detects lobby picks, recommends situational loadouts, and exports runes directly into your League client.
                </p>
              </div>
            </Reveal>

            <Reveal className="mt-10" delayMs={100}>
              <DemoVideo />
            </Reveal>
          </div>
        </section>

        {/* Interactive Summoner Timers Showcase */}
        <section className="bg-[#0b0c10] border-b border-white/10 py-16 sm:py-20">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-2">
            <Reveal>
              <div>
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-chrome-gold">
                  In-Game Overlay
                </span>
                <h2 className="mt-2 font-display text-3xl font-medium tracking-wide text-chrome-bright sm:text-4xl">
                  Summoner Tracking with Zero Delay
                </h2>
                <p className="mt-4 text-base leading-relaxed text-chrome-dim">
                  Commercial companion apps require taking your hand off the mouse to click an overlay icon or Alt-Tabbing. One Trick registers a Windows low-level keyboard hook: tap <kbd className="kbd-key">PageUp</kbd> or <kbd className="kbd-key">PageDown</kbd> while staying 100% focused on League.
                </p>
                <ul className="mt-6 space-y-3 text-sm text-chrome-silver/90">
                  <li className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-chrome-gold" />
                    <span>Works in exclusive fullscreen and borderless windowed mode</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-chrome-gold" />
                    <span>Opaque dark panels designed for instant peripheral vision reading</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-chrome-gold" />
                    <span>Zero CSS blur or filter recalculations to preserve game FPS</span>
                  </li>
                </ul>
              </div>
            </Reveal>

            <Reveal delayMs={100}>
              <InteractiveSummonerTimers />
            </Reveal>
          </div>
        </section>

        {/* The Zero-Debuff Benchmark Matrix */}
        <section className="bg-[#07080a] border-b border-white/10 py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <Reveal>
              <div className="text-center mb-10">
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-chrome-gold">
                  No Bloatware
                </span>
                <h2 className="mt-2 font-display text-3xl font-medium tracking-wide text-chrome-bright sm:text-4xl">
                  Built for Competitors Who Care About Frames
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-chrome-dim">
                  Most companion apps are heavy advertising platforms. One Trick was built from the ground up as a focused competitive tool.
                </p>
              </div>
            </Reveal>

            <Reveal delayMs={100}>
              <ComparisonMatrix />
            </Reveal>
          </div>
        </section>

        {/* Web HUD Studio Teaser */}
        <section className="bg-gradient-to-b from-[#0b0c10] to-[#07080a] border-b border-white/10 py-16 sm:py-20">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-10 px-5 sm:px-8 lg:grid-cols-2">
            <Reveal>
              <div>
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-chrome-gold">
                  Layout Companion
                </span>
                <h2 className="mt-2 font-display text-3xl font-medium tracking-wide text-chrome-bright sm:text-4xl">
                  Design Your HUD in the Browser
                </h2>
                <p className="mt-4 text-base leading-relaxed text-chrome-dim">
                  The Web HUD Studio lets you drag, pin, and resize summoner timers, gank probability squares, and next-buy indicators over a League HUD reference canvas. Export your custom layout JSON and load it directly into the desktop client.
                </p>
                <div className="mt-6 flex items-center gap-4">
                  <a href={siteHref('/studio/')} className="btn-chrome">
                    Launch Web HUD Studio
                  </a>
                  <a href={siteHref('/overlay/')} className="btn-line">
                    Overlay Guide
                  </a>
                </div>
              </div>
            </Reveal>

            <Reveal delayMs={100}>
              <div className="rounded-xl border border-white/10 bg-black/40 p-6 gothic-bracket">
                <div className="flex items-center justify-between border-b border-white/10 pb-3 font-mono text-xs text-chrome-dim">
                  <span>CANVAS PREVIEW</span>
                  <span className="text-emerald-400">1920 x 1080 Normalized</span>
                </div>
                <div className="mt-4 space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] p-2.5">
                    <span className="text-chrome-silver">Summoner Timers Anchor</span>
                    <span className="text-chrome-gold">Left of Minimap</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] p-2.5">
                    <span className="text-chrome-silver">Gank Probability Square</span>
                    <span className="text-chrome-gold">Minimap Corner</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] p-2.5">
                    <span className="text-chrome-silver">Next Buy Item Slot</span>
                    <span className="text-chrome-gold">Above Inventory</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] p-2.5">
                    <span className="text-chrome-silver">Action Cue Banner</span>
                    <span className="text-chrome-gold">Centered Sub-HUD</span>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="feature-band border-b border-white/10 py-16 sm:py-20" aria-label="Features">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <Reveal>
              <div className="mb-12">
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-chrome-gold">
                  Core Capabilities
                </span>
                <h2 className="mt-2 font-display text-3xl font-medium tracking-wide text-chrome-bright sm:text-4xl">
                  Engineered for Every Phase of the Game
                </h2>
              </div>
            </Reveal>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, i) => (
                <Reveal key={feature.title} delayMs={i * 50}>
                  <article className="feature-card gothic-bracket flex flex-col justify-between">
                    <div>
                      <h3 className="font-display text-lg font-medium text-chrome-bright flex items-center gap-2">
                        <span className="h-1 w-3 bg-chrome-gold" />
                        {feature.title}
                      </h3>
                      <p className="mt-3 text-sm leading-relaxed text-chrome-dim">{feature.body}</p>
                    </div>
                    <a
                      href={siteHref(feature.href)}
                      className="feature-link mt-4 inline-block font-mono text-xs uppercase tracking-wider text-chrome-gold no-underline hover:text-white"
                    >
                      {feature.link} &rarr;
                    </a>
                  </article>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Installation & Setup Section */}
        <section className="bg-[#07080a] py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <div className="grid gap-12 lg:grid-cols-2 items-center">
              <Reveal>
                <div>
                  <span className="font-mono text-xs uppercase tracking-[0.2em] text-chrome-gold">
                    Simple Installation
                  </span>
                  <h2 className="mt-2 font-display text-3xl font-medium tracking-wide text-chrome-bright sm:text-4xl">
                    Ready in 30 Seconds
                  </h2>
                  <p className="mt-4 text-base leading-relaxed text-chrome-dim">
                    One Trick ships as a standalone portable zip or lightweight user installer. No background updaters, no telemetry demons, no kernel drivers.
                  </p>
                  <div className="mt-6 note">
                    <p className="text-xs leading-relaxed text-amber-200/90">
                      <strong>Windows SmartScreen notice:</strong> Because One Trick is free, open-source software without an expensive enterprise certificate, Windows may show a standard SmartScreen notice. Click <em>More info</em> &rarr; <em>Run anyway</em>. The app never asks for administrator access.
                    </p>
                  </div>
                </div>
              </Reveal>

              <Reveal delayMs={100}>
                <div className="rounded-xl border border-white/10 bg-black/40 p-6 sm:p-8 gothic-bracket shadow-[0_24px_80px_rgba(0,0,0,0.5)]">
                  <ol className="space-y-6">
                    {installSteps.map((step) => (
                      <li key={step.n} className="grid grid-cols-[auto_1fr] gap-4">
                        <span className="flex h-7 w-7 items-center justify-center rounded border border-chrome-gold/40 bg-chrome-gold/10 font-mono text-xs font-semibold text-chrome-gold">
                          {step.n}
                        </span>
                        <div>
                          <p className="font-medium text-chrome-bright">{step.title}</p>
                          <p className="mt-1 text-sm leading-relaxed text-chrome-dim">{step.body}</p>
                        </div>
                      </li>
                    ))}
                  </ol>
                  <div className="mt-8 border-t border-white/10 pt-6">
                    <DownloadActions release={release} />
                  </div>
                </div>
              </Reveal>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
