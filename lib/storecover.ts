/**
 * Что типографской обложке (components/TypeCover) знать об игре не из Steam:
 * чей она магазин и жанр одной строкой.
 *
 * ОТДЕЛЬНО ОТ ПУЛА lib/otherstores — ради веса. Обложка живёт в клиентском
 * GameArt, то есть в первой загрузке почти каждого маршрута, а пул — это
 * карточки целиком: теги, категории, описания, ссылки магазинов. Ради одного
 * поля store обложка искала игру в нём find'ом, и 2.7 КБ пула ехали в /play,
 * /daily, /library, /quiz (замер сборкой). Полноту и совпадение обеих таблиц
 * с пулом держит lib/otherstores.test.ts.
 */
import type { Locale } from './i18n'

/** Магазин игры не из Steam — ключ STORE_LABEL и STORE_TINT (lib/stores), как store в пуле */
export const OTHER_STORE_OF: Readonly<Record<number, string>> = {
  [-101]: 'epic',
  [-102]: 'epic',
  [-103]: 'epic',
  [-104]: 'epic',
  [-105]: 'riot',
  [-106]: 'riot',
  [-107]: 'battlenet',
  [-108]: 'battlenet',
  [-109]: 'battlenet',
  [-110]: 'hoyoverse',
  [-111]: 'mojang',
}

/**
 * Жанр одной строкой — для типографской обложки (components/TypeCover).
 *
 * Готовой подписью, а не tagRu по верхнему тегу: обложка живёт в клиентском
 * GameArt, и словарь тегов Steam (около 12 КБ) ехал ради одиннадцати слов в
 * первую загрузку всех двадцати маршрутов — замерено по
 * route-bundle-stats.json. Полноту таблицы держит lib/otherstores.test.ts.
 */
export const OTHER_STORE_GENRE: Readonly<Record<number, string>> = {
  [-101]: 'Королевская битва',
  [-102]: 'Спорт',
  [-103]: 'Вечеринка',
  [-104]: 'Хоррор',
  [-105]: 'Тактический шутер',
  [-106]: 'MOBA',
  [-107]: 'MMORPG',
  [-108]: 'Карточная игра',
  [-109]: 'Геройский шутер',
  [-110]: 'Открытый мир',
  [-111]: 'Песочница',
}

/**
 * Те же одиннадцать жанров по-английски — для /en. Отдельной таблицей рядом,
 * а не через tagLabel: обложка не тянет словарь тегов ни на каком языке, и
 * пара строк на игру весит меньше любого импорта. Sentence case, как у
 * остальных подписей английской версии; MOBA и MMORPG — как пишутся везде.
 */
const OTHER_STORE_GENRE_EN: Readonly<Record<number, string>> = {
  [-101]: 'Battle royale',
  [-102]: 'Sports',
  [-103]: 'Party game',
  [-104]: 'Horror',
  [-105]: 'Tactical shooter',
  [-106]: 'MOBA',
  [-107]: 'MMORPG',
  [-108]: 'Card game',
  [-109]: 'Hero shooter',
  [-110]: 'Open world',
  [-111]: 'Sandbox',
}

const GENRE_BY_LOCALE = { ru: OTHER_STORE_GENRE, en: OTHER_STORE_GENRE_EN } satisfies Record<
  Locale,
  Readonly<Record<number, string>>
>

/**
 * Жанр обложки на языке страницы; undefined — игра не из пула (у Steam своя
 * обложка, и жанр ей не нужен). hasOwn — appid приходит из данных, и
 * «constructor» не должен найти прототип.
 */
export function otherStoreGenre(appid: number, locale: Locale = 'ru'): string | undefined {
  const table = GENRE_BY_LOCALE[locale]
  return Object.hasOwn(table, appid) ? table[appid] : undefined
}
