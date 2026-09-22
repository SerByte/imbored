'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useSyncExternalStore, type ComponentProps } from 'react'
import { lastMoodStore, pickHref, QUIZ_HREF } from '@/lib/lastmood'

/*
 * Снимок — готовая строка адреса, а не запись из хранилища: две одинаковые
 * строки равны по значению, и useSyncExternalStore не уходит в повторный
 * рендер. Часы читаются здесь, в снимке, а не в теле компонента: рендер
 * обязан быть чистым, а срок годности прошлого настроения зависит от «сейчас».
 */
const hrefNow = () => pickHref(lastMoodStore.get(), Math.floor(Date.now() / 1000))
const hrefServer = () => QUIZ_HREF

/**
 * «Подобрать игру» — сразу к выдаче под прошлое настроение (lib/lastmood.ts).
 *
 * Клиентский, потому что помнит устройство, а не сервер: лэйаут кук не
 * читает и читать не должен. На сервере и в первом рендере адрес всегда
 * /quiz — разметка до гидратации обязана совпасть, — и только потом, если на
 * устройстве есть свежее настроение, ссылка становится выдачей.
 *
 * Внутри самого подбора (/quiz и /play) ссылка остаётся квизом: на /play
 * прошлое настроение — это и есть открытая страница, и пункт меню вёл бы
 * туда же, где человек уже стоит, то есть не делал бы ничего. Подсветка
 * активного пункта от адреса не зависит — её считает MobileNav по своему списку.
 */
export function PickLink(props: Omit<ComponentProps<typeof Link>, 'href'>) {
  const remembered = useSyncExternalStore(lastMoodStore.subscribe, hrefNow, hrefServer)
  const pathname = usePathname() ?? ''
  const inFlow = pathname === '/quiz' || pathname === '/play'
  return <Link {...props} href={inFlow ? QUIZ_HREF : remembered} />
}
