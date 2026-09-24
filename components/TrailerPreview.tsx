'use client'

import { useReducedMotion } from 'motion/react'
import { useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import type { Trailer } from '@/lib/trailer'

/** idle — постер и кнопка; loading — нажали, ждём первого кадра */
type State = 'idle' | 'loading' | 'playing' | 'failed'

/**
 * Микротрейлер Steam прямо на карточке: секунды геймплея без ухода на YouTube
 * и без вкладки магазина.
 *
 * НИЧЕГО НЕ КАЧАЕТСЯ ДО НАЖАТИЯ. Ролик весит 2–3 МБ (замер по верху
 * каталога: 2,1–2,9 МБ mp4, 6–8,5 секунды), и на /play пятёрку листают
 * руками — автоплей стоил бы по мегабайтам на каждую карточку, которую
 * пролистали не глядя. Поэтому <video> стоит с preload="none" и без атрибута
 * poster: такой элемент не делает ни одного запроса. Постер — обычный <img>
 * с loading="lazy" поверх, а в компактном виде его нет вовсе, пока не нажали.
 *
 * play() зовётся прямо в обработчике нажатия, а не эффектом после
 * перерисовки: iOS разрешает запуск видео только из жеста, и то, что ролик
 * без звука, спасает не во всех версиях.
 *
 * ДВИЖЕНИЕ ОСТАНАВЛИВАЕТСЯ. Ролик короткий и по умолчанию крутится по кругу —
 * так его и показывает магазин, — а круг длиннее пяти секунд без паузы —
 * провал WCAG 2.2.2. Пауза — родные controls, они появляются вместе с первым
 * кадром. При prefers-reduced-motion круга нет вовсе: ролик играет один раз
 * и возвращается к постеру. loop ставится в момент нажатия, а не атрибутом:
 * на сервере предпочтение неизвестно, и атрибут разошёлся бы при гидратации.
 *
 * Звука в микротрейлерах нет, и подпись говорит об этом заранее: иначе кнопку
 * громкости крутили бы в поисках звука, которого не будет.
 *
 * Отказ (ролик пропал из CDN, браузер не умеет ни webm, ни mp4) — строка
 * вместо кнопки. Карточка без трейлера — нормальная карточка, поэтому ничего
 * громче этого не нужно.
 */
export function TrailerPreview({
  trailer,
  name,
  compact = false,
  className = '',
}: {
  trailer: Trailer
  name: string
  /** Свёрнут в строку-кнопку до нажатия: герой /play, где место под текст */
  compact?: boolean
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<State>('idle')
  const [open, setOpen] = useState(!compact)
  // boolean | null — до первого замера считаем, что движение можно
  const reduced = useReducedMotion() === true

  const start = () => {
    setOpen(true)
    // Кнопка, на которой стоял фокус, сейчас исчезнет (строка — насовсем,
    // кнопка на постере — до конца ролика): фокус переезжает на сам ролик, а
    // не падает в начало страницы
    requestAnimationFrame(() => boxRef.current?.focus({ preventScroll: true }))
    const v = videoRef.current
    if (!v) return
    v.loop = !reduced
    setState('loading')
    v.play().catch((err: unknown) => {
      // Поломка ролика — только NotSupportedError: не сыграл ни один
      // источник. AbortError (вкладку увели в фон, Chrome глушит видео без
      // звука ради батареи) и NotAllowedError — не про ролик: возвращаем
      // кнопку, и следующее нажатие сработает
      const broken = err instanceof DOMException && err.name === 'NotSupportedError'
      setState(broken ? 'failed' : 'idle')
    })
  }

  // Имя игры — хвостом для скринридера: видимая подпись обязана быть началом
  // доступного имени (WCAG 2.5.3), а «В движении» без игры непонятно о чём
  const forReader = <span className="sr-only">, {name}</span>

  return (
    <div className={className}>
      {!open && (
        <button
          type="button"
          onClick={start}
          className="rounded-full glass glass-hover px-4 py-2 text-sm inline-flex items-center gap-2"
        >
          <span aria-hidden>▶</span>
          В движении
          <span className="text-dim">· без звука</span>
          {forReader}
        </button>
      )}
      <div
        ref={boxRef}
        tabIndex={-1}
        className={`relative aspect-video w-full overflow-hidden rounded-[20px] border border-edge bg-surface ${
          open ? '' : 'hidden'
        }`}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          preload="none"
          controls={state === 'playing'}
          aria-label={`${name}: несколько секунд геймплея без звука`}
          onPlaying={() => setState('playing')}
          onEnded={() => setState('idle')}
          className="absolute inset-0 h-full w-full object-cover"
        >
          {/* webm обычно легче; кто его не умеет, берёт mp4. Ошибка всплывает
              на последнем источнике — значит, не сыграл ни один */}
          {trailer.webm && <source src={trailer.webm} type="video/webm" />}
          <source src={trailer.mp4} type="video/mp4" onError={() => setState('failed')} />
        </video>

        {state !== 'playing' && (
          <div className="absolute inset-0">
            {open && trailer.poster && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={trailer.poster}
                alt=""
                loading="lazy"
                decoding="async"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
            <div className="absolute inset-0 flex items-center justify-center p-4">
              {state === 'failed' ? (
                <p role="status" className="glass rounded-[14px] px-4 py-2 text-sm text-dim">
                  Видео не загрузилось
                </p>
              ) : state === 'loading' ? (
                <Spinner size={32} />
              ) : (
                <button
                  type="button"
                  onClick={start}
                  className="rounded-full glass glass-hover px-5 py-3 text-sm inline-flex items-center gap-2"
                >
                  <span aria-hidden>▶</span>
                  В движении
                  <span className="text-dim">· без звука</span>
                  {forReader}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
