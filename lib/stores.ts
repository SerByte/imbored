/** Метки магазинов — отдельный модуль без серверных зависимостей (нужен клиенту) */
export const STORE_LABEL: Record<string, string> = {
  epic: 'Epic Games',
  battlenet: 'Battle.net',
  riot: 'Riot Games',
  hoyoverse: 'HoYoverse',
  mojang: 'Minecraft.net',
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

/**
 * Цвет магазина для типографской обложки (components/TypeCover): у игр не из
 * Steam картинок нет вовсе, и обложку собирает название на свечении этого
 * цвета. Узнаваемый цвет самого магазина — Riot красный, Battle.net синий, —
 * чтобы полка различала их с первого взгляда, как по логотипу.
 */
export const STORE_TINT: Record<string, string> = {
  epic: '#2f7de1',
  battlenet: '#148eff',
  riot: '#eb0029',
  hoyoverse: '#d9a441',
  mojang: '#5d9b34',
}

/** Свечение игры, про магазин которой ничего не известно */
export const STORE_TINT_DEFAULT = '#8a8a8a'
