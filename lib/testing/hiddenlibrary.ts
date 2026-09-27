import type { GameMeta, LibraryGame } from '../types'

/**
 * Библиотека со скрытым в Steam временем — фикстура «20 игр, у всех нули».
 *
 * Ровно так выглядит ответ GetOwnedGames при галочке «Всегда скрывать общее
 * время игры»: список целиком, playtime_forever — ноль у каждой игры
 * (lib/playtime.ts). Одна фикстура на все модули, которые её судят: вкус,
 * выдача, причины, /library, портрет, — чтобы признак у них был один и тот же,
 * а не «почти такой же» в каждом тесте.
 *
 * Теги по кругу из трёх жанров: у профиля вкуса есть что сравнить, а
 * равный вес каждой игре виден по равным долям жанров.
 *
 * Модуль только для тестов: продукт его не импортирует.
 */
export const HIDDEN_LIBRARY_SIZE = 20

const GENRES: Array<Record<string, number>> = [
  { Roguelike: 100, 'Deck Building': 80 },
  { Automation: 100, 'Base Building': 80 },
  { 'Story Rich': 100, RPG: 80 },
]

export function hiddenLibrary(n = HIDDEN_LIBRARY_SIZE): LibraryGame[] {
  return Array.from({ length: n }, (_, i) => ({
    appid: 1000 + i,
    name: `Игра ${1000 + i}`,
    playtimeForever: 0,
    playtime2Weeks: 0,
  }))
}

export function hiddenLibraryMetas(n = HIDDEN_LIBRARY_SIZE): GameMeta[] {
  return hiddenLibrary(n).map((g, i) => ({
    appid: g.appid,
    name: g.name,
    tags: GENRES[i % GENRES.length],
    genres: [],
    categories: [2],
  }))
}
