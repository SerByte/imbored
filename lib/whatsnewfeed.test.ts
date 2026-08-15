import { describe, expect, test, vi } from 'vitest'
import { LIBRARY_CAP, resolveWhatsNew, topLibraryAppids } from './whatsnewfeed'

const game = (appid: number, playtimeForever: number) => ({ appid, playtimeForever })

/** Ветку проверяем на строках-заглушках: она обязана быть слепой к типу */
function stubs(opts: { mine?: string[]; major?: string[] } = {}) {
  const forApps = vi.fn(async (_ids: number[], limit: number) =>
    (opts.mine ?? []).slice(0, limit),
  )
  const major = vi.fn(async (limit: number, minRank: number) => {
    void minRank // заглушка порог не применяет — его проверяет отдельный тест
    return (opts.major ?? []).slice(0, limit)
  })
  const snapshot = vi.fn(async () => ({ games: [game(730, 100), game(440, 50)] }))
  return { forApps, major, snapshot }
}

describe('topLibraryAppids', () => {
  test('сортирует по наигранному и режет по капу', () => {
    const games = [game(1, 5), game(2, 500), game(3, 50)]
    expect(topLibraryAppids(games, 2)).toEqual([2, 3])
  })

  test('при равном времени порядок детерминирован по appid', () => {
    // на границе капа две игры с равным playtimeForever решают, кто попадёт в
    // ленту. Без явной добивки страница и опрос совпадали бы по удаче.
    const a = topLibraryAppids([game(900, 10), game(100, 10), game(500, 10)], 2)
    const b = topLibraryAppids([game(500, 10), game(900, 10), game(100, 10)], 2)
    expect(a).toEqual([100, 500])
    expect(a).toEqual(b)
  })

  test('кап по умолчанию — LIBRARY_CAP', () => {
    const many = Array.from({ length: LIBRARY_CAP + 10 }, (_, i) => game(i + 1, i))
    expect(topLibraryAppids(many)).toHaveLength(LIBRARY_CAP)
  })
})

describe('resolveWhatsNew', () => {
  test('гость видит общую ленту и снапшот не читает', async () => {
    const s = stubs({ major: ['общая'] })
    const res = await resolveWhatsNew({ steamid: null, wantsPopular: false, ...s })
    expect(res).toMatchObject({ items: ['общая'], showPopular: true, hasMine: false })
    expect(s.snapshot).not.toHaveBeenCalled()
    expect(s.forApps).not.toHaveBeenCalled()
  })

  test('есть личная лента — показываем её', async () => {
    const s = stubs({ mine: ['личная'], major: ['общая'] })
    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s })
    expect(res).toMatchObject({ items: ['личная'], showPopular: false, hasMine: true })
    expect(s.major).not.toHaveBeenCalled()
  })

  test('личная лента пуста — тихо откатываемся на общую без переключателя', async () => {
    // ровно то, что опрос переписал бы своими словами и разошёлся со страницей
    const s = stubs({ mine: [], major: ['общая'] })
    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s })
    expect(res).toMatchObject({ items: ['общая'], showPopular: true, hasMine: false })
  })

  test('нет снапшота — тоже общая', async () => {
    const s = stubs({ major: ['общая'] })
    s.snapshot.mockResolvedValue(null as never)
    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s })
    expect(res.hasMine).toBe(false)
  })

  test('на общей вкладке личная лента спрашивается одной строкой', async () => {
    const s = stubs({ mine: ['личная'], major: ['общая'] })
    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: true, ...s })
    // переключатель показать надо, а тридцать записей ради этого не читаем
    expect(res).toMatchObject({ showPopular: true, hasMine: true })
    expect(s.forApps.mock.calls[0]![1]).toBe(1)
  })

  test('порог популярности доезжает до общей ленты', async () => {
    const s = stubs({ major: ['общая'] })
    await resolveWhatsNew({ steamid: null, wantsPopular: true, ...s, rankFloor: 777 })
    expect(s.major.mock.calls[0]![1]).toBe(777)
  })
})
