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
 * 1. Не режем текст до подмены шрифта: слова замерялись бы по метрикам
 *    фолбэка и после свопа разъезжались. Но и ждать fonts.ready бесконечно
 *    нельзя — у ожидания есть бюджет (см. ниже): на медленном шрифте текст
 *    уже виден, и перепрятывать отрисованные слова ради повторного входа —
 *    это мигание, а не церемония. Анимация может только добавить появление.
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
      let budget = 0

      const run = () => {
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
      }

      if (document.fonts.status === 'loaded') {
        // Тёплый путь (все смены шага, повторные заходы): шрифты уже на месте
        run()
      } else {
        // Холодный путь: даём шрифтам 150 мс. Успели — стаггер как обычно;
        // нет — стаггер пропускается целиком, текст просто остаётся видимым.
        // Своп шрифта — сам по себе визуальное событие, второе поверх него
        // читалось бы как сбой (и до этой развилки так и читалось: контейнер
        // уже устаканивался, когда слова начинали въезжать заново).
        budget = window.setTimeout(() => {
          cancelled = true
        }, 150)
        void document.fonts.ready.then(() => {
          window.clearTimeout(budget)
          run()
        })
      }

      return () => {
        cancelled = true
        window.clearTimeout(budget)
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
