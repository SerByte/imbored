import type { Metadata } from 'next'
import { MotionLazy } from '@/components/motion/MotionLazy'

/**
 * См. app/rooms/layout.tsx: страница клиентская, а metadata экспортируется
 * только из серверных модулей — отсюда отдельный layout. /explore закрыт в
 * robots.txt (lib/robots.ts), как и /play: без куки индексировать нечего.
 * Заголовок — для вкладки, истории и закладки.
 */
export const metadata: Metadata = {
  title: 'Полистать',
  description:
    'Колода из твоей библиотеки и магазина без вопросов о настроении: «Интересно» или «Мимо», а приглянувшееся ложится на полку.',
}

export default function ExploreLayout({ children }: LayoutProps<'/explore'>) {
  return <MotionLazy>{children}</MotionLazy>
}
