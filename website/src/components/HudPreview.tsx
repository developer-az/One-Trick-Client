/** Real in-app screenshot plane — preserves intrinsic aspect ratio. */

type Props = {
  src?: string
  alt?: string
  caption?: string
  /** Wider hero treatment vs nested column shot */
  size?: 'hero' | 'inline'
}

const SIZE = {
  hero: 'max-w-5xl',
  inline: 'max-w-none',
} as const

export function HudPreview({
  src = `${import.meta.env.BASE_URL}screenshots/hero-app.png`,
  alt = 'One Trick — Pyke Support loadout screen',
  caption = 'Live client · Pyke Support',
  size = 'hero',
}: Props) {
  return (
    <figure className={`relative mx-auto w-full ${SIZE[size]}`}>
      <div className="hud-shot clip-panel relative overflow-hidden">
        <img
          src={src}
          alt={alt}
          width={838}
          height={577}
          decoding="async"
          {...(size === 'hero' ? { fetchPriority: 'high' as const } : {})}
        />
      </div>
      <figcaption className="mt-3 text-sm text-chrome-dim">
        {caption}
      </figcaption>
    </figure>
  )
}
