'use client'

import { useEffect, useRef, useState } from 'react'
import { SplitHeading } from '@/components/SplitHeading'
import { logoUrl } from '@/lib/art'

/**
 * ЗАГОЛОВОК ГЕРОЯ: ЛОГОТИП ИГРЫ, А НЕ НАБРАННОЕ НАЗВАНИЕ.
 *
 * Стриминг ставит поверх арта логотип фильма, и «Премьера» делает так же:
 * у большинства игр в Steam есть logo.png без фона. Набранное название рядом с
 * ним — это подпись к картинке, а логотип и есть сама игра.
 *
 * Заголовок при этом остаётся настоящим h1 с текстом — для скринридера, для
 * фокуса (героя фокусируют программно после каждого ответа) и для запасного
 * случая. Он делит с логотипом одну ячейку сетки и уходит в sr-only, только
 * когда логотип действительно загрузился.
 *
 * ЖДЁМ НЕ ДОЛЬШЕ LOGO_WAIT_MS. Пока логотип грузится, текст прозрачен — иначе
 * название мелькнуло бы и сменилось картинкой. Но если логотипа у игры нет или
 * он едет долго, пустое место под причиной хуже любой подмены: по таймеру
 * показываем текст, и опоздавший логотип его уже не вытесняет.
 */
const LOGO_WAIT_MS = 900

type State = 'wait' | 'ok' | 'text'

export function HeroTitle({
  appid,
  name,
  headingRef,
  className = '',
  logoClassName = '',
  delay,
}: {
  appid: number
  name: string
  headingRef?: (el: HTMLElement | null) => void
  /** Классы текстового заголовка: кегль и прочее */
  className?: string
  /** Высота рамки логотипа — её задаёт страница */
  logoClassName?: string
  delay?: number
}) {
  const src = logoUrl(appid)
  const [shown, setShown] = useState<{ appid: number; state: State }>({
    appid,
    state: src ? 'wait' : 'text',
  })
  // Смена игры без размонтирования: состояние сбрасывается во время рендера,
  // тем же приёмом, что в GameArt
  if (shown.appid !== appid) setShown({ appid, state: src ? 'wait' : 'text' })
  const state: State = shown.appid === appid ? shown.state : src ? 'wait' : 'text'
  const settle = (next: State) =>
    setShown((s) => (s.appid === appid && s.state === 'wait' ? { appid, state: next } : s))

  const img = useRef<HTMLImageElement>(null)
  useEffect(() => {
    if (state !== 'wait') return
    const el = img.current
    // Логотип из кэша готов раньше, чем React успел подписаться на onLoad
    if (el?.complete) {
      setShown({ appid, state: el.naturalWidth > 0 ? 'ok' : 'text' })
      return
    }
    const t = window.setTimeout(
      () => setShown((s) => (s.appid === appid && s.state === 'wait' ? { appid, state: 'text' } : s)),
      LOGO_WAIT_MS,
    )
    return () => window.clearTimeout(t)
  }, [state, appid])

  return (
    <div className="grid items-end justify-items-start">
      {src && state !== 'text' && (
        // Прямой <img>, как у GameArt: файл лежит на CDN Steam
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={img}
          src={src}
          alt=""
          aria-hidden
          decoding="async"
          onLoad={() => settle('ok')}
          onError={() => settle('text')}
          className={`hero-logo [grid-area:1/1] w-auto max-w-full object-contain object-left-bottom ${logoClassName} ${
            state === 'ok' ? 'is-in' : ''
          }`}
        />
      )}
      <SplitHeading
        headingRef={headingRef}
        tabIndex={-1}
        delay={delay}
        className={`[grid-area:1/1] outline-none transition-opacity duration-300 ${className} ${
          state === 'ok' ? 'sr-only' : state === 'wait' ? 'opacity-0' : ''
        }`}
      >
        {name}
      </SplitHeading>
    </div>
  )
}
