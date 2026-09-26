import { freshlyDigestedPatches, getCatalogMeta, setCatalogMeta, type Db } from './db'
import { newsPath, SITEMAP_NEWS_WINDOW_SEC } from './newspage'

/**
 * IndexNow — сказать поисковикам, что у патча появилась страница.
 *
 * Страница патча становится индексируемой не при публикации, а когда крон
 * пересказов пишет ей «Коротко» (newsIndexable в lib/newspage). До IndexNow
 * поисковик узнавал об этом из карты сайта — через сутки-двое, когда патч
 * уже никому не интересен. IndexNow — общий вход Bing и Яндекса (для
 * русского сайта второй важнее первого): один POST со списком адресов.
 *
 * Перед пингом страница перегенерируется (revalidatePath): она на сутках
 * ISR, и зашедший до пересказа оставил в кэше версию без «Коротко» и с
 * noindex. Позвать краулера к ней — значило бы показать ему именно её.
 * Перегенерация делается и без ключа: устаревшая страница — это баг и для
 * человека, а не только для поиска.
 *
 * Только прод (VERCEL_ENV === 'production'): превью разделяет с продом
 * APP_BASE_URL, а база у него своя, и пинг с превью называл бы поисковику
 * адреса, которых на imbored.cc нет. Ключ — INDEXNOW_KEY, его файл отдаёт
 * app/indexnow-key.txt/route.ts.
 */

export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow'

/** Где лежит файл ключа — в корне сайта: ключ из корня покрывает весь хост */
export const INDEXNOW_KEY_PATH = '/indexnow-key.txt'

/** Отметка в catalog_meta: до какого пересказа уже объявлено */
export const INDEXNOW_MARK = 'indexnow_last'

/**
 * Адресов за раз. Цепочка пересказов успевает до двухсот за час (25 × 8
 * звеньев), протокол принимает до 10 000. Выборка идёт по времени пересказа
 * от старых (freshlyDigestedPatches), так что не влезшее не теряется, а
 * ждёт следующего раза.
 */
const BATCH = 1000

/**
 * Отказы, которые повтор не исправит: 400 — мы собрали запрос неверно, 422 —
 * адреса не того хоста. На них отметка двигается (иначе тот же список уходил
 * бы каждую цепочку вечно и рос). 403 (ключ) и 429 (часто) — ждут исправления
 * ключа и паузы: список повторится.
 */
const FINAL_STATUSES = new Set([400, 422])

/** Первый запуск без отметки: берём пересказы за сутки, а не за все девяносто */
const FIRST_LOOKBACK_SEC = 86_400

/** Требование протокола к ключу: 8–128 знаков, латиница, цифры и дефис */
const KEY_RE = /^[A-Za-z0-9-]{8,128}$/

export function indexNowKey(env: Record<string, string | undefined> = process.env): string | null {
  const key = env.INDEXNOW_KEY?.trim()
  return key && KEY_RE.test(key) ? key : null
}

/** Пинговать можно: ключ задан и это прод */
export function indexNowEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return indexNowKey(env) !== null && env.VERCEL_ENV === 'production'
}

/**
 * POST в IndexNow. Ключ — в теле, а не в адресе: адреса попадают в журналы,
 * тела — нет. Свой таймаут: пинг стоит в хвосте крона, у которого свой срок.
 * 200 и 202 — принято; остальное (403 ключ, 422 чужой хост, 429) — отказ.
 */
export async function pingIndexNow(opts: {
  baseUrl: string
  key: string
  urls: readonly string[]
  fetchFn?: typeof fetch
  timeoutMs?: number
}): Promise<{ ok: boolean; status: number | null }> {
  const { baseUrl, key, urls, fetchFn = fetch, timeoutMs = 5000 } = opts
  if (!urls.length) return { ok: true, status: null }
  try {
    const res = await fetchFn(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        host: new URL(baseUrl).host,
        key,
        keyLocation: `${baseUrl}${INDEXNOW_KEY_PATH}`,
        urlList: urls,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { ok: res.status === 200 || res.status === 202, status: res.status }
  } catch {
    return { ok: false, status: null }
  }
}

type Mark = { at: number; digestedAt: number; count: number; status: number | null }

function readMark(raw: string | null): Mark | null {
  if (!raw) return null
  try {
    const m = JSON.parse(raw) as Partial<Mark>
    return typeof m.digestedAt === 'number' ? (m as Mark) : null
  } catch {
    return null
  }
}

/**
 * Свежепересказанные патчи: перегенерировать страницы и объявить их.
 *
 * Отметка двигается только при успехе (или когда пинговать не нужно вовсе):
 * отказ IndexNow — это те же адреса в следующий раз, а повторная
 * перегенерация ничего не стоит. null — объявлять нечего.
 */
export async function announceFreshPatches(
  db: Db,
  opts: {
    now: number
    baseUrl: string
    revalidate: (path: string) => void
    env?: Record<string, string | undefined>
    fetchFn?: typeof fetch
  },
): Promise<{ count: number; pinged: boolean; ok: boolean; status: number | null } | null> {
  const { now, baseUrl, revalidate, env = process.env, fetchFn } = opts
  const mark = readMark(await getCatalogMeta(db, INDEXNOW_MARK))
  const after = mark?.digestedAt ?? now - FIRST_LOOKBACK_SEC
  const fresh = await freshlyDigestedPatches(db, now - SITEMAP_NEWS_WINDOW_SEC, after, BATCH)
  if (!fresh.length) return null

  const paths = fresh.map((n) => newsPath(n.appid, n.gid))
  for (const p of paths) revalidate(p)

  const key = indexNowEnabled(env) ? indexNowKey(env) : null
  const result = key
    ? await pingIndexNow({ baseUrl, key, urls: paths.map((p) => `${baseUrl}${p}`), fetchFn })
    : { ok: true, status: null }

  /*
   * Докуда объявлено. Выборка — от раньше пересказанных, значит последняя
   * строка — самая поздняя. Если выборка обрезана по BATCH, за ней могли
   * остаться строки с тем же tldr_at — отметка встаёт на секунду раньше, и
   * они придут в следующий раз (повтор адреса ничего не стоит).
   */
  const last = fresh[fresh.length - 1].digestedAt
  const through = fresh.length === BATCH ? last - 1 : last
  const advance = result.ok || (result.status !== null && FINAL_STATUSES.has(result.status))
  const digestedAt = advance ? Math.max(after, through) : after
  const next: Mark = { at: now, digestedAt, count: fresh.length, status: result.status }
  await setCatalogMeta(db, INDEXNOW_MARK, JSON.stringify(next))
  return { count: fresh.length, pinged: key !== null, ok: result.ok, status: result.status }
}
