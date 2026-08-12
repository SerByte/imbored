'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { useRef } from 'react'

gsap.registerPlugin(SplitText, useGSAP)

/**
 * Заголовок, который собирается по словам.
 *
 * Здесь gsap, а не motion, по одной причине: SplitText корректно режет строку на
 * слова и символы с учётом юникода — интерфейс кириллический, и наивный split(' ')
 * ломается на составных названиях и неразрывных пробелах.
 *
 * Два обязательных условия, без которых эффект выглядит сломанным:
 *
 * 1. Ждём document.fonts.ready. Onest грузится сабсетом через next/font, и если
 *    разрезать текст до подмены шрифта, слова замеряются по метрикам фолбэка и
 *    после свопа разъезжаются.
 * 2. split.revert() на очистке. Без него в DOM остаются служебные <span>, и
 *    следующий рендер режет уже разрезанное.
 *
 * Доступность: реальный текст остаётся в aria-label, разрезанные слова скрыты от
 * скринридера — иначе заголовок читается по слову с паузами.
 */
export function SplitHeading({
  children,
  className = '',
  as: Tag = 'h1',
  delay = 0,
  stagger = 0.045,
  y = 24,
}: {
  children: string
  className?: string
  as?: 'h1' | 'h2' | 'div' | 'span'
  delay?: number
  stagger?: number
  y?: number
}) {
  const ref = useRef<HTMLElement>(null)

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

      let split: SplitText | null = null
      let tween: gsap.core.Tween | null = null
      let cancelled = false

      void document.fonts.ready.then(() => {
        if (cancelled || !ref.current) return
        split = new SplitText(ref.current, { type: 'words', wordsClass: 'split-word' })
        tween = gsap.from(split.words, {
          y,
          opacity: 0,
          duration: 0.6,
          ease: 'power3.out',
          stagger,
          delay,
        })
      })

      return () => {
        cancelled = true
        tween?.kill()
        split?.revert()
      }
    },
    { scope: ref, dependencies: [children] },
  )

  return (
    // @ts-expect-error — динамический тег: ref типизируется через общий HTMLElement
    <Tag ref={ref} className={className} aria-label={children}>
      {children}
    </Tag>
  )
}
