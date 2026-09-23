import { createClient, type InArgs, type InStatement } from '@libsql/client'
import { describe, expect, test } from 'vitest'
import {
  bannedAppidsOf,
  catalogSignalsQueue,
  claimNewsPollBatch,
  countNewsPollDue,
  createDb,
  getFeedForApps,
  getFeedHeadForApps,
  getHeroMedia,
  getGamesMeta,
  getGamesMetaLite,
  getMajorFeed,
  getMajorFeedHead,
  getUnsummarized,
  listPublicRooms,
  migrateDb,
  revokeAllSessions,
  getStaleAppids,
  stalePriceAppids,
  sweepStale,
  topCatalogAppids,
  topGamesByTag,
  upsertNewsItems,
  type Db,
} from './db'
import { fetchDiscoveryPool } from './pool'

/**
 * Частичные индексы и запросы, которые на них держатся.
 *
 * SQLite берёт частичный индекс, только если может доказать его предикат из
 * WHERE запроса, а доказывает он почти дословным совпадением. Расхождение не
 * ломает ни один результат: запрос просто молча становится полным сканом,
 * и видно это только по счёту Turso за прочитанные строки. noscan этого не
 * ловит — там регэксп по FROM games без WHERE и LIMIT, а у этих запросов
 * есть и то и другое.
 *
 * Поэтому здесь не текст, а план: что SQLite на самом деле сделает.
 */

const NOW = 1_700_000_000

type Issued = { sql: string; args: InArgs }

/** Все SELECT, UPDATE и DELETE, которые функция отправила в базу. */
async function statementsOf(db: Db, run: (spy: Db) => Promise<unknown>): Promise<Issued[]> {
  const issued: Issued[] = []
  const note = (q: InStatement) => {
    const sql = typeof q === 'string' ? q : q.sql
    const args = typeof q === 'string' ? [] : (q.args ?? [])
    if (/^\s*(SELECT|UPDATE|DELETE)\b/i.test(sql)) issued.push({ sql, args })
  }
  const spy = {
    execute: (q: InStatement) => {
      note(q)
      return db.execute(q)
    },
    batch: (qs: InStatement[], mode?: 'write' | 'read' | 'deferred') => {
      qs.forEach(note)
      return db.batch(qs, mode)
    },
  } as unknown as Db
  await run(spy)
  return issued
}

async function planOf(db: Db, q: Issued): Promise<string[]> {
  const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${q.sql}`, args: q.args })
  return plan.rows.map((r) => String(r.detail))
}

/**
 * Проход по таблице мимо индекса. «SCAN … USING INDEX» сюда не относится:
 * это чтение частичного индекса по порядку, он и так содержит только нужные
 * строки, а LIMIT останавливает чтение.
 */
function bareScans(plan: string[]): string[] {
  return plan.filter((step) => /^SCAN \w+$/.test(step))
}

type Case = {
  name: string
  run: (db: Db) => Promise<unknown>
  /** Каждый запрос функции обязан взять один из них. */
  indexes: string[]
  /**
   * Порядок обязан приходить из индекса. Где сортировка законна, сказано
   * почему: там её объём ограничен самим запросом, а не размером таблицы.
   */
  sortFree: boolean
}

/** Первичный ключ news_items (appid, gid): по нему лента добирает тела. */
const NEWS_PK = 'sqlite_autoindex_news_items_1'

/**
 * Лента с пустой головой до тел не доходит вовсе, поэтому её планы смотрятся
 * на живых строках — иначе вторая фаза в проверку просто не попала бы.
 * Запись идёт INSERT'ом, и statementsOf её не считает.
 */
async function withPatches(db: Db): Promise<Db> {
  await upsertNewsItems(
    db,
    [730, 570].map((appid) => ({
      appid,
      gid: '1',
      title: 'Патч',
      url: '',
      publishedAt: NOW,
      kind: 'patch' as const,
      scale: 'major' as const,
      blocks: [],
      bodyHash: 'h',
      rank: 20_000,
    })),
    NOW,
  )
  return db
}

const CASES: Case[] = [
  // Лента — две фазы: голова по частичному индексу, тела по первичному ключу
  {
    name: 'общая лента',
    run: async (db) => getMajorFeed(await withPatches(db)),
    indexes: ['idx_news_feed', NEWS_PK],
    sortFree: true,
  },
  {
    name: 'общая лента с порогом популярности',
    run: async (db) => getMajorFeed(await withPatches(db), 30, { minRank: 10_000 }),
    indexes: ['idx_news_feed', NEWS_PK],
    sortFree: true,
  },
  {
    name: 'голова общей ленты',
    run: (db) => getMajorFeedHead(db),
    indexes: ['idx_news_feed'],
    sortFree: true,
  },
  // Личная лента: несколько appid — несколько диапазонов idx_news_app, их
  // слияние по дате требует сортировки, но строк там не больше, чем патчей у
  // четырёхсот игр библиотеки за окно ленты.
  {
    name: 'личная лента',
    run: async (db) => getFeedForApps(await withPatches(db), [730, 570]),
    indexes: ['idx_news_app', NEWS_PK],
    sortFree: false,
  },
  {
    name: 'голова личной ленты',
    run: (db) => getFeedHeadForApps(db, [730, 570]),
    indexes: ['idx_news_app'],
    sortFree: false,
  },
  {
    name: 'очередь пересказа',
    run: (db) => getUnsummarized(db),
    indexes: ['idx_news_tldr_v2'],
    sortFree: true,
  },
  {
    name: 'пачка опроса новостей',
    run: (db) => claimNewsPollBatch(db, NOW),
    indexes: ['idx_news_poll_due'],
    sortFree: true,
  },
  {
    name: 'счётчик очереди опроса',
    run: (db) => countNewsPollDue(db, NOW),
    indexes: ['idx_news_poll_due'],
    sortFree: true,
  },
  // Доска пати: сортируется только правая часть ORDER BY — участники внутри
  // комнаты, а комнат на доске единицы.
  {
    name: 'доска открытых пати',
    run: (db) => listPublicRooms(db, NOW),
    indexes: ['idx_rooms_public'],
    sortFree: false,
  },
  // Холодный старт пула: порядок по отзывам — из частичного индекса, а
  // семантика доезжает поиском по ключу game_semantics на каждую строку, не
  // ломая ни порядок, ни LIMIT
  {
    name: 'пул открытий без профиля',
    run: (db) => fetchDiscoveryPool(db, { tags: [], limit: 50 }),
    indexes: ['idx_games_pool'],
    sortFree: true,
  },
  {
    name: 'топ каталога',
    run: (db) => topCatalogAppids(db),
    indexes: ['idx_games_ccu', 'idx_games_pool'],
    sortFree: true,
  },
  // Отсечки по возрасту в запросе нет — см. catalogSignalsQueue: иначе при
  // пустой очереди SQLite читал бы весь пул
  {
    name: 'очередь сигналов каталога',
    run: (db) => catalogSignalsQueue(db, 200),
    indexes: ['idx_games_reviews_at'],
    sortFree: true,
  },
  // Баны участников пати: по диапазону индекса на каждого участника. DISTINCT
  // сортирует только найденные строки этих людей, а не таблицу.
  {
    name: 'баны участников пати',
    run: (db) => bannedAppidsOf(db, ['76561198000000001', '76561198000000002']),
    indexes: ['idx_feedback_steamid'],
    sortFree: false,
  },
  {
    name: 'выйти на всех устройствах',
    run: (db) => revokeAllSessions(db, '76561198000000001', NOW),
    indexes: ['idx_sessions_steamid'],
    sortFree: true,
  },
]

describe('планы запросов', () => {
  for (const c of CASES) {
    test(`${c.name}: по индексу, без полного скана`, async () => {
      const db = await createDb(':memory:')
      const issued = await statementsOf(db, c.run)
      expect(issued.length).toBeGreaterThan(0)

      const used = new Set<string>()
      for (const q of issued) {
        const plan = await planOf(db, q)
        const where = `${c.name}: ${plan.join(' | ')}`
        expect(bareScans(plan), where).toEqual([])
        const hit = c.indexes.filter((i) => plan.some((step) => step.includes(`INDEX ${i}`)))
        expect(hit.length, where).toBeGreaterThan(0)
        hit.forEach((i) => used.add(i))
        if (c.sortFree) expect(plan.some((s) => s.includes('TEMP B-TREE')), where).toBe(false)
      }
      expect([...used].sort()).toEqual([...c.indexes].sort())
    })
  }

  /*
   * Суточная уборка в CASES не входит: сессии и комнаты она читает полным
   * сканом, и это осознанно — раз в сутки, по таблицам, которые она же и
   * держит короткими. А вот демо-личности ищутся среди ВСЕХ людей, и тут
   * скан users был бы ценой, растущей вместе с продуктом; как и скан
   * feedback или снимков библиотек — самых толстых таблиц с людьми.
   */
  test('уборка демо идёт по префиксу первичного ключа users, а не по всем людям', async () => {
    const db = await createDb(':memory:')
    const demo = (await statementsOf(db, (spy) => sweepStale(spy, NOW))).filter((q) =>
      q.sql.includes("GLOB '000*'"),
    )
    expect(demo.length).toBe(6)
    for (const q of demo) {
      const plan = await planOf(db, q)
      const where = plan.join(' | ')
      // Скан sessions — та самая сделка: истёкшие входы ищутся им же
      expect(
        bareScans(plan).filter((step) => step !== 'SCAN sessions'),
        where,
      ).toEqual([])
      expect(where).toContain('sqlite_autoindex_users_1 (steamid>? AND steamid<?)')
    }
  })

  /*
   * Полка «Похожие» досортировывает ничьи по отзывам, и это законно, пока
   * сортировка касается только правой части ORDER BY: вес приходит из индекса
   * (tag, weight DESC), а по отзывам упорядочивается один блок равных весов, в
   * который попал LIMIT. Полная сортировка читала бы весь тег — у Action это
   * две с половиной тысячи строк на каждую карточку из карты сайта.
   */
  test('полка «Похожие»: по индексу тега, досортировка только внутри ничьих', async () => {
    const db = await createDb(':memory:')
    const issued = await statementsOf(db, (spy) => topGamesByTag(spy, 'Action', 730))
    expect(issued).toHaveLength(1)
    const plan = await planOf(db, issued[0]!)
    const where = plan.join(' | ')
    expect(bareScans(plan), where).toEqual([])
    expect(where).toContain('INDEX idx_game_tags_tag (tag=?)')
    expect(
      plan.filter((step) => step.includes('TEMP B-TREE')),
      where,
    ).toEqual(['USE TEMP B-TREE FOR RIGHT PART OF ORDER BY'])
  })

  test('у каждого частичного индекса схемы есть запрос, который это проверяет', async () => {
    // Сторож на сам список: новый частичный индекс без строки в CASES — это
    // индекс, про который никто не узнает, если запрос от него отъедет.
    const db = await createDb(':memory:')
    const res = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND sql LIKE '%WHERE%'",
    )
    const partial = res.rows.map((r) => String(r.name)).sort()
    const covered = new Set(CASES.flatMap((c) => c.indexes))
    expect(partial.filter((name) => !covered.has(name))).toEqual([])
  })
})

/**
 * Выборки по списку appid: библиотека целиком одним JSON-параметром.
 *
 * `appid IN (SELECT value FROM json_each(?))` — не IN (?, …), потому что тот
 * упирается в лимит переменных SQLite на 32 767 играх (lib/db.test.ts). Цена
 * замены могла бы быть скрытой: SQLite вправе прочитать games целиком и
 * сверять каждую строку со списком. Здесь проверяется, что он идёт от списка
 * к строкам — поиском по первичному ключу на каждый appid.
 *
 * Метаданные пачкой джойнят семантику (SEMANTICS_JOIN), и у них та же
 * проверка для второй таблицы: одна строка game_semantics по ключу на игру, а
 * не проход по всей семантике каталога.
 */
describe('выборки по списку appid', () => {
  const IDS = [730, 570, 620]
  const WITH_SEMANTICS = new Set(['getGamesMeta', 'getGamesMetaLite'])
  const LIST_READS: Array<[string, (db: Db) => Promise<unknown>]> = [
    ['getGamesMeta', (db) => getGamesMeta(db, IDS)],
    ['getGamesMetaLite', (db) => getGamesMetaLite(db, IDS)],
    ['getHeroMedia', (db) => getHeroMedia(db, IDS)],
    ['getStaleAppids', (db) => getStaleAppids(db, IDS, 86_400, NOW)],
    ['stalePriceAppids', (db) => stalePriceAppids(db, IDS, 3600, NOW)],
  ]

  for (const [name, run] of LIST_READS) {
    test(`${name}: по первичному ключу, без прохода по games`, async () => {
      const db = await createDb(':memory:')
      const issued = await statementsOf(db, run)
      expect(issued.length).toBe(1)
      const plan = await planOf(db, issued[0])
      const where = plan.join(' | ')
      // games бывает и под алиасом g — в выборках с джойном семантики
      expect(bareScans(plan).filter((step) => /^SCAN (games|g|s)$/.test(step)), where).toEqual([])
      expect(where).toMatch(/SEARCH (games|g) USING INTEGER PRIMARY KEY/)
      if (WITH_SEMANTICS.has(name)) expect(where).toContain('SEARCH s USING PRIMARY KEY (appid=?)')
      expect(issued[0].sql).toContain('json_each(?)')
    })
  }
})

describe('смена определения индекса', () => {
  /**
   * Так выглядела живая база: индекс с прежним предикатом «scale IS NULL»
   * пережил его смену, потому что CREATE INDEX IF NOT EXISTS смотрит только
   * на имя.
   *
   * База на каждый тест своя: EXPLAIN в libsql оставляет запрос открытым, и
   * DROP INDEX на том же соединении падал бы с SQLITE_LOCKED — в проде EXPLAIN
   * никто не зовёт, это особенность только теста.
   */
  async function driftedDb(): Promise<Db> {
    const db = await migrateDb(createClient({ url: ':memory:' }))
    await db.executeMultiple(`
      DROP INDEX idx_news_tldr_v2;
      CREATE INDEX idx_news_tldr ON news_items (published_at DESC)
        WHERE kind = 'patch' AND tldr IS NULL AND tldr_tries < 3 AND scale IS NULL;`)
    return db
  }

  test('со старым определением очередь пересказа читает news_items целиком', async () => {
    // Цена дрейфа: запрос повторяет НОВЫЙ предикат, и старый индекс ему не годится
    const db = await driftedDb()
    const [q] = await statementsOf(db, (spy) => getUnsummarized(spy))
    expect(bareScans(await planOf(db, q))).toEqual(['SCAN news_items'])
  })

  test('миграция снимает старый idx_news_tldr, и очередь уходит на новый индекс', async () => {
    const db = await driftedDb()
    await migrateDb(db)

    const names = await db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_news_tldr%'",
    )
    expect(names.rows.map((r) => r.name)).toEqual(['idx_news_tldr_v2'])
    const [after] = await statementsOf(db, (spy) => getUnsummarized(spy))
    const plan = await planOf(db, after)
    expect(bareScans(plan)).toEqual([])
    expect(plan.join(' | ')).toContain('idx_news_tldr_v2')
  })
})
