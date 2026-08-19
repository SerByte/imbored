import type { Metadata } from 'next'

const ROOM_ID_RE = /^[A-Z0-9]{6}$/

/**
 * Страница комнаты клиентская, а metadata экспортируется только из серверных
 * модулей — отсюда отдельный layout, тем же приёмом, что у /rooms и /daily.
 *
 * Нужен он тут больше, чем где-либо ещё: ссылка на комнату — это буквально
 * то, что кидают в Discord, и до сих пор она разворачивалась голым адресом.
 * Заголовок с кодом делает из неё приглашение ещё до перехода.
 *
 * В базу не ходим намеренно. Всё, что нужно карточке, есть в самом адресе, а
 * тянет её краулер мессенджера — на этом пути незачем ни читать комнату, ни
 * решать, что из её состава можно показать постороннему.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const code = ROOM_ID_RE.test(id) ? id : null

  const title = code ? `Пати ${code}` : 'Пати'
  const description = code
    ? `Тебя зовут выбрать игру на вечер. Код комнаты ${code} — подключи библиотеку и свайпай.`
    : 'Комната на вечер: подключаете библиотеки, свайпаете колоду из общих игр.'

  return {
    title,
    description,
    // Комнаты живут сутки и адресуются случайным кодом — в выдаче им не место.
    robots: { index: false, follow: false },
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default function RoomLayout({ children }: LayoutProps<'/room/[id]'>) {
  return children
}
