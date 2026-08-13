'use client'

import type { GameArtUrls } from '@/lib/art'
import { GameArt } from './GameArt'

/** Полноэкранный арт с фолбэком на ambient-градиент, если арта нет */
export function HeroArt({
  appid,
  headerImage,
  art,
  name = '',
}: {
  appid: number
  headerImage: string | null
  art?: GameArtUrls | null
  name?: string
}) {
  return (
    <GameArt
      appid={appid}
      name={name}
      headerImage={headerImage}
      art={art}
      variant="hero"
      eager
      className="absolute inset-0 h-full w-full object-cover anim-kenburns"
      fallback={
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(60% 50% at 70% 20%, rgba(255,158,100,0.16), transparent 70%), radial-gradient(50% 45% at 20% 80%, rgba(100,140,255,0.10), transparent 70%)',
          }}
        />
      }
    />
  )
}
