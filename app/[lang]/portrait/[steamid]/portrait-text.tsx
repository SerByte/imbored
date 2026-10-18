import { dateLabel } from '@/lib/freshness'
import { lp, type Locale } from '@/lib/i18n'
import { personaLabel, playerFallback } from '@/lib/playername'
import { textLangOn } from '@/lib/textlang'
import type { WrappedYear } from '@/lib/wrapped'

/*
 * Куски на языке страницы, общие для портрета, итогов года и их карточек.
 * Одним местом, потому что расходиться им нельзя: ник в заголовке вкладки,
 * на странице и на карточке обязан быть одним и тем же.
 */

/**
 * Ник для вывода: демо-ник — на языке страницы («Demo player» на /en), без
 * ника — «Игрок 1234» / «Player 1234». Ник живого человека — как записан.
 */
export function playerName(steamid: string, persona: string | null, locale: Locale): string {
  return personaLabel(steamid, persona, locale) ?? playerFallback(steamid.slice(-4), locale)
}

/**
 * lang куска чужого текста — ника из Steam, названия игры: на /en русский ник
 * помечается 'ru', и английский голос скринридера не читает его по буквам.
 *
 * Только на /en. Русская страница остаётся без атрибута, как была:
 * textLangOn на ней пометил бы латиницу, а это уже другая правка, не перевод.
 */
export function langOn(locale: Locale, text: string): 'ru' | undefined {
  return locale === 'en' && textLangOn(locale, text) === 'ru' ? 'ru' : undefined
}

/**
 * Превью английской страницы — своей записью, ради alt.
 *
 * alt файловой картинки (opengraph-image.tsx) — одна статическая строка на
 * оба языка, а файловая картинка встаёт в метаданные, только если у
 * страницы нет своих openGraph.images (mergeStaticMetadata в Next). Поэтому
 * на /en картинка та же и по тому же адресу под /en, но с английским alt;
 * twitter берёт её отсюда сам. Русская страница своих images не объявляет —
 * у неё всё по-прежнему, вплоть до хэша в адресе картинки.
 *
 * path — русский адрес страницы без префикса, как у localeAlternates.
 */
export function ogImageOn(locale: Locale, path: string, alt: string) {
  if (locale !== 'en') return {}
  // Размер — как у opengraph-image.tsx: импорт оттуда тянул бы в страницу next/og и всю карточку
  return { images: [{ url: lp(locale, `${path}/opengraph-image`), width: 1200, height: 630, type: 'image/png', alt }] }
}

/**
 * «По снимкам библиотеки: с 5 марта по 26 сентября» — две честные даты
 * итогов. Целой фразой на язык: предлоги по-английски свои, и склеить их из
 * русских кусков нельзя. Русская ветка — та же разметка, что стояла в обеих
 * страницах, до текстового узла.
 */
export function SnapshotDates({
  year,
  locale,
}: {
  year: Pick<WrappedYear, 'from' | 'to' | 'fromPrevYear' | 'closed'>
  locale: Locale
}) {
  const from = dateLabel(year.from, { year: year.fromPrevYear, locale })
  const to = dateLabel(year.to, { year: year.closed, locale })
  return locale === 'en' ? (
    <>
      Based on library snapshots from {from} to {to}.
    </>
  ) : (
    <>
      По снимкам библиотеки: с {from} по{' '}
      {to}.
    </>
  )
}
