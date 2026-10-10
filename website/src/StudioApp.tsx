import { useEffect, useMemo, useRef, useState } from 'react'
import { warmCatalog } from '../../src/catalog/client.ts'
import { ChromeMark } from './components/ChromeMark'
import { HudStudioCanvas } from '../../src/overlay/HudStudioCanvas.tsx'
import {
  HUD_LAYOUT_PRESETS,
  applyModulesToLayout,
  layoutToHudModules,
  loadStoredHudLayout,
  normalizeHudLayout,
  removeSticker,
  storeHudLayout,
  upsertSticker,
  type HudLayout,
  type HudSticker,
} from '../../src/overlay/hudLayout.ts'
import { HUD_MODULE_IDS, HUD_MODULE_LABELS } from '../../src/overlay/hudModules.ts'
import { fetchLatestRelease, REPO_URL, type ReleaseInfo } from './lib/release'

const base = import.meta.env.BASE_URL

function downloadLayout(layout: HudLayout): void {
  const blob = new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'onetrick-hud-layout.json'
  a.click()
  URL.revokeObjectURL(url)
}

export function StudioApp() {
  const [layout, setLayout] = useState<HudLayout>(() => loadStoredHudLayout())
  const [release, setRelease] = useState<ReleaseInfo | null>(null)
  const [patch, setPatch] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const modules = useMemo(() => layoutToHudModules(layout), [layout])

  useEffect(() => {
    let alive = true
    fetchLatestRelease().then((info) => {
      if (alive) setRelease(info)
    })
    void warmCatalog({ apiBase: `${base.replace(/\/?$/, '/')}api/v1` }).then((bundle) => {
      if (alive && bundle?.manifest.patch) setPatch(bundle.manifest.patch)
    })
    return () => {
      alive = false
    }
  }, [])

  const commit = (next: HudLayout) => {
    const normalized = normalizeHudLayout(next)
    storeHudLayout(normalized)
    setLayout(normalized)
  }

  const addSticker = (partial: Omit<HudSticker, 'id' | 'x' | 'y' | 'scale' | 'opacity'>) => {
    commit(
      upsertSticker(layout, {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        x: 0.46,
        y: 0.38,
        scale: 1,
        opacity: 1,
        ...partial,
      }),
    )
  }

  return (
    <>
      <div className="site-atmosphere" aria-hidden />
      <div className="site-content">
        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
          <a href={base} className="flex items-center gap-2.5 text-chrome-bright no-underline">
            <ChromeMark size={22} />
            <span className="font-display text-lg tracking-tight">One Trick</span>
          </a>
          <nav className="flex items-center gap-6 font-mono text-[11px] uppercase tracking-[0.18em] text-chrome-dim">
            <a href={base} className="hover:text-chrome-bright">
              Home
            </a>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-chrome-bright">
              GitHub
            </a>
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl px-5 pb-20 sm:px-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-chrome-dim">
            HUD Studio{patch ? ` · patch ${patch}` : ''}
          </p>
          <h1 className="mt-3 font-display text-4xl tracking-tight text-chrome-bright sm:text-5xl">
            Place your tools on the Rift.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-chrome-dim">
            Map the League HUD and minimap, then pin modules and chrome stickers. Export JSON into the
            desktop overlay — a browser tab cannot sit on top of League.
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            {HUD_LAYOUT_PRESETS.map((preset) => (
              <button
                key={preset.name}
                type="button"
                className="btn-ghost !px-3 !py-2"
                onClick={() => commit({ ...preset })}
              >
                {preset.name}
              </button>
            ))}
            <button type="button" className="btn-chrome !px-3 !py-2" onClick={() => downloadLayout(layout)}>
              Export JSON
            </button>
            <button type="button" className="btn-ghost !px-3 !py-2" onClick={() => fileRef.current?.click()}>
              Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                void file.text().then((text) => {
                  try {
                    commit(normalizeHudLayout(JSON.parse(text)))
                  } catch {
                    /* ignore */
                  }
                })
                event.target.value = ''
              }}
            />
            {release && (
              <a className="btn-ghost !px-3 !py-2" href={release.downloadUrl}>
                Desktop {release.tag}
              </a>
            )}
          </div>

          <div className="hud-studio-wrap mt-8">
            <HudStudioCanvas layout={layout} onChange={commit} />
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {HUD_MODULE_IDS.map((id) => (
              <button
                key={id}
                type="button"
                className="btn-ghost !px-3 !py-2"
                onClick={() =>
                  commit(applyModulesToLayout(layout, { ...modules, [id]: !modules[id] }))
                }
              >
                {modules[id] ? 'On · ' : 'Off · '}
                {HUD_MODULE_LABELS[id]}
              </button>
            ))}
            <button type="button" className="btn-ghost !px-3 !py-2" onClick={() => addSticker({ kind: 'mark' })}>
              Pin mark
            </button>
            <button
              type="button"
              className="btn-ghost !px-3 !py-2"
              onClick={() => addSticker({ kind: 'text', label: 'ONE TRICK' })}
            >
              Pin text
            </button>
          </div>

          {layout.stickers.length > 0 && (
            <ul className="mt-4 space-y-1 font-mono text-[11px] text-chrome-dim">
              {layout.stickers.map((sticker) => (
                <li key={sticker.id} className="flex items-center justify-between gap-3">
                  <span>
                    {sticker.label || sticker.kind} · {Math.round(sticker.x * 100)}/{Math.round(sticker.y * 100)}
                  </span>
                  <button type="button" className="btn-ghost !px-2 !py-1" onClick={() => commit(removeSticker(layout, sticker.id))}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </main>
      </div>
    </>
  )
}
