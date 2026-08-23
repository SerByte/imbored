'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Кольцо процента — общий компонент.
 *
 * Раньше жил только внутри /compat как PercentRing, хотя приложение показывает
 * проценты ещё в двух местах: оценка отзывов на /game (обычным моно-текстом) и
 * прогресс разбора библиотеки на /play (вообще без индикатора). Теперь один.
 *
 * Отличие от исходника: и число, и дуга едут в ОДНОМ rAF-цикле, а не числом в
 * rAF плюс дугой на CSS-transition. Это нужно для /play, где percent меняется
 * вживую: кольцо доезжает от текущего значения к новому, а не дёргается с нуля.
 */
export function ProgressRing({
  percent,
  size = 200,
  stroke = 10,
  duration = 1000,
  showPercent = true,
  suffix = '%',
  label,
  ariaLabel,
  className = '',
}: {
  percent: number
  size?: number
  stroke?: number
  duration?: number
  showPercent?: boolean
  /**
   * Что стоит после числа в центре. Дуга всегда рисует шкалу 0–100, но само
   * число не всегда процент: концентрация на портрете — это индекс HHI, и
   * знак «%» рядом с ним просто врёт. Там подпись под кольцом вынуждена была
   * поправлять картинку словами — «Концентрация 34 из 100».
   */
  suffix?: string
  /** Что показать вместо процента в центре (например, счётчик оставшихся игр). */
  label?: React.ReactNode
  /**
   * Что произносит скринридер. Без него слышно голое «48%» — сорок восемь
   * процентов чего, из разметки не следует: svg помечен aria-hidden.
   */
  ariaLabel?: string
  className?: string
}) {
  const target = Math.max(0, Math.min(100, percent))
  /*
   * Стартуем с ГОТОВОГО значения, а не с нуля.
   *
   * useState(0) означал, что в серверном HTML стоит «0%» — а это то, что читают
   * краулер и человек с выключенным JS на самой шаримой странице приложения.
   * Ровно это правило CountNumber формулирует у себя в докблоке и по той же
   * причине. Анимацию от нуля запускает первый клиентский эффект: mounted
   * отличает первый прогон от последующих, поэтому живое обновление на /play
   * по-прежнему доезжает от текущего значения, а не дёргается с нуля.
   */
  const [shown, setShown] = useState(target)
  const shownRef = useRef(target)
  const mounted = useRef(false)

  useEffect(() => {
    const from = mounted.current ? shownRef.current : 0
    mounted.current = true
    if (from === target) return

    // Выключенная анимация — не отдельная ветка, а нулевая длительность:
    // первый же кадр отдаёт p=1 и кольцо просто оказывается на месте.
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = reduce ? 1 : Math.min((t - start) / duration, 1)
      // тот же ease-out, что у --ease-out, чтобы кольцо звучало как остальная хореография
      const eased = 1 - Math.pow(1 - p, 3)
      const value = from + (target - from) * eased
      shownRef.current = value
      setShown(value)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    // Та же страховка, что и в CountNumber: rAF молчит в фоновой вкладке, а
    // кольцо на /compat — заглавная цифра страницы. Лучше доехать без
    // анимации, чем остаться на нуле.
    const backstop = window.setTimeout(
      () => {
        shownRef.current = target
        setShown(target)
      },
      duration + 400,
    )

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(backstop)
    }
    // shownRef читается намеренно без подписки: это «откуда ехать», а не вход
  }, [target, duration])

  const r = size / 2 - stroke / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - shown / 100)

  return (
    <div
      className={`relative ${className}`}
      style={{ height: size, width: size }}
      {...(ariaLabel ? { role: 'img' as const, 'aria-label': ariaLabel } : {})}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--edge)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--ember)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        {label ?? (
          showPercent && (
            <span
              // Число уже сказано в ariaLabel — второй раз его читать не надо
              aria-hidden={ariaLabel ? true : undefined}
              className="font-mono font-extrabold text-ink"
              style={{ fontSize: size * 0.24, fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(shown)}
              {suffix}
            </span>
          )
        )}
      </div>
    </div>
  )
}
