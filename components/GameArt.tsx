'use client'

import { useState } from 'react'
import { artCandidates } from '@/lib/art'

/**
 * Обложка игры с деградацией по цепочке источников.
 *
 * URL арта Steam нельзя построить по шаблону: пути контент-адресуемые, с хэшем
 * у каждого ассета (см. lib/art.ts). Поэтому первым идёт резолвленная ссылка из
 * базы, а шаблон остаётся запасным вариантом для ещё не прогретых строк.
 * Когда не осталось ни одного кандидата — рисуем заглушку, а не битую картинку.
 */
export function GameArt({
  appid,
  name,
  headerImage,
  className = '',
  fallback,
  eager = false,
}: {
  appid: number
  name: string
  headerImage?: string | null
  className?: string
  /** Чем заменить картинку, если ни один источник не отдал арт */
  fallback?: React.ReactNode
  eager?: boolean
}) {
  const candidates = artCandidates({ appid, headerImage })
  // Состояние сбрасывается при смене игры без useEffect: обновление во время
  // рендера — штатный приём React для «состояния, зависящего от пропсов»
  const [tried, setTried] = useState({ appid, idx: 0 })
  if (tried.appid !== appid) setTried({ appid, idx: 0 })

  const src = candidates[tried.appid === appid ? tried.idx : 0]
  if (!src) return <>{fallback ?? <ArtPlaceholder name={name} className={className} />}</>

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
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
