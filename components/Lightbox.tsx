'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'
import { Portal } from '@/components/Portal'
import { stepIndex, swipeStep } from '@/lib/lightbox'
import { backdropOf, holdScroll, makeInert } from '@/lib/pagelock'
import { Icon } from '@/components/Icon'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Полноэкранный просмотр кадра.
 *
 * Вынут из Screenshots.tsx как есть: клавиатура, блокировка скролла под
 * оверлеем, счётчик и кнопка закрытия не менялись. Понадобился отдельно,
 * потому что кадры теперь показывает слайдер, а увеличение никуда не делось —
 * на телефоне блок 16:9 во всю ширину экрана мелковат, чтобы что-то
 * рассмотреть перед покупкой.
 *
 * Индекс держит родитель: у сетки он приходит от нажатой миниатюры, у слайдера
 * — от текущего кадра канваса, и владеть им внутри лайтбокс не может.
 *
 * layoutId необязателен. У сетки он есть, и миниатюра физически становится
 * полным кадром. У слайдера источника-миниатюры не существует — кадр живёт в
 * канвасе, а не в DOM, — поэтому там лайтбокс просто появляется.
 *
 * МОДАЛЬНОСТЬ — НЕ ТОЛЬКО СЛОВА. role="dialog" aria-modal="true" обещают, что
 * остальной страницы сейчас нет. Пока окно открыто, фон инертен, а смузер
 * стоит на паузе (lib/pagelock.ts): колесо над кадром больше не уводит
 * страницу, и виртуальный курсор скринридера не читает её под затемнением.
 * Листается кадр стрелками, кнопками по бокам и свайпом (lib/lightbox.ts).
 */
export function Lightbox({
  images,
  index,
  onIndex,
  onClose,
  layoutId,
}: {
  images: string[]
  /** null — закрыт */
  index: number | null
  onIndex: (i: number) => void
  onClose: () => void
  layoutId?: (i: number) => string
}) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  /** Где началось касание — для свайпа; null — касания нет. */
  const pressRef = useRef<{ x: number; y: number; id: number } | null>(null)
  /** Нажатие закончилось свайпом: следующий за ним click — не «закрыть». */
  const swipedRef = useRef(false)
  const isOpen = index !== null
  const many = images.length > 1

  /*
   * Фокус забираем внутрь и возвращаем обратно.
   *
   * Оверлей объявлен как role="dialog" aria-modal="true", то есть обещает
   * скринридеру, что всё остальное на странице скрыто. Фокус при этом
   * физически оставался там, где был, — на миниатюре ПОД оверлеем. Обещание
   * и положение дел расходились: Tab уводил в разметку, которую AT обязана
   * не читать, а после закрытия человек не понимал, где он.
   *
   * Отдельным эффектом от клавиатуры ниже, и это принципиально: тот зависит
   * от index и перезапускается на каждой стрелке. Возврат фокуса в его
   * очистке срабатывал бы при КАЖДОЙ смене кадра.
   *
   * Здесь же — фон. Инертность, пауза смузера и overflow снимаются в очистке,
   * то есть на любом пути закрытия: крестик, Escape, клик по фону, уход со
   * страницы с открытым кадром. Порядок в очистке важен: сначала снять inert,
   * потом возвращать фокус — в инертный узел фокус не встаёт.
   *
   * overflow остаётся для режима без смузера («уменьшить движение»): там
   * прокрутка нативная, и его хватает. Смузер прокручивает программно и
   * overflow не читает — ему нужна пауза.
   *
   * Возврат — только в элемент, который ещё в документе: миниатюра могла
   * размонтироваться (слайдер сменился сеткой на повороте экрана), и focus()
   * на отцепленном узле молча уронил бы фокус в <body>.
   */
  useEffect(() => {
    if (!isOpen) return
    const previously = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overlay = overlayRef.current
    const children = Array.from(document.body.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    const releaseInert = overlay ? makeInert(backdropOf(children, overlay)) : () => {}
    const releaseScroll = holdScroll()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()
    return () => {
      releaseInert()
      releaseScroll()
      document.body.style.overflow = overflow
      if (previously?.isConnected) previously.focus({ preventScroll: true })
    }
  }, [isOpen])

  // Escape и стрелки: лайтбокс без клавиатуры — это ловушка
  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onIndex(stepIndex(index, 1, images.length))
      if (e.key === 'ArrowLeft') onIndex(stepIndex(index, -1, images.length))
      if (e.key === 'Tab') {
        // Цикл по фокусируемому внутри оверлея: «Закрыть» и, если кадров
        // больше одного, две кнопки листания. Список, а не жёсткая ссылка на
        // кнопку, — чтобы добавленный элемент не сломал ловушку. Фон и так
        // инертен, но без цикла Tab уходил бы из окна в адресную строку.
        const focusable = overlayRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        )
        if (!focusable?.length) return
        const list = Array.from(focusable)
        const at = list.indexOf(document.activeElement as HTMLElement)
        const next = e.shiftKey ? at - 1 : at + 1
        e.preventDefault()
        list[((next % list.length) + list.length) % list.length]?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, images.length, onClose, onIndex])

  /* Портал обязателен: оверлей на весь экран, а под плавной прокруткой
     fixed внутри содержимого цепляется к содержимому. См. Portal.tsx. */
  return (
    <Portal>
      <AnimatePresence>
        {index !== null && (
        <motion.div
          ref={overlayRef}
          className="fixed inset-0 z-[100] flex items-center justify-center p-5 touch-pinch-zoom select-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          /*
            Свайп — на всём оверлее, а не на картинке: кадр на телефоне
            занимает не весь экран, и промах мимо него листать тоже должен.
            touch-pinch-zoom: палец ведёт свайп, а не прокрутку, но щипок
            остаётся — кадр на телефоне рассматривают, увеличивая.
            select-none: протяжка мышью выделяла кадр, и следующая протяжка
            тащила уже выделение — dragstart, pointercancel, кадр стоит
            (замерено на втором свайпе подряд).
          */
          onPointerDown={(e) => {
            swipedRef.current = false
            pressRef.current = many ? { x: e.clientX, y: e.clientY, id: e.pointerId } : null
          }}
          onPointerUp={(e) => {
            const press = pressRef.current
            pressRef.current = null
            if (!press || press.id !== e.pointerId) return
            const step = swipeStep(e.clientX - press.x, e.clientY - press.y)
            if (!step) return
            swipedRef.current = true
            onIndex(stepIndex(index, step, images.length))
          }}
          onPointerCancel={() => {
            pressRef.current = null
          }}
          onClick={() => {
            // Мышью свайп кончается кликом по фону — это листание, а не закрытие
            if (swipedRef.current) {
              swipedRef.current = false
              return
            }
            onClose()
          }}
          role="dialog"
          aria-modal="true"
          aria-label={`Скриншот ${index + 1} из ${images.length}`}
        >
          <div aria-hidden className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
          <motion.img
            layoutId={layoutId?.(index)}
            src={images[index]}
            alt=""
            // Мышью свайп ведут прямо по кадру, а картинку браузер тащит сам:
            // родное перетаскивание начиналось на первом же пикселе и гасило
            // жест через pointercancel — замерено, кадр не листался
            draggable={false}
            initial={layoutId ? undefined : { opacity: 0, scale: 0.97 }}
            animate={layoutId ? undefined : { opacity: 1, scale: 1 }}
            className="relative max-h-[85vh] w-auto max-w-full rounded-(--radius-panel) border border-edge"
            transition={{ duration: 0.35, ease: EASE }}
          />
          <button
            ref={closeRef}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            aria-label="Закрыть"
            className="btn-circle absolute top-5 right-5"
          >
            <Icon name="close" size={18} />
          </button>
          {many && (
            <>
              {/*
                Кнопки листания — те же, что у слайдера на странице
                (components/morph/MorphSlider.tsx): подпись, глиф и 44 px под
                палец. stopPropagation обязателен — клик по оверлею закрывает.
              */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onIndex(stepIndex(index, -1, images.length))
                }}
                aria-label="Предыдущий кадр"
                className="btn-circle absolute left-3 top-1/2 -translate-y-1/2"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onIndex(stepIndex(index, 1, images.length))
                }}
                aria-label="Следующий кадр"
                className="btn-circle absolute right-3 top-1/2 -translate-y-1/2"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                  <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
          <span className="absolute bottom-5 tabular-nums text-xs text-dim">
            {index + 1}/{images.length}
          </span>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  )
}
