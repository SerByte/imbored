'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

/**
 * Нижняя панель навигации — только на телефоне; на десктопе меню в шапке.
 *
 * Подписи короче десктопных: в пяти колонках на 360px «Что нового» и
 * «Подобрать игру» переносятся на две строки и ломают высоту панели.
 */
const ITEMS = [
  { href: '/daily', label: 'Игра дня' },
  { href: '/quiz', label: 'Подбор' },
  { href: '/rooms', label: 'Пати' },
  { href: '/whatsnew', label: 'Новое' },
  { href: '/library', label: 'Игры' },
]

export function MobileNav() {
  const pathname = usePathname() ?? ''
  const activeIndex = ITEMS.findIndex(
    (i) => pathname === i.href || pathname.startsWith(`${i.href}/`),
  )

  const rowRef = useRef<HTMLDivElement>(null)
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null)

  /**
   * Индикатор ИЗМЕРЯЕТ активный пункт, а не делит ширину на четыре.
   * Кириллические подписи сильно разной длины («Пати» против «Библиотеки»), и
   * пересчитывать надо не только на resize, но и после подмены шрифта: Onest
   * приезжает сабсетом через next/font, и до свопа ширины другие.
   */
  useEffect(() => {
    const measure = () => {
      const row = rowRef.current
      if (!row || activeIndex < 0) return setBar(null)
      // Именно querySelectorAll('a'), а не children[activeIndex]: сам индикатор
      // лежит в этом же контейнере первым узлом и сдвигал бы индексы на один —
      // полоска вставала над соседней вкладкой.
      const el = row.querySelectorAll('a')[activeIndex] as HTMLElement | undefined
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
  }, [activeIndex])

  return (
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-edge backdrop-blur-xl"
      style={{
        background: 'var(--glass-bg)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      <div ref={rowRef} className="grid grid-cols-5 relative">
        {/*
         * Волосок, а не залитая пилюля: на /play и /daily панель висит над
         * полноэкранным артом, и сплошная фигура пробивает в кадре дыру.
         * Заодно это тот же жест, что и ember-зачёркивание в логотипе.
         */}
        {bar && (
          <span
            aria-hidden
            className="absolute top-0 h-[2px] rounded-full bg-ember"
            style={{
              left: bar.left,
              width: bar.width,
              transition: 'left 240ms cubic-bezier(.22,1,.36,1), width 240ms cubic-bezier(.22,1,.36,1)',
            }}
          />
        )}
        {ITEMS.map((item, i) => (
          <Link
            key={item.href}
            href={item.href}
            aria-current={i === activeIndex ? 'page' : undefined}
            className={`py-3.5 text-center text-[11px] transition-colors ${
              i === activeIndex ? 'text-ember-text font-semibold' : 'text-dim'
            }`}
          >
            <span data-label>{item.label}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
