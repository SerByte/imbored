import { describe, expect, test, vi } from 'vitest'
import { LIBRARY_CAP, MINE_FRESH_SEC, resolveWhatsNew, topLibraryAppids } from './whatsnewfeed'

const NOW = 1_700_000_000
const DAY = 86_400

const game = (appid: number, playtimeForever: number) => ({ appid, playtimeForever })

/** Запись ленты: ветке важны ровно два поля */
const item = (appid: number, daysAgo: number) => ({ appid, publishedAt: NOW - daysAgo * DAY })

function stubs(opts: { mine?: ReturnType<typeof item>[]; major?: ReturnType<typeof item>[] } = {}) {
  const forApps = vi.fn(async (_ids: number[], limit: number) => (opts.mine ?? []).slice(0, limit))
  const major = vi.fn(async (limit: number, minRank: number) => {
    void minRank // заглушка порог не применяет — его проверяет отдельный тест
    return (opts.major ?? []).slice(0, limit)
  })
  const snapshot = vi.fn(async () => ({ games: [game(730, 100), game(440, 50)] }))
  return { forApps, major, snapshot, nowSec: NOW }
}

describe('topLibraryAppids', () => {
  test('сортирует по наигранному и режет по капу', () => {
    expect(topLibraryAppids([game(1, 5), game(2, 500), game(3, 50)], 2)).toEqual([2, 3])
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

describe('resolveWhatsNew: выбор ленты', () => {
  test('гость видит общую и снапшот не читает', async () => {
    const s = stubs({ major: [item(1, 0)] })
    const res = await resolveWhatsNew({ steamid: null, wantsPopular: false, ...s })
    expect(res).toMatchObject({ showPopular: true, hasMine: false })
    expect(res.items.map((i) => i.appid)).toEqual([1])
    expect(s.snapshot).not.toHaveBeenCalled()
  })

  test('своих свежих хватает на всю ленту — общую не трогаем', async () => {
    const mine = [item(10, 1), item(11, 2), item(12, 3)]
    const s = stubs({ mine, major: [item(99, 0)] })
    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s, limit: 3 })
    expect(res).toMatchObject({ showPopular: false, hasMine: true, mineCount: 3 })
    expect(s.major).not.toHaveBeenCalled()
  })

  test('на общей вкладке личная лента спрашивается одной строкой', async () => {
    const s = stubs({ mine: [item(10, 1)], major: [item(99, 0)] })
    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: true, ...s })
    // переключатель показать надо, а тридцать записей ради этого не читаем
    expect(res).toMatchObject({ showPopular: true, hasMine: true })
    expect(s.forApps.mock.calls[0]![1]).toBe(1)
  })

  test('порог популярности доезжает до общей ленты', async () => {
    const s = stubs({ major: [item(1, 0)] })
    await resolveWhatsNew({ steamid: null, wantsPopular: true, ...s, rankFloor: 777 })
    expect(s.major.mock.calls[0]![1]).toBe(777)
  })
})

describe('resolveWhatsNew: добивка из общей', () => {
  test('своих мало — остаток берётся из общей, свои идут первыми', async () => {
    // порядок НЕ хронологический намеренно: добивка свежее того, что над ней
    const mine = [item(10, 20), item(11, 40)]
    const major = [item(90, 0), item(91, 1), item(92, 2)]
    const s = stubs({ mine, major })

    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s, limit: 5 })

    expect(res.items.map((i) => i.appid)).toEqual([10, 11, 90, 91, 92])
    expect(res).toMatchObject({ showPopular: false, hasMine: true, mineCount: 2 })
  })

  test('игра, уже показанная сверху, в добивку не попадает', async () => {
    // одна и та же игра дважды в одной ленте выглядит поломкой, а не полнотой
    const mine = [item(10, 20)]
    const major = [item(10, 0), item(91, 1), item(92, 2)]
    const s = stubs({ mine, major })

    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s, limit: 3 })

    expect(res.items.map((i) => i.appid)).toEqual([10, 91, 92])
    expect(res.mineCount).toBe(1)
  })

  test('протухшее в личную не идёт — именно оно давало хвост в пять лет', async () => {
    const mine = [item(10, 20), item(11, 200), item(12, 1964)]
    const major = [item(90, 0), item(91, 1)]
    const s = stubs({ mine, major })

    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s, limit: 3 })

    expect(res.items.map((i) => i.appid)).toEqual([10, 90, 91])
    expect(res.mineCount).toBe(1)
  })

  test('граница свежести: ровно на пороге ещё своё, на секунду старше — нет', async () => {
    const s1 = stubs({ mine: [{ appid: 10, publishedAt: NOW - MINE_FRESH_SEC }], major: [] })
    expect((await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s1 })).mineCount).toBe(1)

    const s2 = stubs({ mine: [{ appid: 10, publishedAt: NOW - MINE_FRESH_SEC - 1 }], major: [item(90, 0)] })
    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s2 })
    expect(res).toMatchObject({ showPopular: true, mineCount: 1 })
    expect(res.items.map((i) => i.appid)).toEqual([90])
  })

  test('за три месяца по своим играм пусто — показываем общую целиком и БЕЗ вкладок', async () => {
    // Вкладка, ведущая в пустоту, хуже её отсутствия — и это касается самого
    // переключателя тоже. Пока hasMine считался по mine.length, страница
    // рисовала две вкладки, помечала активной «В популярных играх», находясь
    // по адресу /whatsnew без параметра, и переключить ленту было нельзя ни
    // с одного из двух адресов.
    const s = stubs({ mine: [item(10, 500), item(11, 900)], major: [item(90, 0), item(91, 1)] })
    const res = await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s, limit: 2 })

    expect(res).toMatchObject({ showPopular: true, hasMine: false })
    expect(res.items.map((i) => i.appid)).toEqual([90, 91])
  })

  test('на общей вкладке переключатель держится на свежести, а не на факте патчей', async () => {
    // Тот же разрез с другой стороны: сюда приходят по ?feed=popular, и
    // вернуться на личную вкладку можно только если ей есть что показать.
    const stale = stubs({ mine: [item(10, 500)], major: [item(90, 0)] })
    expect(await resolveWhatsNew({ steamid: '765', wantsPopular: true, ...stale })).toMatchObject({
      showPopular: true,
      hasMine: false,
    })

    const freshOne = stubs({ mine: [item(10, 1)], major: [item(90, 0)] })
    expect(await resolveWhatsNew({ steamid: '765', wantsPopular: true, ...freshOne })).toMatchObject({
      showPopular: true,
      hasMine: true,
    })
  })

  test('порог свежести настраивается', async () => {
    const s = stubs({ mine: [item(10, 200)], major: [item(90, 0)] })
    const res = await resolveWhatsNew({
      steamid: '765',
      wantsPopular: false,
      ...s,
      limit: 2,
      freshSec: 300 * DAY,
    })
    expect(res.mineCount).toBe(1)
    expect(res.items.map((i) => i.appid)).toEqual([10, 90])
  })

  test('добивка запрашивается с запасом на пересечения', async () => {
    const s = stubs({ mine: [item(10, 1), item(11, 2)], major: [item(90, 0)] })
    await resolveWhatsNew({ steamid: '765', wantsPopular: false, ...s, limit: 5 })
    // 5 мест минус 2 своих = 3 нужных, но пересечения могут съесть часть
    expect(s.major.mock.calls[0]![0]).toBeGreaterThan(3)
  })
})
