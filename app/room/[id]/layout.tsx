import type { Metadata } from 'next'
import { plural } from '@/lib/plural'
import { OG_SITE } from '@/lib/og'
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
 * robots: index false — /room/ и так закрыт в robots.txt (это чужая личная
 * комната), но на превью по прямой ссылке флаг не влияет: мессенджер тянет
 * страницу сам, а не берёт её из индекса.
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

  const invite = await loadRoomInvite(code)
  const title = invite?.host
    ? `${invite.host} зовёт в пати ${code}`
    : `Тебя зовут в пати ${code}`
  const description = invite
    ? `${invite.members} ${plural(invite.members, 'человек уже в комнате', 'человека уже в комнате', 'человек уже в комнате')}. ` +
      'Подключи свою библиотеку Steam и свайпай, во что готов играть: совпадут голоса всех — будет матч.'
    : 'Подключи свою библиотеку Steam и свайпай, во что готов играть: совпадут голоса всех — будет матч.'

  return {
    title,
    description,
    robots,
    openGraph: { ...OG_SITE, title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default function RoomLayout({ children }: LayoutProps<'/room/[id]'>) {
  return children
}
