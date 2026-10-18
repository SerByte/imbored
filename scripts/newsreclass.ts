import type { Db } from '../lib/db'
import { isPatchNote, newsText } from '../lib/news'
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
 * модель. Сбрасываем его не у всех: повторный пересказ стоит вызова, а
 * пересказанных крупных патчей на выгрузке прода 911. Только у тех, где в
 * заголовке или начале тела есть приметы невышедшего или чужого (PLAN_CUES),
 * — 131; остальные модель уже видела, и пересказ у них о вышедшем.
 *
 * Ни срока, ни rank в этом отборе нет намеренно. Пересказ виден везде, где
 * стоит строка, а стоит она без срока: карточка игры показывает восемь
 * последних патчей любого возраста (getGameNews) со ссылкой на страницу
 * (indexedNewsPath), страница патча открыта по своему адресу всегда и с
 * пересказом идёт в индекс (newsIndexable), а rank решает только индекс и
 * ссылку — сам текст карточка и страница показывают и у игры вне каталога.
 * Раньше отбор держался окна карты сайта (девяносто дней) и rank > 0 — и
 * пропускал ровно Hades: пост от 25.09.2025 старше окна, а на карточке первой
 * Hades он так и стоял последним крупным патчем с «Вышла финальная версия
 * 1.0 Hades II». С окном отбор давал 56 строк, без окна — 116, без rank — ещё
 * пятнадцать.
 *
 * Обратный ход — вердикт модели «не патч» (scale 'none', NewsVerdict в
 * lib/db). Опрос его не переписывает, пока тело то же, и ошибка модели иначе
 * снимала бы пост со всех поверхностей патчей навсегда. План перечисляет
 * такие строки, а --renone возвращает их модели — после правки промпта или
 * выборочно, по списку, который владелец проверил глазами.
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
  /** Пересказанные крупные патчи с приметами невышедшего — любого возраста */
  redigest: ReclassRow[]
  /**
   * Вердикты модели «не патч» у постов, которые эвристика и сейчас считает
   * патчами. Новость по нынешнему правилу сюда не попадает — она в demote, и
   * переспрашивать о ней модель незачем.
   */
  none: ReclassRow[]
}

type Row = {
  appid: number
  gid: string
  title: string
  blocks_json: string
  scale: string | null
  tldr: string | null
}

function blocksOf(raw: string): NewsBlock[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as NewsBlock[]) : []
  } catch {
    return []
  }
}

/** Ключ строки в аргументе --renone: «appid/gid», как в выводе плана */
export const reclassKey = (r: { appid: number; gid: string }): string => `${r.appid}/${r.gid}`

/**
 * Только чтение: обходит все строки kind = 'patch' по первичному ключу
 * порциями и решает по каждой тем же правилом, что опрос (isPatchNote над
 * newsText — как isStoredPatch на чтении).
 */
export async function planNewsReclass(db: Db): Promise<ReclassPlan> {
  const plan: ReclassPlan = { demote: [], redigest: [], none: [] }
  let after: [number, string] = [Number.MIN_SAFE_INTEGER, '']
  for (;;) {
    const res = await db.execute({
      sql: `SELECT appid, gid, title, blocks_json, scale, tldr FROM news_items
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
      if (r.scale === 'none') {
        plan.none.push(row)
        continue
      }
      const told = r.scale === 'major' && Boolean(r.tldr)
      if (told && PLAN_CUES.test(`${row.title}\n${text.slice(0, 1500)}`)) plan.redigest.push(row)
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
 *
 * renone — вердикт «не патч» обратно в очередь: scale 'major', каким его
 * ставит опрос всякому нетривиальному патчу (lib/newsjob), пересказ и
 * попытки в ноль. true — все строки plan.none, список «appid/gid» — только
 * они: ключ, которого в плане нет, не пишется (вердикт мог смениться между
 * планом и записью, а за чужую строку модели платить незачем). До разбора
 * пост снова патч без пересказа — на карточке и своей страницей с noindex.
 */
export async function applyNewsReclass(
  db: Db,
  plan: ReclassPlan,
  opts: { redigest?: boolean; renone?: boolean | readonly string[] },
  nowSec: number,
): Promise<{ demoted: number; redigested: number; renoned: number }> {
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
  const picked = Array.isArray(opts.renone) ? new Set(opts.renone) : null
  const renone = opts.renone ? plan.none.filter((r) => !picked || picked.has(reclassKey(r))) : []
  const renoned = await run(
    renone.map((r) => ({
      sql: `UPDATE news_items SET scale = 'major', tldr = NULL, tldr_at = NULL, tldr_tries = 0
            WHERE appid = ? AND gid = ? AND kind = 'patch' AND scale = 'none'`,
      args: [r.appid, r.gid],
    })),
  )
  return { demoted, redigested, renoned }
}
