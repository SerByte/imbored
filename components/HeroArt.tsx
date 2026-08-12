'use client'

import { useEffect, useState } from 'react'

export function heroArtUrl(appid: number, headerImage: string | null): string | null {
  if (appid > 0)
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appid}/library_hero.jpg`
  return headerImage
}

/** Полноэкранный арт с фолбэком header.jpg и ambient-градиентом, если арта нет */
export function HeroArt({ appid, headerImage }: { appid: number; headerImage: string | null }) {
  const [src, setSrc] = useState(heroArtUrl(appid, headerImage))
  useEffect(() => setSrc(heroArtUrl(appid, headerImage)), [appid, headerImage])
  if (!src) {
    return (
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 70% 20%, rgba(255,158,100,0.16), transparent 70%), radial-gradient(50% 45% at 20% 80%, rgba(100,140,255,0.10), transparent 70%)',
        }}
      />
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setSrc(src !== headerImage ? headerImage : null)}
      className="absolute inset-0 h-full w-full object-cover anim-kenburns"
    />
  )
}
