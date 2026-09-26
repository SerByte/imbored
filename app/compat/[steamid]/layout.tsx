import { MotionLazy } from '@/components/motion/MotionLazy'

/**
 * Провайдер анимаций раздела: блоки совместимости проявляются m.* при
 * прокрутке. Почему не в корневом лэйауте — components/motion/MotionLazy.tsx.
 */
export default function CompatLayout({ children }: LayoutProps<'/compat/[steamid]'>) {
  return <MotionLazy>{children}</MotionLazy>
}
