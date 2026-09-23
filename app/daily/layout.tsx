import { ownAddress } from '@/lib/site'

/** См. app/rooms/layout.tsx: страница клиентская, metadata — только серверная. */
export const generateMetadata = ownAddress('/daily', {
  title: 'Игра дня',
  description:
    'Одна игра из твоей библиотеки на сегодня — та же самая до завтра, без бесконечной ленты и без выбора из десяти вариантов.',
})

export default function DailyLayout({ children }: LayoutProps<'/daily'>) {
  return children
}
