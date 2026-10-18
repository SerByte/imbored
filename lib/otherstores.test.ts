import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { OTHER_STORE_GAMES } from './otherstores'
import { OTHER_STORE_GENRE, OTHER_STORE_OF, otherStoreGenre } from './storecover'

/**
 * Жанр типографской обложки — готовой строкой (см. OTHER_STORE_GENRE).
 *
 * Два сторожа: у каждой игры пула подпись есть и она русская, а сама обложка
 * не тянет словарь тегов обратно — он клиентский GameArt утяжелял на все
 * маршруты сразу.
 */
describe('жанр игр не из Steam', () => {
  test('у каждой игры пула есть русская подпись', () => {
    for (const g of OTHER_STORE_GAMES) {
      const genre = OTHER_STORE_GENRE[g.appid]
      expect(genre, g.name).toBeTruthy()
      // MOBA и MMORPG так и пишут по-русски — латиница допустима только целиком заглавная
      expect(/[а-яё]/i.test(genre) || /^[A-Z]+$/.test(genre), `${g.name}: ${genre}`).toBe(true)
    }
  })

  /*
   * Английская таблица — без правила «кириллица или ВСЕ ЗАГЛАВНЫЕ»: она
   * латиницей целиком. Сторож обратный — ни одной русской буквы, иначе на
   * /en обложка заговорила бы по-русски.
   */
  test('у каждой игры пула есть английская подпись, и она без кириллицы', () => {
    for (const g of OTHER_STORE_GAMES) {
      const genre = otherStoreGenre(g.appid, 'en')
      expect(genre, g.name).toBeTruthy()
      expect(genre, `${g.name}: ${genre}`).not.toMatch(/[А-Яа-яЁё]/)
      expect(genre, `${g.name}: ${genre}`).toMatch(/^[A-Z]/)
    }
    expect(otherStoreGenre(-101, 'en')).toBe('Battle royale')
    expect(otherStoreGenre(-106, 'en')).toBe('MOBA')
  })

  test('по умолчанию и на ru — ровно OTHER_STORE_GENRE; чужой appid — undefined', () => {
    for (const g of OTHER_STORE_GAMES) {
      expect(otherStoreGenre(g.appid), g.name).toBe(OTHER_STORE_GENRE[g.appid])
      expect(otherStoreGenre(g.appid, 'ru'), g.name).toBe(OTHER_STORE_GENRE[g.appid])
    }
    expect(otherStoreGenre(730, 'en')).toBeUndefined()
    expect(otherStoreGenre(730)).toBeUndefined()
  })

  test('TypeCover не импортирует словарь тегов', () => {
    const src = readFileSync(path.join(__dirname, '..', 'components', 'TypeCover.tsx'), 'utf8')
    expect(src).not.toMatch(/tagsru/)
  })

  /*
   * Магазин обложки — своей таблицей (lib/storecover), а не find по пулу:
   * пул — карточки целиком, и обложка везла его в первую загрузку почти
   * каждого маршрута ради одного поля. Таблица обязана совпадать с пулом —
   * иначе у новой игры не будет ни цвета магазина, ни метки на обложке.
   */
  test('магазин у обложки — тот же, что в пуле, у каждой игры и без лишних', () => {
    for (const g of OTHER_STORE_GAMES) expect(OTHER_STORE_OF[g.appid], g.name).toBe(g.store)
    const pool = OTHER_STORE_GAMES.map((g) => String(g.appid)).sort()
    expect(Object.keys(OTHER_STORE_OF).sort()).toEqual(pool)
    expect(Object.keys(OTHER_STORE_GENRE).sort()).toEqual(pool)
  })

  test('TypeCover не тянет пул целиком', () => {
    const src = readFileSync(path.join(__dirname, '..', 'components', 'TypeCover.tsx'), 'utf8')
    expect(src).not.toMatch(/from '@\/lib\/otherstores'/)
  })
})
