/**
 * Мелочи вокруг патчнота: метка масштаба и дата.
 *
 * Раньше здесь жила и карточка ленты, но /whatsnew больше не строится из
 * карточек — осталось ровно то, что нужно странице игры.
 *
 * Язык — пропсом locale (по умолчанию русский), а не useLocale(): хуков здесь
 * нет, и оба компонента рисуются и серверной страницей патча, и клиентским
 * островком GameNews — каждый из них язык знает сам.
 */
import type { StoredNews } from '@/lib/db'
import { dateLabel } from '@/lib/freshness'
import { tr, type Locale } from '@/lib/i18n'

/** Метка масштаба. Крупное подсвечиваем, мелкое — приглушаем. */
export function ScaleBadge({ scale, locale = 'ru' }: { scale: StoredNews['scale']; locale?: Locale }) {
  if (!scale) return null
  const major = scale === 'major'
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs shrink-0 ${
        major ? 'bg-ember/15 text-ember-text' : 'glass text-dim'
      }`}
    >
      {/* Пилюля стоит в одном ряду с заголовком строки: английская подпись
          не шире русской («Major» уже «Крупное», «Hotfix» — «Хотфикс») */}
      {major ? tr(locale, { ru: 'Крупное', en: 'Major' }) : tr(locale, { ru: 'Хотфикс', en: 'Hotfix' })}
    </span>
  )
}

/**
 * Дата через lib/freshness, а не через свой toLocaleDateString: зона обязана
 * быть зафиксирована, иначе сервер и браузер печатают разные дни и React
 * перерисовывает всё тело страницы. Подробности там же.
 *
 * Неразрывная всегда: это одна метка шириной около 115 px, а не фраза. В
 * строке «Что нового» карточки игры её сжимал сосед, и на проде при 1440 шесть
 * дат из восьми ломались в «28 сентября 2026 / г.», а на 390 — в три строки по
 * слову. Пробелы в «2026 г.» обычные, переноса Intl не запрещает — запрещаем
 * здесь, одним местом на все вызовы, архив обновлений игры в их числе
 * (сторож — lib/newsrow.test.ts).
 */
export function NewsDate({ at, className = '', locale = 'ru' }: { at: number; className?: string; locale?: Locale }) {
  return (
    <time
      dateTime={new Date(at * 1000).toISOString()}
      className={`tabular-nums whitespace-nowrap text-xs text-dim ${className}`}
    >
      {dateLabel(at, { year: true, locale })}
    </time>
  )
}
