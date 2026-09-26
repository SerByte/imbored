'use client'

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import { splitWords } from '@/lib/splitwords'

/** power3.out — та же кривая, что была у gsap-твина */
const easeOut = (t: number) => 1 - (1 - t) ** 3
const DURATION_MS = 600

/*
 * Эффект входа — layout-эффект: первый кадр прячет слова ДО отрисовки. В
 * обычном useEffect браузер успевал нарисовать заголовок готовым, а потом
 * слова исчезали и въезжали заново: название игры в церемонии матча мигало
 * и пропадало на секунду. Так же работал useGSAP. На сервере layout-эффекта
 * нет — там обычный, который всё равно не запускается.
 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Заголовок, который собирается по словам.
 *
 * БЕЗ GSAP. Раньше слова резал SplitText на клиенте, а въезжали они твином
 * gsap: ради пословного входа одного заголовка ядро gsap (70 КБ) стояло в
 * первой загрузке /play, /daily, /whatsnew, /portrait и /compat
 * (route-bundle-stats.json). Теперь слова — обычные <span> прямо в разметке,
 * уже на сервере, а вход — свой цикл на requestAnimationFrame: ноль килобайт.
 *
 * ПОЧЕМУ НЕ WEB ANIMATIONS API. Он был первым и выглядел так же, но
 * прозрачность в нём анимирует композитор, а Chrome засчитывает слово в LCP
 * только когда главный поток рисует его видимым — то есть в конце входа.
 * Замер на /whatsnew (телефон, 4x CPU, 4G): LCP 1400 → 2020 мс, заголовок —
 * элемент LCP. Покадровые стили, как у gsap, рисуют слово на первом же кадре,
 * и LCP вернулся к прежнему.
 *
 * Два обязательных условия остались прежними:
 *
 * 1. Не анимируем до подмены шрифта: у ожидания бюджет 150 мс. Успели —
 *    стаггер как обычно; нет — вход пропускается целиком, текст просто
 *    виден. Своп шрифта — сам по себе событие, второе поверх него читалось
 *    бы сбоем. Анимация может только добавить появление, не спрятать текст.
 * 2. Очистка останавливает цикл и снимает стили слов: смена названия — это
 *    новые слова и новый вход, а не доигрывание прошлого.
 *
 * Доступность: реальный текст — в aria-label на самом заголовке, слова
 * скрыты от скринридера — иначе заголовок читается по слову с паузами.
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

  useIsoLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let cancelled = false
    let budget = 0
    let raf = 0
    let words: HTMLElement[] = []

    const clear = () => {
      for (const w of words) {
        w.style.opacity = ''
        w.style.transform = ''
      }
    }

    const run = () => {
      if (cancelled || !ref.current) return
      words = [...ref.current.querySelectorAll<HTMLElement>('.split-word')]
      const start = performance.now()
      const frame = (now: number) => {
        let done = true
        words.forEach((word, i) => {
          const t = Math.min(1, Math.max(0, (now - start - (delay + i * stagger) * 1000) / DURATION_MS))
          if (t < 1) done = false
          const k = easeOut(t)
          word.style.opacity = String(k)
          word.style.transform = `translateY(${(1 - k) * y}px)`
        })
        if (done) clear()
        else raf = requestAnimationFrame(frame)
      }
      // Первый кадр — синхронно: слова не должны мелькнуть готовыми до старта
      frame(start)
    }

    if (document.fonts.status === 'loaded') {
      // Тёплый путь (все смены шага, повторные заходы): шрифты уже на месте
      run()
    } else {
      // Холодный путь: даём шрифтам 150 мс, иначе вход пропускается
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
      cancelAnimationFrame(raf)
      clear()
    }
  }, [children, delay, stagger, y])

  // Колбэк с общим HTMLElement подходит любому из тегов — объектный ref
  // динамического тега раньше приходилось глушить @ts-expect-error
  return (
    <Tag ref={setRef} className={className} aria-label={children} tabIndex={tabIndex}>
      {splitWords(children).map((word, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span aria-hidden className="split-word" data-stress={i === stress ? '' : undefined}>
            {word}
          </span>
        </Fragment>
      ))}
    </Tag>
  )
}
