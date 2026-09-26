'use client'

import { useEffect, useRef, useState } from 'react'
import { logoUrl } from '@/lib/art'

/**
 * Логотип игры поверх арта — вместо набранного заголовка, как в стриминге.
 *
 * logo.png есть не у каждой игры, и заранее этого не узнать. Поэтому
 * название текстом стоит в разметке всегда: пока логотип грузится и если он
 * так и не пришёл. Картинка поверх — декоративная (alt пустой), смысл несёт
 * текст, который остаётся для скринридера, когда картинка видна.
 *
 * Ошибка загрузки могла случиться ещё до гидратации — тогда onError React не
 * увидит. Эффект досматривает: картинка «загружена», а ширины у неё нет.
 */
export function GameLogo({
  appid,
  name,
  className = '',
  imgClassName = '',
  textClassName = '',
}: {
  appid: number
  name: string
  className?: string
  imgClassName?: string
  textClassName?: string
}) {
  const src = logoUrl(appid)
  const [state, setState] = useState<'wait' | 'ok' | 'fail'>(src ? 'wait' : 'fail')
  const ref = useRef<HTMLImageElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || !el.complete) return
    setState(el.naturalWidth > 0 ? 'ok' : 'fail')
  }, [src])

  // Рамка постоянной высоты задаётся снаружи (className с h-…): логотип и
  // текст сменяют друг друга внутри неё, и под героем ничего не прыгает.
  return (
    <span className={`relative block ${className}`}>
      <span
        className={`absolute inset-x-0 bottom-0 transition-opacity duration-300 ${
          state === 'ok' ? 'sr-only' : state === 'fail' ? 'opacity-100' : 'opacity-0'
        } ${textClassName}`}
      >
        {name}
      </span>
      {src && state !== 'fail' ? (
        // Прямой <img>, как у GameArt: арт лежит на CDN Steam, и оптимизатор
        // Next только добавил бы свой прыжок перед тем же файлом.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={ref}
          src={src}
          alt=""
          aria-hidden
          decoding="async"
          onLoad={() => setState('ok')}
          onError={() => setState('fail')}
          className={`h-full w-auto max-w-full object-contain object-left-bottom drop-shadow-[0_8px_24px_rgba(0,0,0,0.55)] transition-opacity duration-500 ${
            state === 'ok' ? 'opacity-100' : 'opacity-0'
          } ${imgClassName}`}
        />
      ) : null}
    </span>
  )
}
