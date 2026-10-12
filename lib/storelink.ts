import { STORE_LABEL } from './stores'

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
 */
export function storeLink(game: {
  appid: number
  store: string | null
  storeUrl: string | null
}): { href: string; where: string } | null {
  if (game.storeUrl) return { href: game.storeUrl, where: STORE_LABEL[game.store ?? ''] ?? 'магазине' }
  if (game.appid > 0) return { href: `https://store.steampowered.com/app/${game.appid}/`, where: 'Steam' }
  return null
}
