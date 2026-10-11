import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { latestWins } from './latestwins'

/**
 * Очередь ответов «Твоих вечеров». Два POST разом доезжали в любом порядке, и
 * база оставалась на «Зацепило», когда экран уже показывал «Так себе», —
 * перезагрузка возвращала сменённый ответ.
 */

type Sent = 'ok' | 'failed'

/** Запрос, который отвечает, когда скажут: так видно, что ушло и когда */
function server() {
  const sent: string[] = []
  const pending: Array<(r: Sent) => void> = []
  const send = (verdict: string) => () =>
    new Promise<Sent>((resolve) => {
      sent.push(verdict)
      pending.push(resolve)
    })
  /** Ответить на самый старый запрос в пути и дать очереди сделать шаг */
  const reply = async (r: Sent) => {
    pending.shift()!(r)
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  return { sent, send, reply }
}

describe('latestWins', () => {
  test('нажатие в пути не шлётся разом, а уезжает следом — последним', async () => {
    const run = latestWins<Sent>((r) => r === 'ok')
    const s = server()

    const first = run('7:1', s.send('hooked'))
    const second = run('7:1', s.send('meh'))
    // второй ждёт: два запроса разом и есть та гонка
    expect(s.sent).toEqual(['hooked'])
    // встал в очередь — итог скажет тот, кто начал полёт
    expect(await second).toBeNull()

    await s.reply('ok')
    expect(s.sent).toEqual(['hooked', 'meh'])
    await s.reply('ok')
    expect(await first).toBe('ok')
  })

  test('из трёх быстрых нажатий промежуточное не уходит вовсе', async () => {
    const run = latestWins<Sent>((r) => r === 'ok')
    const s = server()

    const first = run('7:1', s.send('hooked'))
    void run('7:1', s.send('meh'))
    void run('7:1', s.send('hooked-again'))

    await s.reply('ok')
    await s.reply('ok')
    expect(await first).toBe('ok')
    expect(s.sent).toEqual(['hooked', 'hooked-again'])
  })

  /**
   * Экран откатывается к принятому сервером и говорит «не вышло». Ждущее
   * нажатие, уехавшее поверх отказа, разошлось бы с этим откатом.
   */
  test('отказ сбрасывает ждущего и отдаётся тому, кто начал полёт', async () => {
    const run = latestWins<Sent>((r) => r === 'ok')
    const s = server()

    const first = run('7:1', s.send('hooked'))
    void run('7:1', s.send('meh'))
    await s.reply('failed')

    expect(await first).toBe('failed')
    expect(s.sent).toEqual(['hooked'])
  })

  test('ждущий, который не доехал, — тоже отказ всей цепочки', async () => {
    const run = latestWins<Sent>((r) => r === 'ok')
    const s = server()

    const first = run('7:1', s.send('hooked'))
    void run('7:1', s.send('meh'))
    await s.reply('ok')
    await s.reply('failed')

    expect(await first).toBe('failed')
  })

  test('разные игры друг друга не ждут, и после ответа ключ свободен', async () => {
    const run = latestWins<Sent>((r) => r === 'ok')
    const s = server()

    const a = run('7:1', s.send('a'))
    const b = run('8:1', s.send('b'))
    expect(s.sent).toEqual(['a', 'b'])
    await s.reply('ok')
    await s.reply('ok')
    expect([await a, await b]).toEqual(['ok', 'ok'])

    const again = run('7:1', s.send('a2'))
    expect(s.sent).toEqual(['a', 'b', 'a2'])
    await s.reply('ok')
    expect(await again).toBe('ok')
  })

  test('«Твои вечера» шлют ответ через очередь, а не fetch прямо из нажатия', () => {
    const code = fs.readFileSync(path.join(__dirname, '..', 'components/Evenings.tsx'), 'utf8')
    expect(code).toContain("from '@/lib/latestwins'")
    const answer = code.slice(code.indexOf('async function answer('))
    expect(answer.slice(0, answer.indexOf('\n  }\n'))).toContain('await send(key, () => post(item, verdict))')
    expect(answer.slice(0, answer.indexOf('\n  }\n'))).not.toContain('fetch(')
  })
})
