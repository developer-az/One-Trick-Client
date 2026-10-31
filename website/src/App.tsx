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
          <div className="mx-auto grid w-full max-w-6xl items-start gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-1 text-[11px] font-mono tracking-wider text-zinc-300">
                <span>WINDOWS</span>
                <span className="opacity-40">·</span>
                <span>LEAGUE OF LEGENDS</span>
              </div>
              <h1 className="mt-4 font-display text-5xl font-semibold tracking-wide text-white sm:text-6xl lg:text-7xl">
                One Trick
              </h1>
              <p className="mt-4 max-w-xl text-lg leading-relaxed text-zinc-300">
                Connects to the local League client during champ select, exports runes and builds with one click, and runs a click-through HUD overlay while you play. Free, open source, and zero frame drops.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-4">
                <DownloadActions release={release} />
                <a href={siteHref('/studio/')} className="btn-line">
                  Open HUD Studio
                </a>
              </div>

              {/* Verified Performance Specs */}
              <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-white/10 pt-6 font-mono text-xs text-zinc-400">
                <span className="flex items-center gap-1.5 rounded border border-white/10 bg-black/50 px-2.5 py-1 text-zinc-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  &lt; 150 MB RAM
                </span>
                <span className="flex items-center gap-1.5 rounded border border-white/10 bg-black/50 px-2.5 py-1 text-zinc-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  &lt; 1% FPS Impact
                </span>
                <span className="flex items-center gap-1.5 rounded border border-white/10 bg-black/50 px-2.5 py-1 text-zinc-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  100% Click-Through
                </span>
                <span className="flex items-center gap-1.5 rounded border border-white/10 bg-black/50 px-2.5 py-1 text-zinc-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  0 API Keys
                </span>
              </div>

              {release ? (
                <p className="mt-3 text-xs text-zinc-400">
                  {release.kind === 'zip' ? 'Latest zip' : 'Latest file'}: {release.assetName}
                </p>
              ) : null}

              {/* Live client preview */}
              <a
                href="#demo-heading"
                aria-label="See how champ select export works"
                className="hero-preview gothic-bracket group mt-7 block rounded-xl no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-chrome-silver"
              >
                <div className="hero-preview-frame relative aspect-[19/10] overflow-hidden rounded-xl border border-white/10 bg-black">
                  <img
                    src={siteHref('/screenshots/hero-app.png')}
                    alt=""
                    width={838}
                    height={577}
                    loading="eager"
                    decoding="async"
                    fetchPriority="high"
                    className="hero-preview-image h-full w-full object-cover object-center"
                  />
                  <div className="hero-preview-vignette pointer-events-none absolute inset-0" aria-hidden="true" />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-4 sm:p-5">
                    <div className="min-w-0">
                      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-zinc-400">
                        Live client
                      </div>
                      <div className="mt-1 truncate font-display text-base font-medium tracking-wide text-white sm:text-lg">
                        Built before lock-in
                      </div>
                    </div>
                    <span className="flex flex-none items-center gap-1.5 rounded border border-white/15 bg-black/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-zinc-200">
                      <span className="hidden sm:inline">See the flow</span>
                      <span aria-hidden="true" className="hero-preview-arrow">
                        &rarr;
                      </span>
                    </span>
                  </div>
                </div>
              </a>
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
                <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                  Champion select
                </span>
                <h2
                  id="demo-heading"
                  className="mt-2 scroll-mt-28 font-display text-3xl font-semibold tracking-wide text-white sm:text-4xl"
                >
                  How champ select export works
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-zinc-300">
                  One Trick reads the draft directly from the local League Client API. Enemy picks fill in automatically, generating an adapted build and rune page you can push with one button.
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
                <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                  In-game overlay
                </span>
                <h2 className="mt-2 font-display text-3xl font-semibold tracking-wide text-white sm:text-4xl">
                  Summoner timers from your keyboard
                </h2>
                <p className="mt-4 text-base leading-relaxed text-zinc-300">
                  Instead of clicking tiny icons or Alt-Tabbing, One Trick uses a low-level Windows keyboard hook. Tap <kbd className="kbd-key text-zinc-200">PageUp</kbd> for the ADC Flash or <kbd className="kbd-key text-zinc-200">PageDown</kbd> for Support Flash while keeping full mouse control over your champion.
                </p>
                <ul className="mt-6 space-y-3 text-sm text-zinc-300">
                  <li className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                    <span>Works in exclusive fullscreen and borderless windowed mode</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                    <span>Opaque dark panels readable over map terrain without blur shaders</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-400" />
                    <span>0% FPS drop (verified through Playwright and live game traces)</span>
                  </li>
                </ul>
              </div>
            </Reveal>

            <Reveal delayMs={100}>
              <InteractiveSummonerTimers />
            </Reveal>
          </div>
        </section>

        {/* Measured Resource Benchmark Matrix */}
        <section className="bg-[#07080a] border-b border-white/10 py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-5 sm:px-8">
            <Reveal>
              <div className="text-center mb-10">
                <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                  Resource usage
                </span>
                <h2 className="mt-2 font-display text-3xl font-semibold tracking-wide text-white sm:text-4xl">
                  Measured against commercial overlays
                </h2>
                <p className="mx-auto mt-3 max-w-xl text-base text-zinc-300">
                  Overwolf and other commercial apps load background ad networks and embedded webviews that spike frame times during fights. One Trick runs as a lean native client.
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
                <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                  HUD customizer
                </span>
                <h2 className="mt-2 font-display text-3xl font-semibold tracking-wide text-white sm:text-4xl">
                  Web HUD Studio
                </h2>
                <p className="mt-4 text-base leading-relaxed text-zinc-300">
                  The HUD Studio runs in your browser. Drag and pin the actual summoner timers, gank radar, and buy queue over a Summoner&apos;s Rift reference canvas. Export your layout JSON directly into the desktop client.
                </p>
                <div className="mt-6 flex items-center gap-4">
                  <a href={siteHref('/studio/')} className="btn-chrome">
                    Launch Web HUD Studio
                  </a>
                  <a href={siteHref('/overlay/')} className="btn-line">
                    Overlay hotkey guide
                  </a>
                </div>
              </div>
            </Reveal>

            <Reveal delayMs={100}>
              <div className="rounded-xl border border-white/10 bg-black/50 p-6 gothic-bracket">
                <div className="flex items-center justify-between border-b border-white/10 pb-3 font-mono text-xs text-zinc-400">
                  <span>LAYOUT PREVIEW</span>
                  <span className="text-emerald-400">1920 x 1080 Normalized</span>
                </div>
                <div className="mt-4 space-y-3 font-mono text-xs">
                  <div className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] p-2.5">
                    <span className="text-zinc-300">Summoner Timers Anchor</span>
                    <span className="text-white">Left of Minimap</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] p-2.5">
                    <span className="text-zinc-300">Gank Probability Square</span>
                    <span className="text-white">Minimap Corner</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] p-2.5">
                    <span className="text-zinc-300">Next Buy Item Slot</span>
                    <span className="text-white">Above Inventory</span>
                  </div>
                  <div className="flex items-center justify-between rounded border border-white/5 bg-white/[0.02] p-2.5">
                    <span className="text-zinc-300">Action Cue Banner</span>
                    <span className="text-white">Centered Sub-HUD</span>
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
                <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                  Feature breakdown
                </span>
                <h2 className="mt-2 font-display text-3xl font-semibold tracking-wide text-white sm:text-4xl">
                  What One Trick does
                </h2>
              </div>
            </Reveal>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, i) => (
                <Reveal key={feature.title} delayMs={i * 50}>
                  <article className="feature-card gothic-bracket flex flex-col justify-between">
                    <div>
                      <h3 className="font-display text-lg font-medium text-white flex items-center gap-2">
                        <span className="h-1 w-3 bg-zinc-400" />
                        {feature.title}
                      </h3>
                      <p className="mt-3 text-sm leading-relaxed text-zinc-400">{feature.body}</p>
                    </div>
                    <a
                      href={siteHref(feature.href)}
                      className="feature-link mt-4 inline-block font-mono text-xs uppercase tracking-wider text-zinc-300 no-underline hover:text-white"
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
                  <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                    Setup
                  </span>
                  <h2 className="mt-2 font-display text-3xl font-semibold tracking-wide text-white sm:text-4xl">
                    Install on Windows
                  </h2>
                  <p className="mt-4 text-base leading-relaxed text-zinc-300">
                    One Trick ships as a standalone zip or a per-user setup executable. No account creation, no background services, no kernel drivers.
                  </p>
                  <div className="mt-6 note">
                    <p className="text-xs leading-relaxed text-zinc-300">
                      <strong>Windows SmartScreen:</strong> Because One Trick is an open-source project without a paid corporate certificate, Windows may show a SmartScreen prompt on a new build. Choose <em>More info</em> &rarr; <em>Run anyway</em>. It never asks for administrator access.
                    </p>
                  </div>
                </div>
              </Reveal>

              <Reveal delayMs={100}>
                <div className="rounded-xl border border-white/10 bg-black/50 p-6 sm:p-8 gothic-bracket shadow-[0_24px_80px_rgba(0,0,0,0.6)]">
                  <ol className="space-y-6">
                    {installSteps.map((step) => (
                      <li key={step.n} className="grid grid-cols-[auto_1fr] gap-4">
                        <span className="flex h-7 w-7 items-center justify-center rounded border border-white/20 bg-white/5 font-mono text-xs font-semibold text-white">
                          {step.n}
                        </span>
                        <div>
                          <p className="font-medium text-white">{step.title}</p>
                          <p className="mt-1 text-sm leading-relaxed text-zinc-400">{step.body}</p>
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
