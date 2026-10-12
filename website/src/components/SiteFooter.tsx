import { ChromeMark } from './ChromeMark'
import { REPO_URL, siteHref } from '../lib/site'

export function SiteFooter() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-5 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <a href={siteHref('/')} className="flex items-center gap-2 text-chrome-silver no-underline">
          <ChromeMark size={16} />
          <span className="text-sm font-medium">One Trick</span>
        </a>
        <p className="max-w-md text-xs leading-relaxed text-chrome-dim">
          Unofficial fan tool. Not affiliated with Riot Games. League of Legends and Riot Games are
          trademarks of Riot Games, Inc.
        </p>
        <a href={REPO_URL} className="text-sm text-chrome-dim no-underline hover:text-chrome-bright">
          Source
        </a>
      </div>
    </footer>
  )
}
