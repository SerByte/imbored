'use client'

import { useEffect, useRef, useState } from 'react'

const ROW_H = 56
const VISIBLE = 3 // сколько строк видно выше и ниже центра

const mod = (n: number, m: number) => ((n % m) + m) % m

/**
 * Колесо выбора для режима рулетки.
 *
 * Рулетка — единственная механика продукта, построенная на случайности, и до сих
 * пор у неё не было ни одного случайного движения: weightedRandomIndex() молча
 * выбирал игру, и результат просто проявлялся, как любой другой. «Бросок кубика
 * без кубика».
 *
 * Крутятся ТОЛЬКО названия — арт не трогаем. Игровая обложка появляется уже
 * в reveal, и подмена картинок в барабане превратила бы церемонию в мельтешение.
 *
 * Ember появляется ровно один раз: волосок над и под центральной строкой.
 */
export function SpinWheel({
  items,
  landOn,
  onDone,
  duration = 1600,
  loops = 3,
}: {
  items: string[]
  landOn: number
  onDone: () => void
  duration?: number
  loops?: number
}) {
  const n = items.length
  const [pos, setPos] = useState(0)
  const done = useRef(false)
  /** Только для объявления скринридеру: барабан ещё крутится или уже встал. */
  const [landed, setLanded] = useState(false)

  // onDone приходит новой функцией на каждый рендер родителя. Если положить её
  // в зависимости эффекта, барабан будет перезапускаться посреди прокрутки.
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })

  useEffect(() => {
    if (n === 0) {
      onDoneRef.current()
      return
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      onDoneRef.current()
      return
    }

    const target = loops * n + landOn
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min((t - start) / duration, 1)
      const eased = 1 - Math.pow(1 - p, 3)
      setPos(target * eased)
      if (p < 1) {
        raf = requestAnimationFrame(tick)
      } else if (!done.current) {
        done.current = true
        // Короткая пауза на «щелчок»: результат должен успеть прочитаться
        // как результат, а не проскочить в следующий экран.
        setLanded(true)
        setTimeout(() => onDoneRef.current(), 260)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [n, landOn, duration, loops])

  if (n === 0) return null

  const base = Math.floor(pos)
  const frac = pos - base

  return (
    <div
      className="relative w-full max-w-lg select-none"
      style={{ height: ROW_H * (VISIBLE * 2 + 1), perspective: 700 }}
    >
      {/*
        Живая область — отдельной строкой, а не на самом барабане.

        aria-live="polite" стоял на контейнере, внутри которого за 1,6
        секунды меняется текст семи строк на каждом кадре: это порядка ста
        двадцати замен, то есть очередь объявлений наполняется во много раз
        быстрее, чем произносится. Скринридер получал поток названий вместо
        сообщения, а сам результат выбора не объявлялся вообще нигде.

        Барабан теперь aria-hidden — это чистая анимация, — а говорят о нём
        ровно два сообщения.
      */}
      <p role="status" className="sr-only">
        {landed ? `Выбрана игра: ${items[mod(landOn, n)]}` : 'Выбираем игру…'}
      </p>
      <div aria-hidden className="absolute inset-0 overflow-hidden">
        {Array.from({ length: VISIBLE * 2 + 1 }, (_, k) => {
          const slot = k - VISIBLE
          const d = slot - frac
          const item = items[mod(base + slot, n)]
          const dist = Math.abs(d)
          return (
            <div
              key={`${slot}-${item}`}
              className="absolute inset-x-0 flex items-center justify-center px-6 text-center"
              style={{
                height: ROW_H,
                top: '50%',
                transform: `translateY(-50%) translateY(${d * ROW_H}px) rotateX(${d * -14}deg) scale(${1 - dist * 0.06})`,
                opacity: Math.max(0, 1 - dist * 0.38),
              }}
            >
              <span
                className={`truncate text-xl font-extrabold tracking-tight ${
                  dist < 0.5 ? 'text-ink' : 'text-dim'
                }`}
              >
                {item}
              </span>
            </div>
          )
        })}
      </div>

      {/* Окно выбора: две ember-волосины, та же геометрия, что у пилюль */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
        style={{ height: ROW_H }}
      >
        <div className="absolute inset-x-6 top-0 h-px rounded-full bg-ember" />
        <div className="absolute inset-x-6 bottom-0 h-px rounded-full bg-ember" />
      </div>
    </div>
  )
}
