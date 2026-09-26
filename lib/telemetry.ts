import { after } from 'next/server'
import type { Db } from './db'
import { logSwallowed } from './errlog'
import { getDb, nowSec } from './server'

/**
 * Почасовые счётчики в своей базе — поверх строк в логе.
 *
 * Сбои на сервере, отчёты об ошибках из браузера и нарушения CSP до сих пор
 * жили только строками в журнале Vercel: чтобы узнать «стало ли хуже после
 * деплоя», их надо было выгружать и считать руками, а /api/cron/health о них
 * не знал ничего. Здесь те же события оседают числами — сколько за час и
 * какого вида. Туда же — шаги воронки (lib/track.ts): вход, подбор, запуск,
 * «поделиться».
 *
 * Лог остаётся главным: счётчик пишется ПОСЛЕ строки в лог и лучшим
 * усилием. База падает ровно тогда же, когда сыплются ошибки, и отказ
 * счётчика не имеет права ни задержать ответ надолго, ни уронить его, ни
 * заглушить строку в логе.
 *
 * Ничего личного. kind — из закрытого списка, key — шаблон маршрута
 * ('/game/[appid]', а не '/game/730'), вид ошибки, директива CSP или
 * «событие:источник» воронки. SteamID, адресов, путей с параметрами,
 * IP и user-agent здесь нет — поэтому и forgetUser эту таблицу не трогает.
 */

export type TelemetryKind = 'server-error' | 'client-error' | 'csp' | 'event'

/** Сколько живут счётчики: квартал — достаточно, чтобы сравнить месяц с месяцем */
export const TELEMETRY_TTL_SEC = 90 * 86_400

/** Ключ — строго короткий и из безопасного алфавита: сюда не должно пролезть ничего личного */
const KEY_RE = /^[a-z0-9_:/[\].-]{1,80}$/i

export const hourOf = (sec: number) => Math.floor(sec / 3600) * 3600

/**
 * Сколько сбоев на сервере за окно «прошлый час + текущий» ещё не авария —
 * порог /api/cron/health. Окно — два часовых счётчика, то есть от часа до
 * двух реального времени: у крона нет своего времени, он приходит в :17.
 * Единичные 500 бывают всегда, десятки в час — уже поломка.
 */
export const SERVER_ERRORS_LIMIT = 50

/** Можно ли писать такой ключ. Всё, что не проходит, превращается в 'other'. */
export function telemetryKey(raw: string): string {
  return KEY_RE.test(raw) ? raw : 'other'
}

/** Прибавить к счётчику часа. Бросает — это для тех, кто ловит сам. */
export async function bumpTelemetry(
  db: Db,
  kind: TelemetryKind,
  key: string,
  atSec: number,
  by = 1,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO telemetry_hourly (hour, kind, key, count) VALUES (?, ?, ?, ?)
          ON CONFLICT (hour, kind, key) DO UPDATE SET count = count + excluded.count`,
    args: [hourOf(atSec), kind, telemetryKey(key), by],
  })
}

/**
 * Посчитать событие лучшим усилием: не бросает, отказ — одной строкой
 * logSwallowed (не чаще раза в минуту). Возвращает промис, который можно
 * дождаться — instrumentation.ts так и делает, с таймаутом.
 */
export async function recordTelemetry(kind: TelemetryKind, key: string, by = 1): Promise<void> {
  try {
    await bumpTelemetry(await getDb(), kind, key, nowSec(), by)
  } catch (err) {
    logSwallowed('telemetry:bump', err, { kind })
  }
}

/**
 * То же, но после ответа: запрос человека не ждёт записи счётчика. Вне
 * контекста запроса (скрипт, тест) after недоступен — тогда запись просто
 * идёт сама, она уже начата.
 */
export function recordTelemetryLater(kind: TelemetryKind, key: string, by = 1): void {
  const work = recordTelemetry(kind, key, by)
  try {
    after(work)
  } catch {
    // вне запроса: промис уже запущен и сам себя ловит
  }
}

/** Сколько событий вида kind с часа, в котором лежит sinceSec, по сейчас */
export async function telemetryCount(db: Db, kind: TelemetryKind, sinceSec: number): Promise<number> {
  const res = await db.execute({
    sql: 'SELECT COALESCE(SUM(count), 0) AS n FROM telemetry_hourly WHERE hour >= ? AND kind = ?',
    args: [hourOf(sinceSec), kind],
  })
  return Number(res.rows[0]?.n ?? 0)
}

/** Стереть счётчики старше TELEMETRY_TTL_SEC. Раз в сутки из крона новостей. */
export async function pruneTelemetry(db: Db, atSec: number): Promise<number> {
  const res = await db.execute({
    sql: 'DELETE FROM telemetry_hourly WHERE hour < ?',
    args: [hourOf(atSec - TELEMETRY_TTL_SEC)],
  })
  return res.rowsAffected
}
