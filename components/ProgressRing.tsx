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
  label,
  className = '',
}: {
  percent: number
  size?: number
  stroke?: number
  duration?: number
  showPercent?: boolean
  /** Что показать вместо процента в центре (например, счётчик оставшихся игр). */
  label?: React.ReactNode
  className?: string
}) {
  const target = Math.max(0, Math.min(100, percent))
  const [shown, setShown] = useState(0)
  const shownRef = useRef(0)

  useEffect(() => {
    const from = shownRef.current
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
  }, [target, duration])

  const r = size / 2 - stroke / 2
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - shown / 100)

  return (
    <div className={`relative ${className}`} style={{ height: size, width: size }}>
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
              className="font-mono font-extrabold text-ink"
              style={{ fontSize: size * 0.24, fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(shown)}%
            </span>
          )
        )}
      </div>
    </div>
  )
}
