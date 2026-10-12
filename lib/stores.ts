/** Метки магазинов — отдельный модуль без серверных зависимостей (нужен клиенту) */
export const STORE_LABEL: Record<string, string> = {
  epic: 'Epic Games',
  battlenet: 'Battle.net',
  riot: 'Riot Games',
  hoyoverse: 'HoYoverse',
  mojang: 'Minecraft.net',
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
