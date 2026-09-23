import type { Metadata } from 'next'
import { inviteCopy } from '@/lib/roominvite'
import { OG_SITE } from '@/lib/site'
import { loadRoomInvite, ROOM_ID_RE } from './invite'

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
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const code = id.toUpperCase()
  const robots = { index: false, follow: false } as const

  if (!ROOM_ID_RE.test(code)) {
    return { title: 'Пати', robots }
  }

  // После матча — какая игра и куда идти дальше, без комнаты — нейтрально:
  // три состояния разобраны в inviteCopy
  const { title, description } = inviteCopy(code, await loadRoomInvite(code))

  // Код — в верхнем регистре: /room/abc234 и /room/ABC234 — одна комната
  const url = `/room/${code}`

  return {
    title,
    description,
    alternates: { canonical: url },
    robots,
    openGraph: { ...OG_SITE, title, description, type: 'website', url },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default function RoomLayout({ children }: LayoutProps<'/room/[id]'>) {
  return children
}
