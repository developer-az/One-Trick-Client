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
  storeHudLayout,
  type HudLayout,
} from '../../src/overlay/hudLayout.ts'
import {
  HUD_MODULE_IDS,
  HUD_MODULE_LABELS,
  HUD_STUDIO_MODULE_IDS,
  type HudModuleId,
} from '../../src/overlay/hudModules.ts'
import { fetchLatestRelease, REPO_URL, type ReleaseInfo } from './lib/release'
import { siteHref } from './lib/site'

const base = import.meta.env.BASE_URL

const MODULE_SCALE_MIN = 75
const MODULE_SCALE_MAX = 140
const MODULE_SCALE_STEP = 5

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
  const [copied, setCopied] = useState<boolean>(false)
  const [importError, setImportError] = useState<string>('')
  const fileRef = useRef<HTMLInputElement>(null)
  const modules = useMemo(() => layoutToHudModules(layout), [layout])

  /** Uniform module scale, derived from the layout so presets and imports stay in sync. */
  const moduleScale = useMemo(() => {
    const scales = layout.elements
      .filter((el) => HUD_MODULE_IDS.includes(el.id as HudModuleId))
      .map((el) => el.scale)
    if (!scales.length) return 100
    const average = scales.reduce((sum, value) => sum + value, 0) / scales.length
    return Math.round(average * 100)
  }, [layout])

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

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(layout, null, 2))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      downloadLayout(layout)
    }
  }

  const toggleModule = (id: HudModuleId) => {
    commit(applyModulesToLayout(layout, { ...modules, [id]: !modules[id] }))
  }

  const applyModuleScale = (pct: number) => {
    const nextScale = Math.max(MODULE_SCALE_MIN, Math.min(MODULE_SCALE_MAX, pct)) / 100
    commit({
      ...layout,
      elements: layout.elements.map((el) =>
        HUD_MODULE_IDS.includes(el.id as HudModuleId) ? { ...el, scale: nextScale } : el
      ),
    })
  }

  return (
    <>
      <div className="site-atmosphere" aria-hidden />
      <div className="site-content min-h-screen flex flex-col">
        {/* Navigation Bar */}
        <header className="border-b border-white/10 bg-[#0c0d12]/95 px-5 py-4 sm:px-8">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-3 whitespace-nowrap">
              <a href={siteHref('/')} className="flex items-center gap-2.5 text-white no-underline">
                <ChromeMark size={20} />
                <span className="font-display text-base font-semibold tracking-wide whitespace-nowrap">
                  One Trick
                </span>
              </a>
              <span className="hidden items-center gap-3 sm:flex">
                <span className="text-zinc-600">/</span>
                <span className="font-mono text-xs uppercase tracking-wider text-zinc-300">
                  HUD Studio {patch ? `· Patch ${patch}` : ''}
                </span>
              </span>
            </div>

            <div className="flex items-center gap-2 sm:gap-3">
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="hidden text-xs text-zinc-400 hover:text-white transition-colors no-underline sm:inline"
              >
                GitHub
              </a>
              <a
                href={siteHref('/')}
                className="hidden whitespace-nowrap text-xs text-zinc-400 hover:text-white transition-colors no-underline sm:inline"
              >
                Back to Home
              </a>
              {release && (
                <a
                  href={release.downloadUrl}
                  className="whitespace-nowrap rounded border border-white/20 bg-zinc-800 px-3 py-1.5 font-mono text-xs text-white no-underline hover:bg-zinc-700 transition-colors"
                >
                  Download <span className="hidden sm:inline">{release.tag}</span>
                </a>
              )}
            </div>
          </div>
        </header>

        {/* Studio Workspace */}
        <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 flex-1">
          {/* Header & Instructions */}
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-white/10 pb-6">
            <div>
              <h1 className="font-display text-3xl font-semibold text-white tracking-wide sm:text-4xl">
                HUD Studio
              </h1>
              <p className="mt-2 text-sm text-zinc-300 max-w-2xl leading-relaxed">
                Drag and pin your tactical modules over the Summoner&apos;s Rift reference canvas. Custom layout coordinates sync directly into your click-through desktop overlay.
              </p>
            </div>

            {/* Layout Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={copyJson}
                aria-live="polite"
                className="rounded border border-white/20 bg-zinc-800 px-3.5 py-1.5 font-mono text-xs font-medium text-white hover:bg-zinc-700 transition-colors"
              >
                {copied ? 'Copied to Clipboard!' : 'Copy JSON'}
              </button>
              <button
                type="button"
                onClick={() => downloadLayout(layout)}
                className="rounded border border-white/10 bg-black/60 px-3.5 py-1.5 font-mono text-xs text-zinc-300 hover:text-white hover:border-white/30 transition-colors"
              >
                Export File
              </button>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="rounded border border-white/10 bg-black/60 px-3.5 py-1.5 font-mono text-xs text-zinc-300 hover:text-white hover:border-white/30 transition-colors"
              >
                Import File
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
                      setImportError('')
                    } catch {
                      setImportError('Invalid layout JSON file.')
                    }
                  })
                  event.target.value = ''
                }}
              />
            </div>
          </div>

          {importError && (
            <div className="mt-3 rounded border border-rose-500/30 bg-rose-950/30 px-3 py-2 font-mono text-xs text-rose-300">
              {importError}
            </div>
          )}

          {/* Controls Bar: Presets & Module Toggles */}
          <div className="mt-6 rounded-xl border border-white/10 bg-[#0e0f14] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              {/* Presets */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
                  Preset:
                </span>
                <div className="flex flex-wrap gap-1">
                  {HUD_LAYOUT_PRESETS.map((preset) => {
                    const active = layout.name === preset.name
                    return (
                      <button
                        key={preset.name}
                        type="button"
                        onClick={() => commit({ ...preset })}
                        aria-pressed={active}
                        className={`rounded px-3 py-1 font-mono text-xs transition-colors ${
                          active
                            ? 'bg-zinc-200 text-black font-semibold'
                            : 'bg-black/40 text-zinc-400 hover:text-white border border-white/10'
                        }`}
                      >
                        {preset.name}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Uniform Module Scale */}
              <div className="flex items-center gap-3 font-mono text-xs text-zinc-400">
                <label htmlFor="studio-module-scale">Module size:</label>
                <input
                  id="studio-module-scale"
                  type="range"
                  min={MODULE_SCALE_MIN}
                  max={MODULE_SCALE_MAX}
                  step={MODULE_SCALE_STEP}
                  value={moduleScale}
                  onChange={(e) => applyModuleScale(Number(e.target.value))}
                  aria-valuetext={`${moduleScale} percent`}
                  className="h-1.5 w-28 accent-zinc-300 cursor-pointer"
                />
                <span aria-hidden="true" className="w-9 text-right text-zinc-200">
                  {moduleScale}%
                </span>
              </div>
            </div>

            {/* Module Toggles */}
            <div className="flex flex-wrap items-center gap-2 border-t border-white/10 pt-3">
              <span className="font-mono text-xs uppercase tracking-wider text-zinc-400 mr-2">
                Visible Modules:
              </span>
              {HUD_STUDIO_MODULE_IDS.map((id) => {
                const active = modules[id]
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => toggleModule(id)}
                    aria-pressed={active}
                    className={`flex items-center gap-1.5 rounded px-2.5 py-1 font-mono text-xs transition-colors border ${
                      active
                        ? 'border-emerald-500/40 bg-emerald-950/20 text-emerald-300'
                        : 'border-white/10 bg-black/40 text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        active ? 'bg-emerald-400' : 'bg-zinc-600'
                      }`}
                    />
                    <span>{HUD_MODULE_LABELS[id]}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Interactive HUD Canvas Stage */}
          <p className="mt-6 mb-2 font-mono text-[10px] uppercase tracking-wider text-zinc-500 sm:hidden">
            Swipe the stage sideways to reach the right rail
          </p>
          <div className="hud-studio-wrap rounded-xl border border-white/10 shadow-[0_24px_80px_rgba(0,0,0,0.7)] sm:mt-6">
            <HudStudioCanvas layout={layout} onChange={commit} minStageWidth={640} />
          </div>

          {/* Setup Guide */}
          <div className="mt-8 grid gap-4 sm:grid-cols-3 text-xs text-zinc-300">
            <div className="rounded-lg border border-white/10 bg-[#0e0f14] p-4">
              <div className="font-mono font-semibold text-white uppercase tracking-wider">
                1. Arrange
              </div>
              <p className="mt-1.5 leading-relaxed text-zinc-400">
                Drag the live modules on the canvas above. Position summoner timers, gank radar, and buy queues where they fit your vision. On narrow screens the stage scrolls sideways.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0e0f14] p-4">
              <div className="font-mono font-semibold text-white uppercase tracking-wider">
                2. Export
              </div>
              <p className="mt-1.5 leading-relaxed text-zinc-400">
                Click <strong>Copy JSON</strong> or <strong>Export File</strong> to obtain your customized layout coordinates.
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0e0f14] p-4">
              <div className="font-mono font-semibold text-white uppercase tracking-wider">
                3. Load in Client
              </div>
              <p className="mt-1.5 leading-relaxed text-zinc-400">
                In the One Trick Windows app, navigate to <strong>In-game overlay</strong> and import your layout. It applies immediately.
              </p>
            </div>
          </div>
        </main>
      </div>
    </>
  )
}
