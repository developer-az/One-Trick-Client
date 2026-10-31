import { useEffect, useState } from 'react'

export function InteractiveSummonerTimers() {
  const [flashCd, setFlashCd] = useState<number>(0)
  const [igniteCd, setIgniteCd] = useState<number>(0)

  const active = flashCd > 0 || igniteCd > 0

  useEffect(() => {
    if (!active) return

    const interval = setInterval(() => {
      setFlashCd((prev) => (prev > 0 ? prev - 1 : 0))
      setIgniteCd((prev) => (prev > 0 ? prev - 1 : 0))
    }, 1000)

    return () => clearInterval(interval)
  }, [active])

  const toggleFlash = () => {
    setFlashCd((prev) => (prev > 0 ? 0 : 300))
  }

  const toggleIgnite = () => {
    setIgniteCd((prev) => (prev > 0 ? 0 : 180))
  }

  const formatSec = (s: number) => {
    const mins = Math.floor(s / 60)
    const secs = s % 60
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="rounded-xl border border-white/10 bg-[#0c0d12] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.6)] sm:p-6 gothic-bracket">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 pb-4">
        <div>
          <span className="font-mono text-xs uppercase tracking-wider text-zinc-400">
            In-game overlay module
          </span>
          <h3 className="font-display text-xl font-semibold text-white tracking-wide">
            Summoner Spell Timers
          </h3>
        </div>
        <span className="rounded border border-emerald-500/30 bg-emerald-950/40 px-2.5 py-1 font-mono text-xs text-emerald-400">
          Global keyboard hook
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-zinc-300">
        Tracks enemy cooldowns without moving your cursor. Tap the hotkey while playing League to start or clear the countdown:
      </p>

      <div className="mt-5 space-y-3">
        {/* Row 1: Caitlyn Flash */}
        <button
          type="button"
          onClick={toggleFlash}
          aria-pressed={flashCd > 0}
          aria-label={
            flashCd > 0
              ? `Caitlyn enemy Flash, ${formatSec(flashCd)} remaining. Activate to clear the timer.`
              : 'Start the Caitlyn enemy Flash timer. Hotkey Page Up.'
          }
          className={`flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-left cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 ${
            flashCd > 0
              ? 'border-rose-500/40 bg-rose-950/20'
              : 'border-white/10 bg-black/40 hover:border-white/20'
          }`}
        >
          <div className="flex items-center gap-3">
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Caitlyn.png"
              alt=""
              className="h-10 w-10 rounded border border-white/20"
            />
            <div>
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <span>Caitlyn</span>
                <span className="text-[10px] text-zinc-400 uppercase font-mono">ADC</span>
              </div>
              <div className="text-xs text-zinc-400">Enemy Flash</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/spell/SummonerFlash.png"
                alt=""
                className={`h-9 w-9 rounded border ${
                  flashCd > 0 ? 'border-rose-500/60 opacity-60' : 'border-white/20'
                }`}
              />
              {flashCd > 0 && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-xs font-bold text-rose-300 bg-black/70 rounded">
                  {formatSec(flashCd)}
                </div>
              )}
            </div>
            <kbd aria-hidden="true" className="kbd-key text-zinc-200">PageUp</kbd>
          </div>
        </button>

        {/* Row 2: Lux Ignite */}
        <button
          type="button"
          onClick={toggleIgnite}
          aria-pressed={igniteCd > 0}
          aria-label={
            igniteCd > 0
              ? `Lux enemy Ignite, ${formatSec(igniteCd)} remaining. Activate to clear the timer.`
              : 'Start the Lux enemy Ignite timer. Hotkey Page Down.'
          }
          className={`flex w-full items-center justify-between gap-4 rounded-lg border p-3 text-left cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 ${
            igniteCd > 0
              ? 'border-amber-500/40 bg-amber-950/20'
              : 'border-white/10 bg-black/40 hover:border-white/20'
          }`}
        >
          <div className="flex items-center gap-3">
            <img
              src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/champion/Lux.png"
              alt=""
              className="h-10 w-10 rounded border border-white/20"
            />
            <div>
              <div className="text-sm font-medium text-white flex items-center gap-2">
                <span>Lux</span>
                <span className="text-[10px] text-zinc-400 uppercase font-mono">Support</span>
              </div>
              <div className="text-xs text-zinc-400">Enemy Ignite</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="relative">
              <img
                src="https://ddragon.leagueoflegends.com/cdn/15.1.1/img/spell/SummonerDot.png"
                alt=""
                className={`h-9 w-9 rounded border ${
                  igniteCd > 0 ? 'border-amber-500/60 opacity-60' : 'border-white/20'
                }`}
              />
              {igniteCd > 0 && (
                <div className="absolute inset-0 flex items-center justify-center font-mono text-xs font-bold text-amber-300 bg-black/70 rounded">
                  {formatSec(igniteCd)}
                </div>
              )}
            </div>
            <kbd aria-hidden="true" className="kbd-key text-zinc-200">PageDown</kbd>
          </div>
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-white/10 pt-3 text-xs text-zinc-400 font-mono">
        <span>Fallback keys: Num 9 / Num 3</span>
        <span>Click row or press key again to clear</span>
      </div>
    </div>
  )
}
