import type { Db } from '../lib/db'
import { isPatchNote, newsText } from '../lib/news'
import { SITEMAP_NEWS_WINDOW_SEC } from '../lib/newspage'
import type { NewsBlock } from '../lib/steamhtml'

/**
 * Работа news-reclass без обвязки командной строки — ради теста на базе в
 * памяти, как neighborsbuild и semanticsbuild.
 *
 * Прогон НЕОБЯЗАТЕЛЕН, и вот почему. Правку классификатора (lib/news) база
 * догоняет сама: опрос переписывает kind каждого поста из окна ленты, а
 * страница патча и лента карточки сверяют запись с нынешним правилом на
 * чтении (isStoredPatch) и «дорожной карте» отвечают 404 с первого рендера.
 * Прогон нужен, чтобы не ждать переопроса там, где правило на чтении не
 * работает, — в голове ленты, карте сайта, IndexNow и RSS, — и чтобы достать
 * записи за окном ленты, которые опрос не перечитает никогда (по выгрузке
 * прода от 24.09.2026 — две из ста тридцати одной).
 *
 * Пересказ — отдельный шаг. Его проверка моделью («не патч», lib/llm)
 * появилась позже самих пересказов, и уже опубликованный текст вроде «Вышла
 * версия 1.0 Hades II» на странице первой Hades переписать может только
 * модель. Сбрасываем его не у всех: повторный пересказ стоит вызова, а окно
 * карты сайта — сотни патчей. Только у тех, где в заголовке или начале тела
 * есть приметы невышедшего или чужого (PLAN_CUES), — на выгрузке прода 56 из
 * 380; остальные модель уже видела, и пересказ у них о вышедшем.
 */

/** Строк за одно чтение: тело патча — до десятков килобайт */
const PAGE = 200

/**
 * Приметы поста, который может оказаться не патчем. Шире эвристики lib/news
 * намеренно: промах здесь стоит одного лишнего пересказа, а не потерянного
 * патча.
 */
const PLAN_CUES = new RegExp(
  'roadmap|дорожн\\p{L}*\\s+карт|looking\\s+ahead|preview|превью|upcoming|incoming|coming\\s+soon|' +
    "what[’']?s\\s+next|что\\s+дальше|в\\s+разработке|subject\\s+to\\s+change|currently\\s+exploring|" +
    'условный\\s+характер|open\\s+beta|public\\s+beta|beta\\s+branch|открыт\\p{L}*\\s+бет|бета-тест|' +
    'stream|стрим|трансляц|sequel|сиквел',
  'iu',
)

export type ReclassRow = { appid: number; gid: string; title: string }

export type ReclassPlan = {
  /** Записаны патчами, а нынешнее правило считает их новостями */
  demote: ReclassRow[]
  /** Пересказанные крупные патчи окна карты сайта с приметами невышедшего */
  redigest: ReclassRow[]
}

type Row = {
  appid: number
  gid: string
  title: string
  blocks_json: string
  scale: string | null
  tldr: string | null
  rank: number
  published_at: number
}

function blocksOf(raw: string): NewsBlock[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as NewsBlock[]) : []
  } catch {
    return []
  }
}

/**
 * Только чтение: обходит все строки kind = 'patch' по первичному ключу
 * порциями и решает по каждой тем же правилом, что опрос (isPatchNote над
 * newsText — как isStoredPatch на чтении).
 */
export async function planNewsReclass(db: Db, nowSec: number): Promise<ReclassPlan> {
  const plan: ReclassPlan = { demote: [], redigest: [] }
  const since = nowSec - SITEMAP_NEWS_WINDOW_SEC
  let after: [number, string] = [Number.MIN_SAFE_INTEGER, '']
  for (;;) {
    const res = await db.execute({
      sql: `SELECT appid, gid, title, blocks_json, scale, tldr, rank, published_at FROM news_items
            WHERE kind = 'patch' AND (appid, gid) > (?, ?)
            ORDER BY appid, gid LIMIT ?`,
      args: [after[0], after[1], PAGE],
    })
    const rows = res.rows as unknown as Row[]
    for (const r of rows) {
      const text = newsText({ blocks: blocksOf(r.blocks_json) })
      const row = { appid: Number(r.appid), gid: String(r.gid), title: String(r.title) }
      if (!isPatchNote(row.title, text)) {
        plan.demote.push(row)
        continue
      }
      const told = r.scale === 'major' && Boolean(r.tldr) && Number(r.rank) > 0
      if (told && Number(r.published_at) >= since && PLAN_CUES.test(`${row.title}\n${text.slice(0, 1500)}`)) {
        plan.redigest.push(row)
      }
    }
    if (rows.length < PAGE) return plan
    const last = rows[rows.length - 1]!
    after = [Number(last.appid), String(last.gid)]
  }
}

/**
 * Запись плана. Повтор безопасен: условия в WHERE те же, что в плане, и уже
 * сделанное второй раз не трогается (счёт — по rowsAffected).
 *
 * demote — kind = 'news' и updated_at = сейчас, ровно как переписал бы опрос
 * (upsertNewsItems двигает updated_at на смене вида поста).
 *
 * redigest — пересказ и счётчик попыток в ноль: запись встаёт в очередь
 * пересказа (getUnsummarized), и её разберёт крон в пределах суточного
 * бюджета модели (lib/llmcap). До разбора страница без пересказа стоит с
 * noindex и выпадает из карты сайта — для поста под подозрением это и нужно.
 */
export async function applyNewsReclass(
  db: Db,
  plan: ReclassPlan,
  opts: { redigest: boolean },
  nowSec: number,
): Promise<{ demoted: number; redigested: number }> {
  const run = async (sqls: Array<{ sql: string; args: Array<string | number> }>) => {
    if (!sqls.length) return 0
    const res = await db.batch(sqls, 'write')
    return res.reduce((n, r) => n + Number(r.rowsAffected ?? 0), 0)
  }
  const demoted = await run(
    plan.demote.map((r) => ({
      sql: `UPDATE news_items SET kind = 'news', updated_at = ?
            WHERE appid = ? AND gid = ? AND kind = 'patch'`,
      args: [nowSec, r.appid, r.gid],
    })),
  )
  const redigested = opts.redigest
    ? await run(
        plan.redigest.map((r) => ({
          sql: `UPDATE news_items SET tldr = NULL, tldr_at = NULL, tldr_tries = 0
                WHERE appid = ? AND gid = ? AND kind = 'patch' AND scale = 'major' AND tldr IS NOT NULL`,
          args: [r.appid, r.gid],
        })),
      )
    : 0
  return { demoted, redigested }
}
