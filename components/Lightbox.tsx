'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef } from 'react'

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
  const isOpen = index !== null

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
   */
  useEffect(() => {
    if (!isOpen) return
    const previously = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    return () => previously?.focus()
  }, [isOpen])

  // Escape и стрелки: лайтбокс без клавиатуры — это ловушка
  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onIndex((index + 1) % images.length)
      if (e.key === 'ArrowLeft') onIndex((index - 1 + images.length) % images.length)
      if (e.key === 'Tab') {
        // Цикл по фокусируемому внутри оверлея. Сейчас там одна кнопка, и
        // цикл вырождается в «остаться на ней» — но список, а не жёсткая
        // ссылка на кнопку, чтобы добавленный элемент не сломал ловушку.
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
    // фон не должен скроллиться под открытым лайтбоксом
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [index, images.length, onClose, onIndex])

  return (
    <AnimatePresence>
      {index !== null && (
        <motion.div
          ref={overlayRef}
          className="fixed inset-0 z-[100] flex items-center justify-center p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Скриншот ${index + 1} из ${images.length}`}
        >
          <div aria-hidden className="absolute inset-0 bg-black/85 backdrop-blur-sm" />
          <motion.img
            layoutId={layoutId?.(index)}
            src={images[index]}
            alt=""
            initial={layoutId ? undefined : { opacity: 0, scale: 0.97 }}
            animate={layoutId ? undefined : { opacity: 1, scale: 1 }}
            className="relative max-h-[85vh] w-auto max-w-full rounded-[20px] border border-edge"
            transition={{ duration: 0.35, ease: EASE }}
          />
          <button
            ref={closeRef}
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            aria-label="Закрыть"
            className="absolute top-5 right-5 rounded-full glass px-4 py-2 text-sm cursor-pointer"
          >
            Закрыть ✕
          </button>
          <span className="absolute bottom-5 font-mono text-xs text-dim">
            {index + 1}/{images.length}
          </span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
