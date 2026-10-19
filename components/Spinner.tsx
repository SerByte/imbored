'use client'

import { useLocale } from '@/components/LocaleProvider'
import { tr } from '@/lib/i18n'

/**
 * Единственный загрузчик приложения.
 *
 * Раньше эта же разметка была скопирована в шести местах (/play, /daily, /rooms,
 * /room/new, /room/[id] ×2, /compat) и уже разъезжалась: где-то 10×10, где-то 8×8.
 *
 * Клиентский, а не серверный: все, кто его рисует, — клиентские страницы и
 * островки, и имя для скринридера он берёт на языке страницы из контекста
 * (useLocale), а не пропом через каждого из них.
 */
export function Spinner({ size = 40, className = '' }: { size?: number; className?: string }) {
  const locale = useLocale()
  return (
    <div
      role="status"
      aria-label={tr(locale, { ru: 'Загрузка', en: 'Loading' })}
      className={`spinner ${className}`}
      style={{ height: size, width: size }}
    />
  )
}
