import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { inTurn, sendUnlike, undoLike, unlikeMiss } from './unlike'
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
})

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
    const reply = gate<Response>()
    fetchMock.mockImplementationOnce(() => reply.p)
    const p = page([appid, 7])
    const done = undoLike({ appid, name: 'Hades' }, p.setLiked, p.say)
    expect(p.liked().has(appid)).toBe(false)
    expect(p.liked().has(7)).toBe(true)
    reply.open(json(200, { ok: true }))
    await done
    expect(p.liked().has(appid)).toBe(false)
    // Только сброс прежнего отказа — нового нет
    expect(p.said).toEqual([null])
  })

  test('сбой возвращает «Зашло» и говорит, с какой игры не снялось', async () => {
    fetchMock.mockResolvedValueOnce(json(500, {}))
    const p = page([appid])
    await undoLike({ appid, name: 'Hades' }, p.setLiked, p.say)
    expect(p.liked().has(appid)).toBe(true)
    expect(p.said).toEqual([null, unlikeMiss('Hades')])
    expect(unlikeMiss('Hades')).toBe('Не вышло снять «Зашло» с «Hades» — нажми ещё раз.')
  })

  test('needsteam возвращает «Зашло» молча: на сервере оно осталось, а кнопку прячет режим чтения', async () => {
    fetchMock.mockResolvedValueOnce(json(403, { error: 'needsteam' }))
    const p = page([appid])
    await undoLike({ appid, name: 'Hades' }, p.setLiked, p.say)
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
    const reply = gate<Response>()
    fetchMock.mockImplementationOnce(() => reply.p)
    const p = page([appid])
    const done = undoLike({ appid, name: 'Hades' }, p.setLiked, p.say)
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
    const first = gate<Response>()
    fetchMock.mockImplementationOnce(() => first.p)
    const p = page([appid])
    const undone = undoLike({ appid, name: 'Hades' }, p.setLiked, p.say)
    p.setLiked((prev) => new Set(prev).add(appid))
    void inTurn(appid, async () => true)
    const again = undoLike({ appid, name: 'Hades' }, p.setLiked, p.say)
    expect(p.liked().has(appid)).toBe(false)
    first.open(json(500, {}))
    await undone
    await again
    expect(p.liked().has(appid)).toBe(false)
    expect(p.said).toEqual([null, null])
  })

  test('повтор того же отказа звучит: строка гаснет до запроса', async () => {
    const reply = gate<Response>()
    fetchMock.mockImplementationOnce(() => reply.p)
    const p = page([appid])
    p.say(unlikeMiss('Hades'))
    const done = undoLike({ appid, name: 'Hades' }, p.setLiked, p.say)
    // Сброс ушёл синхронно — до того, как ответ вообще пришёл
    expect(p.said.at(-1)).toBe(null)
    reply.open(json(500, {}))
    await done
    expect(p.said.at(-1)).toBe(unlikeMiss('Hades'))
  })
})
