import { beforeEach, describe, expect, test, vi } from 'vitest'
import {
  logFeedback,
  saveLibrarySnapshot,
  unbanGame,
  upsertGamesMeta,
  upsertNeighbors,
  type Db,
} from '@/lib/db'
import { NEAR_SHOWN } from '@/lib/ownednear'
import { nowSec } from '@/lib/server'
import { freshDb, signInAs, signOut } from '@/lib/testing/route'
import type { LibraryGame } from '@/lib/types'
import { GET } from './route'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /api/session/owns — один бит «есть ли игра у смотрящего».
 *
 * По нему страница игры решает, показывать ли «Запустить». Ошибка в сторону
 * «да» — это ровно та кнопка, ради которой роут заведён: steam://run у того,
 * у кого игры нет. Поэтому здесь больше случаев «нет», чем «да».
 */

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

const lib = (...appids: number[]): LibraryGame[] =>
  appids.map((appid) => ({ appid, name: `Игра ${appid}`, playtimeForever: 60, playtime2Weeks: 0 }))

const ask = (appid: string | number) => GET(new Request(`http://localhost/api/session/owns?appid=${appid}`))

async function owned(appid: number): Promise<boolean> {
  const res = await ask(appid)
  expect(res.status).toBe(200)
  return ((await res.json()) as { owned: boolean }).owned
}

describe('/api/session/owns', () => {
  test('гостю — «нет» и без кэша: иначе ответ до входа пережил бы вход', async () => {
    signOut()
    const res = await ask(730)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ owned: false })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
  })

  test('мусорный appid — 400 до всякого чтения', async () => {
    await signInAs(db, 'openid')
    expect((await ask('abc')).status).toBe(400)
    expect((await ask(0)).status).toBe(400)
    expect((await ask('1.5')).status).toBe(400)
  })

  /*
   * Пять минут кэша — ответу, который меняет только новый снапшот: «нет» и
   * «да» сессии по ссылке. «Да» пишущей сессии несёт ещё и биты, которые она
   * меняет сама — «Уже прошёл» здесь или в «Твоих вечерах», «Снова
   * предлагать» на /library, — и закэшированный ответ до отметки вернул бы
   * кнопку на перезагрузке (тест «пройдена» ниже).
   */
  test('игра в библиотеке — «да», ответ личный; у сессии по ссылке живёт пять минут', async () => {
    const me = await signInAs(db, 'claimed')
    await saveLibrarySnapshot(db, me, lib(570, 730), nowSec())
    const res = await ask(730)
    expect(await res.json()).toEqual({ owned: true })
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    expect(res.headers.get('vary')).toBe('Cookie')
  })

  test('у пишущей сессии «да» без кэша, «нет» — те же пять минут', async () => {
    const me = await signInAs(db, 'openid')
    await saveLibrarySnapshot(db, me, lib(570, 730), nowSec())
    const yes = await ask(730)
    expect(await yes.json()).toEqual({ owned: true })
    expect(yes.headers.get('cache-control')).toBe('private, no-store')
    const no = await ask(440)
    expect(await no.json()).toEqual({ owned: false })
    expect(no.headers.get('cache-control')).toBe('private, max-age=300')
    expect(no.headers.get('vary')).toBe('Cookie')
  })

  /*
   * «Уже прошёл» на странице игры жил только в состоянии островка: после
   * перезагрузки кнопка возвращалась, хотя игра уже лежит на полке
   * «Пройдено», — человек не понимал, сохранилась ли отметка, и каждое
   * повторное нажатие писало ещё одну строку бана. Решает последний бан, как
   * у полки (listBanned): переставленный другой кнопкой — уже не «пройдено»,
   * снятый «Снова предлагать» — тоже.
   */
  test.each(['openid', 'demo'] as const)('%s: пройденная — done: true, и решает последний бан', async (kind) => {
    const me = await signInAs(db, kind)
    await saveLibrarySnapshot(db, me, lib(730), nowSec())
    await logFeedback(db, { steamid: me, appid: 730, action: 'banned', reason: 'done' }, nowSec() - 60)
    const res = await ask(730)
    expect(await res.json()).toEqual({ owned: true, done: true })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    await logFeedback(db, { steamid: me, appid: 730, action: 'banned' }, nowSec())
    expect(await (await ask(730)).json()).toEqual({ owned: true })
    await logFeedback(db, { steamid: me, appid: 730, action: 'banned', reason: 'done' }, nowSec() + 1)
    expect(await (await ask(730)).json()).toEqual({ owned: true, done: true })
    await unbanGame(db, me, 730)
    expect(await (await ask(730)).json()).toEqual({ owned: true })
  })

  // Кнопки у сессии по ссылке нет — и спрашивать её бан незачем; у чужой
  // игры кнопки нет тоже
  test('сессии по ссылке и у не своей игры — без done', async () => {
    const me = await signInAs(db, 'claimed')
    await saveLibrarySnapshot(db, me, lib(730), nowSec())
    await logFeedback(db, { steamid: me, appid: 730, action: 'banned', reason: 'done' }, nowSec() - 60)
    await logFeedback(db, { steamid: me, appid: 440, action: 'banned', reason: 'done' }, nowSec() - 60)
    expect(await (await ask(730)).json()).toEqual({ owned: true })
    db = await freshDb()
    const writer = await signInAs(db, 'openid')
    await saveLibrarySnapshot(db, writer, lib(730), nowSec())
    await logFeedback(db, { steamid: writer, appid: 440, action: 'banned', reason: 'done' }, nowSec() - 60)
    expect(await (await ask(440)).json()).toEqual({ owned: false })
  })

  test('7300 в библиотеке — не повод сказать «да» про 730', async () => {
    // Отсев в SQL ищет подстроку `"appid":730`, и 7300 под неё подходит.
    // Подтверждает json_each — этот тест держит именно его.
    const me = await signInAs(db, 'openid')
    await saveLibrarySnapshot(db, me, lib(7300, 17300), nowSec())
    expect(await owned(730)).toBe(false)
    expect(await owned(7300)).toBe(true)
  })

  test('без снапшота — «нет», а не ошибка', async () => {
    await signInAs(db, 'openid')
    expect(await owned(730)).toBe(false)
  })

  test('решает последний снапшот: проданная или скрытая игра больше не «есть»', async () => {
    const me = await signInAs(db, 'openid')
    await saveLibrarySnapshot(db, me, lib(730), nowSec() - 60)
    await saveLibrarySnapshot(db, me, lib(570), nowSec())
    expect(await owned(730)).toBe(false)
  })

  test('игра другого магазина в библиотеке Steam не бывает', async () => {
    const me = await signInAs(db, 'openid')
    await saveLibrarySnapshot(db, me, lib(730), nowSec())
    expect(await owned(-12)).toBe(false)
  })

  /*
   * «План на вечер» (lib/eveningplan.ts): живая строка главной ведёт сюда, на
   * страницу игры, и запуск отсюда обязан закрыть план — иначе строка
   * «Ставил на загрузку — ждёт тебя» висела бы и после сыгранного вечера.
   * Признак едет тем же ответом, а не вторым запросом, и без кэша: после
   * запуска он перестаёт быть правдой.
   */
  test('у игры живой план — plan: true и без кэша; у соседней — обычный ответ', async () => {
    const me = await signInAs(db, 'openid')
    await saveLibrarySnapshot(db, me, lib(570, 730), nowSec())
    await upsertGamesMeta(db, [{ appid: 730, name: 'Игра 730', tags: {}, genres: [], categories: [] }], nowSec())
    await logFeedback(
      db,
      { steamid: me, appid: 730, action: 'opened', ctx: { source: 'daily', intent: 'tonight' } },
      nowSec() - 60,
    )
    // Более свежий план другой игры не прячет план этой
    await upsertGamesMeta(db, [{ appid: 570, name: 'Игра 570', tags: {}, genres: [], categories: [] }], nowSec())
    await logFeedback(
      db,
      { steamid: me, appid: 570, action: 'opened', ctx: { source: 'play', intent: 'install' } },
      nowSec() - 30,
    )
    const res = await ask(730)
    expect(await res.json()).toEqual({ owned: true, plan: true })
    expect(res.headers.get('cache-control')).toBe('private, no-store')
    // запуск закрыл план — дальше обычный ответ
    await logFeedback(db, { steamid: me, appid: 730, action: 'launched' }, nowSec())
    expect(await (await ask(730)).json()).toEqual({ owned: true })
  })

  test.each(['claimed', 'demo'] as const)('%s — плана не видит: запуск не её план закрыл бы', async (kind) => {
    const me = await signInAs(db, kind)
    await saveLibrarySnapshot(db, me, lib(730), nowSec())
    await upsertGamesMeta(db, [{ appid: 730, name: 'Игра 730', tags: {}, genres: [], categories: [] }], nowSec())
    await logFeedback(
      db,
      { steamid: me, appid: 730, action: 'opened', ctx: { source: 'play', intent: 'install' } },
      nowSec() - 60,
    )
    expect(await (await ask(730)).json()).toEqual({ owned: true })
  })

  test('сессия по вставленной ссылке тоже спрашивает: это чтение, а не запись', async () => {
    const me = await signInAs(db, 'claimed')
    await saveLibrarySnapshot(db, me, lib(730), nowSec())
    expect(await owned(730)).toBe(true)
  })

  /*
   * «Похожее уже есть у тебя» (lib/ownednear): соседи страницы, которые
   * лежат на своей полке. Тем же ответом владения, по near=1, и только там,
   * где «у тебя» — правда про смотрящего: пишущая сессия не из демо, и
   * самой игры у неё нет.
   */
  describe('near — свои из соседей', () => {
    /** Соседи 1000: 1001…1006 по порядку; у всех теги, иначе пул их не держит */
    async function neighbors() {
      await upsertGamesMeta(
        db,
        [1000, 1001, 1002, 1003, 1004, 1005, 1006].map((appid) => ({
          appid,
          name: `Игра ${appid}`,
          tags: { Roguelike: 100 },
          genres: [],
          categories: [],
        })),
        nowSec(),
      )
      await upsertNeighbors(
        db,
        new Map([[1000, [1001, 1002, 1003, 1004, 1005, 1006].map((neighbor, i) => ({ neighbor, score: 0.9 - i / 10, shared: [] }))]]),
      )
    }
    const askNear = (appid: number) => GET(new Request(`http://localhost/api/session/owns?appid=${appid}&near=1`))
    const libWith = (minutes: Record<number, number>): LibraryGame[] =>
      Object.entries(minutes).map(([appid, m]) => ({
        appid: Number(appid),
        name: `Игра ${appid}`,
        playtimeForever: m,
        playtime2Weeks: 0,
      }))

    test('пишущей — свои соседи в порядке соседей, с наигранным, не больше трёх', async () => {
      await neighbors()
      const me = await signInAs(db, 'openid')
      await saveLibrarySnapshot(db, me, libWith({ 1006: 0, 1004: 180, 1002: 0, 1001: 25, 730: 600 }), nowSec())
      const res = await askNear(1000)
      expect(await res.json()).toEqual({
        owned: false,
        near: [
          { appid: 1001, name: 'Игра 1001', minutes: 25 },
          { appid: 1002, name: 'Игра 1002', minutes: 0 },
          { appid: 1004, name: 'Игра 1004', minutes: 180 },
        ],
      })
      expect(NEAR_SHOWN).toBe(3)
      // «нет» остаётся «нет»: прежние пять минут и Vary
      expect(res.headers.get('cache-control')).toBe('private, max-age=300')
      expect(res.headers.get('vary')).toBe('Cookie')
    })

    test('без near=1 ответ прежний: другие вызывающие соседей не просили', async () => {
      await neighbors()
      const me = await signInAs(db, 'openid')
      await saveLibrarySnapshot(db, me, libWith({ 1001: 25 }), nowSec())
      expect(await (await ask(1000)).json()).toEqual({ owned: false })
    })

    test('забаненное и пройденное — мимо: бан — «не предлагать», пройденное — не замена покупке', async () => {
      await neighbors()
      const me = await signInAs(db, 'openid')
      await saveLibrarySnapshot(db, me, libWith({ 1001: 0, 1002: 0, 1003: 40 }), nowSec())
      await logFeedback(db, { steamid: me, appid: 1001, action: 'banned' }, nowSec() - 60)
      await logFeedback(db, { steamid: me, appid: 1002, action: 'banned', reason: 'done' }, nowSec() - 60)
      expect(await (await askNear(1000)).json()).toEqual({
        owned: false,
        near: [{ appid: 1003, name: 'Игра 1003', minutes: 40 }],
      })
    })

    test('своя игра — без near: брать ли её, вопрос не стоит', async () => {
      await neighbors()
      const me = await signInAs(db, 'openid')
      await saveLibrarySnapshot(db, me, libWith({ 1000: 10, 1001: 0 }), nowSec())
      expect(await (await askNear(1000)).json()).toEqual({ owned: true })
    })

    test.each(['claimed', 'demo'] as const)('%s — без near: «у тебя» было бы не про смотрящего', async (kind) => {
      await neighbors()
      const me = await signInAs(db, kind)
      await saveLibrarySnapshot(db, me, libWith({ 1001: 0, 1002: 30 }), nowSec())
      expect(await (await askNear(1000)).json()).toEqual({ owned: false })
    })

    test('гостю — ничего', async () => {
      await neighbors()
      signOut()
      expect(await (await askNear(1000)).json()).toEqual({ owned: false })
    })

    test('время скрыто настройками Steam — без минут, а не «не запускал»', async () => {
      await neighbors()
      const me = await signInAs(db, 'openid')
      // десять игр и ни одной минуты — признак lib/playtime
      const zeros = Object.fromEntries([1001, 1003, ...Array.from({ length: 8 }, (_, i) => 2000 + i)].map((id) => [id, 0]))
      await saveLibrarySnapshot(db, me, libWith(zeros), nowSec())
      expect(await (await askNear(1000)).json()).toEqual({
        owned: false,
        near: [
          { appid: 1001, name: 'Игра 1001', minutes: null },
          { appid: 1003, name: 'Игра 1003', minutes: null },
        ],
      })
    })

    test('ни одного своего среди соседей — поля нет вовсе', async () => {
      await neighbors()
      const me = await signInAs(db, 'openid')
      await saveLibrarySnapshot(db, me, libWith({ 730: 60 }), nowSec())
      expect(await (await askNear(1000)).json()).toEqual({ owned: false })
    })
  })

  test('чужая библиотека ответа не меняет', async () => {
    await saveLibrarySnapshot(db, '76561197960287999', lib(730), nowSec())
    await signInAs(db, 'openid')
    expect(await owned(730)).toBe(false)
  })
})
