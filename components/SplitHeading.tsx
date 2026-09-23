'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { SplitText } from 'gsap/SplitText'
import { useCallback, useRef } from 'react'

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
 *
 * Поэтому тег — только заголовок. aria-label на div или span (роль generic)
 * запрещён ARIA 1.2 и браузерами игнорируется, а слова под ним спрятаны —
 * и текст пропадает из дерева доступности целиком. Так экран матча не
 * называл игру, на которой сошлись (components/MatchCeremony.tsx). Прежние
 * 'div' | 'span' в типе убраны: вернуть их — ошибка компиляции, а не
 * тихая дыра, которую видно только скринридером.
 */
export function SplitHeading({
  children,
  className = '',
  as: Tag = 'h1',
  delay = 0,
  stagger = 0.045,
  y = 24,
  stress,
  headingRef,
  tabIndex,
}: {
  children: string
  className?: string
  as?: 'h1' | 'h2'
  delay?: number
  stagger?: number
  y?: number
  /**
   * Индекс слова, которое несёт фразу: получает data-stress, а вес и трекинг
   * ему назначает страница. Титульность делается контрастом веса внутри одной
   * строки — так набраны настоящие титры.
   *
   * По умолчанию undefined, то есть поведение остальных экранов не меняется
   * ни на байт.
   */
  stress?: number
  /**
   * Сам узел заголовка — для тех, кто переносит на него фокус (герой /play
   * после смены игры). Колбэк, а не объект: узел нужен в момент появления,
   * а при AnimatePresence mode="wait" он появляется позже, чем срабатывает
   * эффект страницы.
   */
  headingRef?: (el: HTMLElement | null) => void
  /** -1 — фокус принимается программно, но в обход по Tab заголовок не встаёт */
  tabIndex?: number
}) {
  const ref = useRef<HTMLElement>(null)
  const setRef = useCallback(
    (el: HTMLElement | null) => {
      ref.current = el
      headingRef?.(el)
    },
    [headingRef],
  )

  useGSAP(
    () => {
      const el = ref.current
      if (!el) return
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      // Ударение — ТИПОГРАФИКА, а не движение: при выключенных анимациях резать
      // строку всё равно нужно, иначе вес ударного слова пропадал бы вместе со
      // стаггером. Экраны без stress ведут себя ровно как раньше.
      if (reduce && stress === undefined) return

      let split: SplitText | null = null
      let tween: gsap.core.Tween | null = null
      let cancelled = false
      let budget = 0

      const run = () => {
        if (cancelled || !ref.current) return
        split = new SplitText(ref.current, { type: 'words', wordsClass: 'split-word' })
        if (stress !== undefined) split.words[stress]?.setAttribute('data-stress', '')
        if (reduce) return
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

  // Колбэк с общим HTMLElement подходит любому из тегов — объектный ref
  // динамического тега раньше приходилось глушить @ts-expect-error
  return (
    <Tag ref={setRef} className={className} aria-label={children} tabIndex={tabIndex}>
      {children}
    </Tag>
  )
}
