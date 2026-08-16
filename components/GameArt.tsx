'use client'

import { useEffect, useRef, useState } from 'react'
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
  fade = false,
}: {
  appid: number
  name: string
  headerImage?: string | null
  art?: GameArtUrls | null
  variant?: ArtVariant
  className?: string
  /** Подсказка браузеру о ширине слота; для героя по умолчанию вся ширина окна */
  sizes?: string
  /**
   * Чем заменить картинку, если ни один источник не отдал арт.
   * null — «ничем», в отличие от undefined, который даёт ArtPlaceholder:
   * второму слою панели квиза заглушка с названием игры противопоказана.
   */
  fallback?: React.ReactNode
  eager?: boolean
  /**
   * Проявление по факту загрузки (opacity через CSS img[data-art-fade]).
   * Кэшированная картинка получает data-loaded сразу — уже доступный контент
   * не прячется ради анимации, правило то же, что у .anim-page-in.
   */
  fade?: boolean
}) {
  const source = { appid, art, headerImage }
  const candidates = artCandidates(source, variant)
  // Состояние сбрасывается при смене игры без useEffect: обновление во время
  // рендера — штатный приём React для «состояния, зависящего от пропсов»
  const [tried, setTried] = useState({ appid, idx: 0 })
  const [loaded, setLoaded] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  if (tried.appid !== appid) {
    setTried({ appid, idx: 0 })
    if (loaded) setLoaded(false)
  }

  const idx = tried.appid === appid ? tried.idx : 0
  const src = candidates[idx]

  // Кэшированная картинка может быть готова до подписки на onLoad
  useEffect(() => {
    if (!fade || loaded) return
    const el = imgRef.current
    if (el?.complete && el.naturalWidth > 0) setLoaded(true)
  }, [fade, loaded, src])

  if (!src)
    return (
      <>{fallback !== undefined ? fallback : <ArtPlaceholder name={name} className={className} />}</>
    )

  // srcSet имеет смысл только пока показываем самый крупный вариант: на
  // запасных ссылках размеры уже другие
  const srcSet = idx === 0 ? artSrcSet(source, variant) : undefined

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imgRef}
      src={src}
      srcSet={srcSet}
      sizes={srcSet ? (sizes ?? (variant === 'hero' ? '100vw' : undefined)) : undefined}
      alt=""
      loading={eager ? 'eager' : 'lazy'}
      onError={() => setTried((t) => ({ appid, idx: t.idx + 1 }))}
      onLoad={fade ? () => setLoaded(true) : undefined}
      data-art-fade={fade ? '' : undefined}
      data-loaded={fade && loaded ? '' : undefined}
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
