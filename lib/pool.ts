import {
  ALIVE_POOL_G,
  GAME_LITE_COLUMNS_G,
  rowToMeta,
  SEMANTICS_JOIN,
  type Db,
  type GameRow,
} from './db'
import type { GameMeta } from './types'

/**
 * Выборка кандидатов «попробуй новое» из большого каталога.
 *
 * Turso тарифицирует ПРОЧИТАННЫЕ строки, поэтому полный скан каталога на
 * каждый запрос неприемлем: сотня тысяч строк на подбор сожгла бы месячный
 * лимит за считанные дни. Здесь читается порядка тысячи строк: по ветке
 * на каждый тег профиля с LIMIT внутри, затем join к метаданным.
 *
 * Сортировка идёт по ХАРАКТЕРНОСТИ тега, а не по популярности: «топ по тегу
 * Roguelike» — это игры, которые больше всего являются рогаликами, а не самые
 * продаваемые. Это встроенная защита от «всем выпадают одни и те же хиты».
 */

export type DiscoveryQuery = {
  /** теги профиля; пустой список уводит в холодный старт */
  tags: string[]
  bannedAppids?: number[]
  requireMultiplayer?: boolean
  /** сколько игр брать по каждому тегу */
  perTag?: number
  limit?: number
  /** слот разнообразия: сдвигает окно по хвосту */
  rotation?: number
  /**
   * Сколько заметных игр добрать ВНЕ тегов профиля.
   *
   * Ветки по тегам отвечают на «что ещё такое же», и без этой добавки каталог
   * для человека сужается до его собственного вкуса: любитель рогаликов не
   * увидит ни одной большой RPG, сколько бы их ни было в базе. Скоринг таких
   * кандидатов не трогается — по косинусу они выигрывают редко, но шанс у них
   * появляется. Стоит одного запроса по индексу.
   */
  wildcard?: number
}

const DEFAULT_PER_TAG = 60
const DEFAULT_LIMIT = 400
/** Тег, который есть у слишком большой доли каталога, о вкусе не говорит ничего */
const STOP_TAG_SHARE = 0.15
const DEFAULT_TAG_COUNT = 12

/*
 * Колонки и маппер — те же, что у getGamesMetaLite (lib/db). Здесь жили свои
 * COLUMNS, PoolRow и rowToMeta, и каждая новая колонка games доезжала до них
 * последней, если доезжала вообще. Издатель, разработчик и вердикт курации
 * однажды уже потерялись так: buildSeriesIndex выбирал в группе каталожного
 * победителя без издателя, тот не проходил sameMaker, и мёртвый мультиплеер
 * из библиотеки молча воскресал. Потом потерялись reviews_30d и ccu_at:
 * первый — запасной сигнал живости каталожных кандидатов «с друзьями»
 * (lib/liveness, lib/actual), второй — возраст онлайна, без которого
 * PlayersNow у покупки не смеет сказать «сейчас». Скриншотов и трейлера в
 * узкой выборке нет намеренно: героям их читает getHeroMedia, а пул — четыре
 * сотни строк.
 * Семантика (game_semantics) едет тем же списком колонок и SEMANTICS_JOIN.
 */

/**
 * Теги для запроса: самые весомые в профиле, за вычетом слишком частых.
 * Стоп-слова считаются по каталогу, а не задаются руками.
 *
 * catalogSize обязан быть размером ТОЙ ЖЕ популяции, по которой посчитан
 * tagStats, — то есть pool_size из catalog_meta (см. rebuildTagStats), а не
 * countIngest. Числитель по витрине и знаменатель по карте территории занижают
 * долю примерно втридцатеро, и фильтр перестаёт срабатывать вообще.
 */
export function pickQueryTags(
  profile: Record<string, number>,
  tagStats: Map<string, number>,
  catalogSize: number,
  k = DEFAULT_TAG_COUNT,
): string[] {
  return Object.entries(profile)
    .filter(([, weight]) => weight > 0)
    .filter(([tag]) => {
      const count = tagStats.get(tag)
      if (!count || !catalogSize) return true
      return count / catalogSize <= STOP_TAG_SHARE
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([tag]) => tag)
}

/** FNV-1a: детерминированный хеш без зависимостей */
function hash(s: string): number {
  let h = 2_166_136_261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16_777_619)
  }
  return h >>> 0
}

/**
 * Слот разнообразия: свой у каждого игрока и свой на каждой неделе. Так хвост
 * каталога показывается по очереди, а скоринг при этом не трогается вообще.
 */
export function rotationSlot(steamid: string, nowSec: number, slots = 5): number {
  const week = Math.floor(nowSec / (7 * 86_400))
  return hash(`${steamid}:${week}`) % slots
}

/**
 * Заметные игры каталога по числу отзывов. Ими живёт холодный старт (профиля
 * ещё нет) и добор вне вкуса (wildcard). Идёт по частичному индексу
 * idx_games_pool, поэтому без полного скана.
 */
async function fetchNotable(
  db: Db,
  args: { limit: number; offset: number; mpOnly: number; banned: string },
): Promise<GameMeta[]> {
  const page = async (offset: number) => {
    const res = await db.execute({
      sql: `SELECT ${GAME_LITE_COLUMNS_G} FROM games g ${SEMANTICS_JOIN}
            WHERE ${ALIVE_POOL_G}
              AND (?1 = 0 OR g.is_multiplayer = 1)
              AND g.appid NOT IN (SELECT value FROM json_each(?2))
            ORDER BY g.reviews_total DESC LIMIT ?3 OFFSET ?4`,
      args: [args.mpOnly, args.banned, args.limit, offset],
    })
    return (res.rows as unknown as GameRow[]).map((r) => rowToMeta(r))
  }

  const rows = await page(args.offset)
  // Окно ротации уехало за конец каталога — возвращаемся к началу. На проде с
  // сотней тысяч игр этого не случается никогда, а на свежей или локальной
  // базе именно так «попробуй новое» молча превращалось в пустоту: смещение
  // считается от номера недели и легко оказывается больше всего каталога.
  return rows.length || !args.offset ? rows : page(0)
}

export async function fetchDiscoveryPool(db: Db, q: DiscoveryQuery): Promise<GameMeta[]> {
  const perTag = q.perTag ?? DEFAULT_PER_TAG
  const limit = q.limit ?? DEFAULT_LIMIT
  const offset = (q.rotation ?? 0) * perTag
  const mpOnly = q.requireMultiplayer ? 1 : 0
  const banned = JSON.stringify(q.bannedAppids ?? [])

  // Холодный старт: профиля ещё нет, показываем заметное
  if (!q.tags.length) return fetchNotable(db, { limit, offset, mpOnly, banned })

  // По ветке на тег: LIMIT обязан быть внутри подзапроса, иначе в SQLite он
  // применится ко всему объединению и срежет хвост последних тегов
  const branches = q.tags
    .map(
      () =>
        `SELECT appid, weight FROM (SELECT appid, weight FROM game_tags
           WHERE tag = ? ORDER BY weight DESC LIMIT ? OFFSET ?)`,
    )
    .join(' UNION ALL ')

  const args: Array<string | number> = []
  for (const tag of q.tags) args.push(tag, perTag, offset)
  args.push(mpOnly, banned, limit)

  const res = await db.execute({
    // Фильтр живости здесь такой же, как в холодном старте выше, и это не
    // дублирование ради симметрии: без него мёртвые и переехавшие в сиквел
    // игры попадали в выдачу всем, у кого есть профиль вкуса, — то есть почти
    // всем. Ветку холодного старта это не задевало, поэтому расхождение и
    // прожило незамеченным: в ней предикат стоял с самого начала. Теперь это
    // буквально одна строка — ALIVE_POOL_G из lib/db, и отстать ей нечем.
    sql: `WITH pool AS (${branches}),
               best AS (SELECT appid, MAX(weight) AS w FROM pool GROUP BY appid)
          SELECT ${GAME_LITE_COLUMNS_G} FROM best b JOIN games g ON g.appid = b.appid
            ${SEMANTICS_JOIN}
          WHERE ${ALIVE_POOL_G}
            AND (? = 0 OR g.is_multiplayer = 1)
            AND g.appid NOT IN (SELECT value FROM json_each(?))
          ORDER BY b.w DESC LIMIT ?`,
    args,
  })
  const byTaste = (res.rows as unknown as GameRow[]).map((r) => rowToMeta(r))
  if (!q.wildcard) return byTaste

  // Добор вне вкуса. Идёт ПОСЛЕ основного пула и без обрезки по limit: это
  // не «ещё немного похожего», а единственная дверь наружу из своих же тегов,
  // и срезать её вместе с хвостом ранжирования значило бы не добавить ничего.
  const seen = new Set(byTaste.map((m) => m.appid))
  const notable = await fetchNotable(db, {
    limit: q.wildcard,
    offset: (q.rotation ?? 0) * q.wildcard,
    mpOnly,
    banned,
  })
  return [...byTaste, ...notable.filter((m) => !seen.has(m.appid))]
}
