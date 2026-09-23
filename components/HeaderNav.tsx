'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LinkPending } from '@/components/LinkPending'
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
 *
 * Самая тесная ширина — 768 px, нижняя граница md и ровно iPad в портрете.
 * Замер: шесть подписей с gap-5 занимают 562 px, логотип 91 — в одну строку с
 * запасом 23 px (8 при полосе прокрутки десктопного окна). Когда логотип был
 * набран широким Unbounded, этого запаса не было: три пункта уезжали на вторую
 * строку, и шапка росла с 64 до 72 px. Если подписи или логотип вырастут,
 * первой сломается именно эта ширина. Чинить сужением зазора на md (gap-3.5
 * даёт 30 px, и зоны .tap по 6 px вбок ещё не сходятся), а не переездом
 * планшета на нижнюю панель: в ней пять пунктов против шести, и
 * «Совместимость» просто пропала бы.
 *
 * Подписи — в LinkPending. /whatsnew и /compat динамические и без
 * loading.tsx (каркас прятал страницу в первом ответе, см.
 * lib/firstpaint.test.ts), так что переход на них ждёт сервер, и до ответа
 * нажатый пункт обязан сам показать, что нажат. Ширину подписи мерцание не
 * меняет — запас в 23 px выше не трогается.
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
          children: <LinkPending>{item.label}</LinkPending>,
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
