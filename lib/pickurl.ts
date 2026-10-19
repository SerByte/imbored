import { lp, type Locale } from './i18n'
import { withRef } from './track'

/**
 * Адрес выбора, которым делятся (/pick/<id>), и виды выбора — без остального
 * lib/sharedpick.
 *
 * Их берёт кнопка «Отправить другу» у героя /play и /daily
 * (components/SharePick). lib/sharedpick на уровне модуля собирает регулярки
 * денег, сроков и дат (new RegExp(String.raw…)) и тянет lib/comeback с его
 * регулярками «с прошлого раза» — сборщик не выбросит ни одну, раз модуль
 * импортирован, и ради одного адреса они ехали в первую загрузку обеих
 * страниц (2.4 КБ). Здесь — только lp из lib/i18n и withRef из lib/track.
 * lib/sharedpick реэкспортирует всё отсюда.
 *
 * Сторожит lib/sharedchunk.test.ts.
 */

export const PICK_KINDS = ['play', 'daily'] as const
export type PickKind = (typeof PICK_KINDS)[number]

/**
 * Адрес выбора с меткой воронки — как roomShareUrl у пати. На 'en' — /en/pick/…:
 * получатель английской ссылки открывает английскую страницу, а не русскую.
 */
export function pickShareUrl(origin: string, id: string, locale: Locale = 'ru'): string {
  return withRef(`${origin}${lp(locale, `/pick/${id}`)}`, 'pick')
}
