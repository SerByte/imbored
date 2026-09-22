import type { Metadata } from 'next'

/** См. app/rooms/layout.tsx: страница клиентская, metadata — только серверная. */
export const metadata: Metadata = {
  title: 'Подобрать игру',
  description:
    'Три вопроса — сколько времени, какой вайб, один или с друзьями — и одна игра из твоей библиотеки, а если своего не хватит — пара находок из магазина. С объяснением, почему именно она.',
}

export default function QuizLayout({ children }: LayoutProps<'/quiz'>) {
  return children
}
