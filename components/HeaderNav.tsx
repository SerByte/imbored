'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LinkPending } from '@/components/LinkPending'
import { PickLink } from '@/components/PickLink'
import { isNavActive, navPrefetch } from '@/lib/nav'

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
 * Когда-то шесть подписей с gap-5 и логотип вставали в строку с запасом
 * 23 px; потом рядом встал переключатель темы, и запас кончился: на 768 px
 * «Игра дня», «Подобрать игру» и «Что нового» переносились на две строки
 * (замер: высота меню 40 px вместо 20). Чинится сужением на md, а не
 * переездом планшета на нижнюю панель: в ней пять пунктов против шести, и
 * «Совместимость» просто пропала бы.
 *
 * Одного зазора не хватило. gap-3.5 (зоны .tap по 6 px вбок ещё не
 * сходятся) оставил запас в 4 px: ряд с темой просил 603 px из 607, «Игра
 * дня» стояла в 4 px от логотипа, а с полосой прокрутки десктопного окна
 * (ширина документа 753) ряду доставалось 592 — и те же три пункта снова
 * ломались в две строки. Поэтому на md ещё и кегль 13 px вместо 14, а у ряда
 * с темой gap-3 вместо gap-5; с lg — прежние text-sm, gap-6 и gap-5. Замер
 * на 768 (худший случай — открыта «Совместимость», самая длинная подпись
 * полужирным): 563 px из 607, запас 44 px; с полосой прокрутки — 29.
 * whitespace-nowrap — чтобы нехватка ширины, если снова случится, не ломала
 * подпись пополам. Кегль и оба зазора стоят у <nav> и ряда в app/layout.tsx —
 * менять вместе.
 *
 * Подписи — в LinkPending. /whatsnew и /compat динамические и без
 * loading.tsx (каркас прятал страницу в первом ответе, см.
 * lib/firstpaint.test.ts), так что переход на них ждёт сервер, и до ответа
 * нажатый пункт обязан сам показать, что нажат. Ширину подписи мерцание не
 * меняет — запас на 768 px выше не трогается.
 *
 * Префетча у динамических пунктов нет вовсе — navPrefetch из lib/nav: шапка
 * стоит на каждой странице, и префетч будил бы их функции на каждом просмотре.
 *
 * «Каталог» (/games, жанры) — седьмой пункт и только с lg: на 768 px
 * запаса 44 px, и седьмая подпись унесла бы пункты на вторую строку. На
 * планшете хаб остаётся в подвале и в пути над названием на карточке игры.
 * Подсвечен и на карточке игры (/game): это та же витрина. «Каталог», а не
 * «Игры»: голое «Игры» читается то как каталог, то как своя библиотека, и
 * одно слово вело бы в два разных места. По той же причине библиотека в
 * нижней панели — «Мои игры» (components/MobileNav), а не «Игры».
 */
const ITEMS = [
  { href: '/daily', label: 'Игра дня' },
  { href: '/quiz', label: 'Подобрать игру', also: ['/play'], pick: true },
  { href: '/rooms', label: 'Пати', also: ['/room'] },
  { href: '/whatsnew', label: 'Что нового' },
  { href: '/games', label: 'Каталог', also: ['/game'], wide: true },
  { href: '/compat', label: 'Совместимость' },
  { href: '/library', label: 'Библиотека' },
] satisfies Array<{ href: string; label: string; also?: string[]; pick?: boolean; wide?: boolean }>

export function HeaderNav() {
  const pathname = usePathname() ?? ''

  return (
    <span className="hidden md:flex items-center gap-3.5 lg:gap-6">
      {ITEMS.map((item) => {
        const active = isNavActive(pathname, item.href, 'also' in item ? item.also : [])
        const props = {
          'aria-current': active ? ('page' as const) : undefined,
          className: `tap whitespace-nowrap transition-colors ${'wide' in item ? 'hidden lg:inline' : ''} ${active ? 'text-ink font-extrabold' : 'font-semibold hover:text-ink'}`,
          children: <LinkPending>{item.label}</LinkPending>,
        }
        return 'pick' in item ? (
          <PickLink key={item.href} {...props} />
        ) : (
          <Link key={item.href} href={item.href} prefetch={navPrefetch(item.href)} {...props} />
        )
      })}
    </span>
  )
}
