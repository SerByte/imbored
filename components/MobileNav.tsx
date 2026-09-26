'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from '@/components/Icon'
import { LinkPending } from '@/components/LinkPending'
import { PickLink } from '@/components/PickLink'
import { isNavActive, navPrefetch } from '@/lib/nav'

/**
 * Нижняя панель навигации — только на телефоне; на десктопе меню в шапке.
 *
 * Подписи короче десктопных: в пяти колонках на 360px «Что нового» и
 * «Подобрать игру» переносятся на две строки и ломают высоту панели.
 */
/**
 * `also` — адреса, которые пункт обязан подсвечивать, но по которым сам не
 * ведёт. Без них две страницы, где человек проводит больше всего времени,
 * не подсвечивали в панели ничего: выдача живёт на /play, а не на /quiz,
 * и комната на /room/<код>, а не на /rooms. Панель молча гасла ровно там,
 * где важнее всего понимать, где ты находишься.
 *
 * Само сравнение живёт в lib/nav (isNavActive) — им же пользуется шапка, и
 * разъехаться в том, где ты сейчас, две навигации не имеют права.
 *
 * `pick` — пункт ведёт не по своему href, а туда же, куда «Подобрать» в шапке:
 * к выдаче под прошлое настроение (components/PickLink.tsx). href остаётся
 * /quiz и по-прежнему решает подсветку: адрес ссылки зависит от устройства,
 * а то, где человек находится, — нет.
 */
const ITEMS = [
  { href: '/daily', label: 'Игра дня', icon: 'calendar' },
  { href: '/quiz', label: 'Подбор', icon: 'spark', also: ['/play'], pick: true },
  { href: '/rooms', label: 'Пати', icon: 'users', also: ['/room'] },
  { href: '/whatsnew', label: 'Новое', icon: 'news' },
  { href: '/library', label: 'Игры', icon: 'grid' },
] satisfies Array<{ href: string; label: string; icon: IconName; also?: string[]; pick?: boolean }>

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
      // То же имя, что у меню в шапке: это одно меню, на телефоне оно здесь,
      // на десктопе там, и на экране всегда ровно одно из двух
      aria-label="Разделы"
      className="md:hidden fixed bottom-0 inset-x-0 z-50 border-t border-edge"
      style={{
        background: 'color-mix(in srgb, var(--bg) 94%, transparent)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        // Опора при переходе между страницами, как шапка (см. layout.tsx)
        viewTransitionName: 'site-tabbar',
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
            /*
              rail-bar, а не inline-переход, и класс для этого уже лежал в
              globals.css — с докблоком «Класс, а не inline-стиль — иначе
              „уменьшить движение“ не могло его выключить» и НУЛЁМ
              пользователей. Второй такой сирота после chip-rail: оба пережили
              откат кино-квиза, вместе с которым ушли их вызывающие.

              Пока переход стоял инлайном, медиазапрос до него не дотягивался:
              человек с включённым «уменьшить движение» всё равно видел, как
              волосок ЕЗДИТ между вкладками на каждом переходе — при том, что
              остальные анимации приложения там погашены.

              Инлайн заодно зашивал 240ms, длительности вне словаря движения
              (--dur-fast 180, --dur-base 320): волосок был единственным в
              приложении, кто ехал вне тональности. Класс берёт --dur-base.
            */
            className="rail-bar absolute top-0 h-[2px] rounded-full bg-ink"
            style={{ left: bar.left, width: bar.width }}
          />
        )}
        {ITEMS.map((item, i) => {
          const props = {
            'aria-current': i === activeIndex ? ('page' as const) : undefined,
            // Иконка над подписью, а высота панели прежняя, 52 px — то же число,
            // что в отступе под неё у #smooth-content: 7 + 18 + 3 + 14 + 7 и
            // волосок. Активный пункт белый и жирный, как в шапке: зелёный
            // оставлен проценту совпадения и больше ничему.
            className: `flex flex-col items-center gap-[3px] py-[7px] text-center text-[11px] leading-[14px] transition-colors ${
              i === activeIndex ? 'text-ink font-extrabold' : 'text-dim font-semibold'
            }`,
            // LinkPending: переход на динамическую страницу без каркаса ждёт
            // сервер, и нажатый пункт мерцает до ответа (как в HeaderNav)
            children: (
              <>
                <Icon name={item.icon} size={18} strokeWidth={i === activeIndex ? 2.2 : 1.8} />
                <span data-label>
                  <LinkPending>{item.label}</LinkPending>
                </span>
              </>
            ),
          }
          return 'pick' in item ? (
            <PickLink key={item.href} {...props} />
          ) : (
            <Link key={item.href} href={item.href} prefetch={navPrefetch(item.href)} {...props} />
          )
        })}
      </div>
    </nav>
  )
}
