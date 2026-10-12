import { REPO_URL } from './release'

export { REPO_URL }

export function siteHref(path: string): string {
  const base = import.meta.env.BASE_URL
  if (path === '/' || path === '') return base
  const normalized = path.startsWith('/') ? path.slice(1) : path
  return `${base}${normalized}`
}

export function isSitePath(path: string): boolean {
  const hashIndex = path.indexOf('#')
  const pathPart = hashIndex === -1 ? path : path.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex)
  const current = window.location.pathname.replace(/\/$/, '')
  const target = siteHref(pathPart).replace(/\/$/, '')
  if (current !== target) return false
  if (!hash) return true
  return window.location.hash === hash
}

export type NavLink = {
  href: string
  label: string
}

export type NavGroup = {
  title: string
  links: NavLink[]
}

export const headerLinks: NavLink[] = [
  { href: '/', label: 'Home' },
  { href: '/download/', label: 'Download' },
  { href: '/getting-started/', label: 'Getting started' },
  { href: '/troubleshooting/', label: 'Troubleshooting' },
  { href: '/studio/', label: 'Studio' },
]

export const docsNav: NavGroup[] = [
  {
    title: 'Getting started',
    links: [
      { href: '/download/', label: 'Download' },
      { href: '/getting-started/', label: 'Setting up One Trick' },
      { href: '/overlay/', label: 'Overlay and hotkeys' },
    ],
  },
  {
    title: 'Troubleshooting',
    links: [
      { href: '/troubleshooting/#smartscreen', label: 'Windows protected your PC' },
      { href: '/troubleshooting/#wont-open', label: "One Trick won't open" },
      { href: '/troubleshooting/#overlay', label: 'Overlay not visible' },
      { href: '/troubleshooting/#hotkeys', label: 'Hotkeys do nothing' },
      { href: '/troubleshooting/#draft', label: 'Champ select stays empty' },
    ],
  },
  {
    title: 'About',
    links: [{ href: '/about/', label: 'About and FAQ' }],
  },
]
