import type { Metadata } from 'next'

/**
 * Страница клиентская, а metadata экспортируется только из серверных модулей —
 * поэтому отдельный layout. Без него раздел наследовал заголовок сайта и в
 * выдаче выглядел его дублем.
 */
export const metadata: Metadata = {
  title: 'Пати',
  description:
    'Комната на вечер: подключаете библиотеки, свайпаете колоду из общих игр — совпадут голоса всех, будет матч.',
}

export default function RoomsLayout({ children }: LayoutProps<'/rooms'>) {
  return children
}
