import { describe, expect, test } from 'vitest'
import { forgetMissLine, forgetPreviewReply, forgetReply } from './forgetreply'

/**
 * Ответы /api/forget глазами кнопки «Удалить всё обо мне». Главное здесь —
 * что «всё удалено» звучит только по ответу самого роута: человек, ушедший с
 * экрана с этими словами после обрыва, считал бы себя забытым.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('forgetReply: удаление', () => {
  /*
   * Ответ не роута — прокси, портал Wi-Fi, тайм-аут функции — раньше
   * считался failed и звучал «Не получилось удалить», хотя пачка удаления
   * могла уже пройти. Теперь это unknown: неизвестно, дошёл ли запрос.
   */
  test('удалено — только { ok: true } от роута; другой ответ 200 — неизвестно что', async () => {
    expect(await forgetReply(json({ ok: true }))).toBe('done')
    expect(await forgetReply(json({}))).toBe('unknown')
    expect(await forgetReply(new Response('<html>ok</html>', { status: 200 }))).toBe('unknown')
  })

  test('отказы роута названы своими словами: его 503 и 400 — failed, не удалено ничего', async () => {
    expect(await forgetReply(json({ error: 'needsteam' }, 403))).toBe('needsteam')
    expect(await forgetReply(json({ error: 'ratelimited' }, 429))).toBe('ratelimited')
    expect(await forgetReply(json({ error: 'nosession' }, 401))).toBe('gone')
    expect(await forgetReply(json({ error: 'failed' }, 503))).toBe('failed')
    expect(await forgetReply(json({ error: 'badinput' }, 400))).toBe('failed')
  })

  test('отказ без кода роута — не его ответ: прошло ли удаление, неизвестно', async () => {
    // 403 без кода — не наш needsteam: страница платформы, а не «войди через Steam»
    expect(await forgetReply(new Response('Forbidden', { status: 403 }))).toBe('unknown')
    // тайм-аут функции: пачка могла записаться, а ответа роута не было
    expect(await forgetReply(new Response('<html>504</html>', { status: 504 }))).toBe('unknown')
    expect(await forgetReply(json({ message: 'oops' }, 500))).toBe('unknown')
  })
})

/*
 * Ответ на удаление, который не дошёл, раньше звучал «Не получилось удалить
 * — нажми ещё раз», хотя удаление могло пройти. Повтор получал 401 — «Вход
 * уже не действует», — и «удалено» человек не слышал ни разу. Определённое
 * «не получилось» осталось только у отказа самого роута: его пачка атомарна.
 */
describe('forgetMissLine: отказ словами', () => {
  test('обрыв — «неизвестно», а не «не получилось»', () => {
    const line = forgetMissLine('unknown', 'erase', true)
    expect(line).toContain('Не удалось узнать, прошло ли удаление')
    expect(line).not.toContain('Не получилось удалить')
  })

  test('отказ самого роута — определённо не удалено', () => {
    expect(forgetMissLine('failed', 'erase', false)).toBe('Не получилось удалить — нажми ещё раз.')
    expect(forgetMissLine('failed', 'ask', false)).toBe('Не получилось узнать, что хранится, — нажми ещё раз.')
  })

  test('входа нет при удалении — названы обе причины', () => {
    const line = forgetMissLine('gone', 'erase', false)
    expect(line).toContain('удаление уже прошло')
    expect(line).toContain('вышел на всех устройствах')
    expect(line).toContain('Обнови страницу')
  })

  test('входа нет после оборванного удаления — «похоже, уже прошло», и оговоркой', () => {
    for (const step of ['ask', 'erase'] as const) {
      const line = forgetMissLine('gone', step, true)
      expect(line, step).toMatch(/^Похоже, удаление уже прошло/)
      expect(line, step).toContain('Обнови страницу')
    }
  })

  test('входа нет при вопросе — как раньше', () => {
    expect(forgetMissLine('gone', 'ask', false)).toBe('Вход уже не действует — обнови страницу.')
  })

  test('потолок — тем же словом на обоих шагах', () => {
    expect(forgetMissLine('ratelimited', 'erase', true)).toBe(
      'Слишком много попыток с этого адреса — попробуй через час.',
    )
  })
})

/*
 * По-английски — те же различия: «неизвестно» не звучит как «не получилось»,
 * пропавший вход называет обе причины, оборванное удаление — с оговоркой.
 */
describe('forgetMissLine по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/

  test('каждый случай — дословно', () => {
    expect(forgetMissLine('ratelimited', 'erase', true, 'en')).toBe(
      'Too many tries from this address — try again in an hour.',
    )
    expect(forgetMissLine('gone', 'erase', true, 'en')).toBe(
      "Looks like the deletion already went through: the response to your last attempt never arrived, and you're no longer signed in. Reload the page.",
    )
    expect(forgetMissLine('gone', 'erase', false, 'en')).toBe(
      "You're no longer signed in: either the deletion already went through or you signed out everywhere. Reload the page.",
    )
    expect(forgetMissLine('gone', 'ask', false, 'en')).toBe("You're no longer signed in — reload the page.")
    expect(forgetMissLine('unknown', 'erase', false, 'en')).toBe(
      "Couldn't tell whether the deletion went through — try again.",
    )
    expect(forgetMissLine('failed', 'ask', false, 'en')).toBe("Couldn't load what we store — try again.")
    expect(forgetMissLine('failed', 'erase', false, 'en')).toBe("Couldn't delete it — try again.")
  })

  test('обрыв — «неизвестно», а не «не получилось»; оборванное — «looks like» на обоих шагах', () => {
    expect(forgetMissLine('unknown', 'erase', true, 'en')).not.toContain("Couldn't delete")
    for (const step of ['ask', 'erase'] as const) {
      expect(forgetMissLine('gone', step, true, 'en'), step).toMatch(/^Looks like the deletion already went through/)
    }
  })

  test('ни буквы кириллицы', () => {
    for (const miss of ['ratelimited', 'gone', 'failed', 'unknown'] as const) {
      for (const step of ['ask', 'erase'] as const) {
        for (const lost of [true, false]) {
          expect(forgetMissLine(miss, step, lost, 'en')).not.toMatch(CYRILLIC)
        }
      }
    }
  })
})

describe('forgetPreviewReply: что хранится', () => {
  test('списки строк — ok, всё прочее — failed', async () => {
    expect(await forgetPreviewReply(json({ items: ['Снимки библиотеки — 3'], effects: ['Ты выйдешь на всех устройствах.'] }))).toEqual({
      kind: 'ok',
      items: ['Снимки библиотеки — 3'],
      effects: ['Ты выйдешь на всех устройствах.'],
    })
    expect(await forgetPreviewReply(json({ items: [1], effects: [] }))).toEqual({ kind: 'failed' })
    expect(await forgetPreviewReply(json(null))).toEqual({ kind: 'failed' })
  })

  test('отказы — те же коды, что у удаления', async () => {
    expect(await forgetPreviewReply(json({ error: 'needsteam' }, 403))).toEqual({ kind: 'needsteam' })
    expect(await forgetPreviewReply(json({ error: 'ratelimited' }, 429))).toEqual({ kind: 'ratelimited' })
    expect(await forgetPreviewReply(json({ error: 'nosession' }, 401))).toEqual({ kind: 'gone' })
    expect(await forgetPreviewReply(new Response('oops', { status: 502 }))).toEqual({ kind: 'failed' })
  })
})
