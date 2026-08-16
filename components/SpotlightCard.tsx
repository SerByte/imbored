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
  onKeyDown,
  buttonRef,
  attrs,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>
  /**
   * Ссылка наружу — для управления фокусом с клавиатуры. Внутренний ref никуда
   * не девается: он нужен подсветке, и оба ставятся одним callback-ref.
   */
  buttonRef?: (el: HTMLButtonElement | null) => void
  /**
   * Доп. атрибуты кнопки (data-*, aria-*). Карточка о них ничего не знает и
   * знать не должна — она отвечает за материал, а не за смысл.
   */
  attrs?: React.ButtonHTMLAttributes<HTMLButtonElement>
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
      ref={(el) => {
        ref.current = el
        buttonRef?.(el)
      }}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerMove={move}
      onPointerLeave={leave}
      {...attrs}
      className={`spotlight glass glass-hover cursor-pointer ${className}`}
    >
      {/* Обёртка позиционирована, чтобы текст печатался ПОВЕРХ ::before:
          псевдоэлемент абсолютный, а значит по умолчанию перекрывает
          статичное содержимое, и подсветка ложилась бы на буквы. */}
      <span className="relative block">{children}</span>
    </button>
  )
}
