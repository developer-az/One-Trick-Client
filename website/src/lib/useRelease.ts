import { useEffect, useState } from 'react'
import { fetchLatestRelease, type ReleaseInfo } from './release'

export function useLatestRelease(): { release: ReleaseInfo | null; loaded: boolean } {
  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let alive = true
    fetchLatestRelease()
      .then((info) => {
        if (!alive) return
        setRelease(info)
      })
      .finally(() => {
        if (alive) setLoaded(true)
      })
    return () => {
      alive = false
    }
  }, [])

  return { release, loaded }
}
