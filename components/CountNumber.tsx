'use client'

import { useEffect, useLayoutEffect, useState } from 'react'

/** useLayoutEffect на сервере предупреждает — на сервере он нам и не нужен. */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * Число, которое набегает. Листовой клиентский островок: страницы, где он нужен
 * (/portrait, /library, /game), остаются серверными компонентами.
 *
 * Тонкости, которые здесь важнее анимации:
 *
 * 1. SSR отдаёт СРАЗУ финальное значение, а обнуление и разгон происходят в
 *    layout-эффекте — до отрисовки. Иначе в HTML уезжает ноль (плохо для шаринга
 *    и для отключённого JS), а пользователь видит моргание.
 * 2. tabular-nums обязателен: без него пропорциональные цифры дёргают ширину и
 *    соседние элементы прыгают всю анимацию.
 * 3. Разделитель тысяч в ru-RU — неразрывный пробел (2 847). Форматируем ЦЕЛОЕ
 *    число на каждом кадре, поэтому разделитель остаётся на месте сам собой;
 *    крутить его посимвольно нельзя — число будет ездить по горизонтали.
 */
export function CountNumber({
  value,
  duration = 900,
  delay = 0,
  suffix = '',
  prefix = '',
  className = '',
}: {
  value: number
  duration?: number
  delay?: number
  /**
   * Только сериализуемые пропсы: компонент вызывается из СЕРВЕРНЫХ страниц
   * (/portrait), а функцию через границу RSC передать нельзя — Next падает с
   * «Functions cannot be passed directly to Client Components».
   */
  suffix?: string
  prefix?: string
  className?: string
}) {
  const fmt = (n: number) => `${prefix}${Math.round(n).toLocaleString('ru-RU')}${suffix}`
  const [shown, setShown] = useState(value)

  /*
   * Здесь НЕТ guard-а «запускать только один раз».
   * В dev React монтирует эффекты дважды (mount → cleanup → mount). С guard-ом
   * первый проход обнулял число и ставил анимацию, очистка её снимала, а второй
   * проход упирался в guard и не ставил ничего — число навсегда оставалось нулём.
   * Зависимости эффекта и так перезапускают его только при смене значения.
   */
  useIsoLayoutEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    setShown(0)
    let raf = 0
    let timer = 0
    const run = () => {
      const start = performance.now()
      const tick = (t: number) => {
        const p = Math.min((t - start) / duration, 1)
        const eased = 1 - Math.pow(1 - p, 3)
        setShown(value * eased)
        if (p < 1) raf = requestAnimationFrame(tick)
        else setShown(value)
      }
      raf = requestAnimationFrame(tick)
    }
    if (delay > 0) timer = window.setTimeout(run, delay)
    else run()

    /*
     * Страховка. Обнуление выше происходит до отрисовки, поэтому мигания нет,
     * но дальше значение зависит от rAF — а он не идёт в фоновой вкладке и
     * может быть задушен. Без подстраховки число осталось бы нулём.
     * Для страницы, которую делают ради скриншота, ноль вместо статистики —
     * худший из возможных исходов, поэтому таймер по setTimeout (он живёт и
     * там, где rAF молчит) в любом случае доводит значение до конечного.
     */
    const backstop = window.setTimeout(() => setShown(value), delay + duration + 400)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(timer)
      clearTimeout(backstop)
    }
  }, [value, duration, delay])


  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {fmt(shown)}
    </span>
  )
}
