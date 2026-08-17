'use client'

import { Fragment, useEffect, useRef, useState } from 'react'
import { answerLabel, STEPS } from '@/lib/quiz'
import type { Mood } from '@/lib/types'

/**
 * Рельс шагов: три оси, ember-волосок под текущей.
 *
 * Набран киккером сайта (моно, верхний регистр, разрядка) — тем же, что
 * надзаголовки /library, /compat и /portrait: квиз был единственным крупным
 * экраном без этого регистра. Разделитель «·» между осями — тот же, что в
 * строке настроения («Пара часов · Расслабиться · Один»): отвеченная ось
 * показывает выбранное значение, и рельс на глазах СОБИРАЕТ ту строку,
 * которой квиз закончится и которая встретит человека на экране ожидания.
 *
 * Отвеченная ось кликается — это возврат. Так рельс сразу и прогресс, и
 * память, и навигация.
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
  trailing,
}: {
  stepIndex: number
  answers: Partial<Mood>
  onJump: (index: number) => void
  /**
   * Системный угол строки. Рендерится ПОСЛЕ кнопок шагов, и это несущее:
   * волосок меряет row.querySelectorAll('button')[stepIndex], поэтому всё, что
   * встанет раньше третьего индекса, будет измерено вместо подписи.
   */
  trailing?: React.ReactNode
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
      // querySelectorAll('button'), а не children[i]: волосок и разделители
      // лежат в этом же контейнере и сдвигали бы индексы — та же грабля, что
      // в MobileNav.
      const el = row.querySelectorAll('button')[stepIndex] as HTMLElement | undefined
      if (!el) return setBar(null)
      const text = (el.querySelector('[data-label]') as HTMLElement | null) ?? el
      const rowBox = row.getBoundingClientRect()
      const box = text.getBoundingClientRect()
      // Разрядка добавляет мёртвый хвост ПОСЛЕ последней буквы, и он входит в
      // ширину бокса — без вычета волосок вылезал бы правее текста.
      const tail = parseFloat(getComputedStyle(text).letterSpacing) || 0
      setBar({ left: box.left - rowBox.left, width: Math.max(0, box.width - tail) })
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
   * Счётчика «1 / 3» здесь нет: цифру шага держит правый якорь страницы (он
   * показывает её, пока не приехало число бэклога, и всегда — гостю), а где
   * человек находится, рельс и так показывает волоском.
   */
  return (
    <div
      ref={rowRef}
      className="relative flex flex-wrap items-baseline gap-3 font-mono text-[11px] uppercase tracking-[0.2em] md:tracking-[0.3em]"
    >
      {bar && (
        <span
          aria-hidden
          className="rail-bar absolute -bottom-1 h-[2px] rounded-full bg-ember"
          style={{ left: bar.left, width: bar.width }}
        />
      )}
      {STEPS.map((step, i) => (
        <Fragment key={step.key}>
          {i > 0 && (
            <span aria-hidden className="text-faint">
              ·
            </span>
          )}
          <button
            type="button"
            // Вперёд по рельсу не прыгают: следующий вопрос ещё не заслужен
            disabled={i > stepIndex}
            onClick={() => onJump(i)}
            aria-current={i === stepIndex ? 'step' : undefined}
            // py/-my: у 11px-киккера хит-зона иначе меньше 20px
            className={`-my-2 py-2 transition-colors ${
              i === stepIndex
                ? 'quiz-rail-on'
                : i < stepIndex
                  ? 'cursor-pointer text-dim hover:text-ink'
                  : 'text-faint'
            }`}
          >
            <span data-label>{labels[i]}</span>
          </button>
        </Fragment>
      ))}
      {trailing && <span className="ml-auto flex items-center">{trailing}</span>}
    </div>
  )
}
