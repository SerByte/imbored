import { beforeEach, describe, expect, test, vi } from 'vitest'
import { logFeedback, saveLibrarySnapshot, unbanGame, upsertGamesMeta, type Db } from '@/lib/db'
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

  test('чужая библиотека ответа не меняет', async () => {
    await saveLibrarySnapshot(db, '76561197960287999', lib(730), nowSec())
    await signInAs(db, 'openid')
    expect(await owned(730)).toBe(false)
  })
})
