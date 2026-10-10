# One Trick website

Product landing for One Trick — real in-app screenshots, download CTA, features, and profiles.

**Live:** https://one-trick-client.vercel.app/ (Vercel · `website/` as the project root)

## Develop

```bash
cd website
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

### Base path

| Host | Command / env |
|------|----------------|
| Vercel (root = `website/`) | default `base: /` |
| GitHub Pages project site | `VITE_BASE=/One-Trick-Client/ npm run build` |

## Deploy

- **Vercel (canonical)** — import the repo, set Root Directory to `website`, framework Vite, project name `one-trick-client`. Production URL: https://one-trick-client.vercel.app/
- **GitHub Pages** — optional mirror only. Workflow: [`.github/workflows/pages.yml`](../.github/workflows/pages.yml).

Download buttons resolve the newest **full** (non-prerelease) Windows `.exe` from the GitHub Releases API at runtime (Setup preferred), falling back to the newest published build if needed. Repo: `developer-az/One-Trick-Client`.
