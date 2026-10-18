import type { Metadata } from 'next'
import { MotionLazy } from '@/components/motion/MotionLazy'

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

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default function RoomsLayout({ children }: LayoutProps<'/[lang]/rooms'>) {
  return <MotionLazy>{children}</MotionLazy>
}
