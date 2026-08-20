import type { Metadata } from 'next'

/**
 * Экран транзитный — создаёт комнату и уводит в неё, — и заголовок ему нужен
 * ровно по одной причине: у него есть залипающее состояние. Когда комнату
 * создать не удалось, человек остаётся здесь, и вкладка при этом называется
 * именем сайта, будто он никуда и не нажимал.
 */
export const metadata: Metadata = {
  title: 'Новая комната',
  description: 'Создаём комнату для пати и открываем её по ссылке.',
}

export default function NewRoomLayout({ children }: LayoutProps<'/room/new'>) {
  return children
}
