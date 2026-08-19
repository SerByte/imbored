'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { isNavActive } from '@/lib/nav'

/**
 * Нижняя панель навигации — только на телефоне; на десктопе меню в шапке.
 *
 * Подписи короче десктопных: в пяти колонках на 360px «Что нового» и
 * «Подобрать игру» переносятся на две строки и ломают высоту панели.
 */
/**
 * `also` — адреса, которые пункт обязан подсвечивать, но по которым сам не
 * ведёт: выдача живёт на /play, а не на /quiz, и комната на /room/<код>, а не
 * на /rooms. Панель молча гасла ровно там, где важнее всего понимать, где ты
 * находишься.
 *
 * Само сравнение живёт в lib/nav (isNavActive) — им же пользуется шапка, и
 * разъехаться в том, где ты сейчас, две навигации не имеют права.
 */
const ITEMS = [
  { href: '/daily', label: 'Игра дня' },
  { href: '/quiz', label: 'Подбор', also: ['/play'] },
  { href: '/rooms', label: 'Пати', also: ['/room'] },
  { href: '/whatsnew', label: 'Новое' },
  { href: '/library', label: 'Игры' },
] satisfies Array<{ href: string; label: string; also?: string[] }>

export function MobileNav() {
  const pathname = usePathname() ?? ''
  const activeIndex = ITEMS.findIndex((i) => isNavActive(pathname, i.href, 'also' in i ? i.also : []))

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
    /*
      Панель — ПОВЕРХНОСТЬ, а не стекло, и это следствие замера, а не вкуса.

      Стояло var(--glass-bg): 0.6 в тёмной теме, 0.66 в светлой. Под панелью
      при этом постоянно едет арт — на /library он оказывается там на 35%
      позиций прокрутки (замерено проходом по 31 позиции), — и подписи в 11px
      цветом --dim берут:

        тёмная тема, светлый арт  — 1.85:1
        светлая тема, тёмный арт  — 2.62:1
        активный пункт, ember     — 2.37 и 2.43

      при норме AA 4.5. Обе темы проваливаются на противоположных крайностях,
      что и понятно: подложка полупрозрачна, а цвет текста у них разный.

      Цветом это не чинится. Даже ember, самый яркий токен, не дотягивает, а в
      светлой теме --ember-text (#a84a12) уже выбран как самый тёмный читаемый
      оранжевый — темнее делать нечего.

      0.94 — порог, на котором проходят ОБА худших случая обеих тем (тёмная:
      6.65 dim / 8.50 ember; светлая: 4.94 / 4.58). На 0.9 светлый активный
      пункт даёт 4.18 и не проходит.

      backdrop-blur снят вместе с прозрачностью: размывать шесть процентов
      просвета нечего, а слой композиции он занимал на каждом кадре прокрутки.
      Ровно сегодня выяснилось, что вся размывка сайта не рисовалась вовсе, —
      тем более не стоит держать ту, которой нечего делать.
    */
    <nav
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-edge"
      style={{
        background: 'color-mix(in srgb, var(--bg) 94%, transparent)',
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
