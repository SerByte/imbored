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
import { logSwallowed } from './errlog'
import { newSid, signSessionV2, verifySessionV2 } from './session'

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
  /** строка в таблице sessions — по ней гасят одно устройство */
  sid: string
  /**
   * Куку пора переставить. Только по свежему и удавшемуся чтению из базы —
   * почему, сказано в resolveSession.
   */
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
   * Неизвестное происхождение считаем неподтверждённым: у сессии без строки в
   * базе (Turso моргнула на выдаче) признака нет.
   *
   * То же правило закрывает и запись в профиль — оценки, баны, комнаты: см.
   * isWriter и requireWriter в lib/server.
   */
  verified: boolean
  /**
   * Состояние сессии прочитано из базы — в этом запросе или кэшем не старше
   * REVOKE_CACHE_SEC. false — база не ответила, и вход пущен на веру
   * (fail-open): verified тогда false не потому, что владение не доказано, а
   * потому, что о нём неизвестно ничего. Роуту, которому эта разница видна
   * человеку, — отвечать «не получилось, нажми ещё раз», а не «войди через
   * Steam»: вход в аварию не поможет (app/api/forget).
   */
  checked: boolean
}

export type Lookup = (sid: string, steamid: string) => Promise<SessionRow>

const LIVE: SessionRow = { revokedAt: null, sessionsFrom: null, verified: false, gone: false }

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
 *
 * fresh — мимо кэша: читается база, даже если в кэше свежее. Ответ кэш
 * всё равно обновляет — у этой сессии, и только у неё: сбрасывать ради
 * одного чтения кэш всем (forgetSessionCache) значило бы отдать любому
 * запросу ручку, которая заставляет экземпляр ходить в базу на каждый вход.
 *
 * checked — ответ пришёл из базы (сейчас или из кэша), а не из fail-open.
 */
async function stateOf(
  lookup: Lookup,
  sid: string,
  steamid: string,
  nowSec: number,
  fresh: boolean,
): Promise<{ state: SessionRow; checked: boolean }> {
  const hit = fresh ? undefined : cache.get(sid)
  if (hit && nowSec - hit.at < REVOKE_CACHE_SEC) return { state: hit.state, checked: true }
  try {
    const state = await lookup(sid, steamid)
    cache.set(sid, { at: nowSec, state })
    return { state, checked: true }
  } catch (err) {
    // fail-open, и намеренно без записи в кэш. Но со строкой лога: пока база
    // лежит, отзыв сессий не работает, и об этом надо знать не из жалобы
    logSwallowed('sessions:lookup', err)
    return { state: LIVE, checked: false }
  }
}

/**
 * Кто пришёл. null — гость.
 *
 * Порядок проверок: сначала срок из самого токена (он не требует базы), потом
 * отзыв. Так падение базы не влияет на протухшие куки.
 *
 * fresh — сверить с базой мимо кэша (см. stateOf): для решений, которых не
 * отменить, — удаления всех данных (app/api/forget).
 *
 * ПРОДЛЕНИЕ РЕШАЕТСЯ ТОЛЬКО СВЕЖИМ ЧТЕНИЕМ. Продление — единственное, что
 * превращает старую куку в новую с другим iat, а отсечки по времени выдачи
 * бьют именно по iat: users.sessions_from у «выйти везде» и отметка удаления
 * (forget_marks) у «Удалить всё обо мне». Продли куку, выданную до отсечки, —
 * и она пережила бы отсечку на год. У «выйти везде» за отсечкой стоит ещё и
 * revoked_at на строке сессии, и его продлённая кука с тем же sid не обойдёт.
 * У удаления строк нет вовсе — отсекает только время. Поэтому устаревшая
 * кука сверяется с базой мимо кэша: кэш минутной давности не знает об
 * отсечке, поставленной на соседнем экземпляре. Сбой этой сверки впускает
 * (так устроен весь модуль), но продлевать не просит: продление подождёт
 * следующего захода, а не случится вслепую. Цена — несколько чтений по
 * первичному ключу раз в неделю на устройство, пока первый же
 * /api/session/touch не переставит куку.
 */
export async function resolveSession(opts: {
  token: string | undefined
  secret: string
  nowSec: number
  lookup: Lookup
  fresh?: boolean
}): Promise<Resolved | null> {
  const { token, secret, nowSec, lookup, fresh = false } = opts
  if (!token) return null

  const v2 = verifySessionV2(token, secret)
  if (v2) {
    if (v2.exp <= nowSec) return null
    const stale = nowSec - v2.iat > SESSION_TOUCH_AFTER_SEC
    const { state, checked } = await stateOf(lookup, v2.sid, v2.steamid, nowSec, fresh || stale)
    if (state.revokedAt !== null) return null
    // демо-личность убрана, а кука живёт год — см. SessionRow.gone
    if (state.gone) return null
    // «выйти везде» и удаление бьют по времени выдачи: накрывают и те сессии,
    // чьих строк нет
    if (state.sessionsFrom !== null && v2.iat < state.sessionsFrom) return null
    return {
      steamid: v2.steamid,
      sid: v2.sid,
      stale: stale && checked,
      verified: state.verified,
      checked,
    }
  }

  /*
   * Легаси-кука v1 («<steamid>.<подпись>») больше не пускает — и не
   * меняется на годовую v2, как делал /api/session/touch.
   *
   * Её пускали «пока окно не закроется само»: в браузере она жила 30 суток
   * без продления, v2 вышел 15 августа, и к середине сентября честных v1 не
   * осталось. Но сервер срока не проверял: у формата его нет вовсе, а токен
   * детерминирован — один и тот же для steamid навсегда. Попавший однажды в
   * лог, на скриншот или в чужой браузер, он работал бы вечно и через touch
   * превращался в свежую сессию на год. Отозвать его точечно было нельзя:
   * sid у него нет.
   *
   * Теперь это просто нераспознанный токен — гость, как и любой мусор.
   */
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
