import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { inviteCopy } from '@/lib/roominvite'
import { lp, toLocale, tr } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
import { loadRoomInviteForPage, ROOM_ID_RE } from './invite'
import { MotionLazy } from '@/components/motion/MotionLazy'

/**
 * Приглашение в пати — самая пересылаемая ссылка продукта: комната только для
 * того и создаётся, чтобы кинуть её друзьям. При этом у страницы не было
 * метадаты вообще: в чате разворачивался общий заголовок сайта, и понять, что
 * это зовут именно тебя и именно в комнату, было нельзя.
 *
 * Страница клиентская, а metadata экспортируется только из серверных модулей —
 * отсюда отдельный layout, как у /rooms и /quiz.
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
    return { title: tr(locale, { ru: 'Пати', en: 'Party' }), robots }
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
    openGraph: { ...ogSite(locale), title, description, type: 'website', url: lp(locale, url) },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default function RoomLayout({ children }: LayoutProps<'/[lang]/room/[id]'>) {
  return <MotionLazy>{children}</MotionLazy>
}
