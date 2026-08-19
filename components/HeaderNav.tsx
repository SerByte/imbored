'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { PickLink } from '@/components/PickLink'
import { isNavActive } from '@/lib/nav'

/**
 * Меню шапки — на десктопе; на телефоне пункты уезжают в нижнюю панель.
 *
 * Клиентский островок ровно ради одного: знать, где человек сейчас. Шесть
 * ссылок с одинаковым классом и без единого признака текущего раздела — это
 * было единственное место навигации, которое молчало и глазу, и скринридеру:
 * aria-current стоял только в MobileNav, а её на десктопе прячет md:hidden.
 *
 * usePathname маршрут динамическим не делает — это клиентский хук, — так что
 * правило «лэйаут ничего не читает, иначе умрёт ISR у /game/[appid]» остаётся
 * в силе.
 *
 * Подписи здесь длиннее, чем в панели: в шапке место есть, а в пяти колонках на
 * 360 px «Подобрать игру» переносится на две строки. Общей у двух навигаций
 * остаётся только логика подсветки — lib/nav, isNavActive.
 *
 * `pick` — как в MobileNav: «Подобрать игру» ведёт сразу к выдаче под прошлое
 * настроение, если оно есть на устройстве (lib/lastmood.ts); на сервере —
 * всегда /quiz. Подсветку решает href, а не адрес ссылки.
 */
const ITEMS = [
  { href: '/daily', label: 'Игра дня' },
  { href: '/quiz', label: 'Подобрать игру', also: ['/play'], pick: true },
  { href: '/rooms', label: 'Пати', also: ['/room'] },
  { href: '/whatsnew', label: 'Что нового' },
  { href: '/compat', label: 'Совместимость' },
  { href: '/library', label: 'Библиотека' },
] satisfies Array<{ href: string; label: string; also?: string[]; pick?: boolean }>

export function HeaderNav() {
  const pathname = usePathname() ?? ''

  return (
    <span className="hidden md:flex items-center gap-5">
      {ITEMS.map((item) => {
        const active = isNavActive(pathname, item.href, 'also' in item ? item.also : [])
        const props = {
          'aria-current': active ? ('page' as const) : undefined,
          className: `tap transition-colors ${active ? 'text-ink font-medium' : 'hover:text-ink'}`,
          children: item.label,
        }
        return 'pick' in item ? (
          <PickLink key={item.href} {...props} />
        ) : (
          <Link key={item.href} href={item.href} {...props} />
        )
      })}
    </span>
  )
}
