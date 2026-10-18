import { tr, type Locale } from './i18n'
import { STORE_LABEL } from './stores'

export type StoreLink = {
  href: string
  /**
   * «В чём» для русской подписи «Открыть в …»: Steam, Epic Games, магазине.
   * Английская подпись так не склеивается — её берут целиком из open.
   */
  where: string
  /**
   * Подпись ссылки целиком: «Открыть в Steam», «Open in Epic Games»; магазин
   * без метки — «Открыть в магазине» и «Open store page».
   */
  open: string
}

/**
 * Где взять сошедшуюся игру — адрес и «в чём» для подписи «Открыть в …».
 *
 * Одно правило на запасной экран матча (components/room/CeremonyBoundary) и
 * на экран чужой сошедшейся комнаты (app/room/[id]/page): своя ссылка
 * магазина — если она есть (игры других магазинов), иначе страница Steam.
 * Разъехавшись, они бы по-разному отвечали на один вопрос «где её взять».
 *
 * null — честное «не знаем»: игра другого магазина (отрицательный appid) без
 * своей ссылки. Адрес Steam с отрицательным номером — страница ошибки, и
 * лучше промолчать, чем вести в неё (так же решает offersOf в lib/jsonld).
 *
 * Отдельно от lib/stores: метки магазинов читают обложки и ценники почти
 * каждого маршрута, а это правило — одна комната. Лежало бы там — ехало бы в
 * первую загрузку /play, /daily, /library ради ничего.
 *
 * open — подпись целиком, на языке страницы. Русская — «Открыть в » и where,
 * как её и клеили на месте; английской клеить нечего: «Open in Steam», а
 * магазин без метки — не «Open in store», а «Open store page».
 */
export function storeLink(
  game: {
    appid: number
    store: string | null
    storeUrl: string | null
  },
  locale: Locale = 'ru',
): StoreLink | null {
  if (game.storeUrl) return place(game.storeUrl, STORE_LABEL[game.store ?? ''] ?? null, locale)
  if (game.appid > 0) return place(`https://store.steampowered.com/app/${game.appid}/`, 'Steam', locale)
  return null
}

/** Ссылка с подписями; name null — магазин без метки */
function place(href: string, name: string | null, locale: Locale): StoreLink {
  const where = name ?? tr(locale, { ru: 'магазине', en: 'store' })
  return {
    href,
    where,
    open: tr(locale, { ru: `Открыть в ${where}`, en: name ? `Open in ${name}` : 'Open store page' }),
  }
}
