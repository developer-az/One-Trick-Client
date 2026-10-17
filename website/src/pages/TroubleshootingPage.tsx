import { DocsLayout } from '../components/DocsLayout'
import { RELEASES_URL } from '../lib/release'
import { siteHref } from '../lib/site'

export function TroubleshootingPage() {
  return (
    <DocsLayout
      title="Troubleshooting"
      lede="The usual first-launch warning, and the checks that fix a blank draft or a missing HUD."
    >
      <h2 id="smartscreen">Windows protected your PC</h2>
      <p>
        One Trick is open source and is not signed with a paid certificate. Windows SmartScreen warns the first time
        it sees a new file. Choose <strong>More info</strong>, then <strong>Run anyway</strong>.
      </p>
      <p>
        Download the zip, not an installer you do not trust. Extract it and run OneTrick.exe from the folder you
        keep. That file does not request administrator and does not install itself into Program Files. A certificate
        would print a publisher name on the file. It would not remove this first-launch warning. Microsoft now builds
        that reputation from people actually running the file.
      </p>
      <p>
        Only run builds from the <a href={RELEASES_URL}>GitHub releases</a> of this repository.
      </p>

      <h2 id="wont-open">One Trick won&apos;t open</h2>
      <ul>
        <li>Extract the whole zip. Running OneTrick.exe out of a half-copied folder fails because the resources next to it are part of the app.</li>
        <li>Windows 10 or newer, 64-bit.</li>
        <li>If a setup install is stuck, download the zip from the same release and use that instead.</li>
      </ul>

      <h2 id="overlay">Overlay not visible</h2>
      <ul>
        <li>Set League to Borderless, not Exclusive Fullscreen.</li>
        <li>The HUD appears when a match starts, not in the client menus.</li>
        <li>Ctrl+Shift+H shows it again if it was hidden.</li>
        <li>Check Performance → In-game overlay is on.</li>
        <li>If the HUD vanishes mid-match, update to v1.5.0 or newer, disable “Only while holding Tab” unless you mean to use it, and check Performance for the last overlay close reason after the game.</li>
        <li>Turn Frames on before using Align or Sync LoL for HUD and minimap frames.</li>
      </ul>

      <h2 id="hotkeys">Hotkeys do nothing</h2>
      <p>
        PageUp and PageDown need the keyboard helper that ships inside the folder. If League is Run as administrator,
        run One Trick as administrator too. Details are on the <a href={siteHref('/overlay/')}>overlay page</a>.
      </p>

      <h2 id="draft">Champ select stays empty</h2>
      <ul>
        <li>The League client has to be running. One Trick fills the draft from the local client, not from a Riot API key.</li>
        <li>Manual enemy picks still work in Demo mode when the client is closed.</li>
        <li>Export runs after the draft is filled. It writes runes and an item set into the client.</li>
      </ul>
    </DocsLayout>
  )
}
