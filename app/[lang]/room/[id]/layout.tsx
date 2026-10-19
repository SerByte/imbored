import { MotionLazy } from '@/components/motion/MotionLazy'

/**
 * Метаданные комнаты — в page.tsx, рядом с файловой карточкой: на уровне
 * layout их images карточка перекрывала (там — почему).
 */
export default function RoomLayout({ children }: LayoutProps<'/[lang]/room/[id]'>) {
  return <MotionLazy>{children}</MotionLazy>
}
