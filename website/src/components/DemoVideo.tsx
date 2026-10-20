import { useEffect, useRef, useState } from 'react'

/** Scene start times (seconds) from the recorded take's timeline. */
const scenes = [
  { start: 0, label: 'Pick your champion. Hotkeys and the overlay sit on the same screen.' },
  { start: 3.85, label: 'Add the enemy picks and the matchup read fills in.' },
  { start: 14.93, label: 'Get a build and rune page tuned to that enemy team.' },
]

const base = import.meta.env.BASE_URL

export function DemoVideo() {
  const ref = useRef<HTMLVideoElement>(null)
  const [scene, setScene] = useState(0)
  const [reducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  // Play only while on screen so the loop costs nothing when scrolled past.
  useEffect(() => {
    const video = ref.current
    if (!video || reducedMotion) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          video.play().catch(() => {})
        } else {
          video.pause()
        }
      },
      { threshold: 0.25 },
    )

    observer.observe(video)
    return () => observer.disconnect()
  }, [reducedMotion])

  const onTimeUpdate = () => {
    const t = ref.current?.currentTime ?? 0
    let next = 0
    scenes.forEach((s, i) => {
      if (t >= s.start) next = i
    })
    if (next !== scene) setScene(next)
  }

  const seek = (i: number) => {
    const video = ref.current
    if (!video) return
    video.currentTime = scenes[i].start
    setScene(i)
    if (!reducedMotion) video.play().catch(() => {})
  }

  return (
    <figure className="mx-auto w-full">
      <div className="hud-shot clip-panel relative overflow-hidden">
        <video
          ref={ref}
          className="demo-video"
          poster={`${base}demo/one-trick-demo-poster.jpg`}
          width={1280}
          height={800}
          muted
          loop
          playsInline
          preload="metadata"
          controls={reducedMotion}
          onTimeUpdate={onTimeUpdate}
          aria-label="One Trick demo: picking a champion, adding enemy picks, and getting a build and rune page"
        >
          <source src={`${base}demo/one-trick-demo.mp4`} type="video/mp4" />
          <source src={`${base}demo/one-trick-demo.webm`} type="video/webm" />
        </video>
      </div>
      <figcaption>
        <ol className="mt-5 grid gap-3 sm:grid-cols-3">
          {scenes.map((s, i) => (
            <li key={s.start}>
              <button
                type="button"
                onClick={() => seek(i)}
                aria-current={i === scene ? 'step' : undefined}
                className={`demo-step w-full text-left ${i === scene ? 'is-active' : ''}`}
              >
                <span className="font-mono text-xs tracking-widest text-chrome-gold">0{i + 1}</span>
                <span className="mt-1 block text-sm leading-relaxed">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  )
}
