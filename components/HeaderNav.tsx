'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
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
 */
const ITEMS = [
  { href: '/daily', label: 'Игра дня' },
  { href: '/quiz', label: 'Подобрать игру', also: ['/play'] },
  { href: '/rooms', label: 'Пати', also: ['/room'] },
  { href: '/whatsnew', label: 'Что нового' },
  { href: '/compat', label: 'Совместимость' },
  { href: '/library', label: 'Библиотека' },
] satisfies Array<{ href: string; label: string; also?: string[] }>

export function HeaderNav() {
  const pathname = usePathname() ?? ''

  return (
    /*
      Зазор на планшете уже, чем на десктопе, и это не вкусовщина.

      Замер на 768px: шесть подписей в одну строку просят 562px, а под меню в
      шапке остаётся 541 — не хватает 21. Три пункта из шести переносились на
      вторую строку («Игра дня», «Подобрать игру», «Что нового»), шапка росла с
      64px до 72, и логотип с ними разъезжался по вертикали. Полоса узкая,
      768–788px, но 768 — это ровно ширина iPad в портрете.

      gap-3.5 экономит 30px на пяти промежутках — хватает с запасом. С 1024
      зазор возвращается к прежнему.

      Уводить планшет на нижнюю панель нельзя: в ней пять пунктов против шести,
      «Совместимость» туда не помещалась, и переезд просто спрятал бы раздел.
    */
    <span className="hidden md:flex items-center gap-3.5 lg:gap-5">
      {ITEMS.map((item) => {
        const active = isNavActive(pathname, item.href, 'also' in item ? item.also : [])
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`transition-colors ${active ? 'text-ink font-medium' : 'hover:text-ink'}`}
          >
            {item.label}
          </Link>
        )
      })}
    </span>
  )
}
