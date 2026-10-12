import { RELEASES_URL, type ReleaseInfo } from '../lib/release'
import { siteHref } from '../lib/site'

function downloadLabel(release: ReleaseInfo | null): string {
  if (!release) return 'Download for Windows'
  return `Download ${release.tag}`
}

export function DownloadActions({
  release,
  secondary = 'learn',
}: {
  release: ReleaseInfo | null
  secondary?: 'learn' | 'releases'
}) {
  const href = release?.downloadUrl || RELEASES_URL
  const second =
    secondary === 'releases'
      ? { href: RELEASES_URL, label: 'Other versions', external: true }
      : { href: siteHref('/getting-started/'), label: 'Learn more', external: false }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <a className="btn-solid" href={href}>
        {downloadLabel(release)}
      </a>
      <a
        className="btn-line"
        href={second.href}
        {...(second.external ? { target: '_blank', rel: 'noreferrer' } : {})}
      >
        {second.label}
      </a>
    </div>
  )
}
