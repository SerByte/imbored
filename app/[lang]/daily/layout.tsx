import { ownAddress } from '@/lib/site'
import { MotionLazy } from '@/components/motion/MotionLazy'

/** См. app/rooms/layout.tsx: страница клиентская, metadata — только серверная. */
export const generateMetadata = ownAddress('/daily', {
  title: 'Игра дня',
  description:
    'Одна игра из твоей библиотеки на сегодня — та же самая до завтра, без бесконечной ленты и без выбора из десяти вариантов.',
})

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default function DailyLayout({ children }: LayoutProps<'/[lang]/daily'>) {
  return <MotionLazy>{children}</MotionLazy>
}
