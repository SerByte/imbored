'use client'

import { useState } from 'react'
import { artCandidates, artSrcSet, type ArtVariant, type GameArtUrls } from '@/lib/art'

/**
 * Обложка игры с деградацией по цепочке источников.
 *
 * URL арта Steam нельзя построить по шаблону: пути контент-адресуемые, с хэшем
 * у каждого ассета (см. lib/art.ts). Поэтому первыми идут резолвленные ссылки из
 * базы, а шаблон остаётся запасным вариантом для ещё не прогретых строк.
 *
 * Размер выбирается под место: в полноэкранный герой уходит library_hero
 * 1920×620, в плитку — header 460×215. Раньше везде брался header, и герой
 * выглядел мылом.
 */
export function GameArt({
  appid,
  name,
  headerImage,
  art,
  variant = 'card',
  className = '',
  sizes,
  fallback,
  eager = false,
}: {
  appid: number
  name: string
  headerImage?: string | null
  art?: GameArtUrls | null
  variant?: ArtVariant
  className?: string
  /** Подсказка браузеру о ширине слота; для героя по умолчанию вся ширина окна */
  sizes?: string
  /** Чем заменить картинку, если ни один источник не отдал арт */
  fallback?: React.ReactNode
  eager?: boolean
}) {
  const source = { appid, art, headerImage }
  const candidates = artCandidates(source, variant)
  // Состояние сбрасывается при смене игры без useEffect: обновление во время
  // рендера — штатный приём React для «состояния, зависящего от пропсов»
  const [tried, setTried] = useState({ appid, idx: 0 })
  if (tried.appid !== appid) setTried({ appid, idx: 0 })

  const idx = tried.appid === appid ? tried.idx : 0
  const src = candidates[idx]
  if (!src) return <>{fallback ?? <ArtPlaceholder name={name} className={className} />}</>

  // srcSet имеет смысл только пока показываем самый крупный вариант: на
  // запасных ссылках размеры уже другие
  const srcSet = idx === 0 ? artSrcSet(source, variant) : undefined

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? (sizes ?? (variant === 'hero' ? '100vw' : undefined)) : undefined}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setTried((t) => ({ appid, idx: t.idx + 1 }))}
      className={className}
    />
  )
}

/** Типографская заглушка: название игры вместо иконки битой картинки. */
export function ArtPlaceholder({ name, className = '' }: { name: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center px-3 text-center ${className}`}
      style={{
        background:
          'radial-gradient(80% 120% at 50% 0%, rgba(255,158,100,0.14), transparent 70%), var(--glass-bg)',
      }}
    >
      <span className="text-xs font-semibold leading-tight text-dim line-clamp-3">{name}</span>
    </div>
  )
}
