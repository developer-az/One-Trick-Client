import { DownloadActions } from '../components/DownloadActions'
import { DocsLayout } from '../components/DocsLayout'
import { siteHref } from '../lib/site'
import { useLatestRelease } from '../lib/useRelease'

export function DownloadPage() {
  const { release, loaded } = useLatestRelease()
  const zip = release?.kind !== 'setup'

  return (
    <DocsLayout
      title="Download"
      lede={
        !loaded
          ? 'Windows 10 or newer, 64-bit.'
          : zip
            ? 'One Trick is a Windows app. The download is a zip archive. Extract it and run OneTrick.exe.'
            : 'The newest published build is still the setup program. It installs for your user and does not ask for administrator.'
      }
    >
      <DownloadActions release={release} secondary="releases" />
      {release ? (
        <p>
          Latest{release.prerelease ? ' pre-release' : ''}: {release.assetName}
        </p>
      ) : (
        <p>{loaded ? 'Open the releases page if the button did not find a file.' : 'Checking the latest release.'}</p>
      )}

      <h2>Quick start</h2>
      {!loaded ? null : zip ? (
        <ol>
          <li>Download the zip.</li>
          <li>Right-click it, choose Extract All, and keep the folder. Documents\One Trick is a good place.</li>
          <li>Open that folder and run OneTrick.exe.</li>
        </ol>
      ) : (
        <ol>
          <li>Download {release?.assetName}. This published build is still the setup program.</li>
          <li>Run it. It installs for your Windows user and does not ask for administrator.</li>
          <li>Open One Trick from the Start menu.</li>
        </ol>
      )}

      <div className="note">
        <p>
          If Windows says it protected your PC, choose <strong>More info</strong>, then <strong>Run anyway</strong>.
          That dialog is SmartScreen meeting a new unsigned file. It is not an antivirus verdict. The zip never
          asks an unknown publisher to change the PC, and the setup program installs for the current user only.{' '}
          <a href={siteHref('/troubleshooting/#smartscreen')}>Why this happens</a>
        </p>
      </div>

      <h2>Updating</h2>
      <p>
        Download the new zip and replace the previous folder. If you used the optional setup program, run the new
        setup the same way. It still installs for the current user only. Setup removes old &quot;Pyke Dominator&quot;
        shortcuts; use the new Start menu entry named One Trick. If the taskbar still shows a generic icon, unpin and
        pin again from the fresh shortcut.
      </p>

      <h2>Optional setup program</h2>
      <p>
        Releases can also include One.Trick.Setup. It adds a Start menu shortcut. Prefer the zip unless you want
        that shortcut. Both files are built from the same source.
      </p>
    </DocsLayout>
  )
}
