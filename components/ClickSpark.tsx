'use client'

import { useCallback, useEffect, useRef } from 'react'

const COUNT = 8
/**
 * Жизнь одной искры, мс. Экспортируется ради lib/motion.test.ts: финальный такт
 * квиза обязан пережить залп целиком, и тест сверяет OUTRO.sparkAt + SPARK_LIFE
 * с таймером навигации.
 */
export const SPARK_LIFE = 340
const RADIUS = 16
const PAD = 44 // запас вокруг элемента, чтобы искры не обрезались

type Spark = { x: number; y: number; angle: number; born: number }

/**
 * Короткий залп искр в точке нажатия.
 *
 * Единственный эффект в каталоге, чьё название уже является токеном этого
 * дизайна: акцент называется --ember, и искры — это он же, но на мгновение.
 *
 * Цвет читается из CSS-переменной в рантайме, а не зашит: в светлой теме
 * ember другой (#e0742f), и захардкоженный оранжевый там выглядел бы чужим.
 *
 * Искры — сужающиеся линии, а не точки: это рифмуется с ember-штрихом в
 * логотипе, а точки читались бы как конфетти.
 *
 * Живёт ровно в трёх местах. Специально НЕ на кнопках голосования в пати:
 * двадцать карточек подряд с попкорном превратили бы церемонию в автомат.
 */
export function ClickSpark({
  children,
  className = 'inline-block',
  fireOnMount = false,
  fireDelay = 1100,
}: {
  children?: React.ReactNode
  className?: string
  /** Для программного залпа (экран матча), где клика нет. */
  fireOnMount?: boolean
  /**
   * Когда именно бабахнуть при fireOnMount. По умолчанию 1.1 с — кульминация
   * церемонии матча. Финальный такт квиза вдвое короче всей церемонии, и залп
   * на общей задержке случился бы уже после ухода со страницы.
   */
  fireDelay?: number
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sparks = useRef<Spark[]>([])
  const raf = useRef(0)

  const fire = useCallback((clientX?: number, clientY?: number) => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const r = wrap.getBoundingClientRect()
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = r.width + PAD * 2
    const h = r.height + PAD * 2
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const x = clientX !== undefined ? clientX - r.left + PAD : w / 2
    const y = clientY !== undefined ? clientY - r.top + PAD : h / 2
    const start = performance.now()
    for (let i = 0; i < COUNT; i++) {
      sparks.current.push({ x, y, angle: (Math.PI * 2 * i) / COUNT, born: start })
    }

    // Цикл живёт локально: так он не ссылается сам на себя через хук и не
    // тянет за собой цепочку зависимостей.
    const step = () => {
      const now = performance.now()
      ctx.clearRect(0, 0, w, h)
      sparks.current = sparks.current.filter((s) => now - s.born < SPARK_LIFE)

      // Цвет читаем в рантайме: в светлой теме ember другой (#e0742f)
      const color =
        getComputedStyle(document.documentElement).getPropertyValue('--ember').trim() || '#ff9e64'

      ctx.strokeStyle = color
      ctx.lineWidth = 1
      ctx.lineCap = 'round'
      for (const s of sparks.current) {
        const p = (now - s.born) / SPARK_LIFE
        const eased = 1 - Math.pow(1 - p, 3)
        const dist = RADIUS + eased * RADIUS * 1.6
        const tail = 7 * (1 - eased)
        ctx.globalAlpha = 1 - p
        ctx.beginPath()
        ctx.moveTo(s.x + Math.cos(s.angle) * dist, s.y + Math.sin(s.angle) * dist)
        ctx.lineTo(
          s.x + Math.cos(s.angle) * (dist + tail),
          s.y + Math.sin(s.angle) * (dist + tail),
        )
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      if (sparks.current.length) raf.current = requestAnimationFrame(step)
    }

    cancelAnimationFrame(raf.current)
    raf.current = requestAnimationFrame(step)
  }, [])

  useEffect(() => {
    if (fireOnMount) {
      const t = window.setTimeout(() => fire(), fireDelay)
      return () => window.clearTimeout(t)
    }
  }, [fireOnMount, fireDelay, fire])

  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  return (
    <div
      ref={wrapRef}
      className={`relative ${className}`}
      onPointerDown={(e) => fire(e.clientX, e.clientY)}
    >
      {children}
      {/*
        width/height = 0 обязательны: у <canvas> дефолт 300x150, и до первого
        залпа он висел прозрачным прямоугольником поверх соседних элементов.
        Реальный размер выставляется в fire().
      */}
      <canvas
        ref={canvasRef}
        aria-hidden
        width={0}
        height={0}
        className="pointer-events-none absolute"
        style={{ left: -PAD, top: -PAD }}
      />
    </div>
  )
}
