import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { OTHER_STORE_GAMES, OTHER_STORE_GENRE } from './otherstores'

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

  test('TypeCover не импортирует словарь тегов', () => {
    const src = readFileSync(path.join(__dirname, '..', 'components', 'TypeCover.tsx'), 'utf8')
    expect(src).not.toMatch(/tagsru/)
  })
})
