import { clip, DESCRIPTION_MAX } from '@/lib/clip'
import { dateLabel } from '@/lib/freshness'
import { fmtDate, pl, tr, type Locale } from '@/lib/i18n'
import {
  archiveDescription,
  archiveMonths,
  archiveTitle,
  type ArchiveItem,
  type ArchiveMonth,
} from '@/lib/patcharchive'

/**
 * Тексты архива обновлений на языке страницы.
 *
 * Русские — ровно те, что пишет lib/patcharchive (archiveTitle,
 * archiveDescription, archiveMonths): сюда они приходят вызовом, а не копией,
 * и правятся там. Шаг пути «Обновления» — archiveCrumb из lib/jsonld: тот же,
 * что в крошках разметки. Английские — свои целиком, а
 * не перевод кусков: у них другой порядок слов («Counter-Strike 2 updates»,
 * а не «Обновления «…»»), и даты без «г.», поэтому точки ставятся иначе.
 */

/** h1 архива: «Обновления «X»» / «X updates» */
export function archiveHeading(gameName: string, locale: Locale = 'ru'): string {
  return tr(locale, { ru: `Обновления «${gameName}»`, en: `${gameName} updates` })
}

/** <title>: имя игры — с него начинается запрос — и вопрос, ради которого ищут */
export function archiveTitleOn(gameName: string, locale: Locale = 'ru'): string {
  if (locale !== 'en') return archiveTitle(gameName)
  return `${gameName} updates — what changed in each patch`
}

/**
 * meta description: сколько патчей и за какой срок, затем последний пересказ —
 * то же правило, что у archiveDescription. На /en item.tldr — уже английский
 * пересказ (loadArchive), год — у конца срока и у начала, только если он другой.
 * Имя игры — первым и через двоеточие («Counter-Strike 2: 30 patches — …»):
 * русская отделяет его кавычками, а «30 Left 4 Dead 2 patches» без границы
 * сливал число счёта с числом в названии.
 */
export function archiveDescriptionOn(gameName: string, items: readonly ArchiveItem[], locale: Locale = 'ru'): string {
  if (locale !== 'en') return archiveDescription(gameName, items)
  const n = items.length
  const newest = items[0]
  const oldest = items[n - 1]
  const sameYear =
    newest && oldest && new Date(newest.publishedAt * 1000).getUTCFullYear() === new Date(oldest.publishedAt * 1000).getUTCFullYear()
  const span =
    newest && oldest && n > 1
      ? ` — ${dateLabel(oldest.publishedAt, { year: !sameYear, locale })} to ${dateLabel(newest.publishedAt, { year: true, locale })}`
      : newest
        ? ` — ${dateLabel(newest.publishedAt, { year: true, locale })}`
        : ''
  const noun = pl(locale, n, { ru: ['патч', 'патча', 'патчей'], en: ['patch', 'patches'] })
  const head = `${gameName}: ${n} ${noun}${span}.`
  const told = items.find((i) => i.tldr?.trim())
  const text = told
    ? `${head} Latest summary, ${dateLabel(told.publishedAt, { locale })}: ${told.tldr!.replace(/\s+/g, ' ').trim()}`
    : head
  return clip(text, DESCRIPTION_MAX) ?? text.slice(0, DESCRIPTION_MAX)
}

/**
 * Строки по месяцам — группировка archiveMonths (UTC, как дата строки), а
 * подпись месяца на /en — «October 2026». По-английски месяц с заглавной и
 * без «г.» и есть заголовок, поэтому здесь хватает Intl.
 */
export function archiveMonthsOn(items: readonly ArchiveItem[], locale: Locale = 'ru'): ArchiveMonth[] {
  const months = archiveMonths(items)
  if (locale !== 'en') return months
  return months.map((m) => ({ ...m, label: fmtDate(locale, m.items[0]!.publishedAt, { month: 'long', year: 'numeric' }) }))
}
