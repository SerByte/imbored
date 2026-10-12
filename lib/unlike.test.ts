import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { LIKE_ROWS_KEY } from './planforget'
import { inTurn, sendLike, sendUnlike, undoLike, unlikeMiss, type Heart } from './unlike'
import { writerStore } from './writer'

/**
 * «Зашло» снимается тем же нажатием (lib/unlike). Сеть — подменённый fetch:
 * проверяется порядок записей одной игры и то, что страница видит в ответ.
 */

/** Промис, который тест отпускает сам — «запрос ещё едет» */
function gate<T>() {
  let open!: (v: T) => void
  const p = new Promise<T>((r) => {
    open = r
  })
  return { p, open }
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>>
let appid = 1000

beforeEach(() => {
  fetchMock = vi.fn(async () => json(200, { ok: true }))
  vi.stubGlobal('fetch', fetchMock)
  writerStore.set(null)
  // Очередь живёт в модуле на всю вкладку — каждый тест берёт свою игру
  appid += 1
})

afterEach(() => {
  vi.unstubAllGlobals()
  // Строки сердца живут в sessionStorage, а у node он настоящий и общий на
  // процесс: тест не оставляет их следующему
  sessionStorage.removeItem(LIKE_ROWS_KEY)
})

/**
 * Нажатие сердца, которое легло строкой row: его снятию есть что снять.
 * Ответ /api/feedback — тем же видом, что у роута («Зашло» отдаёт строку).
 */
async function tapped(row: number | null = 77, heart: Heart = 'play', id = appid) {
  fetchMock.mockResolvedValueOnce(json(200, { ok: true, row }))
  await sendLike(heart, id, { ctx: { source: heart } })
}

/** Тела запросов к этому адресу, по порядку */
const bodies = (url: string) =>
  fetchMock.mock.calls.filter(([u]) => u === url).map(([, init]) => JSON.parse(String(init?.body)) as unknown)

describe('inTurn: записи одной игры — в порядке нажатий', () => {
  test('снятие ждёт «Зашло», которое ещё едет: DELETE не обгоняет INSERT', async () => {
    const like = gate<boolean>()
    const order: string[] = []
    void inTurn(appid, () => {
      order.push('like:start')
      return like.p.then((ok) => {
        order.push('like:done')
        return ok
      })
    })
    const undone = sendUnlike(appid)
    await new Promise((r) => setTimeout(r, 0))
    // «Зашло» ещё в пути — /api/unlike не ушёл
    expect(fetchMock).not.toHaveBeenCalled()
    like.open(true)
    expect(await undone).toBe('ok')
    expect(order).toEqual(['like:start', 'like:done'])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/unlike')
    expect(JSON.parse(String(init?.body))).toEqual({ appid })
  })

  test('«Зашло» сразу после снятия ждёт его: новый INSERT не стирается запоздалым DELETE', async () => {
    const unlike = gate<Response>()
    fetchMock.mockImplementationOnce(() => unlike.p)
    const undone = sendUnlike(appid)
    const like = vi.fn(async () => true)
    const liked = inTurn(appid, like)
    await new Promise((r) => setTimeout(r, 0))
    expect(like).not.toHaveBeenCalled()
    unlike.open(json(200, { ok: true }))
    await undone
    expect(await liked).toBe(true)
    expect(like).toHaveBeenCalledTimes(1)
  })

  test('разные игры друг друга не ждут', async () => {
    const slow = gate<boolean>()
    void inTurn(appid, () => slow.p)
    expect(await sendUnlike(appid + 500)).toBe('ok')
    slow.open(true)
  })

  test('сорвавшаяся запись не стопорит очередь', async () => {
    await inTurn(appid, () => Promise.reject(new Error('сеть'))).catch(() => null)
    expect(await sendUnlike(appid)).toBe('ok')
  })
})

describe('sendUnlike: что видит страница', () => {
  test('needsteam — не «нажми ещё раз», а режим чтения на всю страницу', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'needsteam' }))
    expect(await sendUnlike(appid)).toBe('needsteam')
    expect(writerStore.get()).toBe(false)
  })

  test('пятисотка и обрыв сети — fail, промис не отклоняется', async () => {
    fetchMock.mockResolvedValueOnce(json(500, { error: 'x' }))
    expect(await sendUnlike(appid)).toBe('fail')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await sendUnlike(appid)).toBe('fail')
    // Чужой 403 — не needsteam: права сессии он не меняет
    fetchMock.mockResolvedValueOnce(json(403, { error: 'private' }))
    expect(await sendUnlike(appid)).toBe('fail')
    expect(writerStore.get()).toBe(null)
  })
})

describe('undoLike: второе нажатие «Зашло» у героя', () => {
  /** Состояние страницы: множество «зашло» и строка отказа под героем */
  function page(initial: number[]) {
    let liked = new Set(initial)
    const said: Array<string | null> = []
    return {
      setLiked: (update: (prev: Set<number>) => Set<number>) => {
        liked = update(liked)
      },
      say: (line: string | null) => said.push(line),
      liked: () => liked,
      said,
    }
  }

  test('кнопка гаснет сразу, до ответа сервера; удача — без строки', async () => {
    await tapped()
    const reply = gate<Response>()
    fetchMock.mockImplementationOnce(() => reply.p)
    const p = page([appid, 7])
    const done = undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    expect(p.liked().has(appid)).toBe(false)
    expect(p.liked().has(7)).toBe(true)
    reply.open(json(200, { ok: true }))
    await done
    expect(p.liked().has(appid)).toBe(false)
    // Только сброс прежнего отказа — нового нет
    expect(p.said).toEqual([null])
  })

  test('сбой возвращает «Зашло» и говорит, с какой игры не снялось', async () => {
    await tapped()
    fetchMock.mockResolvedValueOnce(json(500, {}))
    const p = page([appid])
    await undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    expect(p.liked().has(appid)).toBe(true)
    expect(p.said).toEqual([null, unlikeMiss('Hades')])
    expect(unlikeMiss('Hades')).toBe('Не вышло снять «Зашло» с «Hades» — нажми ещё раз.')
  })

  test('needsteam возвращает «Зашло» молча: на сервере оно осталось, а кнопку прячет режим чтения', async () => {
    await tapped()
    fetchMock.mockResolvedValueOnce(json(403, { error: 'needsteam' }))
    const p = page([appid])
    await undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    expect(p.liked().has(appid)).toBe(true)
    expect(p.said).toEqual([null])
    expect(writerStore.get()).toBe(false)
  })

  /*
   * Снятие ещё едет, а сердце нажали снова: оно зажглось, и «Зашло» встало
   * в очередь за снятием. Сбой снятия тогда не откатывает и не говорит —
   * последним скажет вставка, а «нажми ещё раз» под горящим сердцем звало
   * бы снять только что поставленное.
   */
  test('сбой снятия, за которым уже встало новое «Зашло», молчит и сердце не трогает', async () => {
    await tapped()
    const reply = gate<Response>()
    fetchMock.mockImplementationOnce(() => reply.p)
    const p = page([appid])
    const done = undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    expect(p.liked().has(appid)).toBe(false)
    // Второе нажатие: страница зажигает сердце и ставит «Зашло» в очередь игры
    p.setLiked((prev) => new Set(prev).add(appid))
    const like = vi.fn(async () => true)
    const liked = inTurn(appid, like)
    reply.open(json(500, {}))
    await done
    expect(p.said).toEqual([null])
    expect(p.liked().has(appid)).toBe(true)
    // Вставка ушла следом за снятием — как и обещала очередь
    expect(await liked).toBe(true)
    expect(like).toHaveBeenCalledTimes(1)
  })

  test('снял, зажёг и снова снял: сбой первого снятия не зажигает погашенное последним', async () => {
    await tapped()
    const first = gate<Response>()
    fetchMock.mockImplementationOnce(() => first.p)
    const p = page([appid])
    const undone = undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    p.setLiked((prev) => new Set(prev).add(appid))
    // второе «Зашло» ляжет своей строкой — её и снимет второе снятие
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, row: 78 }))
    void sendLike('play', appid, { ctx: { source: 'play' } })
    const again = undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    expect(p.liked().has(appid)).toBe(false)
    first.open(json(500, {}))
    await undone
    await again
    expect(p.liked().has(appid)).toBe(false)
    expect(p.said).toEqual([null, null])
    expect(bodies('/api/unlike')).toEqual([
      { appid, row: 77 },
      { appid, row: 78 },
    ])
  })

  test('повтор того же отказа звучит: строка гаснет до запроса', async () => {
    await tapped()
    const reply = gate<Response>()
    fetchMock.mockImplementationOnce(() => reply.p)
    const p = page([appid])
    p.say(unlikeMiss('Hades'))
    const done = undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    // Сброс ушёл синхронно — до того, как ответ вообще пришёл
    expect(p.said.at(-1)).toBe(null)
    reply.open(json(500, {}))
    await done
    expect(p.said.at(-1)).toBe(unlikeMiss('Hades'))
  })
})

/*
 * Сердце героя /play и /daily — состояние экрана, а не сервера: оно гаснет с
 * каждой выдачей, и игра, которой «Зашло» сказали на прошлой неделе, приходит
 * героем с пустым сердцем. Нажал по ошибке и снял — на сервере обязано
 * остаться то, что было до двух нажатий. Поэтому снятие у героя несёт строку,
 * которую легло его «Зашло», и ничего не шлёт, если не легло ничего. Полка
 * /library — другое дело: она показывает то, что помнит сервер, и снимает всё.
 */
describe('снятие у героя — только строка своего нажатия', () => {
  /** Состояние страницы — как в undoLike выше, без строки отказа */
  function heart(initial: number[]) {
    let liked = new Set(initial)
    return {
      setLiked: (update: (prev: Set<number>) => Set<number>) => {
        liked = update(liked)
      },
      liked: () => liked,
    }
  }
  const undo = (h: Heart, p: ReturnType<typeof heart>, id = appid) =>
    undoLike(h, { appid: id, name: 'Hades' }, p.setLiked, () => {})

  test('«Зашло» уходит в /api/feedback, снятие несёт его строку', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true, row: 77 }))
    await sendLike('play', appid, { mood: { time: 'medium', vibe: 'chill', social: 'solo' }, ctx: { source: 'play' } })
    expect(bodies('/api/feedback')).toEqual([
      { appid, action: 'liked', mood: { time: 'medium', vibe: 'chill', social: 'solo' }, ctx: { source: 'play' } },
    ])
    const p = heart([appid])
    await undo('play', p)
    expect(bodies('/api/unlike')).toEqual([{ appid, row: 77 }])
    expect(p.liked().has(appid)).toBe(false)
  })

  test('снятие, нажатое пока «Зашло» ещё едет, ждёт его строку', async () => {
    const reply = gate<Response>()
    fetchMock.mockImplementationOnce(() => reply.p)
    void sendLike('daily', appid, { ctx: { source: 'daily' } })
    const done = undo('daily', heart([appid]))
    await new Promise((r) => setTimeout(r, 0))
    expect(bodies('/api/unlike')).toEqual([])
    reply.open(json(200, { ok: true, row: 91 }))
    await done
    expect(bodies('/api/unlike')).toEqual([{ appid, row: 91 }])
  })

  /*
   * «Зашло» час назад — и нажатие ничего не вставило: суточный дедуп
   * (lib/db). Снимать сердцу нечего — прежнее «зашло» остаётся, как было до
   * нажатий; сердце гаснет без запроса.
   */
  test('нажатие, проглоченное дедупом, снимать нечего: запроса нет, сердце гаснет', async () => {
    await tapped(null)
    const p = heart([appid])
    await undo('play', p)
    expect(bodies('/api/unlike')).toEqual([])
    expect(p.liked().has(appid)).toBe(false)
  })

  test('сбой и needsteam у «Зашло» — строки нет, снятию снимать нечего', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await sendLike('play', appid, { ctx: { source: 'play' } })
    await undo('play', heart([appid]))

    fetchMock.mockResolvedValueOnce(json(403, { error: 'needsteam' }))
    await sendLike('play', appid + 1, { ctx: { source: 'play' } })
    expect(writerStore.get()).toBe(false)
    writerStore.set(null)
    await undo('play', heart([appid + 1]), appid + 1)

    expect(bodies('/api/unlike')).toEqual([])
  })

  test('сессия только читает — «Зашло» не уходит вовсе', async () => {
    writerStore.set(false)
    await sendLike('play', appid, { ctx: { source: 'play' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  /*
   * «Зашло» у героя /play, потом то же у /daily: второе дедуп проглотит. У
   * /daily снимать нечего, а горящее сердце /play (выдачу помнит вкладка)
   * снимает своё — общая память на игру отдала бы ему пустоту /daily.
   */
  test('сердца /play и /daily помнят свои строки порознь', async () => {
    await tapped(77, 'play')
    await tapped(null, 'daily')
    await undo('daily', heart([appid]))
    expect(bodies('/api/unlike')).toEqual([])
    await undo('play', heart([appid]))
    expect(bodies('/api/unlike')).toEqual([{ appid, row: 77 }])
  })

  test('неудачное снятие строку помнит, удачное — забывает', async () => {
    await tapped(77)
    fetchMock.mockResolvedValueOnce(json(500, {}))
    const p = heart([appid])
    await undo('play', p)
    expect(p.liked().has(appid)).toBe(true)
    // «нажми ещё раз» — та же строка
    await undo('play', p)
    expect(p.liked().has(appid)).toBe(false)
    // снята — и третье снятие (сердце зажгли бы только новым «Зашло») пусто
    await undo('play', heart([appid]))
    expect(bodies('/api/unlike')).toEqual([
      { appid, row: 77 },
      { appid, row: 77 },
    ])
  })

  test('полка снимает всё «зашло» игры — без строки, даже когда сердце помнит свою', async () => {
    await tapped(77)
    expect(await sendUnlike(appid)).toBe('ok')
    expect(bodies('/api/unlike')).toEqual([{ appid }])
  })

  test('помнится полсотни последних: старшие уходят первыми', async () => {
    const first = appid
    for (let i = 0; i < 51; i++) await tapped(100 + i, 'play', first + 10_000 + i)
    await undo('play', heart([first + 10_000]), first + 10_000)
    await undo('play', heart([first + 10_001]), first + 10_001)
    expect(bodies('/api/unlike')).toEqual([{ appid: first + 10_001, row: 101 }])
  })
})

/*
 * Сердце /play переживает перезагрузку вкладки вместе с выдачей
 * (lib/playcache, sessionStorage): телефон выгрузил вкладку, пока открыт
 * Steam, — и снять его после неё надо той же строкой. Перезагрузка здесь —
 * свежий модуль при том же хранилище.
 */
describe('строки сердца — в хранилище вкладки', () => {
  function fakeStorage(seed: Record<string, string> = {}) {
    const data: Record<string, string> = { ...seed }
    return {
      data,
      area: {
        getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
        setItem: (k: string, v: string) => {
          data[k] = v
        },
        removeItem: (k: string) => {
          delete data[k]
        },
      },
    }
  }
  const page = () => ({ setLiked: () => {}, say: () => {} })

  test('после перезагрузки снятие знает строку своего нажатия', async () => {
    const session = fakeStorage()
    vi.stubGlobal('sessionStorage', session.area)
    await tapped(77)
    expect(JSON.parse(session.data[LIKE_ROWS_KEY])).toEqual({ [`play:${appid}`]: 77 })

    vi.resetModules()
    const fresh = await import('./unlike')
    const p = page()
    await fresh.undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    expect(bodies('/api/unlike')).toEqual([{ appid, row: 77 }])
    expect(JSON.parse(session.data[LIKE_ROWS_KEY])).toEqual({})
  })

  test('чужое в хранилище — мимо: не id строки снимать не зовёт', async () => {
    vi.stubGlobal(
      'sessionStorage',
      fakeStorage({ [LIKE_ROWS_KEY]: JSON.stringify({ [`play:${appid}`]: 'всё', [`daily:${appid}`]: -1 }) }).area,
    )
    const p = page()
    await undoLike('play', { appid, name: 'Hades' }, p.setLiked, p.say)
    await undoLike('daily', { appid, name: 'Hades' }, p.setLiked, p.say)
    expect(bodies('/api/unlike')).toEqual([])
  })
})
