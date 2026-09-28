'use client'

import { m, useReducedMotion } from 'framer-motion'
import type { Ref } from 'react'

const EASE = [0.22, 1, 0.36, 1] as const
const SPREAD = 14 // максимальный разлёт призраков по X, px

/**
 * Заголовок, в который сходятся призрачные копии.
 *
 * Здесь это не украшение, а иллюстрация механики: число призраков равно числу
 * людей в комнате, и они схлопываются в одно слово ровно так же, как только что
 * схлопнулись их голоса. В комнате на четверых — четыре призрака.
 *
 * Смещение только по X: по Y призраки читаются как тень, а тени в этом дизайне
 * нет нигде.
 *
 * Настоящий заголовок всегда видим и не анимируется по прозрачности — если
 * анимация не отработает, текст всё равно на месте. Призраки скрыты от
 * скринридера, иначе «Это матч!» читается четыре раза подряд.
 *
 * tabIndex={-1} — заголовок принимает фокус программно, в обход по Tab не
 * встаёт. Церемония матча подменяет комнату целиком, кнопки колоды уходят, и
 * фокус падал в body; теперь его забирает «Это матч!» (headRef, решение — в
 * MatchCeremony). Атрибут на обоих h1: ветка без движения — тот же заголовок.
 */
export function EchoTitle({
  text,
  ghosts = 3,
  className = '',
  delay = 0.42,
  headRef,
}: {
  text: string
  ghosts?: number
  className?: string
  delay?: number
  /** настоящий заголовок, без призраков, — цель фокуса */
  headRef?: Ref<HTMLHeadingElement>
}) {
  const reduce = useReducedMotion()
  const n = Math.max(2, Math.min(5, ghosts))

  if (reduce) return <h1 ref={headRef} tabIndex={-1} className={className}>{text}</h1>

  return (
    <div className="relative">
      {Array.from({ length: n }, (_, i) => {
        // равномерный разлёт: -SPREAD … +SPREAD
        const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1
        return (
          <m.span
            key={i}
            aria-hidden
            className={`${className} absolute inset-0 whitespace-nowrap text-ember-text`}
            initial={{ x: t * SPREAD, opacity: 0.22 }}
            animate={{ x: 0, opacity: 0 }}
            transition={{ duration: 0.55, ease: EASE, delay }}
          >
            {text}
          </m.span>
        )
      })}
      {/* relative обязателен: призраки выше — позиционированные, и без этого
          они печатались бы ПОВЕРХ настоящего заголовка, а не за ним. */}
      <h1 ref={headRef} tabIndex={-1} className={`relative ${className}`}>{text}</h1>
    </div>
  )
}
