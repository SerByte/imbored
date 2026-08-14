import type { Metadata } from 'next'

/** См. app/rooms/layout.tsx: страница клиентская, metadata — только серверная. */
export const metadata: Metadata = {
  title: 'Подобрать игру',
  description:
    'Три вопроса — сколько времени, какой вайб, один или с друзьями — и подборка из твоей же библиотеки с объяснением, почему именно это.',
}

export default function QuizLayout({ children }: LayoutProps<'/quiz'>) {
  return children
}
