import { describe, expect, test } from 'vitest'
import { passChain } from './chain'

const ОТВЕТ = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response

describe('передача звена цепочки', () => {
  test('принятое звено не даёт причины и не повторяется', async () => {
    let звонков = 0
    const итог = await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        return ОТВЕТ(202)
      },
    })
    expect(итог).toEqual({ ok: true })
    expect(звонков).toBe(1)
  })

  test('не-2xx у ребёнка перестал быть невидимым', async () => {
    // Ровно это и глотал прежний .catch(() => {}): 401 или 500 у ребёнка
    // выглядели так же, как успех, и цепочка умирала молча.
    const итог = await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => ОТВЕТ(401),
    })
    expect(итог).toEqual({ ok: false, reason: 'HTTP 401', childMayRun: false })
  })

  test('на ответе повторяем один раз: он доказывает, что работы ребёнок не начал', async () => {
    let звонков = 0
    await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        return ОТВЕТ(500)
      },
    })
    expect(звонков).toBe(2)
  })

  test('моргнувший ответ лечится повтором', async () => {
    let звонков = 0
    const итог = await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        return ОТВЕТ(звонков === 1 ? 503 : 202)
      },
    })
    expect(итог).toEqual({ ok: true })
    expect(звонков).toBe(2)
  })

  test('ОТКАЗ СЕТИ НЕ ПОВТОРЯЕТСЯ: запрос мог дойти', async () => {
    // Повтор поднял бы вторую цепочку, а аренда реентерабельна по holder —
    // два среза пошли бы к Steam разом, вдвое превысив его лимит.
    let звонков = 0
    const итог = await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        throw new Error('ECONNRESET')
      },
    })
    expect(звонков).toBe(1)
    expect(итог).toEqual({ ok: false, reason: 'ECONNRESET', childMayRun: true })
  })

  test('при отказе сети вызывающему запрещено отдавать аренду', async () => {
    const итог = await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => {
        throw new Error('fetch failed: getaddrinfo ENOTFOUND')
      },
    })
    expect(итог.ok).toBe(false)
    if (!итог.ok) {
      expect(итог.childMayRun).toBe(true)
      expect(итог.reason).toContain('ENOTFOUND')
    }
  })

  test('исключение наружу не выходит ни при каком раскладе', async () => {
    // Обрыв цепочки не имеет права уронить уже сделанную работу среза.
    await expect(
      passChain('http://x/next', 's', { delayMs: 0, fetchFn: async () => { throw 'строка, не Error' } }),
    ).resolves.toMatchObject({ ok: false })
  })
})
