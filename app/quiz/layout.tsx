import { MotionLazy } from '@/components/motion/MotionLazy'
import { ownAddress } from '@/lib/site'

/**
 * См. app/rooms/layout.tsx: страница клиентская, metadata — только серверная.
 *
 * Свой адрес (ownAddress), потому что квиз открыт краулеру и идёт в выдачу
 * (lib/robots): гость видит первый вопрос целиком. canonical сворачивает в
 * /quiz хвосты вроде ?from=untouched из библиотеки, а og:url не даёт VK и
 * Facebook склеить ссылку на квиз с главной.
 */
export const generateMetadata = ownAddress('/quiz', {
  title: 'Подобрать игру',
  description:
    'Три вопроса — сколько времени, какой вайб, один или с друзьями — и одна игра из твоей библиотеки, а если своего не хватит — пара находок из магазина. С объяснением, почему именно она.',
})

export default function QuizLayout({ children }: LayoutProps<'/quiz'>) {
  return <MotionLazy>{children}</MotionLazy>
}
