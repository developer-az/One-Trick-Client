import { DemoVideo } from './components/DemoVideo'
import { DownloadActions } from './components/DownloadActions'
import { SiteFooter } from './components/SiteFooter'
import { SiteHeader } from './components/SiteHeader'
import { siteHref } from './lib/site'
import { useLatestRelease } from './lib/useRelease'

const features = [
  {
    title: 'Client export',
    body: 'Items and runes go into the League client from champion select. You stay in the lobby.',
    href: '/getting-started/',
    link: 'Setting up One Trick',
  },
  {
    title: 'Summoner timers',
    body: 'Enemy Flash and combat sums, toggled with PageUp and PageDown while League is focused.',
    href: '/overlay/',
    link: 'Overlay and hotkeys',
  },
  {
    title: 'Click-through HUD',
    body: 'Gank square, vision, next buy, and one action line. The mouse still belongs to the game.',
    href: '/overlay/',
    link: 'HUD modules',
  },
  {
    title: 'HUD studio',
    body: 'Pin modules on a League HUD map in the browser, then use that layout in the overlay.',
    href: '/studio/',
    link: 'Open the studio',
  },
  {
    title: 'Every champion',
    body: 'Pyke, Pantheon, and Yone are written by hand. Everyone else resolves from the live catalog.',
    href: '/getting-started/',
    link: 'What you get in champion select',
  },
  {
    title: 'No API key',
    body: 'Region and draft come from the local League client. Nothing to register with Riot.',
    href: '/about/',
    link: 'About and FAQ',
  },
]

const zipSteps = [
  { n: '01', title: 'Download the zip', body: 'One file from the latest release. No store account.' },
  { n: '02', title: 'Extract the folder', body: 'Keep it somewhere permanent, such as Documents.' },
  { n: '03', title: 'Run OneTrick.exe', body: 'Start League, export in champion select, then play.' },
]

const setupSteps = [
  { n: '01', title: 'Download the setup', body: 'This published build is still One.Trick.Setup. It does not ask for administrator.' },
  { n: '02', title: 'Run it', body: 'It installs for your Windows user and adds a Start menu shortcut.' },
  { n: '03', title: 'Open One Trick', body: 'Start League, export in champion select, then play.' },
]

export default function App() {
  const { release, loaded } = useLatestRelease()
  const installSteps = loaded && release?.kind === 'setup' ? setupSteps : zipSteps

  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero-band">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 sm:px-8 sm:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div>
              <p className="font-display text-[11px] font-medium uppercase tracking-[0.22em] text-chrome-gold">
                Windows · League of Legends
              </p>
              <h1 className="mt-3 font-display text-5xl font-medium tracking-wide text-chrome-bright sm:text-6xl">
                One Trick
              </h1>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-chrome-silver/90">
                A free, open-source companion that fills champion select and keeps a click-through HUD on the Rift.
              </p>
              <div className="mt-8">
                <DownloadActions release={release} />
              </div>
              <p className="mt-4 text-sm text-chrome-dim">For Windows 10 or newer, 64-bit</p>
              {release ? (
                <p className="mt-1 text-sm text-chrome-dim">
                  {release.kind === 'zip' ? 'Latest zip' : 'Latest file'}: {release.assetName}
                </p>
              ) : null}
            </div>

            <aside className="rounded-xl border border-chrome-gold/25 bg-black/35 p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)] sm:p-8">
              <p className="font-display text-sm font-medium tracking-[0.16em] text-chrome-gold">Install</p>
              <ol className="mt-5 space-y-5">
                {installSteps.map((step) => (
                  <li key={step.n} className="grid grid-cols-[auto_1fr] gap-4">
                    <span className="pt-0.5 font-mono text-xs tracking-widest text-chrome-gold">{step.n}</span>
                    <div>
                      <p className="font-medium text-chrome-bright">{step.title}</p>
                      <p className="mt-1 text-sm leading-relaxed text-chrome-dim">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </aside>
          </div>
        </section>

        <section className="demo-band" aria-labelledby="demo-heading">
          <div className="mx-auto w-full max-w-6xl px-5 pb-16 pt-4 sm:px-8 sm:pb-20">
            <p className="font-display text-[11px] font-medium uppercase tracking-[0.22em] text-chrome-gold">
              See it work
            </p>
            <h2 id="demo-heading" className="mt-3 font-display text-3xl font-medium tracking-wide text-chrome-bright sm:text-4xl">
              From champion select to a full loadout
            </h2>
            <div className="mt-8">
              <DemoVideo />
            </div>
          </div>
        </section>

        <div className="gold-rule" />
        <section className="feature-band" aria-label="Features">
          <div className="mx-auto grid w-full max-w-6xl gap-x-10 gap-y-12 px-5 py-16 sm:grid-cols-2 sm:px-8 sm:py-20 lg:grid-cols-3">
            {features.map((feature) => (
              <article key={feature.title}>
                <h2 className="text-lg font-semibold text-chrome-bright">
                  <span className="mr-2 inline-block h-px w-3 translate-y-[-0.28em] bg-chrome-gold align-middle" />
                  {feature.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-chrome-dim">{feature.body}</p>
                <a href={siteHref(feature.href)} className="feature-link mt-3 inline-block text-sm no-underline">
                  {feature.link}
                </a>
              </article>
            ))}
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  )
}
