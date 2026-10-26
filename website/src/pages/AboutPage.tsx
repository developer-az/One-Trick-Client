import { DocsLayout } from '../components/DocsLayout'
import { REPO_URL, RELEASES_URL } from '../lib/release'
import { siteHref } from '../lib/site'

export function AboutPage() {
  return (
    <DocsLayout
      title="About and FAQ"
      lede="A free Windows companion for League of Legends. Authored Pyke, Pantheon, and Yone, and a live catalog for everyone else."
    >
      <p>
        One Trick connects to the League client on your PC, recommends a loadout in champion select, exports it, and
        keeps a click-through HUD up during the match. Source and issues live on <a href={REPO_URL}>GitHub</a>.
        Builds are on the <a href={RELEASES_URL}>releases</a> page.
      </p>

      <h2>Do I need a certificate to install it?</h2>
      <p>
        No. <a href={siteHref('/download/')}>Download the zip</a>, extract it, and run OneTrick.exe. Windows may ask
        once because the file is unsigned. That is the same install other open-source Windows tools use. A paid
        certificate is a publisher name, not a requirement.
      </p>

      <h2>Does it change League?</h2>
      <p>
        No. It talks to the local client and draws its own windows. It does not edit League&apos;s install, and it
        does not ask for a Riot developer key.
      </p>

      <h2>Which Windows versions?</h2>
      <p>Windows 10 or newer, 64-bit. There is no macOS build.</p>

      <h2>Does the Windows build include FFmpeg?</h2>
      <p>
        Yes. Auto-clip runs FFmpeg 6.1.1 as a separate program (the gyan.dev essentials build shipped through
        ffmpeg-static 5.3.0). That binary is GNU General Public License version 3 (GPL-3.0). One Trick's own
        code remains MIT. The install folder includes THIRD_PARTY_NOTICES.txt, a copy of GPL-3.0, and the
        source offer. FFmpeg source for this build is commit{' '}
        <a href="https://github.com/FFmpeg/FFmpeg/commit/e38092ef93">e38092ef93</a>.
      </p>

      <h2>Is this a Riot product?</h2>
      <p>
        No. One Trick is an unofficial fan tool. It is not endorsed by Riot Games and does not reflect the views of
        Riot Games or anyone officially involved in producing League of Legends. League of Legends and Riot Games are
        trademarks or registered trademarks of Riot Games, Inc.
      </p>
    </DocsLayout>
  )
}
