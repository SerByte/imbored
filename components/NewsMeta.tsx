/**
 * Мелочи вокруг патчнота: метка масштаба и дата.
 *
 * Раньше здесь жила и карточка ленты, но /whatsnew больше не строится из
 * карточек — осталось ровно то, что нужно странице игры.
 */
import type { StoredNews } from '@/lib/db'
import { dateLabel } from '@/lib/freshness'

/** Метка масштаба. Крупное подсвечиваем, мелкое — приглушаем. */
export function ScaleBadge({ scale }: { scale: StoredNews['scale'] }) {
  if (!scale) return null
  const major = scale === 'major'
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs shrink-0 ${
        major ? 'bg-ember/15 text-ember-text' : 'glass text-dim'
      }`}
    >
      {major ? 'Крупное' : 'Хотфикс'}
    </span>
  )
}

/**
 * Дата через lib/freshness, а не через свой toLocaleDateString: зона обязана
 * быть зафиксирована, иначе сервер и браузер печатают разные дни и React
 * перерисовывает всё тело страницы. Подробности там же.
 */
export function NewsDate({ at, className = '' }: { at: number; className?: string }) {
  return (
    <time
      dateTime={new Date(at * 1000).toISOString()}
      className={`font-mono tabular-nums text-xs text-dim ${className}`}
    >
      {dateLabel(at, { year: true })}
    </time>
  )
}
