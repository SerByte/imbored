'use client'

import Link from '@/components/Link'
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
 * (замер: высота меню 40 px вместо 20). Починено так, как здесь и было
 * завещано, — сужением зазора на md: gap-3.5 (зоны .tap по 6 px вбок ещё не
 * сходятся), с lg обратно gap-6. Не переездом планшета на нижнюю панель: в
 * ней пять пунктов против шести, и «Совместимость» просто пропала бы. Тот же
 * зазор стоит у <nav> в app/layout.tsx — менять вместе.
 *
 * Одного зазора оказалось мало: «Премьера» сделала подписи полужирными, а
 * логотип вырос до 121 px. Замер на 768 с gap-3.5 и text-sm: справа 597 px
 * при доступных 607, запас 10 px — а полоса прокрутки десктопного окна
 * съедает 15, и меню налезало бы на логотип. Поэтому на md ещё и кегль
 * 13 px (у <nav> в app/layout.tsx), у ряда с темой gap-3: справа 563 px,
 * запас 44 px (29 при полосе прокрутки). С lg — прежние text-sm и gap-6.
 * whitespace-nowrap — чтобы нехватка ширины, если снова случится, не
 * ломала подпись пополам.
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
 * «Игры»: в нижней панели библиотека — «Мои игры», и голое «Игры» рядом
 * вело бы одним словом в два разных места.
 *
 * Значок «Найти игру» (components/SearchLauncher) стоит рядом с темой и по
 * той же причине прячется на md: кнопка 40 px и зазор ряда 12 px — это 52 px
 * при запасе 44. Замер на 768 со значком: правый ряд начинался ровно на
 * правом краю логотипа (зазор 0), и «Игра дня» легла на вордмарк. С lg запас
 * 70 px (55 при полосе прокрутки). На планшете поиск остаётся на /games и
 * на 404.
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
