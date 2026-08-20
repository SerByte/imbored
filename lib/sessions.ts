/**
 * Политика сессий: сколько живёт вход, когда продлевается и когда его гасят.
 *
 * Главное решение здесь одно, и оно определяет всё остальное: **авторитетом
 * является подпись куки, а база нужна только для обратного действия — отзыва.**
 *
 * Соблазн сделать наоборот («сессия жива, пока есть строка») выглядит строже,
 * но означает, что недоступность Turso, холодный старт с пустой базой или один
 * не записавшийся INSERT разлогинивают всех разом. Мы чиним ровно эту боль,
 * так что усиливать её нельзя. Отсюда fail-open: если база не ответила, вход
 * остаётся в силе, а отзыв просто не доезжает до конца аварии.
 *
 * База данных приходит сюда ФУНКЦИЕЙ, а не клиентом: vitest собирает только
 * lib/, и логику, которая решает «пускать или нет», обязаны покрывать тесты —
 * та же причина, что описана в lib/warmup.ts:8-12.
 */
import type { SessionRow } from './db'
import { newSid, signSessionV2, verifySession, verifySessionV2 } from './session'

/** Год. Браузеры режут куки примерно на 400 сутках, сюда укладываемся. */
export const SESSION_TTL_SEC = 60 * 60 * 24 * 365

/**
 * Порог продления. Кука переставляется, когда токену больше недели.
 *
 * Отсюда честная формулировка гарантии: срок куки в браузере никогда не ближе
 * 365 − 7 = **358 суток** от последнего захода, а не «год скользящий». Разница
 * в неделю всплыла бы через год загадочным баг-репортом.
 */
export const SESSION_TOUCH_AFTER_SEC = 60 * 60 * 24 * 7

/** Насколько отзыв может опоздать: столько живёт кэш состояния на процесс */
export const REVOKE_CACHE_SEC = 60

export type Resolved = {
  steamid: string
  /** null — легаси-кука без идентификатора: гасить нечего, надо апгрейдить */
  sid: string | null
  /** куку пора переставить (или выдать заново в новом формате) */
  stale: boolean
  /**
   * Владение профилем доказано через Steam OpenID.
   *
   * У сессии, выданной по вставленной ссылке (/api/connect), это false — и это
   * не изъян, а сам продукт: библиотека публична, а вход через Steam ради
   * «во что поиграть» — та самая пошлина, от которой сервис и избавляет.
   *
   * Но РАЗРУШИТЕЛЬНОЕ такой сессии не положено. Иначе выходит перевёртыш прав:
   * кука, полученная без доказательства, гасит куки, полученные С
   * доказательством. Ровно это и было возможно: POST /api/connect с чужим
   * steamid, затем POST /api/auth/logout?scope=all — и revokeAllSessions
   * ставит users.sessions_from = now, после чего resolveSession отвергает ВСЕ
   * настоящие токены владельца, потому что у них iat < sessions_from. Два
   * запроса, никаких секретов, достаточно открытого профиля.
   *
   * Неизвестное происхождение считаем неподтверждённым: у легаси-куки признака
   * нет, у сессии без строки в базе (Turso моргнула на выдаче) тоже.
   */
  verified: boolean
}

export type Lookup = (sid: string, steamid: string) => Promise<SessionRow>

const LIVE: SessionRow = { revokedAt: null, sessionsFrom: null, verified: false }

const cache = new Map<string, { at: number; state: SessionRow }>()

/** Забыть кэш: зовётся сразу после отзыва, чтобы своё же устройство вышло мгновенно */
export function forgetSessionCache(): void {
  cache.clear()
}

/**
 * Состояние сессии с кэшем на процесс.
 *
 * Бросок НЕ кэшируется: иначе одна секундная ошибка Turso означала бы минуту
 * слепоты к отзыву. Кэшируем только успешный ответ.
 */
async function stateOf(lookup: Lookup, sid: string, steamid: string, nowSec: number): Promise<SessionRow> {
  const hit = cache.get(sid)
  if (hit && nowSec - hit.at < REVOKE_CACHE_SEC) return hit.state
  try {
    const state = await lookup(sid, steamid)
    cache.set(sid, { at: nowSec, state })
    return state
  } catch {
    // fail-open, и намеренно без записи в кэш
    return LIVE
  }
}

/**
 * Кто пришёл. null — гость.
 *
 * Порядок проверок: сначала срок из самого токена (он не требует базы), потом
 * отзыв. Так падение базы не влияет на протухшие куки.
 */
export async function resolveSession(opts: {
  token: string | undefined
  secret: string
  nowSec: number
  lookup: Lookup
}): Promise<Resolved | null> {
  const { token, secret, nowSec, lookup } = opts
  if (!token) return null

  const v2 = verifySessionV2(token, secret)
  if (v2) {
    if (v2.exp <= nowSec) return null
    const state = await stateOf(lookup, v2.sid, v2.steamid, nowSec)
    if (state.revokedAt !== null) return null
    // «выйти везде» бьёт по времени выдачи: накрывает и те сессии, чьих строк нет
    if (state.sessionsFrom !== null && v2.iat < state.sessionsFrom) return null
    return {
      steamid: v2.steamid,
      sid: v2.sid,
      stale: nowSec - v2.iat > SESSION_TOUCH_AFTER_SEC,
      verified: state.verified,
    }
  }

  // Легаси-кука: пускаем и помечаем на апгрейд. Живёт она максимум 30 суток
  // от выдачи (продления у того формата не было никогда), так что окно
  // закрывается само, без даты-заката в коде.
  const legacy = verifySession(token, secret)
  if (legacy) {
    // ...но «выйти на всех устройствах» обязано доставать и её. Своего sid у
    // неё нет, и времени выдачи тоже — зато нового такого формата уже никто не
    // выдаёт, поэтому ЛЮБАЯ легаси-кука заведомо старше любой отсечки.
    const state = await stateOf(lookup, `legacy:${legacy}`, legacy, nowSec)
    if (state.sessionsFrom !== null) return null
    // Легаси-формат выдавали до появления признака — считаем неподтверждённой.
    return { steamid: legacy, sid: null, stale: true, verified: false }
  }

  return null
}

/** Новая сессия: свежий sid и токен на год */
export function mintSession(
  steamid: string,
  secret: string,
  nowSec: number,
): { sid: string; token: string } {
  const sid = newSid()
  return {
    sid,
    token: signSessionV2({ sid, steamid, iat: nowSec, exp: nowSec + SESSION_TTL_SEC }, secret),
  }
}

/**
 * Продление: sid НЕ меняется.
 *
 * Ротация идентификатора на каждое продление означала бы новую строку на
 * каждый визит и гонку двух вкладок за то, какая версия куки победит.
 */
export function renewToken(sid: string, steamid: string, secret: string, nowSec: number): string {
  return signSessionV2({ sid, steamid, iat: nowSec, exp: nowSec + SESSION_TTL_SEC }, secret)
}

/**
 * Подпись устройства для списка входов. Не для безопасности — только чтобы
 * человек узнал свой телефон среди строк, поэтому грубого разбора достаточно.
 */
export function deviceLabel(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  const ua = userAgent.slice(0, 300)
  const os = /Android/i.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(ua)
      ? 'iOS'
      : /Mac OS X/i.test(ua)
        ? 'macOS'
        : /Windows/i.test(ua)
          ? 'Windows'
          : /Linux/i.test(ua)
            ? 'Linux'
            : null
  // Порядок важен: Edg и OPR содержат Chrome, Chrome содержит Safari
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /YaBrowser/.test(ua)
        ? 'Яндекс'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null
  const label = [browser, os].filter(Boolean).join(', ')
  return label || null
}
