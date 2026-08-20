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
    expect(итог).toBeNull()
    expect(звонков).toBe(1)
  })

  test('не-2xx у ребёнка перестал быть невидимым', async () => {
    // Ровно это и глотал прежний .catch(() => {}): 401 или 500 у ребёнка
    // выглядели так же, как успех, и цепочка умирала молча.
    const итог = await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => ОТВЕТ(401),
    })
    expect(итог).toBe('HTTP 401')
  })

  test('одна повторная попытка, и ровно одна', async () => {
    let звонков = 0
    await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        throw new Error('ECONNRESET')
      },
    })
    expect(звонков).toBe(2)
  })

  test('моргнувшая сеть лечится повтором', async () => {
    let звонков = 0
    const итог = await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => {
        звонков++
        if (звонков === 1) throw new Error('ECONNRESET')
        return ОТВЕТ(202)
      },
    })
    expect(итог).toBeNull()
    expect(звонков).toBe(2)
  })

  test('причина сети доезжает до вызывающего, а исключение — нет', async () => {
    // Обрыв цепочки не имеет права уронить уже сделанную работу среза.
    const итог = await passChain('http://x/next', 's', {
      delayMs: 0,
      fetchFn: async () => {
        throw new Error('fetch failed: getaddrinfo ENOTFOUND')
      },
    })
    expect(итог).toContain('ENOTFOUND')
  })
})
