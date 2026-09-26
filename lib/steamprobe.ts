import { getCatalogMeta, setCatalogMeta, type Db } from './db'
import { scrubText } from './errlog'
import { resolveVanity } from './steam'

/**
 * Проба ключа Steam Web API — раз в час, с конца цепочки новостей.
 *
 * Ключ нужен входу: библиотеку и профиль Steam отдаёт только по нему. Отзыв
 * ключа или его просрочка не роняют ни одного крона — кроны ходят в магазин
 * без ключа, — и поломку видно только по тому, что люди перестали входить, а
 * в логе копятся проглоченные «connect:steam». Проба делает её видимой:
 * отметка ложится в catalog_meta, а /api/cron/health её читает
 * (steamKeyHealth в lib/cron.ts).
 *
 * Что спрашиваем. ResolveVanityURL на заведомо несуществующее имя: с живым
 * ключом Steam отвечает 200 и «не найдено», с мёртвым — 401/403. Личных
 * данных тут нет вовсе, а сам вызов из тех, что сервис и так делает при входе
 * (/privacy, раздел про Steam). GetPlayerSummaries проверил бы ключ так же, но
 * читал бы чей-то настоящий профиль — нового потока данных ради проверки
 * заводить незачем.
 */

export const STEAM_PROBE_KEY = 'steam_key_probe'

/** Чаще раза в 50 минут не ходим: конец цепочки бывает и чаще часа */
export const STEAM_PROBE_EVERY_SEC = 50 * 60

/** Имя, которого нет ни у кого: дефисы в начале Steam в кастомных URL не даёт */
const PROBE_VANITY = '-imbored-key-probe-'

/** Короткий таймаут на попытку: проба живёт в хвосте крона, а не в запросе человека */
const PROBE_TIMEOUT_MS = 5_000

export type SteamProbeMark = { at: number; ok: boolean; detail?: string }

/**
 * Сходить в Steam и записать отметку. Проба свежая — ничего не делаем и
 * возвращаем null. Не бросает: сбой записи отметки — забота health (она
 * устареет и покраснеет сама).
 */
export async function runSteamProbe(
  db: Db,
  opts: { nowSec: number; apiKey: string | null; fetchFn?: typeof fetch },
): Promise<SteamProbeMark | null> {
  try {
    const last = await getCatalogMeta(db, STEAM_PROBE_KEY)
    const lastAt = Number((last ? (JSON.parse(last) as { at?: unknown }) : null)?.at ?? 0)
    if (Number.isFinite(lastAt) && opts.nowSec - lastAt < STEAM_PROBE_EVERY_SEC) return null
  } catch {
    // мусор в отметке — пробуем заново
  }

  const mark = await probe(opts)
  try {
    await setCatalogMeta(db, STEAM_PROBE_KEY, JSON.stringify(mark))
  } catch {
    // см. докблок: устаревшая отметка покраснеет в health сама
  }
  return mark
}

async function probe(opts: { nowSec: number; apiKey: string | null; fetchFn?: typeof fetch }): Promise<SteamProbeMark> {
  if (!opts.apiKey) return { at: opts.nowSec, ok: false, detail: 'нет ключа' }
  const base = opts.fetchFn ?? fetch
  // Свой таймаут поверх 15 секунд steamApiGet: две попытки по пять — и проба
  // гарантированно укладывается в хвост крона
  const fetchFn: typeof fetch = (input, init) =>
    base(input, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  try {
    await resolveVanity(PROBE_VANITY, { apiKey: opts.apiKey, fetchFn, retryDelayMs: 500 })
    return { at: opts.nowSec, ok: true }
  } catch (err) {
    // В тексте сетевой ошибки бывает полный адрес с key= — вычищаем
    const raw = err instanceof Error ? err.message : String(err)
    return { at: opts.nowSec, ok: false, detail: scrubText(raw).slice(0, 120) }
  }
}
