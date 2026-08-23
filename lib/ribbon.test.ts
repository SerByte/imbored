import { describe, expect, test } from 'vitest'
import {
  FALLBACK_RIBBON,
  RIBBON_MAX,
  RIBBON_MIN,
  ribbonGames,
  type RibbonSource,
} from './ribbon'

/**
 * Сторож ленты главной.
 *
 * Лента идёт за всеми сценами, то есть отвечает за то, что главная вообще
 * выглядит как кино, а не как чёрный экран. Ломается она молча и ровно там, где
 * никто не смотрит: на пустой базе. Локально и в превью TURSO_DATABASE_URL не
 * задан — а значит состояние деградации у разработчика основное, и проверять
 * его надо не глазами.
 */

const row = (appid: number, over: Partial<RibbonSource> = {}): RibbonSource => ({
  appid,
  name: `Игра ${appid}`,
  headerImage: null,
  art: null,
  ...over,
})

describe('лента главной', () => {
  test('на пустом каталоге отдаётся запасной список', () => {
    const got = ribbonGames([])
    expect(got.length).toBe(RIBBON_MIN)
    expect(got.every((g) => g.src.length > 0)).toBe(true)
  })

  test('обложек всегда хватает на двенадцать колонок', () => {
    for (const catalog of [[], [row(1)], [row(1), row(2), row(3)]]) {
      expect(ribbonGames(catalog).length, `каталог из ${catalog.length}`).toBeGreaterThanOrEqual(
        RIBBON_MIN,
      )
    }
  })

  /**
   * Дубликат в ленте читается как ошибка загрузки: одна и та же обложка встаёт
   * рядом сама с собой в соседних колонках.
   */
  test('повторов по appid нет — ни внутри каталога, ни на стыке с запасным списком', () => {
    const catalog = [row(570), row(570), row(730), row(105600)]
    const got = ribbonGames(catalog)
    const ids = got.map((g) => g.appid)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('живые строки каталога не подменяются запасными', () => {
    const catalog = [row(11), row(12), row(13)]
    const got = ribbonGames(catalog)
    expect(got.slice(0, 3).map((g) => g.appid)).toEqual([11, 12, 13])
  })

  test('потолок держится: каталог длиннее максимума не разрастается', () => {
    const catalog = Array.from({ length: RIBBON_MAX + 20 }, (_, i) => row(1000 + i))
    expect(ribbonGames(catalog).length).toBe(RIBBON_MAX)
  })

  /**
   * Ссылка берётся в том же порядке деградации, что и везде в продукте:
   * резолвленный ассет, потом сохранённый header_image, потом шаблон Steam.
   */
  test('ссылка берётся из резолвленного арта, когда он есть', () => {
    const got = ribbonGames([
      row(570, { art: { header: 'https://example.test/a.jpg' }, headerImage: 'https://example.test/b.jpg' }),
    ])
    expect(got[0].src).toBe('https://example.test/a.jpg')
  })

  test('строка без единой ссылки в ленту не попадает', () => {
    const got = ribbonGames([row(-5)])
    expect(got.some((g) => g.appid === -5)).toBe(false)
  })

  /** Запасной список не должен молча усохнуть ниже собственного минимума. */
  test('в запасном списке хватает игр на минимум', () => {
    expect(FALLBACK_RIBBON.length).toBeGreaterThanOrEqual(RIBBON_MIN)
    expect(new Set(FALLBACK_RIBBON.map((g) => g.appid)).size).toBe(FALLBACK_RIBBON.length)
  })
})
