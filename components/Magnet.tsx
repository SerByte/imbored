'use client'

import { useEffect, useRef } from 'react'

/** Потолок хода в пикселях. Наклон должен быть заметен телом, а не глазом. */
const MAX_SHIFT = 5

/**
 * Кнопка чуть наклоняется к курсору и медленнее возвращается назад.
 *
 * Настройки нарочно занижены: ход ~4–5 px. Дефолты у этого приёма резиновые и
 * сразу читаются как шаблон; здесь это должно быть не преследование курсора, а
 * едва заметный наклон — кнопка признаёт указатель до того, как её нажали.
 *
 * Возврат (0.5s) медленнее ухода (0.25s) — именно это даёт ощущение веса.
 *
 * Живёт ровно на трёх кнопках приложения. На тач-устройствах не делает ничего:
 * это не фолбэк, а корректная деградация — эффект просто не существует там,
 * где нет курсора.
 *
 * ВАЖНО: Magnet владеет transform у обёртки, поэтому у обёрнутых элементов
 * .glass-hover должен идти с .no-lift — иначе два источника transform дерутся
 * за один элемент и hover дёргается.
 */
export function Magnet({
  children,
  padding = 80,
  strength = 9,
  className = 'inline-block',
}: {
  children: React.ReactNode
  padding?: number
  strength?: number
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    let active = false
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()

      // Радиус меряем от КРАЁВ элемента, а не от центра. От центра
      // `max(width,height)/2 + padding` у кнопки во всю ширину давало охват
      // под 400 px — она тянулась к курсору через полкарточки и наезжала на
      // соседние элементы. От краёв охват всегда ровно `padding`.
      const nearestX = Math.max(r.left, Math.min(e.clientX, r.right))
      const nearestY = Math.max(r.top, Math.min(e.clientY, r.bottom))
      const edgeDist = Math.hypot(e.clientX - nearestX, e.clientY - nearestY)

      if (edgeDist < padding) {
        const dx = e.clientX - (r.left + r.width / 2)
        const dy = e.clientY - (r.top + r.height / 2)
        // Жёсткий потолок хода: это наклон, а не переезд. Без клампа сдвиг
        // зависел бы от размера кнопки, что и ломало вёрстку.
        const tx = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, dx / strength))
        const ty = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, dy / strength))
        active = true
        el.style.transition = 'transform 0.25s cubic-bezier(.2,.8,.2,1)'
        el.style.transform = `translate(${tx}px, ${ty}px)`
      } else if (active) {
        active = false
        el.style.transition = 'transform 0.5s ease-out'
        el.style.transform = 'translate(0, 0)'
      }
    }

    window.addEventListener('pointermove', onMove, { passive: true })
    return () => {
      window.removeEventListener('pointermove', onMove)
      el.style.transform = ''
      el.style.transition = ''
    }
  }, [padding, strength])

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  )
}
