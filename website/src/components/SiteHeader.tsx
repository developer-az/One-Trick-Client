import { ChromeMark } from './ChromeMark'
import { REPO_URL, headerLinks, isSitePath, siteHref } from '../lib/site'

function GitHubMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  )
}

function NavLinks({ className }: { className: string }) {
  return (
    <ul className={className}>
      {headerLinks.map((link) => {
        const current = isSitePath(link.href)
        return (
          <li key={link.href}>
            <a
              href={siteHref(link.href)}
              aria-current={current ? 'page' : undefined}
              className={current ? 'text-chrome-gold' : 'text-chrome-dim hover:text-chrome-bright'}
            >
              {link.label}
            </a>
          </li>
        )
      })}
    </ul>
  )
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-chrome-gold/20 bg-[#0b0c0e]/92 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
        <a href={siteHref('/')} className="flex items-center gap-2.5 text-chrome-bright no-underline">
          <ChromeMark size={22} className="text-chrome-gold" />
          <span className="font-display text-[15px] font-medium tracking-[0.14em]">One Trick</span>
        </a>
        <div className="flex items-center gap-3">
          <nav aria-label="Primary" className="hidden md:block">
            <NavLinks className="flex items-center gap-5 text-sm" />
          </nav>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-md border border-white/15 px-3 py-1.5 text-sm text-chrome-silver no-underline hover:border-white/40 hover:text-chrome-bright"
          >
            <GitHubMark />
            GitHub
          </a>
          <details className="relative md:hidden">
            <summary className="cursor-pointer list-none rounded-md border border-white/15 px-3 py-1.5 text-sm text-chrome-silver">
              Menu
            </summary>
            <nav
              aria-label="Mobile"
              className="absolute right-0 mt-2 w-52 rounded-md border border-white/10 bg-[#141518] p-3 shadow-xl"
            >
              <NavLinks className="space-y-2 text-sm" />
            </nav>
          </details>
        </div>
      </div>
    </header>
  )
}
