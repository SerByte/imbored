/**
 * Мелочи вокруг патчнота: метка масштаба и дата.
 *
 * Раньше здесь жила и карточка ленты, но /whatsnew больше не строится из
 * карточек — осталось ровно то, что нужно странице игры.
 */
import type { StoredNews } from '@/lib/db'

/** Метка масштаба. Крупное подсвечиваем, мелкое — приглушаем. */
export function ScaleBadge({ scale }: { scale: StoredNews['scale'] }) {
  if (!scale) return null
  const major = scale === 'major'
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs shrink-0 ${
        major ? 'bg-ember/15 text-ember' : 'glass text-dim'
      }`}
    >
      {major ? 'Крупное' : 'Хотфикс'}
    </span>
  )
}

export function NewsDate({ at, className = '' }: { at: number; className?: string }) {
  const d = new Date(at * 1000)
  return (
    <time dateTime={d.toISOString()} className={`font-mono tabular-nums text-xs text-dim ${className}`}>
      {d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
    </time>
  )
}
