'use client'

import { useReducedMotion } from 'framer-motion'
import { useRef, useState } from 'react'
import { Spinner } from '@/components/Spinner'
import { StatusLine } from '@/components/StatusLine'
import type { Trailer } from '@/lib/trailer'
import { Icon } from '@/components/Icon'

/** idle — постер и кнопка; loading — нажали, ждём первого кадра */
type State = 'idle' | 'loading' | 'playing' | 'failed'

/**
 * Экраны, где постеру хватает кадра 600×338 (smallPoster).
 *
 * Порог — тот же, что у слайдера скриншотов (lib/shots, pickShotSize):
 * маленький кадр, пока бокс × DPR (не больше двух) укладывается в 900
 * физических пикселей. Бокс на карточке игры — окно минус поля px-5
 * (40 px), значит при DPR 2 — до 490 px окна: это любой телефон в
 * портрете. Шире — планшет, телефон боком, десктоп: там остаётся полный
 * кадр ролика. Медиа-условие, а не srcSet с шириной: по дескрипторам
 * телефон с DPR 2.6 сам выбрал бы 1920 — ровно то, от чего уходим.
 */
export const SMALL_POSTER_MEDIA = '(max-width: 490px)'

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
  smallPoster,
  className = '',
}: {
  trailer: Trailer
  name: string
  /** Свёрнут в строку-кнопку до нажатия: герой /play, где место под текст */
  compact?: boolean
  /**
   * Постер для телефона — кадр 600×338 из скриншотов игры.
   *
   * Постер ролика — movie_full, 1920×1080 на 110–453 КБ, а на телефоне бокс
   * шириной ~370 CSS px. «Ленивость» его не спасала: блок стоит сразу под
   * героем, в пределах дистанции ленивой загрузки Chrome, и файл качался
   * со стартом страницы рядом с LCP-картинкой героя (замер на проде:
   * 426 КБ на /game/1086940, и ещё 453 КБ на /game/1245620). Кадр игры, а
   * не ролика — честный размен: «В движении» нажимает меньшинство, а
   * маленький первый скриншот страница всё равно берёт для своего блока
   * «Скриншоты» (components/GameShots), так что на телефоне он ещё и из
   * кэша. Без скриншотов — полный кадр, как раньше.
   */
  smallPoster?: string
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
          className="btn-glass"
        >
          <Icon name="play" size={16} />
          В движении
          <span className="font-semibold text-dim">· без звука</span>
          {forReader}
        </button>
      )}
      {/*
        Рамка плеера — .media-card: тёмная поверхность в обеих темах, как сам
        ролик. Кнопка на постере — .btn-glass с текстом и подложкой из --ink, и
        в светлой теме она становилась тёмным пятном на тёмном кадре: замер на
        проде — 1.34:1 на CS2, 1.70:1 на Cyberpunk 2077, 2.48:1 на Hades. С
        тёмными токенами подпись светлая, «без звука», спиннер и строка отказа
        — тоже. Класс на рамке, а не на слое над постером: постера у трейлера
        бывает и нет, и тогда под кнопкой фон самой рамки — молочный
        bg-surface дал бы белую подпись на светлом. Фон теперь --bg кино-зоны.
        Строка компактного вида выше стоит в потоке страницы и держит цвета
        темы. Сторож — lib/trailer.test.ts.
      */}
      <div
        ref={boxRef}
        tabIndex={-1}
        className={`media-card relative aspect-video w-full overflow-hidden rounded-(--radius-panel) border border-edge ${
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
              // display: contents — <picture> не создаёт бокса, картинка
              // ложится на тот же absolute-слой, что и без обёртки
              <picture className="contents">
                {smallPoster && <source media={SMALL_POSTER_MEDIA} srcSet={smallPoster} />}
                <img
                  src={trailer.poster}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              </picture>
            )}
            <div className="absolute inset-0 flex items-center justify-center p-4">
              {/*
                Отказ — в строке, которая стоит с первого кадра постера, а не
                появляется на месте спиннера: живая область, вставленная вместе
                с текстом, звучит не везде (components/StatusLine). Пустая она
                sr-only и середину кадра не сдвигает.
              */}
              <StatusLine
                text={state === 'failed' ? 'Видео не загрузилось' : null}
                className="panel-lift px-4 py-2 text-sm text-dim"
              />
              {state === 'failed' ? null : state === 'loading' ? (
                <Spinner size={32} />
              ) : (
                <button
                  type="button"
                  onClick={start}
                  className="btn-glass"
                >
                  <Icon name="play" size={16} />
                  В движении
                  <span className="font-semibold text-dim">· без звука</span>
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
