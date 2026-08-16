'use client'

import { useEffect, useRef, useState } from 'react'
import { answerLabel, STEPS } from '@/lib/quiz'
import type { Mood } from '@/lib/types'

/**
 * Рельс шагов: три оси, ember-волосок под текущей.
 *
 * Заменяет три одинаковые точки. Точки говорили ровно одно — «шагов три», —
 * и не говорили ни как называются оси, ни что уже выбрано, ни как вернуться:
 * назад вела отдельная текстовая ссылка, и ровно на один шаг.
 *
 * Отвеченная ось показывает ВЫБРАННОЕ ЗНАЧЕНИЕ вместо названия оси и кликается.
 * Так рельс сразу и прогресс, и память, и навигация.
 *
 * Волосок ИЗМЕРЯЕТ активную подпись, а не делит ширину на три — ровно та же
 * причина, что в MobileNav: подписи кириллические и сильно разной длины
 * («Вайб» против «Расслабиться»), а пересчитывать надо ещё и после подмены
 * шрифта, потому что до свопа ширины другие.
 */
export function AxisRail({
  stepIndex,
  answers,
  onJump,
}: {
  stepIndex: number
  answers: Partial<Mood>
  onJump: (index: number) => void
}) {
  const labels = STEPS.map((step) => {
    const chosen = answers[step.key]
    return (chosen && answerLabel(chosen)) || step.axis
  })

  // Подписи строкой — ключ пересчёта: при ответе слово меняется, и волосок
  // обязан переехать под новую ширину
  const labelKey = labels.join(' ')

  const rowRef = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const row = rowRef.current
      if (!row) return setBar(null)
      // querySelectorAll('button'), а не children[i]: сам волосок лежит в этом
      // же контейнере и сдвигал бы индексы — та же грабля, что в MobileNav.
      const el = row.querySelectorAll('button')[stepIndex] as HTMLElement | undefined
      if (!el) return setBar(null)
      const text = (el.querySelector('[data-label]') as HTMLElement | null) ?? el
      const rowBox = row.getBoundingClientRect()
      const box = text.getBoundingClientRect()
      setBar({ left: box.left - rowBox.left, width: box.width })
    }

    measure()
    const ro = new ResizeObserver(measure)
    if (rowRef.current) ro.observe(rowRef.current)
    window.addEventListener('resize', measure)
    void document.fonts?.ready.then(measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [stepIndex, labelKey])

  /*
   * Счётчика «1 / 3» здесь больше нет. Правым якорем страницы стало число
   * бэклога, и два числа друг под другом соревновались бы за одно и то же
   * место; а где человек находится, рельс и так показывает волоском.
   */
  return (
    <div className="flex w-full items-baseline gap-4">
      <div ref={rowRef} className="relative flex items-baseline gap-4 md:gap-6">
        {bar && (
          <span
            aria-hidden
            className="absolute -bottom-2 h-[2px] rounded-full bg-ember"
            style={{
              left: bar.left,
              width: bar.width,
              transition:
                'left var(--dur-base) var(--ease-out), width var(--dur-base) var(--ease-out)',
            }}
          />
        )}
        {STEPS.map((step, i) => (
          <button
            key={step.key}
            type="button"
            // Вперёд по рельсу не прыгают: следующий вопрос ещё не заслужен
            disabled={i > stepIndex}
            onClick={() => onJump(i)}
            aria-current={i === stepIndex ? 'step' : undefined}
            className={`text-sm transition-colors md:text-base ${
              i === stepIndex
                ? 'font-semibold text-ember-text'
                : i < stepIndex
                  ? 'cursor-pointer text-dim hover:text-ink'
                  : 'text-faint'
            }`}
          >
            <span data-label>{labels[i]}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
