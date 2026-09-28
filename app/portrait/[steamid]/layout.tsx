import { MotionLazy } from '@/components/motion/MotionLazy'

/**
 * Провайдер анимаций раздела: блоки портрета проявляются m.* при прокрутке.
 * Почему не в корневом лэйауте — components/motion/MotionLazy.tsx.
 */
export default function PortraitLayout({ children }: LayoutProps<'/portrait/[steamid]'>) {
  return <MotionLazy>{children}</MotionLazy>
}
