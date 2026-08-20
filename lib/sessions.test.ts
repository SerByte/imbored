import { beforeEach, describe, expect, test } from 'vitest'
import type { SessionRow } from './db'
import { signSession, signSessionV2, verifySessionV2 } from './session'
import {
  SESSION_TOUCH_AFTER_SEC,
  SESSION_TTL_SEC,
  deviceLabel,
  forgetSessionCache,
  mintSession,
  renewToken,
  resolveSession,
} from './sessions'

const SECRET = 'secret'
const STEAMID = '76561197960287930'
const NOW = 1_700_000_000

const live: SessionRow = { revokedAt: null, sessionsFrom: null, verified: false }
const lookupLive = async () => live
const lookupThrows = async () => {
  throw new Error('turso прилегла')
}

/** Свежая кука «выданная в момент iat» */
function tokenAt(iat: number, sid = 'a'.repeat(32)): string {
  return signSessionV2({ sid, steamid: STEAMID, iat, exp: iat + SESSION_TTL_SEC }, SECRET)
}

beforeEach(() => {
  // кэш живёт на процесс, между тестами его надо ронять
  forgetSessionCache()
})

describe('resolveSession', () => {
  test('свежая кука пускает и продлевать не просит', async () => {
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW,
      lookup: lookupLive,
    })
    expect(r).toEqual({ steamid: STEAMID, sid: 'a'.repeat(32), stale: false, verified: false })
  })

  test('через неделю с лишним просит продлить', async () => {
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW + SESSION_TOUCH_AFTER_SEC + 1,
      lookup: lookupLive,
    })
    expect(r?.stale).toBe(true)
  })

  test('ровно на пороге ещё молчит: продление не должно срабатывать каждый визит', async () => {
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW + SESSION_TOUCH_AFTER_SEC,
      lookup: lookupLive,
    })
    expect(r?.stale).toBe(false)
  })

  test('истёкший токен — гость, и база для этого не нужна', async () => {
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW + SESSION_TTL_SEC + 1,
      lookup: lookupThrows,
    })
    expect(r).toBeNull()
  })

  test('нет куки и мусор вместо куки — гость', async () => {
    for (const token of [undefined, '', 'garbage', `${'a'.repeat(32)}.deadbeef`]) {
      expect(await resolveSession({ token, secret: SECRET, nowSec: NOW, lookup: lookupLive })).toBeNull()
    }
  })

  test('чужой секрет не пускает', async () => {
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: 'other',
      nowSec: NOW,
      lookup: lookupLive,
    })
    expect(r).toBeNull()
  })

  test('отозванная сессия не пускает', async () => {
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW,
      lookup: async () => ({ revokedAt: NOW - 1, sessionsFrom: null, verified: false }),
    })
    expect(r).toBeNull()
  })

  /* Ради этого и написана вся конструкция: см. комментарий у таблицы sessions */
  test('СТРОКИ НЕТ — сессия жива: пересозданная база не разлогинивает', async () => {
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW,
      lookup: async () => ({ revokedAt: null, sessionsFrom: null, verified: false }),
    })
    expect(r?.steamid).toBe(STEAMID)
  })

  test('база упала — вход остаётся в силе (fail-open)', async () => {
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW,
      lookup: lookupThrows,
    })
    expect(r?.steamid).toBe(STEAMID)
  })

  test('«выйти везде» гасит токены, выданные до отсечки, и не трогает выданные после', async () => {
    const lookup = async () => ({ revokedAt: null, sessionsFrom: NOW, verified: false })
    const before = await resolveSession({ token: tokenAt(NOW - 1), secret: SECRET, nowSec: NOW, lookup })
    expect(before).toBeNull()

    forgetSessionCache()
    const after = await resolveSession({
      token: tokenAt(NOW + 1, 'b'.repeat(32)),
      secret: SECRET,
      nowSec: NOW,
      lookup,
    })
    expect(after?.steamid).toBe(STEAMID)
  })

  test('«выйти везде» достаёт и сессию, чьей строки нет вовсе', async () => {
    // revokedAt null (строки сессии нет), но отсечка у пользователя стоит
    const r = await resolveSession({
      token: tokenAt(NOW - 1),
      secret: SECRET,
      nowSec: NOW,
      lookup: async () => ({ revokedAt: null, sessionsFrom: NOW, verified: false }),
    })
    expect(r).toBeNull()
  })

  test('признак подтверждения приезжает из строки сессии, а не из токена', async () => {
    // Формат токена не трогали: он строго пятиполевой, и добавлять туда поле
    // значило бы v3 со всей миграцией. Происхождение живёт в базе.
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW,
      lookup: async () => ({ revokedAt: null, sessionsFrom: null, verified: true }),
    })
    expect(r?.verified).toBe(true)
  })

  test('без строки в базе сессия считается НЕподтверждённой', async () => {
    // Сессия переживает недоступную Turso (см. issueSession), и тогда о её
    // происхождении неизвестно ничего. Наименьшие права: не подтверждена.
    const r = await resolveSession({
      token: tokenAt(NOW),
      secret: SECRET,
      nowSec: NOW,
      lookup: async () => {
        throw new Error('Turso недоступна')
      },
    })
    expect(r?.steamid).toBe(STEAMID)
    expect(r?.verified).toBe(false)
  })

  test('легаси-кука пускает и помечается на апгрейд', async () => {
    const r = await resolveSession({
      token: signSession(STEAMID, SECRET),
      secret: SECRET,
      nowSec: NOW,
      lookup: lookupLive,
    })
    expect(r).toEqual({ steamid: STEAMID, sid: null, stale: true, verified: false })
  })

  test('«выйти везде» достаёт и легаси-куку, у которой нет ни sid, ни времени выдачи', async () => {
    const r = await resolveSession({
      token: signSession(STEAMID, SECRET),
      secret: SECRET,
      nowSec: NOW,
      lookup: async () => ({ revokedAt: null, sessionsFrom: NOW, verified: false }),
    })
    expect(r).toBeNull()
  })

  test('база не опрашивается, пока жив кэш, и опрашивается снова после', async () => {
    let calls = 0
    const lookup = async () => {
      calls += 1
      return live
    }
    const token = tokenAt(NOW)
    await resolveSession({ token, secret: SECRET, nowSec: NOW, lookup })
    await resolveSession({ token, secret: SECRET, nowSec: NOW + 1, lookup })
    expect(calls).toBe(1)
    await resolveSession({ token, secret: SECRET, nowSec: NOW + 61, lookup })
    expect(calls).toBe(2)
  })

  test('ошибка базы не кэшируется: следующий запрос пробует снова', async () => {
    let calls = 0
    const lookup = async () => {
      calls += 1
      if (calls === 1) throw new Error('икота')
      return { revokedAt: NOW, sessionsFrom: null, verified: false }
    }
    const token = tokenAt(NOW)
    expect((await resolveSession({ token, secret: SECRET, nowSec: NOW, lookup }))?.steamid).toBe(STEAMID)
    // отзыв доезжает сразу же, а не через минуту слепоты
    expect(await resolveSession({ token, secret: SECRET, nowSec: NOW, lookup })).toBeNull()
  })
})

describe('выдача и продление', () => {
  test('mintSession даёт год и разные sid', async () => {
    const a = mintSession(STEAMID, SECRET, NOW)
    const b = mintSession(STEAMID, SECRET, NOW)
    expect(a.sid).not.toBe(b.sid)
    expect(verifySessionV2(a.token, SECRET)).toEqual({
      sid: a.sid,
      steamid: STEAMID,
      iat: NOW,
      exp: NOW + SESSION_TTL_SEC,
    })
  })

  test('renewToken сохраняет sid и сдвигает срок', () => {
    const { sid } = mintSession(STEAMID, SECRET, NOW)
    const later = NOW + SESSION_TOUCH_AFTER_SEC + 10
    const t = verifySessionV2(renewToken(sid, STEAMID, SECRET, later), SECRET)
    expect(t?.sid).toBe(sid)
    expect(t?.exp).toBe(later + SESSION_TTL_SEC)
  })

  test('продлённая кука снова свежая', async () => {
    const { sid } = mintSession(STEAMID, SECRET, NOW)
    const later = NOW + SESSION_TOUCH_AFTER_SEC + 10
    const r = await resolveSession({
      token: renewToken(sid, STEAMID, SECRET, later),
      secret: SECRET,
      nowSec: later,
      lookup: lookupLive,
    })
    expect(r?.stale).toBe(false)
  })
})

describe('deviceLabel', () => {
  test('узнаёт частые связки', () => {
    expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Version/17.0 Safari/604.1')).toBe(
      'Safari, iOS',
    )
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64) Chrome/120.0 Safari/537.36')).toBe(
      'Chrome, Windows',
    )
    // Edg содержит Chrome, Chrome содержит Safari — порядок проверок важен
    expect(deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537.36 Edg/120')).toBe(
      'Edge, Windows',
    )
  })

  test('пустое и неизвестное не притворяются знанием', () => {
    expect(deviceLabel(null)).toBeNull()
    expect(deviceLabel('')).toBeNull()
    expect(deviceLabel('curl/8.0')).toBeNull()
  })
})
