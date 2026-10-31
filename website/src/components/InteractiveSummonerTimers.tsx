import { useEffect, useState } from 'react'

export function InteractiveSummonerTimers() {
  const [flashCd, setFlashCd] = useState<number>(0)
  const [igniteCd, setIgniteCd] = useState<number>(0)

  useEffect(() => {
    if (flashCd <= 0 && igniteCd <= 0) return

    const interval = setInterval(() => {
      setFlashCd((prev) => (prev > 0 ? prev - 1 : 0))
      setIgniteCd((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => clearInterval(interval)
  }, [flashCd, igniteCd])

  const toggleFlash = () => {
    if (flashCd > 0) {
      setFlashCd(0)
    } else {
      setFlashCd(300)
    }
  }

  const toggleIgnite = () => {
    if (igniteCd > 0) {
      setIgniteCd(0)
    } else {
      setIgniteCd(180)
    }
  }

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60)
    const secs = s % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0e0f14]/90 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.5)] sm:p-7 gothic-bracket">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-chrome-gold">
            Global Keyboard Hook
          </span>
          <h3 className="font-display text-xl font-medium tracking-wide text-chrome-bright">
            Summoner Spell Timers
          </h3>
        </div>
        <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-emerald-400">
          Native Windows Hook Active
        </span>
      </div>

      <p className="mt-4 text-sm leading-relaxed text-chrome-dim">
        Never Alt-Tab or move your cursor. Press your configured hotkey while playing League to start or clear cooldowns. Click below to simulate:
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {/* Flash Panel */}
        <div
          onClick={toggleFlash}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') toggleFlash()
          }}
          className={`cursor-pointer rounded-lg border p-4 transition-all duration-150 ${
            flashCd > 0
              ? 'border-red-500/40 bg-red-950/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
              : 'border-white/10 bg-black/30 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-chrome-silver">
              Enemy Flash
            </span>
            <kbd className="kbd-key">PageUp</kbd>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-semibold tracking-tight text-chrome-bright tabular-nums">
              {flashCd > 0 ? formatSec(flashCd) : 'READY'}
            </span>
            <span
              className={`text-xs font-medium uppercase tracking-wider ${
                flashCd > 0 ? 'text-red-400' : 'text-emerald-400'
              }`}
            >
              {flashCd > 0 ? 'On Cooldown' : 'Available'}
            </span>
          </div>
          {flashCd > 0 && (
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-red-500 transition-all duration-1000 linear"
                style={{ width: `${(flashCd / 300) * 100}%` }}
              />
            </div>
          )}
        </div>

        {/* Combat Spell Panel */}
        <div
          onClick={toggleIgnite}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') toggleIgnite()
          }}
          className={`cursor-pointer rounded-lg border p-4 transition-all duration-150 ${
            igniteCd > 0
              ? 'border-amber-500/40 bg-amber-950/20 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
              : 'border-white/10 bg-black/30 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs uppercase tracking-wider text-chrome-silver">
              Ignite / Combat Sum
            </span>
            <kbd className="kbd-key">PageDown</kbd>
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <span className="font-mono text-3xl font-semibold tracking-tight text-chrome-bright tabular-nums">
              {igniteCd > 0 ? formatSec(igniteCd) : 'READY'}
            </span>
            <span
              className={`text-xs font-medium uppercase tracking-wider ${
                igniteCd > 0 ? 'text-amber-400' : 'text-emerald-400'
              }`}
            >
              {igniteCd > 0 ? 'On Cooldown' : 'Available'}
            </span>
          </div>
          {igniteCd > 0 && (
            <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-amber-500 transition-all duration-1000 linear"
                style={{ width: `${(igniteCd / 180) * 100}%` }}
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/5 pt-3 text-[11px] text-chrome-dim">
        <span>Fallback keys: Numpad 9 (Flash) · Numpad 3 (Combat)</span>
        <span>Press again anytime to clear cooldown</span>
      </div>
    </div>
  )
}
