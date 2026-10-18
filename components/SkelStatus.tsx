'use client'

import type { ReactNode } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { tr } from '@/lib/i18n'

/**
 * Рамка каркаса страницы: объявляет загрузку скринридеру на языке страницы.
 *
 * Отдельным островком, а не 'use client' у всего components/Skeleton: язык
 * нужен одной подписи, а ячейки каркаса (Skel, SkelTile) — десятки на экран,
 * и им незачем гидрироваться. Серверные дети проходят сквозь рамку как есть.
 * Язык — из контекста (useLocale), а не пропом: loading.tsx без параметров
 * маршрута, и каркасы чужих разделов, которые ставят SkelPage, его не знают.
 */
export function SkelStatus({ className, children }: { className: string; children: ReactNode }) {
  const locale = useLocale()
  return (
    <div role="status" aria-label={tr(locale, { ru: 'Загрузка', en: 'Loading' })} className={className}>
      {children}
    </div>
  )
}
