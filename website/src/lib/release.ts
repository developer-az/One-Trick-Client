const REPO = 'developer-az/One-Trick-Client'
export const RELEASES_URL = `https://github.com/${REPO}/releases`
export const REPO_URL = `https://github.com/${REPO}`

export type ReleaseKind = 'zip' | 'setup'

export type ReleaseInfo = {
  tag: string
  name: string
  downloadUrl: string
  assetName: string
  kind: ReleaseKind
  prerelease: boolean
}

type GhAsset = {
  name: string
  browser_download_url: string
}

type GhRelease = {
  tag_name: string
  name: string | null
  draft: boolean
  prerelease: boolean
  published_at: string | null
  assets: GhAsset[]
}

function pickDownload(assets: GhAsset[]): GhAsset | undefined {
  const files = assets.filter((a) => !a.name.toLowerCase().includes('blockmap'))
  const named = files.filter((a) => isOneTrickAsset(a.name))
  const pool = named.length > 0 ? named : files
  return (
    pool.find((a) => a.name.toLowerCase().endsWith('.zip')) ||
    pool.find((a) => /setup/i.test(a.name) && a.name.toLowerCase().endsWith('.exe')) ||
    pool.find((a) => a.name.toLowerCase().endsWith('.exe') && !/portable/i.test(a.name)) ||
    pool.find((a) => a.name.toLowerCase().endsWith('.exe'))
  )
}

function kindOf(name: string): ReleaseKind {
  return name.toLowerCase().endsWith('.zip') ? 'zip' : 'setup'
}

function toInfo(data: GhRelease, asset: GhAsset): ReleaseInfo {
  return {
    tag: data.tag_name,
    name: data.name || data.tag_name,
    downloadUrl: asset.browser_download_url,
    assetName: asset.name,
    kind: kindOf(asset.name),
    prerelease: !!data.prerelease,
  }
}

function parseReleaseVersion(tag: string): number[] {
  const core = tag.replace(/^v/i, '').split('-')[0]
  const parts = core.split('.').map((n) => Number.parseInt(n, 10))
  return [parts[0] || 0, parts[1] || 0, parts[2] || 0]
}

function newerThan(a: string, b: string): boolean {
  const left = parseReleaseVersion(a)
  const right = parseReleaseVersion(b)
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] > right[i]
  }
  return false
}

function isOneTrickAsset(name: string): boolean {
  return /one\.trick/i.test(name)
}

/**
 * Prefer the newest One Trick full Windows build.
 * The zip is the download. A per-user setup exe is the fallback.
 * Historical Pyke Dominator tags (1.2 / 1.3) and empty 2025 tags are ignored.
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=20`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) return null
    const list = (await res.json()) as GhRelease[]
    if (!Array.isArray(list)) return null

    let bestFull: ReleaseInfo | null = null
    let bestPre: ReleaseInfo | null = null
    for (const data of list) {
      if (data.draft) continue
      const asset = pickDownload(data.assets || [])
      if (!asset) continue
      const info = toInfo(data, asset)
      const oneTrick = isOneTrickAsset(asset.name)
      if (!oneTrick) continue
      if (info.prerelease) {
        if (!bestPre || newerThan(info.tag, bestPre.tag)) bestPre = info
        continue
      }
      if (!bestFull || newerThan(info.tag, bestFull.tag)) bestFull = info
    }
    return bestFull || bestPre
  } catch {
    return null
  }
}
