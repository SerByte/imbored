'use client'

import { useRef } from 'react'

/**
 * Стеклянная карточка, которая теплеет к курсору.
 *
 * Наполовину родная механика: .glass-hover уже говорит «подсветить рамку на
 * наведении» — здесь тот же жест, но непрерывный, с источником света.
 *
 * Ember 10%, а не белый по умолчанию: белое пятно было бы вторым источником
 * света в интерфейсе, где освещение задаёт только ember и сам арт.
 *
 * ПРАВИЛО: только на текстовых панелях. Никогда на карточках с игровым артом —
 * подсветка забьёт обложку, а обложка здесь и есть содержание.
 *
 * На тач-устройствах не делает ничего (нет pointer-событий) — и это правильная
 * деградация: не пустая кнопка, а просто обычная стеклянная карточка.
 */
export function SpotlightCard({
  children,
  onClick,
  className = '',
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  const ref = useRef<HTMLButtonElement>(null)

  const move = (e: React.PointerEvent<HTMLButtonElement>) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
    el.style.setProperty('--on', '1')
  }

  const leave = () => ref.current?.style.setProperty('--on', '0')

  return (
    <button
      ref={ref}
      onClick={onClick}
      onPointerMove={move}
      onPointerLeave={leave}
      className={`spotlight glass glass-hover cursor-pointer ${className}`}
    >
      {/* Обёртка позиционирована, чтобы текст печатался ПОВЕРХ ::before:
          псевдоэлемент абсолютный, а значит по умолчанию перекрывает
          статичное содержимое, и подсветка ложилась бы на буквы. */}
      <span className="relative block">{children}</span>
    </button>
  )
}
