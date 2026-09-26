import type { ReactNode } from 'react'
import type { GameArtUrls } from '@/lib/art'
import { GameArt } from './GameArt'

/**
 * Карточка игры в ряду — одна на весь продукт.
 *
 * До неё одна и та же плитка (стекло, обложка 460×215, p-3, строка в 11 px)
 * была набрана руками в восьми местах: две полки выдачи, игра дня, колода,
 * библиотека дважды, совместимость и портрет. Отличались они полями, кеглем
 * подписи и тем, реагируют ли на наведение.
 *
 * Здесь только тело: обложка и подпись под ней. Обёртка у мест разная — кнопка,
 * ссылка на страницу игры, внешняя ссылка в магазин, — поэтому её ставит
 * вызывающий, с классом `game-card`: по нему обложка при наведении мягко
 * растёт (см. .card-thumb в globals.css).
 */
export function GameCardBody({
  appid,
  name,
  headerImage,
  art,
  sizes,
  corner,
  overlay,
  meta,
  dim = false,
  eager = false,
}: {
  appid: number
  name: string
  headerImage?: string | null
  art?: GameArtUrls | null
  sizes?: string
  /** угол обложки: скидка, бейдж состояния */
  corner?: ReactNode
  /** слой поверх обложки целиком */
  overlay?: ReactNode
  /** строка под названием: процент, жанр, цена */
  meta?: ReactNode
  /** приглушить обложку (скрытое, заброшенное) */
  dim?: boolean
  /** обложка над сгибом — грузить сразу, а не лениво */
  eager?: boolean
}) {
  return (
    <>
      <span className="card-thumb aspect-[460/215]">
        <GameArt
          appid={appid}
          name={name}
          headerImage={headerImage}
          art={art}
          sizes={sizes}
          eager={eager}
          className={`h-full w-full object-cover ${dim ? 'opacity-60 grayscale' : ''}`}
        />
        {overlay}
        {corner}
      </span>
      <span className="mt-3 block px-0.5">
        <span className="block truncate text-[15px] leading-tight font-extrabold tracking-[-0.01em]">
          {name}
        </span>
        {meta ? (
          <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-[13px] leading-snug font-semibold text-dim">
            {meta}
          </span>
        ) : null}
      </span>
    </>
  )
}
