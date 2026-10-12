import { DocsLayout } from '../components/DocsLayout'
import { siteHref } from '../lib/site'

export function GettingStartedPage() {
  return (
    <DocsLayout
      title="Setting up One Trick"
      lede="League stays in front. One Trick fills champion select, exports a loadout, and leaves a click-through HUD for the game."
    >
      <ol>
        <li>
          <a href={siteHref('/download/')}>Download</a> the zip, extract it, and run OneTrick.exe.
        </li>
        <li>Start the League client, then One Trick. It reconnects if League opens second.</li>
        <li>
          In League, set Video → Display Mode to <strong>Borderless</strong>. Exclusive fullscreen fights an
          always-on-top overlay.
        </li>
        <li>Lock in. Review items and runes, then export them into the client.</li>
        <li>The HUD shows when the match starts. The main window hides to the tray on purpose.</li>
      </ol>

      <h2>What you get in champion select</h2>
      <p>
        Pyke Support, Pantheon Support, and Yone Mid are written by hand. Every other champion uses a profile built
        from the live Data Dragon and Community Dragon catalog.
      </p>

      <h2>During the game</h2>
      <p>
        The overlay can show enemy summoners, a gank square, a vision hint, the next buy, and one time-critical
        line. Ability frames stay off until you turn them on. Hotkeys and alignment are on the{' '}
        <a href={siteHref('/overlay/')}>overlay page</a>.
      </p>

      <div className="note">
        <p>
          One Trick reads the League client on this PC. It does not need a Riot API key, and it does not change
          League&apos;s files.
        </p>
      </div>
    </DocsLayout>
  )
}
