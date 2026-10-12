import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { signOutReply } from './signoutreply'

/**
 * Ответ на выход (lib/signoutreply) — как его читает components/SignOut.
 *
 * «Да, везде» жмут, когда доступ мог утечь, и подтверждение обещает, что
 * погаснут все входы и ссылка на RSS. Сервер честно говорит, когда сделал
 * меньше: база не записала отзыв (revoked: false) или сессию не удалось
 * признать подтверждённой и погашено одно это устройство (scope:
 * 'this-device'). Кнопка раньше ответа не читала — уводила на главную, как
 * после удачи, а чужие сессии и ссылка жили дальше.
 */

const reply = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

describe('signOutReply', () => {
  test('выход сделан — done, и обычный, и «везде»', async () => {
    expect(await signOutReply(false, reply(200, { ok: true }))).toBe('done')
    expect(await signOutReply(true, reply(200, { ok: true }))).toBe('done')
  })

  test('«везде», а база отзыв не записала — partial: здесь вышел, остальные нет', async () => {
    expect(await signOutReply(true, reply(200, { ok: true, revoked: false }))).toBe('partial')
  })

  test('«везде», а погашено одно это устройство — partial', async () => {
    const body = { ok: true, scope: 'this-device', reason: 'Выход на всех устройствах доступен после входа через Steam.' }
    expect(await signOutReply(true, reply(200, body))).toBe('partial')
  })

  /*
   * Обычный выход гасит куку, и этого достаточно: строка сессии без отзыва
   * никому не служит — токена больше нет ни в одном браузере. Говорить
   * человеку «не вышло» здесь значило бы соврать в другую сторону.
   */
  test('обычный выход без записи отзыва — всё равно done: кука погашена', async () => {
    expect(await signOutReply(false, reply(200, { ok: true, revoked: false }))).toBe('done')
  })

  /*
   * Не ответ роута — сбой платформы, обрыв, чужая страница. Погашена ли кука,
   * неизвестно; уходить с экрана, как после выхода, нечестно — та же логика,
   * что у оборванного запроса в SignOut.
   */
  test('сбой или не ответ роута — failed', async () => {
    for (const [status, body] of [
      [500, { ok: true }],
      [502, 'Bad Gateway'],
      [200, 'не json'],
      [200, { error: 'что-то другое' }],
      [200, null],
    ] as const) {
      for (const all of [false, true]) {
        expect(await signOutReply(all, reply(status, body)), `${all} ${status} ${JSON.stringify(body)}`).toBe('failed')
      }
    }
  })
})

/*
 * Кликов здесь не нажать — DOM в прогоне нет, — поэтому проводка кнопки
 * сверяется по исходнику: ответ читается этим разбором, а уход на главную
 * стоит после веток failed и partial, и обе кончаются return. Без этого
 * разбор был бы зелёным, а кнопка по-прежнему уводила бы, как после удачи.
 */
describe('SignOut: ответ выхода решает, уходить ли с экрана', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'SignOut.tsx'), 'utf8')

  test('ответ читается разбором, failed и partial возвращаются до ухода на главную', () => {
    expect(src).toMatch(/reply = await signOutReply\(all, await fetch\(/)
    const away = src.indexOf("router.replace('/')")
    expect(away).toBeGreaterThan(-1)
    for (const branch of ["if (reply === 'failed') {", "if (reply === 'partial') {"]) {
      const at = src.indexOf(branch)
      expect(at, branch).toBeGreaterThan(-1)
      expect(at, branch).toBeLessThan(away)
      // ветка кончается return раньше, чем начнётся следующая или уход
      const body = src.slice(at, away)
      expect(body.slice(0, body.indexOf('\n    }\n')), branch).toMatch(/\n\s*return\s*$/)
    }
  })

  test('partial говорит про RSS, когда ссылка есть, и ведёт ко входу, а не на главную', () => {
    const at = src.indexOf("if (reply === 'partial') {")
    const branch = src.slice(at, src.indexOf("router.replace('/')"))
    expect(branch).toContain("{feedLink ? ' — и ссылка на RSS ещё работает' : ''}")
    expect(branch).toContain("href={steamLoginFor('/library')}")
    expect(branch).not.toContain('router.')
  })
})
