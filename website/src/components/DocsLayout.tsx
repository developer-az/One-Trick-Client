import { useEffect, type ReactNode } from 'react'
import { docsNav, isSitePath, siteHref } from '../lib/site'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

export function DocsLayout({
  title,
  lede,
  children,
}: {
  title: string
  lede?: string
  children: ReactNode
}) {
  useEffect(() => {
    document.title = `${title} — One Trick`
  }, [title])

  return (
    <>
      <SiteHeader />
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 py-10 sm:px-8 md:grid-cols-[220px_minmax(0,1fr)] md:py-14">
        <aside className="md:sticky md:top-24 md:self-start">
          <nav aria-label="Documentation" className="space-y-6">
            {docsNav.map((group) => (
              <div key={group.title}>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-chrome-dim">
                  {group.title}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {group.links.map((link) => {
                    const current = isSitePath(link.href)
                    return (
                      <li key={link.href}>
                        <a
                          href={siteHref(link.href)}
                          aria-current={current ? 'page' : undefined}
                          className={
                            current
                              ? 'text-sm text-chrome-bright no-underline'
                              : 'text-sm text-chrome-dim no-underline hover:text-chrome-bright'
                          }
                        >
                          {link.label}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </aside>
        <article className="docs min-w-0">
          <h1 className="text-4xl font-semibold tracking-tight text-chrome-bright">{title}</h1>
          {lede ? <p className="lede">{lede}</p> : null}
          {children}
        </article>
      </div>
      <SiteFooter />
    </>
  )
}
