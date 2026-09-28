import { dayKey } from './daily'
import { markActiveDay, type ActiveDay, type Db } from './db'

/**
 * Возвраты по когортам: пришёл ли человек снова назавтра, через неделю, через
 * месяц.
 *
 * Воронка (lib/track.ts) видит, дошёл ли человек от входа до запуска, но не
 * отвечает на главный вопрос — возвращаются ли люди вообще. Vercel Analytics
 * на Hobby считает только открытые страницы, а своих следов визита в базе не
 * было: users.last_seen_at пишется при входе, а кука живёт год. Без этого
 * числа любая затея ради возврата (пати, итоги года, напоминания) шла бы в
 * прод вслепую.
 *
 * КАК СЧИТАЕТСЯ. У человека одна дата — users.last_active_day, день его
 * последнего захода по московским суткам (те же сутки, что у игры дня,
 * lib/daily). Истории нет: новый день перезаписывает прежний, и ровно это
 * обещает /privacy, раздел 07. Первый за сутки заход переставляет дату
 * (markActiveDay в lib/db) и, если день попал в окно, той же пачкой
 * прибавляет единицу к агрегатному счётчику в telemetry_hourly:
 *
 *     return:<ISO-неделя прихода>:<окно>:<demo|steam>
 *
 * Все счётчики когорты лежат в одном часе — в её понедельнике, а не в дне
 * захода (cohortHour).
 *
 * Неделя прихода — по users.created_at, в тех же московских сутках. Окна —
 * в сутках от дня прихода, сам день прихода нулевой:
 *
 *   d0  — день 0, сам приход. Это знаменатель. По users когорту задним числом
 *         не сосчитать: демо-строки сносит суточная уборка, любую — удаление
 *         по запросу;
 *   d1  — день 1, ровно назавтра;
 *   d7  — любой день с 7-го по 13-й: вернулся на второй неделе;
 *   d30 — любой день с 30-го по 36-й.
 *
 * Окно, а не ровно седьмой день: у сайта «во что поиграть вечером» привычка
 * недельная, и тот, кто приходит по пятницам, в «ровно седьмой день» попадал
 * бы, только если и впервые пришёл в пятницу. Окно начинается не раньше
 * своего дня: иначе «D7» засчитывал бы вернувшихся на четвёртый.
 *
 * Сутки календарные, а не 24 часа: пришёл в 23:30, вернулся в 00:30 — это
 * уже d1. Так считают и игра дня, и «сегодня» у человека в голове.
 *
 * В одном окне человек считается один раз. Второй заход в том же окне
 * узнаётся по той же единственной дате: прежний заход уже лежит внутри окна —
 * значит, единица за окно уже стоит. Поэтому доля вернувшихся не выходит за
 * 100% и без истории визитов.
 *
 * Защёлка — в базе, а не на устройстве: у человека с телефоном и ноутбуком
 * отметка в браузере посчитала бы его дважды.
 *
 * ДЕМО И d30. Демо-личность без вестей две недели сносит суточная уборка
 * (STALE_DEMO в lib/db: неделя DEMO_TTL_SEC плюс лаг продления
 * SESSION_TOUCH_AFTER_SEC). Её кука после этого — гость, touch не считает
 * ничего, и до окна d30 доживают только те, кто заходил не реже раза в две
 * недели. Так что у демо d30 — нижняя граница, и отчёт в DEPLOY.md его не
 * показывает. d1 и d7 целы: окно 7…13 кончается раньше двух недель. Кто
 * вернулся после уборки и снова нажал «Демо», получает новую личность и
 * приходит d0 в более позднюю когорту: демо-когорта — это личности, а не
 * люди. Сравнивать демо со Steam честно по d1 и d7.
 */

export type ReturnWindow = 'd0' | 'd1' | 'd7' | 'd30'

/** Окна возврата: имя, первый и последний день окна от дня прихода */
export const RETURN_WINDOWS: ReadonlyArray<readonly [ReturnWindow, number, number]> = [
  ['d0', 0, 0],
  ['d1', 1, 1],
  ['d7', 7, 13],
  ['d30', 30, 36],
]

const DAY_MS = 86_400_000

/** Полночь UTC календарной даты вида 2026-09-24 — чтобы считать дни между датами */
function dateMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

/** Сколько суток от даты from до даты to (обе — ключи dayKey) */
export function daysBetween(from: string, to: string): number {
  return Math.round((dateMs(to) - dateMs(from)) / DAY_MS)
}

function addDays(day: string, n: number): string {
  return new Date(dateMs(day) + n * DAY_MS).toISOString().slice(0, 10)
}

/** Полночь UTC понедельника той недели, в которой лежит дата */
function mondayMs(day: string): number {
  const ms = dateMs(day)
  return ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY_MS
}

/**
 * ISO-неделя даты: 2026-W39. Год — тоже ISO: 29 декабря бывает первой неделей
 * следующего года, а 1 января — последней неделей прошлого. Неделя — та, в
 * которой лежит её четверг, поэтому номер считается по нему.
 */
export function isoWeek(day: string): string {
  const thursday = new Date(mondayMs(day) + 3 * DAY_MS)
  const year = thursday.getUTCFullYear()
  const week = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS / 7) + 1
  return `${year}-W${String(week).padStart(2, '0')}`
}

/**
 * Ключ счётчика для первого за сутки захода — или null, если считать нечего:
 * день не попал ни в одно окно или в этом окне человек уже посчитан.
 *
 * prevDay — день прошлого захода до этой отметки; null — отметки не было.
 */
export function returnKey(v: {
  createdAt: number
  prevDay: string | null
  today: string
  demo: boolean
}): string | null {
  const born = dayKey(v.createdAt)
  const n = daysBetween(born, v.today)
  const hit = RETURN_WINDOWS.find(([, from, to]) => n >= from && n <= to)
  if (!hit) return null
  const [window, from] = hit
  if (v.prevDay !== null && v.prevDay >= addDays(born, from)) return null
  return `return:${isoWeek(born)}:${window}:${v.demo ? 'demo' : 'steam'}`
}

/**
 * Час, в который ложатся ВСЕ счётчики когорты, — полночь UTC её понедельника,
 * а не время захода.
 *
 * Когорта «неделя × demo|steam» на маленьком сайте бывает из одного
 * человека, а users.created_at однозначно называет его неделю. Счётчик в
 * часе или дне захода выдал бы по нему до четырёх датированных визитов —
 * ту самую историю, которой в users нет. В понедельнике когорты счётчик не
 * говорит ничего сверх ключа.
 *
 * Второе — уборка. pruneTelemetry стирает по часу, и счётчики одной когорты
 * в разных сутках уходили бы порознь: d0 раньше d30, и тот же отчёт показал
 * бы у старой когорты больше 100%. В одном часе когорта стирается разом.
 */
export function cohortHour(createdAt: number): number {
  return mondayMs(dayKey(createdAt)) / 1000
}

/**
 * Отметить заход и, если это возврат в окне, посчитать его. Возвращает ключ
 * записанного счётчика — для тестов и логов; null — считать было нечего.
 *
 * Зовёт /api/session/touch: туда приходят все страницы — SessionKeeper на
 * каждой, кроме главной, а главная сама (ConnectCard, card=1) и /play
 * (lib/playcache). Бросает — ловит вызывающий.
 */
export async function markReturn(
  db: Db,
  steamid: string,
  demo: boolean,
  nowSec: number,
): Promise<string | null> {
  const today = dayKey(nowSec)
  const counter = (mark: ActiveDay) => {
    const key = returnKey({ ...mark, today, demo })
    return key ? { key, hour: cohortHour(mark.createdAt) } : null
  }
  // Счётчик пишется той же пачкой, что и дата (см. markActiveDay); здесь
  // тот же расчёт повторяется лишь затем, чтобы назвать ключ
  const mark = await markActiveDay(db, steamid, today, counter)
  return mark ? (counter(mark)?.key ?? null) : null
}
