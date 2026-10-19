import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { inviteCopy } from '@/lib/roominvite'
import { lp, toLocale, tr, type Locale } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
import { loadRoomInviteForPage, ROOM_ID_RE } from './invite'
import RoomPage from './RoomPage'

/**
 * Карточка превью на /en — та же opengraph-image.tsx рядом, но с английской
 * подписью (docs/i18n.md, п. 10). alt файловой карточки — константа модуля,
 * русская, и на /en og:image:alt был бы русским. Свой images этого уровня
 * Next ставит вместо файла (mergeStaticMetadata), а twitter:image
 * дозаполняет из openGraph сам. Русская страница images не объявляет и
 * получает файловую карточку как была: адрес с хешем, размеры и alt — оттуда.
 * Хеша у английского адреса нет — его ставит только файловая метадата;
 * карточку и так перерисовывает revalidate, а сброс по roomCardPath
 * (lib/roomcard) снимает оба языка.
 *
 * Размеры и тип — копия size и contentType карточки, а не импорт: модуль
 * карточки тянет next/og и шрифты в рендер страницы. Что они совпадают —
 * сторож в page.test.ts.
 */
const EN_CARD = { width: 1200, height: 630, type: 'image/png', alt: 'Party invite — imbored' }

function enCard(locale: Locale, url: string) {
  if (locale !== 'en') return {}
  return { images: [{ url: lp(locale, `${url}/opengraph-image`), ...EN_CARD }] }
}

/**
 * Приглашение в пати — самая пересылаемая ссылка продукта: комната только для
 * того и создаётся, чтобы кинуть её друзьям. При этом у страницы не было
 * метадаты вообще: в чате разворачивался общий заголовок сайта, и понять, что
 * это зовут именно тебя и именно в комнату, было нельзя.
 *
 * Метаданные — здесь, у страницы, а не в layout, хотя сама комната
 * клиентская (RoomPage.tsx). Файловая карточка opengraph-image.tsx встаёт на
 * уровень страницы (у сегмента с page.tsx Next вешает файловую метадату на
 * __PAGE__), и images, объявленные в layout, она перекрывала: на /en
 * og:image:alt оставался русским — замер на next dev. Свои images карточку
 * вытесняют только на её же уровне (mergeStaticMetadata), а клиентский модуль
 * metadata не экспортирует — поэтому страница — серверная обёртка над
 * RoomPage, и generateMetadata переехал сюда из layout целиком: два
 * generateMetadata платили бы потолку room-peek дважды за загрузку.
 *
 * robots: index false — это чужая личная комната. В robots.txt /room/ НЕ
 * закрыт, и это намеренно: закрытую страницу краулер не открывает и этого
 * флага не видит, а краулер X вдобавок не берёт карточку — приглашение в X
 * разворачивалось голой ссылкой (см. lib/robots.ts). Из поиска комнату
 * убирают этот флаг и X-Robots-Tag; на превью ни то ни другое не влияет:
 * мессенджер тянет страницу сам, а не берёт её из индекса.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string; lang?: string }>
}): Promise<Metadata> {
  const { id, lang } = await params
  const locale = toLocale(lang)
  const code = id.toUpperCase()
  const robots = { index: false, follow: false } as const

  if (!ROOM_ID_RE.test(code)) {
    const title = tr(locale, { ru: 'Пати', en: 'Party' })
    // Файловая карточка стоит и здесь (билет «ПАТИ» без кода), и на /en её
    // подпись — тоже английская. Русская голова — как была, без openGraph
    if (locale !== 'en') return { title, robots }
    const url = `/room/${encodeURIComponent(id)}`
    return { title, robots, openGraph: { ...ogSite(locale), type: 'website', url: lp(locale, url), ...enCard(locale, url) } }
  }

  // После матча — какая игра и куда идти дальше, без комнаты — нейтрально:
  // три состояния разобраны в inviteCopy. С потолком room-peek по адресу:
  // заголовок — та же проверка существования кода, что и API комнаты
  // (lib/roompeek). headers() режим рендера не меняет: страница и так
  // собирается на каждый запрос — generateStaticParams у неё нет
  // Приглашение читается без языка, а слова собирает inviteCopy на языке
  // страницы: превью и заголовок одной комнаты на /room и /en/room — одни
  // факты разными словами
  const { title, description } = inviteCopy(code, await loadRoomInviteForPage(code, await headers()), locale)

  // Код — в верхнем регистре: /room/abc234 и /room/ABC234 — одна комната
  const url = `/room/${code}`

  return {
    title,
    description,
    alternates: localeAlternates(locale, url),
    robots,
    openGraph: { ...ogSite(locale), title, description, type: 'website', url: lp(locale, url), ...enCard(locale, url) },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/**
 * Сама комната — клиентская: опрос, голоса, колода (RoomPage.tsx). Обёртка
 * серверная ради одного generateMetadata выше; разметка и скрипт страницы от
 * неё не меняются — RoomPage параметры берёт сам (useParams).
 */
export default function Page() {
  return <RoomPage />
}
