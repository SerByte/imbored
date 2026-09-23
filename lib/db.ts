import { createClient, type Client } from '@libsql/client'
import { memberLabel } from './room'
import type { GameArtUrls } from './art'
import { isDeadReason } from './liveness'
import { OTHER_STORE_GAMES } from './otherstores'
import { SESSION_TOUCH_AFTER_SEC, SESSION_TTL_SEC } from './sessions'
import type { NewsBlock } from './steamhtml'
import type { GameMeta, LibraryGame, Mood } from './types'

/** Соединение с БД: локальный файл в dev, Turso в проде — API одинаковый */
export type Db = Client

/**
 * 'launched' — нажал «Запустить». Раньше это писалось как 'liked', и точность
 * подбора на /library росла от любого клика: запуск — ещё не «зашло», а
 * человек, запустивший игру и тут же закрывший её, выглядел довольным.
 */
export type FeedbackAction = 'liked' | 'skipped' | 'opened' | 'banned' | 'launched'

/**
 * 'spin' — «Крутить ещё» в рулетке: не оценка игры, а бросок кубика. Ни вкуса,
 * ни точности подбора не трогает. 'done' — «Уже прошёл» рядом с баном: бан, но
 * по другой причине, чем «не нравится».
 *
 * У reason в таблице нет CHECK, поэтому новые значения не требуют миграции.
 */
export type SkipReason = 'genre' | 'hard' | 'tired' | 'notnow' | 'spin' | 'done'

export type FeedbackRow = {
  steamid: string
  appid: number
  action: FeedbackAction
  reason?: SkipReason
  mood?: Mood
  createdAt: number
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  steamid TEXT PRIMARY KEY,
  persona_name TEXT,
  avatar_url TEXT,
  portrait_json TEXT,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
/*
 * Сессии. Строка здесь — НЕ источник истины о том, вошёл ли человек: это
 * решает подпись куки. Таблица существует ровно ради обратного действия —
 * погасить вход досрочно.
 *
 * Разница принципиальная. Если считать сессию живой только при наличии строки,
 * то икота Turso, холодный старт с пустой базой или не записавшийся INSERT
 * означают массовый разлогин — ровно та беда, которую эта задача чинит.
 * Поэтому «строки нет» и «строка отозвана» обязаны быть разными состояниями:
 * отзыв — это revoked_at, а не DELETE. Надгробие убирается, только когда
 * все токены с его sid уже истекли сами (sweepStale), или вместе со всеми
 * данными по запросу человека (forgetUser).
 *
 * Строк накапливается по одной на ВХОД, а не на визит (sid живёт вместе с
 * кукой и при продлении не меняется), но демо-вход — тоже вход, и его жмут
 * гости лендинга; поэтому суточная уборка всё же есть (sweepStale).
 */
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  steamid TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  revoked_at INTEGER,
  device TEXT,
  verified INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_sessions_steamid ON sessions (steamid) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS library_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steamid TEXT NOT NULL,
  taken_at INTEGER NOT NULL,
  games_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_steamid ON library_snapshots (steamid, taken_at DESC);
/*
 * Отметка библиотеки на начало года — единственные данные проекта, которые
 * нельзя получить задним числом.
 *
 * GetOwnedGames отдаёт только пожизненные часы и playtime_2weeks. Значит
 * «сколько наиграно за 2026» считается ровно одним способом: часы сейчас минус
 * часы на начало года. Обычных снапшотов хранится три штуки скользящим окном
 * (SNAPSHOTS_KEPT), то есть к декабрю от января не остаётся ничего, и никакой
 * запрос к Steam этого уже не вернёт.
 *
 * Поэтому таблица отдельная, а не «не удалять часть library_snapshots»: у неё
 * другой жизненный цикл. Строка на игрока и год, пишется один раз и
 * удаляется только вместе со всеми данными игрока по его запросу (forgetUser).
 * Об этом прямо сказано в /privacy, раздел 06.
 */
CREATE TABLE IF NOT EXISTS library_baselines (
  steamid TEXT NOT NULL,
  year INTEGER NOT NULL,
  taken_at INTEGER NOT NULL,
  games_json TEXT NOT NULL,
  PRIMARY KEY (steamid, year)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS games (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '{}',
  genres_json TEXT NOT NULL DEFAULT '[]',
  categories_json TEXT NOT NULL DEFAULT '[]',
  short_description TEXT,
  header_image TEXT,
  screenshots_json TEXT,
  is_free INTEGER,
  price_final INTEGER,
  release_date TEXT,
  median_forever INTEGER,
  store TEXT,
  store_url TEXT,
  reviews_summary_json TEXT,
  pros_cons_json TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  steamid TEXT NOT NULL,
  appid INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened','banned','launched')),
  reason TEXT,
  mood_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_steamid ON feedback (steamid, created_at DESC);
-- deck_round/deck_size — свойства КОМНАТЫ, а не участника: пул кандидатов
-- крутится по rotationSlot(id комнаты, created_at), поэтому колода у всех одна
-- и та же и не меняется со сменой недели.
-- Знаменатель «12 из 20» в ростере ожидания берётся отсюда.
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  mood_json TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  matched_appid INTEGER,
  is_public INTEGER NOT NULL DEFAULT 0,
  deck_round INTEGER NOT NULL DEFAULT 0,
  deck_size INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS room_members (
  room_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  persona_name TEXT,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, steamid)
);
CREATE TABLE IF NOT EXISTS room_votes (
  room_id TEXT NOT NULL,
  steamid TEXT NOT NULL,
  appid INTEGER NOT NULL,
  vote INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, steamid, appid)
);
/*
 * Карты, которые комнате РАЗДАВАЛИ, — объединение всех колод, выданных
 * /api/room/[id]/deck за её жизнь.
 *
 * Голос принимается только за игру отсюда (castDeckVote). Без этого голос был
 * записью с любым appid: участник публичной комнаты (вход бесплатный, через
 * демо) мог набить room_votes произвольными играми без края, а каждый опрос
 * комнаты у каждого участника перечитывал бы их все в roomVoteCounts.
 *
 * Объединение, а не последняя колода: она пересобирается при входе нового
 * участника, и карта, которую кто-то уже держит в руке, из новой колоды может
 * выпасть. Голос за неё честный — отвергать его значит вернуть человеку
 * карточку, которую он уже свайпнул.
 */
CREATE TABLE IF NOT EXISTS room_deck (
  room_id TEXT NOT NULL,
  appid INTEGER NOT NULL,
  PRIMARY KEY (room_id, appid)
) WITHOUT ROWID;
/*
 * Окна ограничителя частоты (lib/ratelimit.ts). Ключ уже содержит номер окна,
 * поэтому индекс не нужен: любое чтение — точное попадание по первичному
 * ключу. expires_at существует только ради подметания из крона.
 */
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
) WITHOUT ROWID;
/*
 * Выбранная игра дня.
 *
 * Обещание страницы — «одна игра на весь день», и до этой таблицы оно
 * держалось на честном слове: pickDaily детерминирован при ФИКСИРОВАННОМ пуле
 * и профиле, а пул растёт по мере прогрева каталога, профиль — с каждым
 * «Зашло». Именно поэтому /daily ждёт полного прогрева (см. комментарий у
 * runWarmup в app/daily/page.tsx) — ожидание покупало устойчивость выбора.
 * Запись делает обещание истинным по построению, а не ожиданием.
 *
 * Второй эффект — цена. Один вызов /api/daily стоил около восьмисот
 * прочитанных строк (снапшот, метаданные библиотеки, фидбек, статистика тегов,
 * пул на четыре сотни) ради ответа, который не меняется до полуночи.
 *
 * Хранится результат ОТБОРА, а не готовый ответ: цены и скидки обязаны
 * оставаться свежими, поэтому они пересчитываются на каждом заходе по
 * четырём appid.
 */
CREATE TABLE IF NOT EXISTS daily_picks (
  steamid TEXT NOT NULL,
  day TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (steamid, day)
) WITHOUT ROWID;
/*
 * Служебные ключи: курсоры крона, аренды, счётчики каталога и флаги миграций.
 * Здесь, а не в SCHEMA_CATALOG рядом с остальным каталогом: migrateDb читает
 * из неё версию схемы ДО ALTER-цикла, чтобы решить, нужен ли он вообще.
 */
CREATE TABLE IF NOT EXISTS catalog_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/**
 * Схема каталога. Отделена от SCHEMA, потому что часть её объектов ссылается
 * на колонки, добавляемые ALTER-циклом, и создаваться должна строго после него.
 *
 * Ключевое разделение: catalog_ingest — карта территории (все игры Steam,
 * ~170 тысяч), games — только то, что реально показываем. Полный каталог
 * в games не влезает по бюджету прочитанных строк Turso.
 *
 * ПРАВИЛО ДЛЯ ИНДЕКСОВ (здесь, в SCHEMA_NEWS и в SCHEMA). CREATE INDEX IF NOT
 * EXISTS смотрит только на имя: если индекс с таким именем в базе уже есть,
 * новое определение молча пропускается. Правка предиката или колонок доезжает
 * до свежих баз, то есть до всех тестов, а живая база остаётся со старым
 * индексом, и запрос, повторяющий НОВЫЙ предикат, идёт полным сканом — видно
 * это только по счёту Turso. Так случилось с idx_news_tldr. Поэтому: поменял
 * определение — дай индексу новое имя (…_v2, …_v3) и положи DROP INDEX IF
 * EXISTS старого имени в тот же блок, перед созданием нового. Версия схемы
 * для этого не нужна: блок выполняется на каждом старте. Планы запросов к
 * частичным индексам проверяет lib/queryplan.test.ts.
 */
const SCHEMA_CATALOG = `
CREATE TABLE IF NOT EXISTS catalog_ingest (
  appid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tagids_json TEXT NOT NULL DEFAULT '[]',
  release_year INTEGER,
  reviews_total INTEGER,
  reviews_percent INTEGER,
  price_final INTEGER,
  status TEXT NOT NULL DEFAULT 'seen',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ingest_rank ON catalog_ingest (reviews_total DESC);
CREATE INDEX IF NOT EXISTS idx_ingest_status ON catalog_ingest (status, reviews_total DESC);

CREATE TABLE IF NOT EXISTS tags (
  tagid INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  game_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS game_tags (
  appid INTEGER NOT NULL,
  tag TEXT NOT NULL,
  weight INTEGER NOT NULL,
  PRIMARY KEY (appid, tag)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_game_tags_tag ON game_tags (tag, weight DESC);

CREATE INDEX IF NOT EXISTS idx_games_pool ON games (reviews_total DESC)
  WHERE alive = 1 AND superseded_by IS NULL AND tag_count > 0;

-- набор игр для опроса новостей по живому онлайну
CREATE INDEX IF NOT EXISTS idx_games_ccu ON games (ccu DESC)
  WHERE alive = 1 AND superseded_by IS NULL AND tag_count > 0;

-- Доска «ищут игроков». Единственный индекс на rooms, и он нужен: страница
-- /rooms опрашивает listPublicRooms раз в несколько секунд из КАЖДОЙ открытой
-- вкладки, а без индекса это полный скан таблицы плюс сортировка во временной
-- структуре. Предикат повторяет условие listPublicRooms ДОСЛОВНО — иначе
-- SQLite частичный индекс не выберет (та же причина, что у idx_games_pool).
-- Здесь, а не в SCHEMA: is_public у старых баз приезжает ALTER'ом, а этот
-- блок выполняется строго после ALTER-цикла.
CREATE INDEX IF NOT EXISTS idx_rooms_public ON rooms (created_at DESC)
  WHERE is_public = 1 AND status = 'open';
`

/**
 * Патчноуты игр и очередь их опроса.
 *
 * Отдельные таблицы, а не колонки на games — по трём причинам:
 *   • лента «Что нового» сортируется по дате ПОПЕРЁК игр, а из пер-геймовых
 *     блобов такой запрос собирается только полным сканом games (см. noscan);
 *   • в очередь надо ставить игры из библиотеки пользователя, а строки в games
 *     для них может ещё не быть — ensureMeta доходит не до всех;
 *   • ноль новых колонок на games означает, что upsertGameMeta трогать не надо
 *     вовсе: там ON CONFLICT DO UPDATE SET с перечислением колонок, и всё, чего
 *     в списке нет, и так не переписывается.
 *
 * Ни на одну колонку из ALTER-цикла эти объекты не ссылаются, поэтому схема
 * применяется сразу после SCHEMA, до ALTER-цикла.
 *
 * Сменил предикат индекса — переименуй его, а старое имя сними через
 * DROP INDEX IF EXISTS; подробно — ПРАВИЛО ДЛЯ ИНДЕКСОВ у SCHEMA_CATALOG.
 */
const SCHEMA_NEWS = `
CREATE TABLE IF NOT EXISTS news_items (
  appid INTEGER NOT NULL,
  gid TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  published_at INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'news',
  scale TEXT,
  blocks_json TEXT NOT NULL DEFAULT '[]',
  body_hash TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  rank INTEGER NOT NULL DEFAULT 0,
  tldr TEXT,
  tldr_at INTEGER,
  tldr_tries INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (appid, gid)
);
CREATE INDEX IF NOT EXISTS idx_news_app ON news_items (appid, published_at DESC);

-- общая лента: только крупные патчи игр из каталога (rank > 0), а не всё подряд
CREATE INDEX IF NOT EXISTS idx_news_feed ON news_items (published_at DESC)
  WHERE kind = 'patch' AND scale = 'major' AND rank > 0;

-- Очередь на пересказ. Мелочь, которой эвристика уже проставила hotfix
-- (обновления карт из мастерской и подобное), до модели не доезжает вовсе —
-- пересказывать там нечего. Всё остальное идёт за пересказом и уточнением
-- масштаба. tldr_tries отсекает вечно падающие записи.
--
-- _v2, потому что у прежнего idx_news_tldr был предикат «scale IS NULL».
-- Когда его сменили, живые базы остались со старым определением (CREATE INDEX
-- IF NOT EXISTS смотрит только на имя), и очередь пересказа, повторяющая
-- новый предикат, читала news_items полным сканом на каждом прогоне крона.
DROP INDEX IF EXISTS idx_news_tldr;
CREATE INDEX IF NOT EXISTS idx_news_tldr_v2 ON news_items (published_at DESC)
  WHERE kind = 'patch' AND tldr IS NULL AND tldr_tries < 3 AND scale IS NOT 'hotfix';

CREATE TABLE IF NOT EXISTS news_poll (
  appid INTEGER PRIMARY KEY,
  tier INTEGER NOT NULL DEFAULT 1,
  next_at INTEGER NOT NULL,
  last_at INTEGER,
  last_pub_at INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'new',
  enrolled_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_poll_due ON news_poll (next_at) WHERE status != 'gone';
`

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',')
}

/**
 * Сколько файловая база ждёт чужую блокировку, прежде чем ответить SQLITE_BUSY.
 *
 * По умолчанию libsql не ждёт вовсе. Продакшен-сборка на копии базы в файле
 * запускает migrateDb в каждом воркере разом, и первый же воркер, попавший
 * на чужую запись, ронял сборку на случайной /game/… — уже при трёх воркерах.
 *
 * Именно опция клиента, а не PRAGMA busy_timeout после подключения: клиент
 * открывает новое соединение после каждой transaction(), и PRAGMA на нём уже
 * не действует, а опция ставится на каждое.
 */
const FILE_BUSY_TIMEOUT_MS = 10_000

export async function createDb(
  url: string,
  authToken?: string,
  opts: MigrateOptions = {},
): Promise<Db> {
  const client = createClient({
    url,
    ...(authToken ? { authToken } : {}),
    // Turso эту опцию не читает, но и передавать её туда незачем
    ...(url.startsWith('file:') ? { timeout: FILE_BUSY_TIMEOUT_MS } : {}),
  })
  return migrateDb(client, process.env, opts)
}

export type MigrateOptions = {
  /**
   * Досеять заготовленное содержимое — кураторский пул других магазинов
   * (lib/otherstores). Только для базы приложения: getDb в lib/server.
   *
   * Не по умолчанию, потому что migrateDb зовут не только для неё. Скрипты
   * открывают ею и data/catalog.db, откуда publish-catalog везёт строки в
   * прод, а тестам нужна пустая база — одиннадцать чужих игр в каждой
   * :memory: меняли бы пул кандидатов под десятками проверок.
   */
  seedContent?: boolean
}

/**
 * Ключ разового бэкфилла производных колонок games. Версия в имени —
 * чтобы следующий бэкфилл можно было прогнать, не трогая этот.
 */
const DERIVED_BACKFILL_KEY = 'derived_backfilled_v1'

/** Ключ разовой пометки карточек, помеченных обогащёнными без данных. */
const PAGE_TRIES_BACKFILL_KEY = 'page_tries_backfilled_v1'

/** Ключ разовой починки веса у уже записанных патчей (см. migrateDb). */
const NEWS_RANK_FIX_KEY = 'news_rank_fixed'

/** Ключ в catalog_meta: до какой версии схемы доведена база. */
const SCHEMA_V_KEY = 'schema_v'

/** Ключ разового досева кураторского пула других магазинов (см. migrateDb). */
const OTHER_STORES_SEED_KEY = 'other_stores_seeded_v1'

/**
 * Версия схемы: набор колонок из ADDED_COLUMNS плюс форма таблиц, которые
 * приходится пересобирать (CHECK у feedback).
 *
 * ALTER TABLE ADD COLUMN не умеет IF NOT EXISTS, и миграция раньше просто
 * пробовала добавить каждую колонку, глотая «duplicate column name». На живой
 * базе это три десятка заведомо падающих запросов на КАЖДОМ холодном старте,
 * и каждый — отдельный поход в Turso: секунды до первого ответа нового
 * инстанса, и ровно в этом окне любой обрыв ронял инициализацию целиком.
 * База, доведённая до этой версии, пропускает и ALTER, и проверку CHECK.
 *
 * ПОДНИМИ ВЕРСИЮ, если добавил колонку в ADDED_COLUMNS или поменял то, что
 * migrateDb делает под upgrade. Иначе на живой базе, где версия уже записана,
 * изменение не выполнится никогда, а тесты этого не заметят: на свежей
 * :memory: версии нет, и миграция там идёт целиком. Об этом напомнит сторож
 * «новая колонка без новой версии схемы» в lib/db.test.ts.
 *
 * Новым таблицам и индексам версия не нужна: блоки CREATE … IF NOT EXISTS
 * выполняются на каждом старте, по одному обращению на блок.
 */
export const CURRENT_SCHEMA_V = 1

/**
 * Колонки, добавленные после первых версий схемы.
 *
 * НОВАЯ КОЛОНКА — ПОДНЯТЬ CURRENT_SCHEMA_V, см. докблок выше.
 */
export const ADDED_COLUMNS = [
  ['games', 'store TEXT'],
  ['games', 'store_url TEXT'],
  ['games', 'art_json TEXT'],
  ['feedback', 'reason TEXT'],
  ['rooms', 'is_public INTEGER NOT NULL DEFAULT 0'],
  // Обязательно и здесь, и в SCHEMA: на живой базе CREATE TABLE IF NOT
  // EXISTS — no-op, и колонка «только в SCHEMA» появится лишь на свежей
  // :memory: из тестов, а в проде каждый запрос комнаты упадёт
  ['rooms', 'deck_round INTEGER NOT NULL DEFAULT 0'],
  ['rooms', 'deck_size INTEGER'],
  ['users', 'portrait_json TEXT'],
  // «выйти на всех устройствах»: отсечка по времени выдачи токена.
  // Страхует случай, когда строки сессии нет вовсе и гасить по sid нечего.
  ['users', 'sessions_from INTEGER'],
  // сигналы актуальности и производные поля для выборки без полного скана
  ['games', 'release_year INTEGER'],
  ['games', 'developer TEXT'],
  ['games', 'publisher TEXT'],
  ['games', 'reviews_total INTEGER'],
  ['games', 'reviews_percent INTEGER'],
  ['games', 'reviews_30d INTEGER'],
  ['games', 'ccu INTEGER'],
  ['games', 'ccu_at INTEGER'],
  ['games', 'signals_at INTEGER'],
  ['games', 'tag_count INTEGER NOT NULL DEFAULT 0'],
  ['games', 'is_multiplayer INTEGER NOT NULL DEFAULT 0'],
  ['games', 'alive INTEGER NOT NULL DEFAULT 1'],
  ['games', 'dead_reason TEXT'],
  ['games', 'superseded_by INTEGER'],
  // когда карточку игры последний раз обогащали (скриншоты, отзывы, pros/cons).
  // NULL — ни разу; см. lib/pagejob.ts
  ['games', 'page_at INTEGER'],
  // Сколько раз подряд поход за карточкой возвращался пустым. Ноль — данные
  // приехали (или ещё не ходили). Отличает «сходили и привезли» от «сходили
  // и не привезли», которые до появления колонки были одним и тем же
  // page_at; см. markPageMissed и lib/pagejob.ts.
  ['games', 'page_tries INTEGER NOT NULL DEFAULT 0'],
  // цена без скидки, размер скидки, её конец и время замера — своя ось
  // свежести у цены, метаданные живут в 30 раз дольше распродажи
  ['games', 'price_initial INTEGER'],
  ['games', 'discount_percent INTEGER'],
  ['games', 'discount_ends_at INTEGER'],
  ['games', 'price_at INTEGER'],
  ['sessions', 'verified INTEGER NOT NULL DEFAULT 0'],
] as const

/**
 * Флаги миграций одним запросом.
 *
 * Раньше каждый флаг бэкфилла читался своим SELECT'ом — лишние походы в базу
 * на каждом старте ради ответа, который почти всегда «уже сделано».
 */
async function readMigrationFlags(db: Db): Promise<Map<string, string>> {
  const keys = [
    SCHEMA_V_KEY,
    DERIVED_BACKFILL_KEY,
    PAGE_TRIES_BACKFILL_KEY,
    NEWS_RANK_FIX_KEY,
    OTHER_STORES_SEED_KEY,
  ]
  const res = await db.execute({
    sql: `SELECT key, value FROM catalog_meta WHERE key IN (${placeholders(keys.length)})`,
    args: keys,
  })
  return new Map(res.rows.map((r) => [String(r.key), String(r.value)]))
}

/**
 * ALTER только для колонок, которых в базе действительно нет.
 *
 * Что уже есть, узнаётся одним запросом по всем таблицам сразу, а не попыткой
 * ALTER с разбором ошибки. Если сам этот запрос не прошёл (сервер не пустил
 * табличную функцию pragma_table_info — на Turso это из тестов не проверить),
 * миграция пробует каждую колонку, как раньше, и платит за это один раз:
 * после неё будет записана версия схемы.
 */
async function addMissingColumns(db: Db): Promise<void> {
  const tables = [...new Set(ADDED_COLUMNS.map(([table]) => table))]
  let have: Set<string> | null = null
  try {
    const res = await db.execute({
      sql: `SELECT m.name AS tbl, p.name AS col
              FROM sqlite_master m, pragma_table_info(m.name) p
             WHERE m.type = 'table' AND m.name IN (${placeholders(tables.length)})`,
      args: tables,
    })
    have = new Set(res.rows.map((r) => `${r.tbl}.${r.col}`))
  } catch {
    have = null
  }

  for (const [table, col] of ADDED_COLUMNS) {
    if (have?.has(`${table}.${col.split(' ')[0]}`)) continue
    try {
      await db.execute(`ALTER TABLE ${table} ADD COLUMN ${col}`)
    } catch (e) {
      // «Колонка уже есть» — ожидаемо, и это единственная причина молчать.
      // После проверки выше так бывает, когда два инстанса стартуют разом.
      // Всё остальное (недоступная Turso, кончившееся место, битая схема) —
      // настоящий сбой, а раньше он был неотличим от дубликата: миграция
      // «успешно» доходила до конца на половине добавленных колонок, и
      // падало уже не здесь, а на первом же запросе к отсутствующему полю.
      const msg = e instanceof Error ? e.message : String(e)
      if (!/duplicate column name/i.test(msg)) throw e
    }
  }
}

/**
 * Старый CHECK у feedback не пускает новые action — сначала 'banned', теперь
 * 'launched'. SQLite не умеет менять CHECK на месте, поэтому таблица
 * пересобирается целиком. Условие проверяет именно последнее добавленное
 * значение в кавычках: после пересборки оно в SQL таблицы есть, и повтор
 * ничего не делает. Одна ветка покрывает и совсем старую схему без 'banned' —
 * в ней тоже нет 'launched'.
 *
 * Зовётся только под upgrade: новый action в CHECK — это тоже подъём
 * CURRENT_SCHEMA_V, иначе живая база его не увидит.
 *
 * Пересборка разрушающая, поэтому спрашивает разрешения (см.
 * destructiveMigrationsAllowed). false — пересборка нужна, но не выполнена:
 * схема НЕ доведена, и версию писать нельзя.
 */
async function rebuildFeedbackCheck(db: Db, allowed: boolean): Promise<boolean> {
  const info = await db.execute(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='feedback'",
  )
  const createSql = info.rows[0]?.sql as string | undefined
  if (createSql?.includes('CHECK') && !createSql.includes("'launched'")) {
    if (!allowed) return false
    await db.batch(
      [
        // Хвост прерванной попытки: без него CREATE упал бы на каждом старте
        'DROP TABLE IF EXISTS feedback_new',
        `CREATE TABLE feedback_new (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           steamid TEXT NOT NULL,
           appid INTEGER NOT NULL,
           action TEXT NOT NULL CHECK (action IN ('liked','skipped','opened','banned','launched')),
           reason TEXT,
           mood_json TEXT,
           created_at INTEGER NOT NULL
         )`,
        `INSERT INTO feedback_new (id, steamid, appid, action, reason, mood_json, created_at)
           SELECT id, steamid, appid, action, reason, mood_json, created_at FROM feedback`,
        'DROP TABLE feedback',
        'ALTER TABLE feedback_new RENAME TO feedback',
        'CREATE INDEX IF NOT EXISTS idx_feedback_steamid ON feedback (steamid, created_at DESC)',
      ],
      'write',
    )
  }
  return true
}

/** Переменная, которой владелец говорит: у превью своя база, миграции можно. */
export const PREVIEW_OWN_DB_ENV = 'PREVIEW_OWN_DB'

/**
 * Можно ли этому окружению разрушающие шаги миграции: пересборку таблиц
 * через DROP и RENAME, а впредь всё, что стирает или переписывает исходные
 * данные. Добавляешь такой шаг — ставь его под этот же вопрос.
 *
 * ЗАЧЕМ. По старой инструкции DEPLOY.md превью получали те же TURSO_*, что и
 * прод. Пуш ветки создаёт превью, его сборка и первый холодный старт гонят
 * migrateDb, и пересборка feedback из ветки выполнялась на живой базе ещё до
 * ревью. Откатили ветку, а схема и строки остались. Правильная защита —
 * отдельная база у превью, и её заводит владелец (DEPLOY.md, раздел о
 * превью). Эта проверка — страховка на случай, если переменные снова
 * разъедутся: превью без явного «база своя» ничего не пересобирает.
 *
 * Прод, локальная разработка и скрипты не затронуты: VERCEL_ENV там
 * 'production' или его нет вовсе.
 *
 * Бэкфиллы производных колонок сюда не относятся: они считают значения из
 * уже лежащих данных и повторяются без потерь.
 */
export function destructiveMigrationsAllowed(env: Record<string, string | undefined>): boolean {
  return env.VERCEL_ENV !== 'preview' || env[PREVIEW_OWN_DB_ENV] === '1'
}

/**
 * Схема и миграции; идемпотентно, безопасно вызывать на каждом старте.
 *
 * На уже доведённой базе это четыре обращения: три блока CREATE … IF NOT
 * EXISTS и одно чтение флагов. Всё остальное — ALTER, пересборка feedback,
 * бэкфиллы по games и news_items — закрыто версией схемы или своим флагом.
 *
 * env — окружение для destructiveMigrationsAllowed; параметром, чтобы тест
 * мог изобразить превью, не трогая process.env.
 */
export async function migrateDb(
  db: Db,
  env: Record<string, string | undefined> = process.env,
  opts: MigrateOptions = {},
): Promise<Db> {
  await db.executeMultiple(SCHEMA)

  // новостные таблицы самодостаточны и на ALTER-колонки не ссылаются
  await db.executeMultiple(SCHEMA_NEWS)

  const flags = await readMigrationFlags(db)
  // «не меньше», а не «меньше»: мусор вместо числа тоже означает «доводить»
  const upgrade = !(Number(flags.get(SCHEMA_V_KEY) ?? 0) >= CURRENT_SCHEMA_V)

  if (upgrade) await addMissingColumns(db)

  // строго после ALTER-цикла: частичный индекс ссылается на новые колонки
  await db.executeMultiple(SCHEMA_CATALOG)

  // Разовый бэкфилл производных колонок для строк, записанных до их появления.
  // Без него холодный старт выборки кандидатов не увидит ни одной игры:
  // условие tag_count > 0 не выполнится ни для кого.
  //
  // Под флагом ровно по той же причине, что и починка rank двадцатью строками
  // ниже: без него это два полнотабличных UPDATE по games на КАЖДОМ холодном
  // старте, ни один из них не опирается на индекс, а Turso считает
  // прочитанные строки. Соседний фикс был закрыт флагом, эти два — нет, и
  // разница обходилась в каталог целиком на каждый новый инстанс.
  if (!flags.has(DERIVED_BACKFILL_KEY)) {
    await db.execute(`UPDATE games SET tag_count = (
        SELECT COUNT(*) FROM json_each(games.tags_json)
      ) WHERE tag_count = 0 AND tags_json != '{}'`)
    await db.execute(`UPDATE games SET is_multiplayer = 1
      WHERE is_multiplayer = 0 AND EXISTS (
        SELECT 1 FROM json_each(games.categories_json) WHERE value IN (1,9,24,36,38,39,49)
      )`)
    await db.execute({
      sql: 'INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)',
      args: [DERIVED_BACKFILL_KEY, '1'],
    })
  }

  /*
   * Кураторский пул других магазинов (lib/otherstores) — раз на базу.
   *
   * Раньше его досевал POST /api/prepare на каждом вызове, то есть на пути
   * прогрева, который человек ждёт. Защёлка на процесс гасила повторы внутри
   * инстанса, но каждый новый инстанс начинал прогрев с лишнего чтения.
   * Здесь цена — одно обращение за всю жизнь базы: флаг читается тем же
   * запросом, что и остальные.
   *
   * Досев, а не апсерт: если строка уже есть, её не трогаем. Строки пропали
   * (ручная чистка games) — сними флаг, и следующий холодный старт досеет.
   * Демо-вход досевает пул и сам, вместе со своими карточками (seedDemo).
   * Почему только по opts.seedContent — см. MigrateOptions.
   */
  if (opts.seedContent && !flags.has(OTHER_STORES_SEED_KEY)) {
    await insertMissingGamesMeta(db, OTHER_STORE_GAMES, Math.floor(Date.now() / 1000))
    await db.execute({
      sql: 'INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)',
      args: [OTHER_STORES_SEED_KEY, '1'],
    })
  }

  /*
   * Разовая пометка карточек, которые помечены обогащёнными, а данных с ними
   * не приехало.
   *
   * Признак — пустые скриншоты: их источник только appdetails, и если поход
   * туда удался, они есть почти у любой игры Steam. На проде под это условие
   * попадает 596 карточек из 721 обогащённой, и это верх каталога по числу
   * отзывов: CS2, Dota 2, Rainbow Six, Team Fortress 2, Terraria.
   *
   * Ставим единицу, а не ноль: с page_tries = 1 карточка возвращается в
   * очередь (см. claimPageEnrichBatch) и попадает в первую группу, но остаётся
   * под потолком PAGE_MAX_TRIES. Игра, у которой скриншотов действительно нет,
   * потратит на это один поход, после чего удачная отметка сбросит счётчик и
   * уберёт её из повторов.
   *
   * Под флагом по той же причине, что и бэкфилл выше: это полнотабличный
   * UPDATE по games, а Turso считает прочитанные строки.
   */
  if (!flags.has(PAGE_TRIES_BACKFILL_KEY)) {
    await db.execute(`UPDATE games SET page_tries = 1
      WHERE page_at IS NOT NULL AND page_tries = 0
        AND (screenshots_json IS NULL OR screenshots_json = '[]')`)
    await db.execute({
      sql: 'INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)',
      args: [PAGE_TRIES_BACKFILL_KEY, '1'],
    })
  }

  // Разовая починка веса у уже записанных патчей. До неё вес считался по числу
  // отзывов для любой опрошенной игры, и в общую ленту налезли Half-Life 2:
  // Deathmatch с Condition Zero — те самые, что каталог метит alive = 0.
  // Флаг в catalog_meta, потому что иначе это скан news_items на каждом
  // холодном старте, а Turso считает прочитанные строки.
  if (!flags.has(NEWS_RANK_FIX_KEY)) {
    await db.execute(`UPDATE news_items SET rank = 0
      WHERE rank > 0 AND NOT EXISTS (
        SELECT 1 FROM games g WHERE g.appid = news_items.appid
          AND g.alive = 1 AND g.superseded_by IS NULL AND g.tag_count > 0
      )`)
    await db.execute({
      sql: 'INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)',
      args: [NEWS_RANK_FIX_KEY, '1'],
    })
  }

  if (upgrade) {
    if (await rebuildFeedbackCheck(db, destructiveMigrationsAllowed(env))) {
      // Последней: версия пишется, только когда всё выше прошло. Оборвись
      // миграция на полпути — следующий старт повторит её целиком.
      await db.execute({
        sql: 'INSERT OR REPLACE INTO catalog_meta (key, value) VALUES (?, ?)',
        args: [SCHEMA_V_KEY, String(CURRENT_SCHEMA_V)],
      })
    } else {
      // Версию НЕ пишем. Если это продовая база под превью, первый же старт
      // прода после мержа увидит старую версию и пересоберёт таблицу сам.
      // Запиши мы её здесь, прод счёл бы схему доведённой и не пересобрал бы
      // никогда. Строка одна на холодный старт: migrateDb зовётся раз на
      // процесс (getDb кэширует соединение).
      console.warn(
        JSON.stringify({
          event: 'migrate-skipped',
          step: 'feedback-check',
          reason: `превью без ${PREVIEW_OWN_DB_ENV}=1 не пересобирает таблицы`,
        }),
      )
    }
  }

  return db
}

/* ---------- сессии ---------- */

/** Что известно про сессию помимо самой куки; см. комментарий у таблицы */
export type SessionRow = {
  /**
   * Владение профилем ДОКАЗАНО через Steam OpenID.
   *
   * Ноль по умолчанию — и для старых строк, и когда строки нет вовсе (сессия
   * переживает недоступную Turso, см. issueSession). Наименьшие права: неизвестное
   * происхождение считаем неподтверждённым.
   */
  verified: boolean
  revokedAt: number | null
  /** users.sessions_from — отсечка «выйти везде», общая на все устройства */
  sessionsFrom: number | null
  /**
   * Личности за сессией больше нет: это демо, а его строки в users нет.
   *
   * Единственное место, где «строки нет» значит «не пускать», и только для
   * демо. Демо-личность — это и есть её строки: без снимка библиотеки ей
   * нечего показать, а строку users демо-вход пишет ДО выдачи куки (seedDemo
   * в /api/connect; не записалась — роут падает, куки нет). Значит, пропасть
   * строка может лишь уборкой (sweepStale) или удалением по запросу — а кука
   * живёт год. Пускать её дальше значило держать человека «вошедшим» без
   * библиотеки: лендинг здоровался «С возвращением», /library и /play
   * разворачивали обратно, а выйти из петли можно было только входом через
   * Steam или чисткой кук.
   *
   * Настоящих людей это не касается: для них отсутствие строки по-прежнему
   * ничего не решает (см. шапку sessions).
   */
  gone: boolean
}

/**
 * Состояние сессии одним запросом.
 *
 * LEFT JOIN, а не два обращения: строки сессии может не быть (не записавшийся
 * INSERT, чужая база), и это НЕ повод отказать — отвечать должен вызывающий,
 * а не отсутствие строки. Различить «нет строки» и «нет пользователя» здесь
 * не нужно: оба поля просто окажутся null. Исключение — демо без строки
 * users, см. SessionRow.gone; префикс '000' тот же, что у уборки (STALE_DEMO).
 */
export async function getSessionState(
  db: Db,
  sid: string,
  steamid: string,
): Promise<SessionRow> {
  const res = await db.execute({
    sql: `SELECT s.revoked_at AS revoked_at, s.verified AS verified, u.sessions_from AS sessions_from,
                 (q.steamid GLOB '000*' AND u.steamid IS NULL) AS gone
            FROM (SELECT ? AS sid, ? AS steamid) q
            LEFT JOIN sessions s ON s.sid = q.sid AND s.steamid = q.steamid
            LEFT JOIN users u ON u.steamid = q.steamid`,
    args: [sid, steamid],
  })
  const row = res.rows[0]
  return {
    revokedAt: (row?.revoked_at as number | null) ?? null,
    sessionsFrom: (row?.sessions_from as number | null) ?? null,
    verified: Number(row?.verified ?? 0) === 1,
    gone: Number(row?.gone ?? 0) === 1,
  }
}

export async function createSession(
  db: Db,
  s: { sid: string; steamid: string; device?: string | null; verified?: boolean },
  nowSec: number,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO sessions (sid, steamid, created_at, seen_at, device, verified)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(sid) DO UPDATE SET seen_at = excluded.seen_at`,
    args: [s.sid, s.steamid, nowSec, nowSec, s.device ?? null, s.verified ? 1 : 0],
  })
}

/** Отметка последнего визита: справка для списка устройств, не авторитет */
export async function touchSession(db: Db, sid: string, nowSec: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE sessions SET seen_at = ? WHERE sid = ? AND revoked_at IS NULL',
    args: [nowSec, sid],
  })
}

/** Погасить одно устройство */
export async function revokeSession(db: Db, sid: string, nowSec: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE sessions SET revoked_at = ? WHERE sid = ? AND revoked_at IS NULL',
    args: [nowSec, sid],
  })
}

/**
 * Погасить все устройства игрока.
 *
 * Двумя действиями, и второе обязательно: UPDATE достаёт только те сессии, чьи
 * строки существуют, а sessions_from накрывает и те, что не записались. Без
 * него «выйти везде» тихо промахивалось бы мимо ровно тех сессий, из-за
 * которых его и нажимают.
 */
export async function revokeAllSessions(db: Db, steamid: string, nowSec: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE sessions SET revoked_at = ? WHERE steamid = ? AND revoked_at IS NULL',
    args: [nowSec, steamid],
  })
  await db.execute({
    sql: `INSERT INTO users (steamid, created_at, last_seen_at, sessions_from)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(steamid) DO UPDATE SET sessions_from = excluded.sessions_from`,
    args: [steamid, nowSec, nowSec, nowSec],
  })
}

/* ---------- пользователи ---------- */

export async function upsertUser(
  db: Db,
  user: { steamid: string; personaName?: string; avatarUrl?: string },
  nowSec: number,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO users (steamid, persona_name, avatar_url, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(steamid) DO UPDATE SET
            persona_name = excluded.persona_name,
            avatar_url = excluded.avatar_url,
            last_seen_at = excluded.last_seen_at`,
    args: [user.steamid, user.personaName ?? null, user.avatarUrl ?? null, nowSec, nowSec],
  })
}

export async function getPersonaName(db: Db, steamid: string): Promise<string | null> {
  const res = await db.execute({
    sql: 'SELECT persona_name FROM users WHERE steamid = ?',
    args: [steamid],
  })
  return (res.rows[0]?.persona_name as string | null) ?? null
}

/** Ник и аватар одним запросом — для приветствия на главной */
export async function getUserCard(
  db: Db,
  steamid: string,
): Promise<{ personaName: string | null; avatarUrl: string | null }> {
  const res = await db.execute({
    sql: 'SELECT persona_name, avatar_url FROM users WHERE steamid = ?',
    args: [steamid],
  })
  const row = res.rows[0]
  return {
    personaName: (row?.persona_name as string | null) ?? null,
    avatarUrl: (row?.avatar_url as string | null) ?? null,
  }
}

export type PortraitCache = { takenAt: number; text: string }

export async function setUserPortrait(
  db: Db,
  steamid: string,
  value: PortraitCache,
): Promise<void> {
  // UPSERT, а не UPDATE: без строки в users запись молча терялась, кэш не
  // сохранялся и Claude дёргался заново на каждый рендер публичной страницы
  const now = Math.floor(Date.now() / 1000)
  await db.execute({
    sql: `INSERT INTO users (steamid, portrait_json, created_at, last_seen_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(steamid) DO UPDATE SET portrait_json = excluded.portrait_json`,
    args: [steamid, JSON.stringify(value), now, now],
  })
}

export async function getUserPortrait(db: Db, steamid: string): Promise<PortraitCache | null> {
  const res = await db.execute({
    sql: 'SELECT portrait_json AS v FROM users WHERE steamid = ?',
    args: [steamid],
  })
  const v = res.rows[0]?.v as string | null | undefined
  return v ? (JSON.parse(v) as PortraitCache) : null
}

/* ---------- комнаты (групповой режим) ---------- */

export type Room = {
  id: string
  createdBy: string
  mood?: Mood
  status: 'open' | 'matched'
  matchedAppid?: number
  isPublic: boolean
  /** какой по счёту раунд колоды раздан комнате; поднимается кнопкой «ещё игр» */
  deckRound: number
  /** сколько карт в текущей колоде; null — колоду ещё никто не запрашивал */
  deckSize: number | null
  createdAt: number
}

export type RoomMember = { steamid: string; personaName?: string; joinedAt: number }

export async function createRoom(
  db: Db,
  room: { id: string; steamid: string; mood?: Mood },
  nowSec: number,
): Promise<void> {
  await db.execute({
    sql: 'INSERT INTO rooms (id, created_by, mood_json, status, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [room.id, room.steamid, room.mood ? JSON.stringify(room.mood) : null, 'open', nowSec],
  })
}

export async function getRoom(db: Db, id: string): Promise<Room | null> {
  const res = await db.execute({ sql: 'SELECT * FROM rooms WHERE id = ?', args: [id] })
  const row = res.rows[0] as unknown as
    | {
        id: string
        created_by: string
        mood_json: string | null
        status: 'open' | 'matched'
        matched_appid: number | null
        is_public: number
        deck_round: number | null
        deck_size: number | null
        created_at: number
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    createdBy: row.created_by,
    ...(row.mood_json ? { mood: JSON.parse(row.mood_json) as Mood } : {}),
    status: row.status,
    ...(row.matched_appid !== null ? { matchedAppid: row.matched_appid } : {}),
    isPublic: row.is_public === 1,
    deckRound: row.deck_round ?? 0,
    deckSize: row.deck_size ?? null,
    createdAt: row.created_at,
  }
}

/**
 * «Ещё игр» — действие комнаты, а не участника.
 *
 * Единогласие в findRoomMatch считается по всем участникам, поэтому карта,
 * которую добрал себе один человек, не даст матча никогда: остальные её просто
 * не увидят. Раунд поднимается один раз, и остальные подхватывают его из
 * обычного опроса.
 *
 * Условие deck_round < ? разрешает гонку без транзакции: если двое нажали
 * одновременно, второй ничего не меняет и читает ту же партию. Возвращается
 * актуальный раунд, а не тот, который просили.
 */
export async function advanceRoomDeckRound(
  db: Db,
  roomId: string,
  toRound: number,
): Promise<number> {
  await db.execute({
    sql: 'UPDATE rooms SET deck_round = ? WHERE id = ? AND deck_round < ?',
    args: [toRound, roomId, toRound],
  })
  const res = await db.execute({
    sql: 'SELECT deck_round FROM rooms WHERE id = ?',
    args: [roomId],
  })
  return (res.rows[0]?.deck_round as number | undefined) ?? 0
}

/**
 * Размер выданной колоды. Пишет его deck-роут; опрос комнаты читает бесплатно —
 * строка rooms и так достаётся целиком.
 */
export async function setRoomDeckSize(db: Db, roomId: string, size: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE rooms SET deck_size = ? WHERE id = ?',
    args: [size, roomId],
  })
}

/**
 * Выдать колоду: размер — в rooms, сами карты — в room_deck.
 *
 * Одной пачкой, и это не экономия ради экономии. Правило перехода в
 * castDeckVote держится на том, что deck_size и строки room_deck появляются
 * вместе: «размер есть, а строк нет» значит только «колоду выдал код, который
 * ещё не знал о room_deck». Раздельные записи открыли бы то же состояние
 * любому отказу между ними — и голос снова принимался бы за что угодно.
 *
 * INSERT OR IGNORE из json_each — одна инструкция на всю колоду, а не строка
 * на карту: колода растёт на двадцать с каждым раундом.
 */
export async function issueRoomDeck(db: Db, roomId: string, appids: number[]): Promise<void> {
  await db.batch(
    [
      { sql: 'UPDATE rooms SET deck_size = ? WHERE id = ?', args: [appids.length, roomId] },
      {
        sql: 'INSERT OR IGNORE INTO room_deck (room_id, appid) SELECT ?, value FROM json_each(?)',
        args: [roomId, JSON.stringify(appids)],
      },
    ],
    'write',
  )
}

/**
 * 'closed' — комната уже договорилась, а просится НОВЫЙ человек.
 *
 * Матч терминален, и новому участнику в такой комнате делать нечего: ни
 * колоды, ни голосов, только ростер с никами и голосами тех, кто
 * договорился, — ровно то, что незнакомцу с доски «Пати» знать незачем.
 * Свой же участник, зашедший повторно, получает 'joined' и остаётся на
 * месте: для него это та же страница церемонии.
 */
export type JoinResult = 'joined' | 'notfound' | 'closed'

export async function joinRoom(
  db: Db,
  roomId: string,
  steamid: string,
  personaName: string | undefined,
  nowSec: number,
): Promise<JoinResult> {
  const room = await getRoom(db, roomId)
  if (!room) return 'notfound'
  if (room.status !== 'open') {
    const res = await db.execute({
      sql: 'SELECT 1 AS hit FROM room_members WHERE room_id = ? AND steamid = ?',
      args: [roomId, steamid],
    })
    return res.rows.length ? 'joined' : 'closed'
  }
  await db.execute({
    sql: 'INSERT OR REPLACE INTO room_members (room_id, steamid, persona_name, joined_at) VALUES (?, ?, ?, ?)',
    args: [roomId, steamid, personaName ?? null, nowSec],
  })
  return 'joined'
}

export async function roomMembers(db: Db, roomId: string): Promise<RoomMember[]> {
  const res = await db.execute({
    /*
     * Добивка по steamid — не исправление симптома, а запись контракта.
     *
     * joined_at секундный, и двое, вошедшие в одну секунду (обычное дело:
     * ссылку кидают в чат разом), по нему неразличимы. Порядок при этом СЕЙЧАС
     * определён, но не нами: EXPLAIN QUERY PLAN на этом запросе даёт «SEARCH
     * USING INDEX sqlite_autoindex_room_members_1 (room_id=?)» и следом «USE
     * TEMP B-TREE FOR ORDER BY» — то есть строки приходят из автоиндекса по
     * (room_id, steamid), уже отсортированные по steamid, а сортировка по
     * joined_at этот порядок для равных ключей сохраняет. Замер подтверждает:
     * без добивки трое, вошедшие одной секундой, выходят по steamid.
     *
     * Держаться этого нельзя. Порядок — следствие плана и формы первичного
     * ключа, а прод ходит в libsql, а не в тот же sqlite; смена плана,
     * появление подходящего индекса или переезд ключа молча его меняют.
     *
     * Что на нём висит: ростер рисуется с layout-анимациями (перестановка —
     * видимый обмен строк местами на экране ожидания), ключ догрузки лайков
     * склеен из участников по порядку (дрожание ключа гнало бы запрос каждый
     * тик даже на стоящей пати), и суммарный вкус в buildGroupDeck
     * складывается обходом участников. Ни одно из трёх сегодня не сломано —
     * добивка стоит ноль и снимает зависимость от того, что нам не обещали.
     */
    sql: `SELECT steamid, persona_name, joined_at FROM room_members
          WHERE room_id = ? ORDER BY joined_at ASC, steamid ASC`,
    args: [roomId],
  })
  return (
    res.rows as unknown as Array<{
      steamid: string
      persona_name: string | null
      joined_at: number
    }>
  ).map((r) => ({
    steamid: r.steamid,
    ...(r.persona_name ? { personaName: r.persona_name } : {}),
    joinedAt: r.joined_at,
  }))
}

/**
 * Убрать участника из комнаты — вместе с его голосами.
 *
 * Голоса удаляются ОБЯЗАТЕЛЬНО, и это не уборка, а корректность.
 * findRoomMatch считает знаменатель как COUNT(*) FROM room_members, а
 * числитель как COUNT(DISTINCT v.steamid) среди положительных голосов. Если
 * ушедший оставит свои голоса, числитель продолжит их считать при
 * уменьшившемся знаменателе — и комната получит матч, за который никто из
 * оставшихся не голосовал.
 *
 * Зачем это вообще понадобилось: DELETE из room_members не было во всём
 * репозитории, а знаменатель — это число участников. Один человек, нажавший
 * «Войти» и закрывший вкладку, делал матч недостижимым навсегда, и экран
 * ожидания вечно обещал «сошлись на N играх, ждём третьего».
 *
 * Возвращает false, если такого участника в комнате нет: повторный вызов
 * обязан быть безобидным.
 */
export async function removeRoomMember(
  db: Db,
  roomId: string,
  steamid: string,
): Promise<boolean> {
  const res = await db.execute({
    sql: 'SELECT 1 AS hit FROM room_members WHERE room_id = ? AND steamid = ?',
    args: [roomId, steamid],
  })
  if (!res.rows.length) return false

  // Одной пачкой, а не двумя вызовами: раздельные удаления оставляли голоса
  // ушедшего навсегда, если второе не проходило. Голоса без участника
  // findRoomMatch теперь и так не считает, но плодить мусор в таблице,
  // которая не подметается, всё равно незачем.
  await db.batch(
    [
      {
        sql: 'DELETE FROM room_members WHERE room_id = ? AND steamid = ?',
        args: [roomId, steamid],
      },
      {
        sql: 'DELETE FROM room_votes WHERE room_id = ? AND steamid = ?',
        args: [roomId, steamid],
      },
    ],
    'write',
  )
  return true
}

export async function castRoomVote(
  db: Db,
  roomId: string,
  steamid: string,
  appid: number,
  vote: 0 | 1,
  nowSec: number,
): Promise<void> {
  await db.execute({
    sql: 'INSERT OR REPLACE INTO room_votes (room_id, steamid, appid, vote, created_at) VALUES (?, ?, ?, ?, ?)',
    args: [roomId, steamid, appid, vote, nowSec],
  })
}

/**
 * Голос из свайпа: пишется, только если эту карту комнате раздавали
 * (room_deck). false — голос не записан.
 *
 * Проверка и запись — одной инструкцией, а не SELECT перед INSERT: это самая
 * частая запись продукта, и лишний обход до Turso на каждом свайпе ощущался
 * бы задержкой под пальцем.
 *
 * legacy — правило перехода для комнат, колоду которым выдал код до room_deck:
 * у них deck_size уже стоит, а строк нет, и их участники свайпают карты,
 * которых здесь не будет никогда. Для такой комнаты, и только пока у неё нет
 * ни одной строки, голос принимается по-старому. Первая же выдача колоды
 * новым кодом запишет строки, и комната перейдёт на строгое правило сама.
 * Новой комнате legacy не светит: issueRoomDeck пишет размер и строки вместе,
 * так что «размер есть, строк нет» у неё не бывает.
 */
export async function castDeckVote(
  db: Db,
  v: { roomId: string; steamid: string; appid: number; vote: 0 | 1; legacy: boolean },
  nowSec: number,
): Promise<boolean> {
  const res = await db.execute({
    sql: `INSERT OR REPLACE INTO room_votes (room_id, steamid, appid, vote, created_at)
          SELECT ?1, ?2, ?3, ?4, ?5
          WHERE EXISTS (SELECT 1 FROM room_deck WHERE room_id = ?1 AND appid = ?3)
             OR (?6 = 1 AND NOT EXISTS (SELECT 1 FROM room_deck WHERE room_id = ?1))`,
    args: [v.roomId, v.steamid, v.appid, v.vote, nowSec, v.legacy ? 1 : 0],
  })
  return res.rowsAffected > 0
}

/** appid, за который проголосовали «да» ВСЕ участники, либо null */
export async function findRoomMatch(db: Db, roomId: string): Promise<number | null> {
  const res = await db.execute({
    // Матч — это договорённость, поэтому участников должно быть минимум двое.
    // Без этого условия человек в комнате один получал «Это матч!» от
    // собственного голоса: «проголосовали все» формально выполнялось.
    //
    // JOIN с room_members — не украшение, а то, что делает дробь честной.
    // Знаменатель всегда считался по составу, а числитель — по голосам, и
    // при расхождении этих множеств голос человека, которого в комнате уже
    // нет, ПОДМЕНЯЕТ СОБОЙ живого. Комната получает «Это матч!» на игре,
    // которую оставшийся отклонил или вовсе не видел, а экран матча
    // терминальный: опрос на нём останавливается, отменить нечем.
    //
    // Разойтись множества могут двумя путями, и оба открыты. Первый: между
    // проверкой членства в /api/room/[id]/vote и самой вставкой лежит обход
    // Turso, и уборка участника успевает вклиниться. Второй: removeRoomMember
    // делает два удаления, и отказ второго оставляет голоса навсегда.
    // Затыкать каждый путь по отдельности — значит помнить о них при каждой
    // следующей правке; JOIN закрывает их все разом, независимо от того, как
    // осиротевший голос там оказался.
    //
    // Второй ключ сортировки не косметика. created_at хранится в секундах, и
    // две игры, добравшие единогласие в одну и ту же секунду, без него шли
    // бы в неопределённом порядке: два параллельных запроса могли выбрать
    // разные игры. Спор всё равно решает setRoomMatched: он пишет только в
    // открытую комнату и возвращает то, что в ней в итоге оказалось.
    sql: `SELECT v.appid AS appid FROM room_votes v
          JOIN room_members m ON m.room_id = v.room_id AND m.steamid = v.steamid
          WHERE v.room_id = ? AND v.vote = 1
            AND (SELECT COUNT(*) FROM room_members WHERE room_id = ?) >= 2
          GROUP BY v.appid
          HAVING COUNT(DISTINCT v.steamid) >= (
            SELECT COUNT(*) FROM room_members WHERE room_id = ?
          )
          ORDER BY MAX(v.created_at) ASC, v.appid ASC
          LIMIT 1`,
    args: [roomId, roomId, roomId],
  })
  return (res.rows[0]?.appid as number | undefined) ?? null
}

/**
 * Условие status = 'open' — страховка от второго матча.
 *
 * Матч терминален: обратного перехода в open в репозитории нет, а экран
 * матча останавливает опрос. Значит переписать уже назначенную игру другой
 * — это подменить людям результат под руками, и никакой запрос не должен
 * иметь такой возможности, даже опоздавший.
 *
 * Возвращает appid, который в комнате ЗАПИСАН, а не свой кандидат. Два
 * завершающих голоса в одну секунду могут прийти с разными кандидатами:
 * запрос A видит полной только X, запрос B — ещё и Y. Условие выше не даёт
 * B переписать X, но если B вернёт клиенту свой Y, его экран покажет
 * церемонию с Y и остановит опрос, а база и остальные увидят X — друзья
 * «договорились» о разных играх, и исправить это уже нечем. Поэтому наружу
 * уходит только то, что прочитано после записи.
 *
 * Запись и чтение идут одной пачкой: один обход до Turso, и между ними никто
 * не вклинится. null — комнаты нет или матч так и не записан.
 */
export async function setRoomMatched(db: Db, roomId: string, appid: number): Promise<number | null> {
  const [, stored] = await db.batch(
    [
      {
        sql: "UPDATE rooms SET status = 'matched', matched_appid = ? WHERE id = ? AND status = 'open'",
        args: [appid, roomId],
      },
      {
        sql: "SELECT matched_appid FROM rooms WHERE id = ? AND status = 'matched'",
        args: [roomId],
      },
    ],
    'write',
  )
  return (stored?.rows[0]?.matched_appid as number | null | undefined) ?? null
}

export type RoomVote = { steamid: string; appid: number; vote: 0 | 1; createdAt: number }

/**
 * Все голоса комнаты. Префикс первичного ключа (room_id, …) — это максимум
 * несколько сотен строк, поэтому группировка по играм делается в JS, а
 * отдельный индекс по appid не нужен: он только утяжелил бы запись на
 * горячем пути свайпа ради выборки, которая случается раз за сессию.
 */
export async function roomVotes(db: Db, roomId: string): Promise<RoomVote[]> {
  const res = await db.execute({
    sql: 'SELECT steamid, appid, vote, created_at FROM room_votes WHERE room_id = ?',
    args: [roomId],
  })
  return (
    res.rows as unknown as Array<{
      steamid: string
      appid: number
      vote: number
      created_at: number
    }>
  ).map((r) => ({
    steamid: r.steamid,
    appid: r.appid,
    vote: r.vote === 1 ? 1 : 0,
    createdAt: r.created_at,
  }))
}

/**
 * Сколько карт отсвайпал каждый участник — одним запросом на комнату.
 *
 * Экран ожидания показывает прогресс всех, а опрос идёт раз в 2.5с у каждого
 * участника. Запрос на человека давал N² чтений строк на комнату, и это самый
 * горячий цикл продукта: пятеро в комнате — сто с лишним строк на запрос,
 * двадцать четыре запроса в минуту с каждого. Здесь префикс первичного ключа
 * (room_id, …), одна выборка вместо N.
 */
export async function roomVoteCounts(db: Db, roomId: string): Promise<Map<string, number>> {
  const res = await db.execute({
    sql: 'SELECT steamid, COUNT(*) AS n FROM room_votes WHERE room_id = ? GROUP BY steamid',
    args: [roomId],
  })
  return new Map(
    (res.rows as unknown as Array<{ steamid: string; n: number }>).map((r) => [
      r.steamid,
      Number(r.n),
    ]),
  )
}

export async function myVotedAppids(
  db: Db,
  roomId: string,
  steamid: string,
): Promise<Set<number>> {
  const res = await db.execute({
    sql: 'SELECT appid FROM room_votes WHERE room_id = ? AND steamid = ?',
    args: [roomId, steamid],
  })
  return new Set((res.rows as unknown as Array<{ appid: number }>).map((r) => r.appid))
}

export async function setRoomPublic(db: Db, roomId: string, isPublic: boolean): Promise<void> {
  await db.execute({
    sql: 'UPDATE rooms SET is_public = ? WHERE id = ?',
    args: [isPublic ? 1 : 0, roomId],
  })
}

export type PublicRoomListing = {
  id: string
  createdAt: number
  memberNames: string[]
}

const PUBLIC_ROOM_MAX_AGE_SEC = 86_400
const PUBLIC_ROOM_LIMIT = 20

/**
 * Игра дня: чтение и запись отобранного.
 *
 * payload — это результат ОТБОРА (герой, полка, основа причины, часы), а не
 * готовый ответ маршрута: цены и скидки живут своей осью свежести и на каждом
 * заходе пересчитываются заново. Смысл записи в том, чтобы не пересобирать
 * четырёхсотигровый пул ради ответа, который до полуночи не меняется.
 *
 * Типизировано как unknown: слой БД не должен знать состав кандидата — это
 * дело маршрута и движка рекомендаций. Разбор с проверкой формы там же.
 */
export async function getDailyPick(db: Db, steamid: string, day: string): Promise<unknown | null> {
  try {
    const res = await db.execute({
      sql: 'SELECT payload_json FROM daily_picks WHERE steamid = ? AND day = ?',
      args: [steamid, day],
    })
    const raw = res.rows[0]?.payload_json
    if (typeof raw !== 'string') return null
    return JSON.parse(raw)
  } catch {
    /*
     * Fail open — та же логика, что у resolveSession и checkRate.
     *
     * Это ускорение, а не источник истины: и битый JSON, и недоступная таблица
     * означают ровно одно — «готового ответа нет, посчитай». Поймано живьём:
     * инстанс, поднятый до появления таблицы, ронял /api/daily пятисоткой,
     * то есть кэш ломал страницу, которую должен был ускорять.
     */
    return null
  }
}

export async function saveDailyPick(
  db: Db,
  steamid: string,
  day: string,
  payload: unknown,
  nowSec: number,
): Promise<void> {
  try {
    await db.execute({
      // OR REPLACE, а не OR IGNORE: две вкладки, открытые одновременно, могут
      // досчитать выбор параллельно. Оба результата верны (сид один и тот же),
      // и спорить о том, чей записать, не за что.
      sql: `INSERT OR REPLACE INTO daily_picks (steamid, day, payload_json, created_at)
            VALUES (?, ?, ?, ?)`,
      args: [steamid, day, JSON.stringify(payload), nowSec],
    })
  } catch (e) {
    // Не записалось — человек получит свою игру дня как раньше, просто дороже.
    // Но в лог это идёт, в отличие от чтения: молчаливо неработающая запись
    // означает, что выбор пересчитывается на каждом заходе, а снаружи это
    // выглядит как «страница почему-то медленная».
    console.warn('daily pick не записан', e)
  }
}

/**
 * Забыть записанный выбор человека — он пересчитается на следующем заходе.
 *
 * Запись не должна пережить то, что отбор обязан учесть сразу: бан и
 * «надоела» исключают игру из кандидатов (см. exclude и cooldown в
 * /api/daily), и без сброса убранная игра продолжала бы стоять героем до
 * полуночи. Остальной фидбек выбор дня не трогает — ради этого запись и
 * заведена.
 */
export async function forgetDailyPick(db: Db, steamid: string): Promise<void> {
  try {
    await db.execute({ sql: 'DELETE FROM daily_picks WHERE steamid = ?', args: [steamid] })
  } catch (e) {
    console.warn('daily pick не сброшен', e)
  }
}

/** Подметание вчерашних выборов. Зовётся из крона, никогда — из запроса */
export async function sweepDailyPicks(db: Db, keepFromDay: string): Promise<void> {
  await db.execute({ sql: 'DELETE FROM daily_picks WHERE day < ?', args: [keepFromDay] })
}

/** Доска «ищут игроков»: открытые публичные комнаты за последние сутки (один запрос) */
export async function listPublicRooms(db: Db, nowSec: number): Promise<PublicRoomListing[]> {
  const res = await db.execute({
    sql: `SELECT r.id AS id, r.created_at AS created_at, m.steamid AS steamid, m.persona_name AS persona_name
          FROM rooms r
          LEFT JOIN room_members m ON m.room_id = r.id
          WHERE r.is_public = 1 AND r.status = 'open' AND r.created_at > ?
          ORDER BY r.created_at DESC, m.joined_at ASC`,
    args: [nowSec - PUBLIC_ROOM_MAX_AGE_SEC],
  })

  const byRoom = new Map<string, PublicRoomListing>()
  for (const raw of res.rows as unknown as Array<{
    id: string
    created_at: number
    steamid: string | null
    persona_name: string | null
  }>) {
    let room = byRoom.get(raw.id)
    if (!room) {
      if (byRoom.size >= PUBLIC_ROOM_LIMIT) continue
      room = { id: raw.id, createdAt: raw.created_at, memberNames: [] }
      byRoom.set(raw.id, room)
    }
    if (raw.steamid) {
      // steamid наружу не уходит вовсе — см. memberLabel в lib/room
      room.memberNames.push(memberLabel(room.id, raw.steamid, raw.persona_name))
    }
  }
  return [...byRoom.values()]
}

/* ---------- библиотеки ---------- */

const SNAPSHOTS_KEPT = 3

/**
 * Год отметки. UTC, а не местное время: год должен считаться одинаково у
 * человека в Калининграде и у крона на Vercel, иначе в новогоднюю ночь одна и
 * та же библиотека попадёт в разные годы.
 */
export function snapshotYear(nowSec: number): number {
  return new Date(nowSec * 1000).getUTCFullYear()
}

export async function saveLibrarySnapshot(
  db: Db,
  steamid: string,
  games: LibraryGame[],
  nowSec: number,
): Promise<void> {
  const payload = JSON.stringify(games)
  const year = snapshotYear(nowSec)

  await db.batch(
    [
      /*
       * Отметка года. Обе инструкции идут ДО вставки нового снапшота и обе с
       * ON CONFLICT DO NOTHING, поэтому после первого раза в году это но-оп.
       *
       * Первая берёт предыдущий снапшот, а не текущие игры, и это главное:
       * человек, заходивший в декабре и вернувшийся в марте, получит отметкой
       * своё декабрьское состояние, а не мартовское. Иначе три месяца игры
       * молча потерялись бы из итогов года.
       *
       * Вторая — для тех, у кого предыдущего снапшота нет вовсе (первый заход
       * в жизни): тогда отметкой становится текущая библиотека.
       */
      {
        sql: `INSERT INTO library_baselines (steamid, year, taken_at, games_json)
              SELECT ?, ?, taken_at, games_json FROM library_snapshots
              WHERE steamid = ? ORDER BY taken_at DESC, id DESC LIMIT 1
              ON CONFLICT DO NOTHING`,
        args: [steamid, year, steamid],
      },
      {
        sql: `INSERT INTO library_baselines (steamid, year, taken_at, games_json)
              VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        args: [steamid, year, nowSec, payload],
      },
      {
        sql: 'INSERT INTO library_snapshots (steamid, taken_at, games_json) VALUES (?, ?, ?)',
        args: [steamid, nowSec, payload],
      },
      {
        sql: `DELETE FROM library_snapshots WHERE steamid = ? AND id NOT IN (
                SELECT id FROM library_snapshots WHERE steamid = ?
                ORDER BY taken_at DESC, id DESC LIMIT ${SNAPSHOTS_KEPT}
              )`,
        args: [steamid, steamid],
      },
    ],
    'write',
  )

  // Игры библиотеки — в очередь опроса новостей (tier 0, самый частый).
  // Именно отсюда наполняется личная лента «Что нового», и делать это надо
  // здесь: строки в games для части библиотеки может ещё не быть, а appid уже
  // в руках — ни одного лишнего чтения.
  await enrollNewsPoll(
    db,
    [...games].sort((a, b) => b.playtimeForever - a.playtimeForever).map((g) => g.appid),
    0,
    nowSec,
  )
}

export async function getLatestSnapshot(
  db: Db,
  steamid: string,
): Promise<{ takenAt: number; games: LibraryGame[] } | null> {
  const res = await db.execute({
    sql: 'SELECT taken_at, games_json FROM library_snapshots WHERE steamid = ? ORDER BY taken_at DESC, id DESC LIMIT 1',
    args: [steamid],
  })
  const row = res.rows[0] as unknown as { taken_at: number; games_json: string } | undefined
  if (!row) return null
  return { takenAt: row.taken_at, games: JSON.parse(row.games_json) as LibraryGame[] }
}

/**
 * Есть ли игра в последнем снапшоте библиотеки. null — снапшота нет вовсе.
 *
 * Отвечает база, а не JS, и это ради веса: вопрос задаёт каждая страница игры
 * у вошедшего (кнопка «Запустить», см. app/api/session/owns) и каждый опрос
 * сматченной комнаты, а games_json у большой библиотеки — блоб на сотни
 * килобайт. getLatestSnapshot вёз бы его целиком в функцию ради одного бита.
 *
 * instr — дешёвый отсев до разбора JSON: у игры, которой нет, в тексте нет и
 * `"appid":<id>`, и json_each не зовётся вовсе (CASE в SQLite ленивый).
 * Подстрока не отличает 730 от 7300, поэтому совпадение подтверждается уже
 * json_each — отсев может только сэкономить, но не соврать.
 */
export async function snapshotOwns(db: Db, steamid: string, appid: number): Promise<boolean | null> {
  const res = await db.execute({
    sql: `SELECT CASE
              WHEN instr(games_json, '"appid":' || ?) = 0 THEN 0
              ELSE EXISTS (
                SELECT 1 FROM json_each(games_json) WHERE json_extract(value, '$.appid') = ?
              )
            END AS owned
          FROM library_snapshots WHERE steamid = ?
          ORDER BY taken_at DESC, id DESC LIMIT 1`,
    // Для подстроки — строкой: число клиент привязывает как REAL, и склейка
    // давала бы `"appid":730.0`, которого в JSON нет никогда
    args: [String(appid), appid, steamid],
  })
  const row = res.rows[0] as unknown as { owned: number } | undefined
  return row ? Number(row.owned) === 1 : null
}

/**
 * Отметка библиотеки на начало года.
 *
 * takenAt отдаём наружу не для порядка: отметка ставится при первом за год
 * заходе, а не первого января. У человека, который пришёл впервые в июне,
 * «за год» честно означает «с июня», и итоги обязаны это сказать, а не
 * выдавать полугодовой отрезок за годовой.
 */
export async function getLibraryBaseline(
  db: Db,
  steamid: string,
  year: number,
): Promise<{ takenAt: number; games: LibraryGame[] } | null> {
  const res = await db.execute({
    sql: 'SELECT taken_at, games_json FROM library_baselines WHERE steamid = ? AND year = ?',
    args: [steamid, year],
  })
  const row = res.rows[0] as unknown as { taken_at: number; games_json: string } | undefined
  if (!row) return null
  return { takenAt: row.taken_at, games: JSON.parse(row.games_json) as LibraryGame[] }
}

/* ---------- каталог игр ---------- */

/**
 * Одна инструкция апсерта, отдельно от её выполнения.
 *
 * Вынесена, чтобы ту же самую запись можно было и выполнить поштучно, и
 * сложить в db.batch. Прогрев библиотеки апсертит до двухсот игр за вызов, и
 * двести отдельных round-trip'ов в Turso стоили там дороже, чем вся остальная
 * работа вместе взятая.
 */
const GAME_INSERT = `INSERT INTO games (appid, name, tags_json, genres_json, categories_json, short_description,
            header_image, screenshots_json, is_free, price_final, release_date, median_forever,
            store, store_url, art_json,
            release_year, developer, publisher, reviews_total, reviews_percent, reviews_30d,
            ccu, ccu_at, tag_count, is_multiplayer,
            price_initial, discount_percent, discount_ends_at, price_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

/**
 * Что делать с уже лежащей строкой: 'update' — переписать (обычный апсерт),
 * 'keep' — не трогать (досев, см. insertMissingGamesMeta).
 */
type OnConflict = 'update' | 'keep'

function gameMetaStatement(meta: GameMeta, nowSec: number, onConflict: OnConflict = 'update') {
  return {
    sql:
      onConflict === 'keep'
        ? `${GAME_INSERT}
          ON CONFLICT(appid) DO NOTHING`
        : `${GAME_INSERT}
          ON CONFLICT(appid) DO UPDATE SET
            name = excluded.name,
            tags_json = excluded.tags_json,
            genres_json = excluded.genres_json,
            categories_json = excluded.categories_json,
            short_description = excluded.short_description,
            header_image = excluded.header_image,
            screenshots_json = excluded.screenshots_json,
            is_free = excluded.is_free,
            price_final = excluded.price_final,
            release_date = excluded.release_date,
            median_forever = excluded.median_forever,
            store = excluded.store,
            store_url = excluded.store_url,
            art_json = excluded.art_json,
            release_year = excluded.release_year,
            developer = excluded.developer,
            publisher = excluded.publisher,
            reviews_total = excluded.reviews_total,
            reviews_percent = excluded.reviews_percent,
            -- Сигналы актуальности приходят отдельным проходом, поэтому
            -- обычная запись метаданных не должна их обнулять
            reviews_30d = COALESCE(excluded.reviews_30d, games.reviews_30d),
            ccu = COALESCE(excluded.ccu, games.ccu),
            ccu_at = COALESCE(excluded.ccu_at, games.ccu_at),
            tag_count = excluded.tag_count,
            is_multiplayer = excluded.is_multiplayer,
            -- Цена и скидка перезаписываются как есть, включая NULL и ноль:
            -- у кончившейся распродажи нет своего события, есть только ответ
            -- Steam без полей скидки. COALESCE тут означал бы «−70%» навсегда.
            price_initial = excluded.price_initial,
            discount_percent = excluded.discount_percent,
            discount_ends_at = excluded.discount_ends_at,
            price_at = excluded.price_at,
            updated_at = excluded.updated_at`,
    args: [
      meta.appid,
      meta.name,
      JSON.stringify(meta.tags),
      JSON.stringify(meta.genres),
      JSON.stringify(meta.categories),
      meta.shortDescription ?? null,
      meta.headerImage ?? null,
      meta.screenshots ? JSON.stringify(meta.screenshots) : null,
      meta.isFree === undefined ? null : meta.isFree ? 1 : 0,
      meta.priceFinal ?? null,
      meta.releaseDate ?? null,
      meta.medianForever ?? null,
      meta.store ?? null,
      meta.storeUrl ?? null,
      // Пустой объект — это «арт искали и не нашли», и он отличается от NULL,
      // то есть «ещё не искали». Иначе такие игры перезапрашивались бы вечно.
      meta.art ? JSON.stringify(meta.art) : null,
      meta.releaseYear ?? null,
      meta.developer ?? null,
      meta.publisher ?? null,
      meta.reviewsTotal ?? null,
      meta.reviewsPercent ?? null,
      meta.reviews30d ?? null,
      meta.ccu ?? null,
      meta.ccuAt ?? null,
      // производные: по ним идёт выборка кандидатов, чтобы не парсить JSON в SQL
      Object.keys(meta.tags).length,
      isMultiplayerCategories(meta.categories) ? 1 : 0,
      meta.priceInitial ?? null,
      meta.discountPercent ?? null,
      meta.discountEndsAt ?? null,
      meta.priceAt ?? null,
      nowSec,
    ],
  }
}

export async function upsertGameMeta(db: Db, meta: GameMeta, nowSec: number): Promise<void> {
  await db.execute(gameMetaStatement(meta, nowSec))
}

/**
 * Пачка апсертов одним round-trip'ом вместо N. Порядок внутри пачки сохраняется,
 * поэтому повторяющийся appid отработает так же, как отработал бы поштучно.
 */
export async function upsertGamesMeta(
  db: Db,
  metas: GameMeta[],
  nowSec: number,
): Promise<void> {
  if (!metas.length) return
  await db.batch(
    metas.map((m) => gameMetaStatement(m, nowSec)),
    'write',
  )
}

/**
 * Досев: записать только те игры, которых в базе ещё нет, — одним заходом.
 *
 * Для заготовленных карточек (демо-библиотека, кураторский пул других
 * магазинов). У демо настоящие Steam appid, и апсерт поверх прогретой строки
 * стёр бы ей теги, арт и цены значениями из заготовки. Раньше «чего нет»
 * выяснялось чтением всех строк целиком (getGamesMeta, SELECT *) и только
 * потом писалось; ON CONFLICT DO NOTHING решает то же одной пачкой и без
 * гонки между чтением и записью.
 */
export async function insertMissingGamesMeta(
  db: Db,
  metas: readonly GameMeta[],
  nowSec: number,
): Promise<void> {
  if (!metas.length) return
  await db.batch(
    metas.map((m) => gameMetaStatement(m, nowSec, 'keep')),
    'write',
  )
}

/**
 * Категории Steam, означающие совместную игру: 1 Multi-player, 9 Co-op,
 * 24 Shared/Split Screen, 36 Online PvP, 38 Online Co-op, 39 Split Screen PvP, 49 PvP.
 * Дублирует isMultiplayerMeta из lib/recommend, но без импорта: db не должна
 * зависеть от движка рекомендаций. Эквивалентность закреплена тестом.
 */
const MULTIPLAYER_CATEGORY_IDS = new Set([1, 9, 24, 36, 38, 39, 49])

export function isMultiplayerCategories(categories: number[]): boolean {
  return categories.some((c) => MULTIPLAYER_CATEGORY_IDS.has(c))
}

type GameRow = {
  appid: number
  name: string
  tags_json: string
  genres_json: string
  categories_json: string
  short_description: string | null
  header_image: string | null
  /** В узкой выборке (GAME_LITE_COLUMNS) колонки нет, и поле приходит undefined */
  screenshots_json?: string | null
  is_free: number | null
  price_final: number | null
  price_initial: number | null
  discount_percent: number | null
  discount_ends_at: number | null
  price_at: number | null
  release_date: string | null
  median_forever: number | null
  store: string | null
  store_url: string | null
  art_json: string | null
  ccu: number | null
  ccu_at: number | null
  reviews_30d: number | null
  reviews_total: number | null
  reviews_percent: number | null
  release_year: number | null
  developer: string | null
  publisher: string | null
  signals_at: number | null
  alive: number | null
  superseded_by: number | null
  /** В узкой выборке (GAME_LITE_COLUMNS) колонки нет: причина нужна только /game */
  dead_reason?: string | null
}

function rowToMeta(row: GameRow): GameMeta {
  const meta: GameMeta = {
    appid: row.appid,
    name: row.name,
    tags: JSON.parse(row.tags_json),
    genres: JSON.parse(row.genres_json),
    categories: JSON.parse(row.categories_json),
  }
  if (row.short_description !== null) meta.shortDescription = row.short_description
  if (row.header_image !== null) meta.headerImage = row.header_image
  // Узкая выборка (getGamesMetaLite) колонку не читает вовсе — отсюда undefined
  if (row.screenshots_json) meta.screenshots = JSON.parse(row.screenshots_json)
  if (row.is_free !== null) meta.isFree = row.is_free === 1
  if (row.price_final !== null) meta.priceFinal = row.price_final
  // Скидка читается целиком, включая ноль: «полная цена» — это ответ, а не
  // отсутствие ответа. Колонки появились позже, у старых строк их нет вовсе,
  // поэтому проверяем и на undefined — так же, как ccu и developer выше.
  if (row.price_initial !== null && row.price_initial !== undefined) {
    meta.priceInitial = row.price_initial
  }
  if (row.discount_percent !== null && row.discount_percent !== undefined) {
    meta.discountPercent = row.discount_percent
  }
  if (row.discount_ends_at !== null && row.discount_ends_at !== undefined) {
    meta.discountEndsAt = row.discount_ends_at
  }
  if (row.price_at !== null && row.price_at !== undefined) meta.priceAt = row.price_at
  if (row.release_date !== null) meta.releaseDate = row.release_date
  if (row.median_forever !== null) meta.medianForever = row.median_forever
  if (row.store !== null) meta.store = row.store
  if (row.store_url !== null) meta.storeUrl = row.store_url
  // колонка появилась позже: у старых строк её может не быть вовсе
  if (row.art_json) meta.art = JSON.parse(row.art_json)
  // сигналы актуальности: без них фильтр живости работает вслепую
  if (row.ccu !== null && row.ccu !== undefined) meta.ccu = row.ccu
  if (row.ccu_at !== null && row.ccu_at !== undefined) meta.ccuAt = row.ccu_at
  if (row.reviews_30d !== null && row.reviews_30d !== undefined) meta.reviews30d = row.reviews_30d
  if (row.reviews_total !== null && row.reviews_total !== undefined) {
    meta.reviewsTotal = row.reviews_total
  }
  if (row.reviews_percent !== null && row.reviews_percent !== undefined) {
    meta.reviewsPercent = row.reviews_percent
  }
  // Эти три колонки пишутся в upsertGameMeta и до сих пор молча терялись при
  // чтении: в GameRow их не было, в маппинге тоже. Из-за этого подпись вида
  // «Valve · 2013» была невозможна, хотя данные лежали в базе.
  if (row.release_year !== null && row.release_year !== undefined) {
    meta.releaseYear = row.release_year
  }
  if (row.developer !== null && row.developer !== undefined) meta.developer = row.developer
  if (row.publisher !== null && row.publisher !== undefined) meta.publisher = row.publisher
  // Вердикт офлайн-курации: тот же класс потери, что был у developer выше.
  // Читается только целиком: alive лежит в колонке с DEFAULT 1, поэтому сам по
  // себе означает лишь «не помечена мёртвой», а не «проверена». Настоящий
  // признак проверки — signals_at, и promote-catalog пишет их одним UPDATE.
  if (row.signals_at !== null && row.signals_at !== undefined) {
    meta.signalsAt = row.signals_at
    meta.alive = row.alive === 1
    if (row.superseded_by !== null && row.superseded_by !== undefined) {
      meta.supersededBy = row.superseded_by
    }
    if (!meta.alive && isDeadReason(row.dead_reason)) meta.deadReason = row.dead_reason
  }
  return meta
}

export async function getGameMeta(db: Db, appid: number): Promise<GameMeta | null> {
  const res = await db.execute({ sql: 'SELECT * FROM games WHERE appid = ?', args: [appid] })
  const row = res.rows[0] as unknown as GameRow | undefined
  return row ? rowToMeta(row) : null
}

/**
 * Строка игры вместе с двумя её блобами — ОДНИМ чтением.
 *
 * Страница игры собирала это тремя: getGameMeta делает SELECT *, а следом
 * getGameJson дважды спрашивал колонки из ТОЙ ЖЕ строки, которую SELECT * уже
 * привёз и выбросил (rowToMeta их не переносит — они не часть GameMeta).
 *
 * Turso тарифицирует строки: три чтения вместо одного на каждый рендер, а
 * рендерится это по адресам из карты сайта, то есть тысячами. Плюс лишний
 * обход к базе в TTFB страницы, которую собирают для краулера.
 *
 * Блобы отдаются сырыми unknown, как и getGameJson: разбирать их форму —
 * дело вызывающего, он один знает, что там лежит.
 */
export async function getGamePageRow(
  db: Db,
  appid: number,
): Promise<{ meta: GameMeta; reviewsSummary: unknown; prosCons: unknown } | null> {
  const res = await db.execute({ sql: 'SELECT * FROM games WHERE appid = ?', args: [appid] })
  const row = res.rows[0] as unknown as (GameRow & Record<string, unknown>) | undefined
  if (!row) return null
  const разобрать = (v: unknown): unknown => {
    if (typeof v !== 'string' || !v) return null
    try {
      return JSON.parse(v)
    } catch {
      return null
    }
  }
  return {
    meta: rowToMeta(row),
    reviewsSummary: разобрать(row.reviews_summary_json),
    prosCons: разобрать(row.pros_cons_json),
  }
}

export type SimilarGame = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

/**
 * Соседи по тегу — «похожие» на карточке игры.
 *
 * Ровно ОДИН тег, а не тройка самых весомых, и это про деньги. Карточка лежит в
 * карте сайта пятью тысячами адресов; запрос по трём тегам с GROUP BY читает
 * все строки game_tags по каждому из них (у широкого тега это тысячи), и один
 * проход краулера превратился бы в десятки миллионов прочитанных строк. С одним
 * тегом запрос идёт по idx_game_tags_tag (tag, weight DESC) и обрывается на
 * LIMIT — тот же приём, которым живёт fetchDiscoveryPool.
 *
 * Порядок — по weight, то есть по ХАРАКТЕРНОСТИ, а не по числу отзывов. Похожие
 * на рогалик — это игры, которые больше всего являются рогаликом, а не самые
 * продаваемые из тех, кто им помечен. Это же и есть механика обещания «мы
 * никогда не продаём места в выдаче»: продать позицию тут физически нечем.
 *
 * appid > 0 — записи чужих магазинов лежат под отрицательными id, арта у них
 * нет, а полка из заглушек полкой не выглядит.
 */
export async function topGamesByTag(
  db: Db,
  tag: string,
  excludeAppid: number,
  limit = 6,
): Promise<SimilarGame[]> {
  const res = await db.execute({
    sql: `SELECT g.appid, g.name, g.header_image, g.art_json
          FROM game_tags gt JOIN games g ON g.appid = gt.appid
          WHERE gt.tag = ? AND g.appid != ? AND g.appid > 0 AND ${ALIVE_POOL}
          ORDER BY gt.weight DESC
          LIMIT ?`,
    args: [tag, excludeAppid, limit],
  })
  return (
    res.rows as unknown as Array<{
      appid: number
      name: string
      header_image: string | null
      art_json: string | null
    }>
  ).map((r) => ({
    appid: Number(r.appid),
    name: r.name,
    headerImage: r.header_image ?? null,
    art: r.art_json ? (JSON.parse(r.art_json) as GameArtUrls) : null,
  }))
}

/**
 * Список appid одним параметром: `appid IN (SELECT value FROM json_each(?))`.
 *
 * IN (?, ?, …) с плейсхолдером на каждый appid упирается в лимит переменных
 * SQLite: на 32 767 запрос падает с «too many SQL variables». Эти функции
 * получают библиотеку ЦЕЛИКОМ, и у коллекционера Steam сорок тысяч игр —
 * подбор, /library и портрет отвечали бы ему 500 на каждый заход. Приём тот же,
 * что в lib/pool.ts; план — поиск по первичному ключу на каждый элемент
 * (сторож в lib/queryplan.test.ts).
 */
const APPIDS_IN = 'appid IN (SELECT value FROM json_each(?))'

/** Метаданные пачки игр одним запросом — строка целиком, со скриншотами */
export async function getGamesMeta(db: Db, appids: number[]): Promise<Map<number, GameMeta>> {
  if (!appids.length) return new Map()
  const res = await db.execute({
    sql: `SELECT * FROM games WHERE ${APPIDS_IN}`,
    args: [JSON.stringify(appids)],
  })
  return new Map(
    (res.rows as unknown as GameRow[]).map((r) => [r.appid, rowToMeta(r)] as const),
  )
}

/**
 * Колонки узкой выборки — всё, что читает rowToMeta, кроме скриншотов.
 *
 * SELECT * тащил с каждой строкой три JSON-блоба: сводку отзывов и pros/cons
 * (в GameMeta их нет вовсе — rowToMeta их просто выбрасывал) и скриншоты,
 * которые разбирались на каждой строке библиотеки, хотя показываются максимум
 * у пятерки героев. У библиотеки на полторы тысячи игр это мегабайт-полтора
 * JSON через сеть на каждый подбор.
 */
const GAME_LITE_COLUMNS = `appid, name, tags_json, genres_json, categories_json,
  short_description, header_image, is_free, price_final, price_initial, discount_percent,
  discount_ends_at, price_at, release_date, median_forever, store, store_url, art_json,
  ccu, ccu_at, reviews_30d, reviews_total, reviews_percent, release_year, developer,
  publisher, signals_at, alive, superseded_by`

/**
 * Метаданные пачки игр без блобов: всё то же, что getGamesMeta, но без
 * screenshots. Для библиотечных сценариев — подбор, игра дня, /library,
 * портрет, лента, комнаты. Кадры героям — отдельно, getGameShots.
 */
export async function getGamesMetaLite(
  db: Db,
  appids: number[],
): Promise<Map<number, GameMeta>> {
  if (!appids.length) return new Map()
  const res = await db.execute({
    sql: `SELECT ${GAME_LITE_COLUMNS} FROM games WHERE ${APPIDS_IN}`,
    args: [JSON.stringify(appids)],
  })
  return new Map(
    (res.rows as unknown as GameRow[]).map((r) => [r.appid, rowToMeta(r)] as const),
  )
}

/** Скриншоты пачки игр — для тех немногих, кто станет героем выдачи */
export async function getGameShots(db: Db, appids: number[]): Promise<Map<number, string[]>> {
  if (!appids.length) return new Map()
  const res = await db.execute({
    sql: `SELECT appid, screenshots_json FROM games
          WHERE ${APPIDS_IN} AND screenshots_json IS NOT NULL`,
    args: [JSON.stringify(appids)],
  })
  const out = new Map<number, string[]>()
  for (const r of res.rows as unknown as Array<{ appid: number; screenshots_json: string }>) {
    try {
      const shots: unknown = JSON.parse(r.screenshots_json)
      if (Array.isArray(shots)) out.set(r.appid, shots.filter((x) => typeof x === 'string'))
    } catch {
      // битая строка — у героя просто не будет кадров, как у игры без них
    }
  }
  return out
}

/*
 * Здесь была getAllGamesMeta — «весь каталог одним запросом». Удалена намеренно,
 * а не помечена устаревшей: на каталоге в сотню тысяч игр это полный скан на
 * каждый запрос пользователя, и оставленная функция вернулась бы в код при
 * первом же рефакторинге. Вместо неё — getGamesMeta по списку appid для
 * библиотечных сценариев и fetchDiscoveryPool из lib/pool для открытий.
 * Возврат полного скана ловит тест lib/noscan.test.ts.
 */

export type GameJsonColumn = 'reviews_summary_json' | 'pros_cons_json'

// имя колонки интерполируется в SQL — рантайм-контроль обязателен
const GAME_JSON_COLUMNS: ReadonlySet<string> = new Set(['reviews_summary_json', 'pros_cons_json'])

function assertGameJsonColumn(column: string): void {
  if (!GAME_JSON_COLUMNS.has(column)) throw new Error(`недопустимая колонка: ${column}`)
}

export async function setGameJson(
  db: Db,
  appid: number,
  column: GameJsonColumn,
  value: unknown,
): Promise<void> {
  assertGameJsonColumn(column)
  await db.execute({
    sql: `UPDATE games SET ${column} = ? WHERE appid = ?`,
    args: [JSON.stringify(value), appid],
  })
}

export async function getGameJson(
  db: Db,
  appid: number,
  column: GameJsonColumn,
): Promise<unknown> {
  assertGameJsonColumn(column)
  const res = await db.execute({
    sql: `SELECT ${column} AS v FROM games WHERE appid = ?`,
    args: [appid],
  })
  const v = res.rows[0]?.v as string | null | undefined
  return v ? JSON.parse(v) : null
}

/*
 * Очередь обогащения карточек игр.
 *
 * Скриншоты, сводку отзывов и pros/cons раньше догружала сама страница
 * /game/[appid] прямо на рендере. Страница публичная, кэша у неё не было, а в
 * каталоге 6000 игр — то есть один проход краулера означал 6000 вызовов Claude
 * и 12000 запросов к Steam. Правило уже было сформулировано в lib/gamepage.ts
 * для патчноутов; здесь оно доведено до остальных полей карточки.
 *
 * Отдельной таблицы нет намеренно: очередь целиком выражается колонкой page_at
 * на games. Предикат живой игры повторяет idx_games_pool ДОСЛОВНО — иначе
 * SQLite не возьмёт частичный индекс и это станет сканом (см. noscan).
 */

const ALIVE_POOL = 'alive = 1 AND superseded_by IS NULL AND tag_count > 0'

/**
 * Игры, которым пора обогатить карточку.
 *
 * Сначала те, за которыми в сеть ещё не ходили ИЛИ ходили впустую, потом
 * самые давние. Порядок внутри группы — по числу отзывов: витрину имеет
 * смысл наполнять с тех страниц, на которые вообще придут.
 *
 * «Ходили впустую» стоит в первой группе намеренно. Пустые походы достались
 * верху каталога — очередь выгребается по убыванию reviews_total, и первый
 * прогон уткнулся в лимит Steam именно на самых заметных играх. Оставить их
 * во второй группе значило бы чинить CS2 после пяти тысяч игр, которых никто
 * не ищет.
 */
export async function claimPageEnrichBatch(
  db: Db,
  staleBefore: number,
  limit: number,
  opts: { redoHeuristic?: boolean; maxTries?: number } = {},
): Promise<number[]> {
  // Карточка, собранная без модели, не должна замирать на полгода.
  //
  // Эвристика тащит в «за что любят» куски чужих языков и обрывки вроде
  // «693 часов в Steam» — читать это на витрине, которая уходит в индекс,
  // нельзя. Но и не заполнять карточку вовсе, пока нет ключа, тоже нельзя:
  // скриншоты и вердикт отзывов от модели не зависят и нужны сразу.
  //
  // Поэтому page_at means «в сеть за этой карточкой сходили», а не «карточка
  // готова». Когда ключ появляется, вызывающий поднимает redoHeuristic, и
  // эвристические pros/cons возвращаются в очередь на пересборку моделью.
  /*
   * Пустой поход тоже не должен замирать на полгода — по той же логике, что
   * и эвристические pros/cons абзацем выше, только причина другая: там данные
   * приехали и оказались хуже нужного, здесь не приехали вовсе.
   *
   * Счётчик обязателен, и ограничение сверху тоже. Без счётчика игра, у
   * которой Steam молчит всегда, возвращалась бы в очередь каждый прогон и
   * съедала бы бюджет — тот самый head-of-line, ради которого отметка и
   * ставится при неудаче. maxTries закрывает эту дверь: после нескольких
   * пустых походов карточка уходит ждать общего срока устаревания.
   */
  /*
   * Ветка пересборки эвристики тоже уважает потолок попыток.
   *
   * Её предикат стоял голым: `redo = 1 AND source = 'reviews'`, без оглядки на
   * page_tries. Карточка, у которой appdetails молчит (значит счётчик пустых
   * походов растёт), а эвристические pros/cons записаны, оставалась бы в
   * очереди ВЕЧНО и возвращалась каждый прогон — тот самый head-of-line, ради
   * которого потолок и заводили двумя условиями выше.
   *
   * Сейчас это латентно: по проду таких карточек 498, но сортировка ставит их
   * в хвост (page_at есть, page_tries ноль), а впереди 5198 непройденных.
   * Дверь закрывается ДО того, как очередь до них доберётся.
   *
   * Условие написано как «политика есть И исчерпана», а не просто
   * `page_tries < maxTries`: при maxTries = 0 политики повторов нет вовсе (так
   * же выключена и ветка выше), и голое сравнение убило бы пересборку целиком
   * — у неисчерпанной карточки page_tries как раз ноль.
   */
  /*
   * ДВА ЗАПРОСА, А НЕ ВЫРАЖЕНИЕ В ORDER BY, и это про цену.
   *
   * Приоритет прежний: сперва те, за кем не ходили или ходили впустую, потом
   * протухшие и кандидаты на пересборку. Но выражался он вычислением в ORDER BY
   * — `(page_at IS NOT NULL AND page_tries = 0), reviews_total DESC`, — и такой
   * порядок частичному индексу не соответствует. План на живой базе:
   *
   *   было:  SEARCH games USING INTEGER PRIMARY KEY + USE TEMP B-TREE FOR ORDER BY
   *   стало: SCAN games USING INDEX idx_games_pool  (обе половины)
   *
   * То есть ради двадцати appid читался и сортировался ВЕСЬ каталог: около
   * шести тысяч строк, которые Turso тарифицирует, на каждое звено цепочки.
   *
   * Разбиение точное, а не приблизительное: объединение двух условий равно
   * прежнему одному. Проверено разбором по веткам — «нет page_at», «есть, но
   * попытки не исчерпаны», «протухло», «пересобрать эвристику» — и тестами,
   * которые на этот порядок уже опирались.
   *
   * Последняя ветка у пустого похода (page_tries > 0) сводится к «политики
   * повторов нет»: при maxTries > 0 её `page_tries < ?` уже покрыто соседним
   * условием, а при maxTries = 0 без неё карточка с эвристикой и пустым
   * походом выпала бы из обеих групп — и разошлась бы с countPageEnrichDue,
   * который обязан считать ровно то же.
   */
  const redo = opts.redoHeuristic ? 1 : 0
  const maxTries = opts.maxTries ?? 0

  // Группа 1: не ходили ни разу ИЛИ ходили впустую. Именно она забирает бюджет
  // первой — см. абзац про верх каталога выше.
  const первые = await db.execute({
    sql: `SELECT appid FROM games
          WHERE ${ALIVE_POOL} AND appid > 0
            AND (
              page_at IS NULL
              OR (page_tries > 0 AND (
                page_tries < ?
                OR page_at < ?
                OR (? = 1 AND ? = 0 AND json_extract(pros_cons_json, '$.source') = 'reviews')
              ))
            )
          ORDER BY reviews_total DESC
          LIMIT ?`,
    args: [maxTries, staleBefore, redo, maxTries, limit],
  })
  const appids = (первые.rows as unknown as Array<{ appid: number }>).map((r) => r.appid)
  if (appids.length >= limit) return appids

  // Группа 2: сходили удачно, но карточка протухла или собрана без модели.
  const вторые = await db.execute({
    sql: `SELECT appid FROM games
          WHERE ${ALIVE_POOL} AND appid > 0
            AND page_at IS NOT NULL AND page_tries = 0
            AND (
              page_at < ?
              OR (? = 1 AND (? = 0 OR page_tries < ?) AND json_extract(pros_cons_json, '$.source') = 'reviews')
            )
          ORDER BY reviews_total DESC
          LIMIT ?`,
    args: [staleBefore, redo, maxTries, maxTries, limit - appids.length],
  })
  return [...appids, ...(вторые.rows as unknown as Array<{ appid: number }>).map((r) => r.appid)]
}

/**
 * Игры для карты сайта: живые, с тегами, по убыванию числа отзывов.
 *
 * Отдаём и ещё не обогащённые тоже — с тех пор как loadGamePage читает только
 * базу, заход краулера на такую страницу не стоит ничего, а имя, теги, цена и
 * патчноуты на ней уже есть. Ждать полного обогащения значило бы держать карту
 * сайта пустой месяцами.
 *
 * lastmod считается по ТРЁМ отметкам, а не по одному updated_at, и это не
 * педантизм. Замер по проду 20 августа: из 5919 живых игр 5691 имеет ОДИН И ТОТ
 * ЖЕ updated_at — след массовой заливки каталога; разных значений на весь
 * каталог девятнадцать. То есть поле не несло сигнала вовсе, а следующая
 * заливка подняла бы пять с половиной тысяч адресов в одну секунду, после чего
 * Google перестаёт учитывать его совсем.
 *
 * Настоящее изменение содержания приносят два других события, и оба
 * размазаны по времени: обогащение карточки (page_at — появляются скриншоты,
 * вердикт отзывов и pros/cons) и новый патчноут (published_at). Их и берём.
 *
 * ПРЕДЕЛ, честно: разных значений стало 88 вместо 19, но крупнейшая группа
 * по-прежнему 5586 адресов. Иначе и быть не может — у этих карточек с прошлой
 * заливки правда ничего не менялось, ни обогащения, ни патчей. Настоящая
 * причина одинаковости лежит не здесь, а в scripts/publish-catalog: он ставит
 * updated_at = now всем строкам подряд, включая те, у которых ни одно видимое
 * поле не изменилось. Чинить надо там, и это отдельная работа.
 */
export async function sitemapGames(
  db: Db,
  limit: number,
): Promise<Array<{ appid: number; updatedAt: number }>> {
  const res = await db.execute({
    sql: `SELECT g.appid AS appid,
                 MAX(
                   g.updated_at,
                   COALESCE(g.page_at, 0),
                   COALESCE((SELECT MAX(n.published_at) FROM news_items n WHERE n.appid = g.appid), 0)
                 ) AS updated_at
          FROM games g
          -- предикат живой игры, тот же что в ALIVE_POOL, но с алиасом таблицы:
          -- подзапрос по news_items требует различать g.appid и n.appid
          WHERE g.alive = 1 AND g.superseded_by IS NULL AND g.tag_count > 0 AND g.appid > 0
          ORDER BY g.reviews_total DESC
          LIMIT ?`,
    args: [limit],
  })
  return (res.rows as unknown as Array<{ appid: number; updated_at: number }>).map((r) => ({
    appid: r.appid,
    updatedAt: r.updated_at,
  }))
}

/**
 * Верх каталога сразу плитками — для 404.
 *
 * Тот же порядок, что у sitemapGames (по числу отзывов), но с именем и
 * артом: на битой ссылке человеку нужны игры, которые он УЗНАЕТ, а не список
 * идентификаторов. Форма совпадает с SimilarGame, чтобы плитка была той же, что и
 * на полке «Похожие».
 *
 * appid > 0 — записи чужих магазинов лежат под отрицательными id, арта у них
 * нет, а полка из заглушек полкой не выглядит (тот же довод, что в topGamesByTag).
 */
export async function topCatalogGames(db: Db, limit: number): Promise<SimilarGame[]> {
  const res = await db.execute({
    sql: `SELECT appid, name, header_image, art_json FROM games
          WHERE ${ALIVE_POOL} AND appid > 0 AND header_image IS NOT NULL
          ORDER BY reviews_total DESC
          LIMIT ?`,
    args: [limit],
  })
  return (
    res.rows as unknown as Array<{
      appid: number
      name: string
      header_image: string | null
      art_json: string | null
    }>
  ).map((r) => ({
    appid: Number(r.appid),
    name: r.name,
    headerImage: r.header_image ?? null,
    art: r.art_json ? (JSON.parse(r.art_json) as GameArtUrls) : null,
  }))
}

/**
 * Описания витрины — для разовой доливки на язык сайта.
 *
 * Отдаём текст вместе с appid, потому что отбор «что доливать» делается по
 * САМОМУ ТЕКСТУ: русское описание от английского отличает наличие кириллицы, а
 * выразить это в SQLite нечем — REGEXP там не встроен, а гонять LIKE по
 * тридцати трём буквам ради разовой задачи нелепо.
 *
 * Только appid > 0: отрицательные — это кураторские карточки других магазинов,
 * и Steam про них ничего не знает.
 */
export async function gameDescriptions(
  db: Db,
  limit: number,
): Promise<Array<{ appid: number; description: string | null }>> {
  const res = await db.execute({
    sql: `SELECT appid, short_description FROM games
          WHERE ${ALIVE_POOL} AND appid > 0
          ORDER BY reviews_total DESC
          LIMIT ?`,
    args: [limit],
  })
  return (res.rows as unknown as Array<{ appid: number; short_description: string | null }>).map(
    (r) => ({ appid: r.appid, description: r.short_description }),
  )
}

/**
 * Переписать ТОЛЬКО описание, не трогая остального.
 *
 * Через upsertGameMeta это не сделать: он пишет строку целиком, и доливка
 * описаний затёрла бы цены, арт и сигналы теми значениями, что оказались в
 * объекте у вызывающего. Здесь же меняется одна колонка.
 *
 * updated_at НЕ трогаем намеренно. Он стоит в карте сайта как lastmod, а
 * доливка перевода — не изменение содержания страницы в том смысле, ради
 * которого краулер сверяет дату. Подняв его на пяти тысячах строк разом, мы
 * сказали бы поисковику, что весь каталог обновился в одну секунду.
 *
 * Батчем, а не поштучно: Turso берёт деньги за строки, но время — за
 * round-trip, и пять тысяч отдельных UPDATE стоили бы часы.
 */
export async function setGameDescriptions(
  db: Db,
  rows: ReadonlyArray<{ appid: number; description: string }>,
): Promise<number> {
  if (!rows.length) return 0
  const res = await db.batch(
    rows.map((r) => ({
      sql: 'UPDATE games SET short_description = ? WHERE appid = ?',
      args: [r.description, r.appid],
    })),
    'write',
  )
  return res.reduce((sum, r) => sum + Number(r.rowsAffected ?? 0), 0)
}

/**
 * Сколько карточек ещё ждёт обогащения — для отчёта крона.
 *
 * Условие обязано повторять claimPageEnrichBatch, иначе отчёт говорит одно,
 * а очередь делает другое: с maxTries по умолчанию 0 повторные попытки в
 * счёт не идут — ровно как и в выборке.
 *
 * И оно РАСХОДИЛОСЬ. У выборки четыре ветки OR, у счётчика было три: ветка
 * пересборки эвристики моделью сюда не доехала. А в проде она включена всегда
 * (redoHeuristic = llmAvailable), и карточек с source = 'reviews' там 498 —
 * то есть отчёт мог показывать «к обогащению готово: 0», пока крон продолжал
 * забирать по двадцать карточек на звено и платить за каждую двумя запросами
 * к Steam и вызовом модели. Ровно то, от чего докблок и предостерегал.
 *
 * Четвёртый аргумент назван так же, как у выборки, и по той же причине: два
 * запроса об одном и том же обязаны читаться рядом как один.
 */
export async function countPageEnrichDue(
  db: Db,
  staleBefore: number,
  maxTries = 0,
  opts: { redoHeuristic?: boolean } = {},
): Promise<number> {
  const redo = opts.redoHeuristic ? 1 : 0
  const res = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM games
          WHERE ${ALIVE_POOL} AND appid > 0
            AND (
              page_at IS NULL
              OR page_at < ?
              OR (page_tries > 0 AND page_tries < ?)
              OR (? = 1 AND (? = 0 OR page_tries < ?) AND json_extract(pros_cons_json, '$.source') = 'reviews')
            )`,
    args: [staleBefore, maxTries, redo, maxTries, maxTries],
  })
  return Number((res.rows[0] as unknown as { n: number }).n)
}

/**
 * Карточка обогащена: в сеть сходили и данные привезли.
 *
 * Счётчик неудач сбрасывается — он считает подряд идущие пустые походы,
 * а не их сумму за историю.
 */
export async function markPageEnriched(db: Db, appid: number, now: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE games SET page_at = ?, page_tries = 0 WHERE appid = ?',
    args: [now, appid],
  })
}

/**
 * В сеть сходили, а данных не привезли.
 *
 * page_at ставится всё равно, и это не изменилось: иначе игра, у которой
 * Steam молчит, навсегда осталась бы первой в очереди и забирала бы весь
 * суточный бюджет на себя. Изменилось другое — раньше такой поход был
 * НЕОТЛИЧИМ от удачного, и карточка выпадала из очереди на полгода.
 *
 * Цена этой неразличимости замерена на проде: из 721 обогащённой карточки
 * скриншоты и жанры приехали к 125. Остальные 596 — это верх каталога по
 * числу отзывов (CS2, Dota 2, Rainbow Six, Team Fortress 2, Terraria), то
 * есть ровно те страницы, на которые приходят. Обогащение выгребает очередь
 * по убыванию reviews_total, так что первый же прогон уткнулся в лимит
 * appdetails на самых заметных играх — и пометил их сделанными.
 */
export async function markPageMissed(db: Db, appid: number, now: number): Promise<void> {
  await db.execute({
    sql: 'UPDATE games SET page_at = ?, page_tries = page_tries + 1 WHERE appid = ?',
    args: [now, appid],
  })
}

/* ---------- большой каталог ---------- */

export type IngestRow = {
  appid: number
  name: string
  tagids: number[]
  releaseYear?: number
  reviewsTotal?: number
  reviewsPercent?: number
  priceFinal?: number
}

/** Карта территории: все игры Steam. Батчами, чтобы не упереться в лимиты. */
export async function upsertIngestRows(db: Db, rows: IngestRow[], nowSec: number): Promise<void> {
  if (!rows.length) return
  const CHUNK = 250
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batch(
      rows.slice(i, i + CHUNK).map((r) => ({
        sql: `INSERT INTO catalog_ingest
                (appid, name, tagids_json, release_year, reviews_total, reviews_percent, price_final, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(appid) DO UPDATE SET
                name = excluded.name,
                tagids_json = excluded.tagids_json,
                release_year = excluded.release_year,
                reviews_total = excluded.reviews_total,
                reviews_percent = excluded.reviews_percent,
                price_final = excluded.price_final,
                updated_at = excluded.updated_at
              WHERE catalog_ingest.name IS NOT excluded.name
                 OR catalog_ingest.tagids_json IS NOT excluded.tagids_json
                 OR catalog_ingest.reviews_total IS NOT excluded.reviews_total`,
        args: [
          r.appid,
          r.name,
          JSON.stringify(r.tagids),
          r.releaseYear ?? null,
          r.reviewsTotal ?? null,
          r.reviewsPercent ?? null,
          r.priceFinal ?? null,
          nowSec,
        ],
      })),
      'write',
    )
  }
}

/** Сколько игр в карте территории */
export async function countIngest(db: Db): Promise<number> {
  const res = await db.execute('SELECT COUNT(*) AS n FROM catalog_ingest')
  return Number(res.rows[0]?.n ?? 0)
}

/** Кандидаты на глубокую загрузку: самые обсуждаемые из ещё не обработанных */
export async function nextIngestBatch(
  db: Db,
  status: string,
  limit: number,
): Promise<IngestRow[]> {
  const res = await db.execute({
    sql: `SELECT appid, name, tagids_json, release_year, reviews_total, reviews_percent, price_final
          FROM catalog_ingest WHERE status = ? ORDER BY reviews_total DESC LIMIT ?`,
    args: [status, limit],
  })
  return (
    res.rows as unknown as Array<{
      appid: number
      name: string
      tagids_json: string
      release_year: number | null
      reviews_total: number | null
      reviews_percent: number | null
      price_final: number | null
    }>
  ).map((r) => ({
    appid: r.appid,
    name: r.name,
    tagids: JSON.parse(r.tagids_json) as number[],
    ...(r.release_year !== null ? { releaseYear: r.release_year } : {}),
    ...(r.reviews_total !== null ? { reviewsTotal: r.reviews_total } : {}),
    ...(r.reviews_percent !== null ? { reviewsPercent: r.reviews_percent } : {}),
    ...(r.price_final !== null ? { priceFinal: r.price_final } : {}),
  }))
}

export async function setIngestStatus(db: Db, appids: number[], status: string): Promise<void> {
  if (!appids.length) return
  const CHUNK = 500
  for (let i = 0; i < appids.length; i += CHUNK) {
    const part = appids.slice(i, i + CHUNK)
    await db.execute({
      sql: `UPDATE catalog_ingest SET status = ? WHERE appid IN (${placeholders(part.length)})`,
      args: [status, ...part],
    })
  }
}

/** Курсоры фаз сида: чтобы прогон возобновлялся с места обрыва */
export async function setCatalogMeta(db: Db, key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO catalog_meta (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  })
}

export async function getCatalogMeta(db: Db, key: string): Promise<string | null> {
  const res = await db.execute({ sql: 'SELECT value FROM catalog_meta WHERE key = ?', args: [key] })
  return (res.rows[0]?.value as string | undefined) ?? null
}

/** Ключ аренды ОБЩИЙ для всех задач, ходящих на store.steampowered.com */
export const STEAM_LEASE = 'steam_lease'

/**
 * Аренда пересказов — ключ ОТДЕЛЬНЫЙ, и это принципиально. Пересказ не ходит
 * в Steam вовсе, только к Claude, поэтому делить с опросом один замок значило
 * бы запрещать двум задачам работать одновременно без единой общей причины.
 * Свой замок нужен по другому поводу: getUnsummarized не резервирует строки,
 * так что две параллельные фазы пересказа возьмут одни и те же записи и
 * заплатят за них дважды.
 */
export const DIGEST_LEASE = 'digest_lease'

/**
 * Аренда права ходить в Steam. Один UPDATE, без транзакции: в SQLite оператор
 * атомарен сам по себе, и rowsAffected — это и есть ответ «взял / не взял».
 *
 * Зачем вообще: lib/pace.ts держит темп в Map уровня модуля, то есть у каждого
 * инстанса свой лимитер. Пока цепочку запускала только сама себя (ребёнок
 * порождается в finally, ПОСЛЕ работы), инстанс был один и этого хватало. Как
 * только расписание переезжает наружу — на GitHub Actions, — внешний триггер
 * может прийти поверх ещё живой цепочки, и тогда к Steam пойдут два потока по
 * 1.7 с вместо одного: ~216 запросов за пять минут при потолке в 200.
 *
 * Ключ общий с кроном страниц не по экономии, а по существу: он ходит на тот
 * же хост через тот же pace('steam-store') и тратит тот же лимит.
 *
 * Аренда РЕЕНТЕРАБЕЛЬНА по holder — иначе второе звено цепочки не смогло бы
 * продлить то, что взяло первое, и цепочка резала бы сама себя.
 */
export async function acquireLease(
  db: Db,
  key: string,
  holder: string,
  ttlSec: number,
  nowSec: number,
): Promise<boolean> {
  await db.execute({
    sql: `INSERT INTO catalog_meta (key, value) VALUES (?, '')
          ON CONFLICT(key) DO NOTHING`,
    args: [key],
  })
  const res = await db.execute({
    sql: `UPDATE catalog_meta SET value = ?
          WHERE key = ?
            AND CASE
                  WHEN json_valid(value)
                  THEN CAST(json_extract(value, '$.until') AS INTEGER) < ?
                       OR json_extract(value, '$.holder') = ?
                  ELSE 1
                END`,
    args: [JSON.stringify({ holder, until: nowSec + ttlSec }), key, nowSec, holder],
  })
  return Number(res.rowsAffected ?? 0) > 0
}

/**
 * Отдать аренду досрочно. Не отдали — истечёт сама по until.
 *
 * Разбор JSON спрятан под CASE, и это не педантизм: отданная аренда хранится
 * ПУСТОЙ СТРОКОЙ, а json_extract('', …) в SQLite бросает «malformed JSON», а не
 * возвращает NULL. То есть повторная отдача — или отдача ключа, которого никто
 * не брал, — падала с исключением.
 *
 * Цена ошибки не в самом исключении, а в том, откуда оно летело: все пять
 * вызовов releaseLease в кронах стоят внутри finally. Исключение там обрывает
 * блок, то есть цепочка не передаётся следующему звену, аренда не снимается и
 * маркер прогона не пишется. Отказ выглядел бы как молчание — ровно тот случай,
 * который дороже всего искать.
 *
 * CASE, а не `value <> '' AND json_extract(...)`: порядок вычисления операндов
 * AND и OR в SQLite не оговорён, а CASE вычисляет ветви строго по условию.
 * Соседний acquireLease переписан так же и по той же причине — он держался на
 * подразумеваемом коротком замыкании OR.
 */
export async function releaseLease(db: Db, key: string, holder: string): Promise<void> {
  await db.execute({
    sql: `UPDATE catalog_meta SET value = '' WHERE key = ?
            AND CASE
                  WHEN json_valid(value) THEN json_extract(value, '$.holder') = ?
                  ELSE 0
                END`,
    args: [key, holder],
  })
}

/** Словарь тегов Steam: tagid -> имя */
export async function saveTagDictionary(db: Db, tags: Map<number, string>): Promise<void> {
  const rows = [...tags.entries()]
  const CHUNK = 250
  for (let i = 0; i < rows.length; i += CHUNK) {
    await db.batch(
      rows.slice(i, i + CHUNK).map(([tagid, name]) => ({
        sql: `INSERT INTO tags (tagid, name) VALUES (?, ?)
              ON CONFLICT(tagid) DO UPDATE SET name = excluded.name`,
        args: [tagid, name],
      })),
      'write',
    )
  }
}

export async function loadTagDictionary(db: Db): Promise<Map<number, string>> {
  const res = await db.execute('SELECT tagid, name FROM tags')
  const out = new Map<number, string>()
  for (const r of res.rows as unknown as Array<{ tagid: number; name: string }>) {
    out.set(r.tagid, r.name)
  }
  return out
}

/**
 * Проекция тегов допустимых игр. Хранится только топ-N тегов на игру, и только
 * для игр, прошедших фильтры актуальности — так «топ по тегу» не возвращает
 * мертвецов, которые потом отсеются в JS и оставят пустую выдачу.
 */
export async function replaceGameTags(
  db: Db,
  appid: number,
  tags: Array<{ tag: string; weight: number }>,
): Promise<void> {
  await db.execute({ sql: 'DELETE FROM game_tags WHERE appid = ?', args: [appid] })
  if (!tags.length) return
  await db.batch(
    tags.map((t) => ({
      sql: 'INSERT OR REPLACE INTO game_tags (appid, tag, weight) VALUES (?, ?, ?)',
      args: [appid, t.tag, t.weight],
    })),
    'write',
  )
}

/**
 * Ключ знаменателя для авто-стоп-слов. Пишется рядом с game_count и только тут:
 * доля тега имеет смысл лишь когда числитель и знаменатель посчитаны по ОДНОЙ
 * популяции, а разъехаться они могут молча.
 */
export const POOL_SIZE_KEY = 'pool_size'

/**
 * Частотность тега по каталогу — из неё считаются авто-стоп-слова.
 *
 * Знаменатель обновляется той же инструкцией, что и числитель, и это не
 * аккуратность, а починка. game_count считается по game_tags — то есть по
 * промоутнутой витрине (тысячи игр), — а STOP_TAG_SHARE в lib/pool.ts делил его
 * на countIngest, то есть на карту территории (сотни тысяч). Деление одной
 * популяции на другую занижало долю примерно в тридцать раз, порог 0.15 не
 * достигался никогда, и Singleplayer с Action уходили в запрос как «характерные
 * теги вкуса». В облаке было ещё хуже: catalog_ingest туда не публикуется
 * (см. scripts/publish-catalog.ts), знаменатель равен нулю и фильтр пропускал
 * вообще всё. Тот же класс ошибки уже описан в lib/compat.ts у rarityScale.
 */
export async function rebuildTagStats(db: Db): Promise<void> {
  await db.execute(`UPDATE tags SET game_count = (
    SELECT COUNT(*) FROM game_tags WHERE game_tags.tag = tags.name
  )`)
  const res = await db.execute('SELECT COUNT(DISTINCT appid) AS n FROM game_tags')
  await setCatalogMeta(db, POOL_SIZE_KEY, String(Number(res.rows[0]?.n ?? 0)))
}

/**
 * Знаменатель для pickQueryTags. Ноль означает «витрина ещё не публиковалась» —
 * в этом случае фильтр стоп-слов сам себя выключает и подбор работает как до
 * починки, а не падает на непрогретой базе.
 */
export async function getPoolSize(db: Db): Promise<number> {
  const raw = await getCatalogMeta(db, POOL_SIZE_KEY)
  const n = Number(raw ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export async function loadTagStats(db: Db): Promise<Map<string, number>> {
  const res = await db.execute('SELECT name, game_count FROM tags WHERE game_count > 0')
  const out = new Map<string, number>()
  for (const r of res.rows as unknown as Array<{ name: string; game_count: number }>) {
    out.set(r.name, r.game_count)
  }
  return out
}

/** appid'ы, которых нет в кэше или чьи метаданные старше maxAgeSec (один запрос) */
export async function getStaleAppids(
  db: Db,
  appids: number[],
  maxAgeSec: number,
  nowSec: number,
): Promise<number[]> {
  if (!appids.length) return []
  const res = await db.execute({
    sql: `SELECT appid, updated_at, art_json FROM games WHERE ${APPIDS_IN}`,
    args: [JSON.stringify(appids)],
  })
  const fresh = new Set<number>()
  for (const r of res.rows as unknown as Array<{
    appid: number
    updated_at: number
    art_json: string | null
  }>) {
    // Строка без резолвленного арта считается протухшей независимо от возраста:
    // иначе игры, прогретые до появления art_json, остались бы с одной мелкой
    // обложкой до истечения TTL
    if (nowSec - r.updated_at <= maxAgeSec && r.art_json) fresh.add(r.appid)
  }
  return appids.filter((appid) => !fresh.has(appid))
}

/**
 * appid, у которых цену пора перезамерить.
 *
 * Отдельно от getStaleAppids и по отдельной колонке: у метаданных TTL две
 * недели, у скидки — часы. Отрицательные appid (кураторский пул других
 * магазинов) не берём вовсе — в Steam их нет, и они бы вечно висели в очереди,
 * съедая бюджет запроса.
 */
export async function stalePriceAppids(
  db: Db,
  appids: number[],
  maxAgeSec: number,
  nowSec: number,
  limit = 200,
): Promise<number[]> {
  const positive = appids.filter((id) => id > 0)
  if (!positive.length) return []
  const res = await db.execute({
    // Сначала те, у кого цены не было никогда, потом самые давние: бюджет
    // одного вызова конечен, а пустая цена заметнее устаревшей
    sql: `SELECT appid FROM games
          WHERE ${APPIDS_IN}
            AND (price_at IS NULL OR price_at < ?)
          ORDER BY price_at IS NOT NULL, price_at
          LIMIT ?`,
    args: [JSON.stringify(positive), nowSec - maxAgeSec, limit],
  })
  return (res.rows as unknown as Array<{ appid: number }>).map((r) => r.appid)
}

export type PriceQuote = {
  appid: number
  priceFinal?: number
  priceInitial?: number
  discountPercent?: number
  discountEndsAt?: number
}

/**
 * Записывает свежие цены, не трогая остальные метаданные.
 *
 * Узкий UPDATE, а не upsertGameMeta: тот перезаписывает строку целиком и
 * двигает updated_at, то есть замер цены отменял бы прогрев метаданных на
 * две недели вперёд.
 *
 * Ответ без блока покупки (free-to-play, снято с продажи, региональное
 * ограничение) гасит скидку, но НЕ цену: «Steam не назвал цену» и «игра стала
 * бесплатной» с этой стороны неразличимы, а обнулить цену бэклога из-за
 * регионального сбоя дороже, чем показать вчерашнюю. price_at ставится в обоих
 * случаях — иначе такие игры перезапрашивались бы на каждом заходе.
 */
export async function updateGamePrices(
  db: Db,
  quotes: PriceQuote[],
  nowSec: number,
): Promise<void> {
  if (!quotes.length) return
  const stmts = quotes.map((q) =>
    q.priceFinal === undefined
      ? {
          sql: `UPDATE games SET discount_percent = NULL, discount_ends_at = NULL, price_at = ?
                WHERE appid = ?`,
          args: [nowSec, q.appid],
        }
      : {
          sql: `UPDATE games SET price_final = ?, price_initial = ?, discount_percent = ?,
                  discount_ends_at = ?, price_at = ?
                WHERE appid = ?`,
          args: [
            q.priceFinal,
            q.priceInitial ?? q.priceFinal,
            q.discountPercent ?? 0,
            q.discountEndsAt ?? null,
            nowSec,
            q.appid,
          ],
        },
  )
  await db.batch(stmts, 'write')
}

/* ---------- фидбек ---------- */

/**
 * Окно, в котором повторное «зашло» или «запустил» той же игры — одно событие.
 * Двойной клик, «Зашло» после «Запустить», перезагрузка выдачи — всё это один
 * и тот же сигнал, а не пять. Сутки, а не навсегда: запустить любимую игру
 * через неделю снова — уже новое событие.
 */
const FEEDBACK_DEDUP_SEC = 86_400

export async function logFeedback(
  db: Db,
  entry: {
    steamid: string
    appid: number
    action: FeedbackAction
    reason?: SkipReason
    mood?: Mood
  },
  nowSec: number,
): Promise<void> {
  const args = [
    entry.steamid,
    entry.appid,
    entry.action,
    entry.reason ?? null,
    entry.mood ? JSON.stringify(entry.mood) : null,
    nowSec,
  ]
  // Скипы, открытия и баны пишутся как есть: у них своя история (причина,
  // время, снятие бана), и схлопывать её незачем. Дедуп — только для положительных сигналов,
  // которые копятся от повторных нажатий. Одним условным INSERT, а не SELECT
  // и INSERT: между ними успел бы проскочить второй клик.
  //
  // Повтор — только если между ним и прежней строкой не было скипа. Запуск
  // после «не сейчас» — уже не повтор, а новый ответ: cooldownOf снимает паузу
  // лишь тёплой строкой НОВЕЕ скипа, и молча проглоченный запуск оставил бы
  // игру отложенной на трое суток, пока человек в неё играет. «Крутить ещё»
  // ответом про игру не считается — как и в cooldownOf.
  if (entry.action === 'liked' || entry.action === 'launched') {
    await db.execute({
      sql: `INSERT INTO feedback (steamid, appid, action, reason, mood_json, created_at)
            SELECT ?, ?, ?, ?, ?, ?
            WHERE NOT EXISTS (
              SELECT 1 FROM feedback f
              WHERE f.steamid = ? AND f.appid = ? AND f.action = ? AND f.created_at > ?
                AND NOT EXISTS (
                  SELECT 1 FROM feedback s
                  WHERE s.steamid = f.steamid AND s.appid = f.appid
                    AND s.action = 'skipped' AND s.reason IS NOT 'spin'
                    AND s.created_at >= f.created_at
                )
            )`,
      args: [...args, entry.steamid, entry.appid, entry.action, nowSec - FEEDBACK_DEDUP_SEC],
    })
    return
  }
  await db.execute({
    sql: 'INSERT INTO feedback (steamid, appid, action, reason, mood_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    args,
  })
}

export async function listFeedback(db: Db, steamid: string, limit = 500): Promise<FeedbackRow[]> {
  const res = await db.execute({
    sql: `SELECT steamid, appid, action, reason, mood_json, created_at FROM feedback
          WHERE steamid = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
    args: [steamid, limit],
  })
  return (
    res.rows as unknown as Array<{
      steamid: string
      appid: number
      action: FeedbackAction
      reason: SkipReason | null
      mood_json: string | null
      created_at: number
    }>
  ).map((r) => ({
    steamid: r.steamid,
    appid: r.appid,
    action: r.action,
    ...(r.reason ? { reason: r.reason } : {}),
    ...(r.mood_json ? { mood: JSON.parse(r.mood_json) as Mood } : {}),
    createdAt: r.created_at,
  }))
}

/**
 * Доля «зашло» среди оценённых показов (liked против skipped).
 *
 * «Зашло» считается по играм, а не по нажатиям: одна игра, отмеченная трижды
 * за месяц, — одно попадание. Запуски ('launched') сюда не входят вовсе:
 * запуск — ещё не оценка. «Крутить ещё» в рулетке (reason 'spin') — тоже не
 * промах подбора, а бросок кубика, поэтому из знаменателя исключён.
 */
export async function feedbackStats(
  db: Db,
  steamid: string,
): Promise<{ liked: number; skipped: number; rate: number | null }> {
  const res = await db.execute({
    sql: `SELECT
            COUNT(DISTINCT CASE WHEN action = 'liked' THEN appid END) AS liked,
            SUM(CASE WHEN action = 'skipped' AND reason IS NOT 'spin' THEN 1 ELSE 0 END) AS skipped
          FROM feedback WHERE steamid = ?`,
    args: [steamid],
  })
  const row = res.rows[0] as unknown as { liked: number | null; skipped: number | null } | undefined
  const liked = Number(row?.liked ?? 0)
  const skipped = Number(row?.skipped ?? 0)
  const total = liked + skipped
  return { liked, skipped, rate: total > 0 ? liked / total : null }
}

export async function bannedAppids(db: Db, steamid: string): Promise<Set<number>> {
  const res = await db.execute({
    sql: "SELECT DISTINCT appid FROM feedback WHERE steamid = ? AND action = 'banned'",
    args: [steamid],
  })
  return new Set((res.rows as unknown as Array<{ appid: number }>).map((r) => r.appid))
}

/**
 * Забаненные с датой — для полки на /library.
 *
 * Свежие сверху: бан почти всегда снимают с того, что забанили сгоряча минуту
 * назад, а не с того, что лежит там полгода. MAX(created_at), потому что бан
 * одной игры может лежать несколькими строками — logFeedback только добавляет.
 *
 * Тай-брейк по appid обязателен, а не для красоты. created_at секундный, и
 * забанить три игры подряд в одну секунду — обычное дело: на /play бан висит в
 * одном клике от выдачи. При равном at SQLite волен вернуть строки в любом
 * порядке, а /library — force-dynamic, и WarmCatalog дёргает на ней
 * router.refresh(). Полка молча перетасовывалась бы сама собой через секунду
 * после загрузки — та же болезнь, от которой лечится pickForgotten.
 */
export async function listBanned(
  db: Db,
  steamid: string,
  limit = 60,
): Promise<Array<{ appid: number; at: number }>> {
  const res = await db.execute({
    sql: `SELECT appid, MAX(created_at) AS at FROM feedback
          WHERE steamid = ? AND action = 'banned'
          GROUP BY appid ORDER BY at DESC, appid LIMIT ?`,
    args: [steamid, limit],
  })
  return (res.rows as unknown as Array<{ appid: number; at: number }>).map((r) => ({
    appid: Number(r.appid),
    at: Number(r.at),
  }))
}

/**
 * Снять бан. Именно DELETE, а не ещё одна строка с action='unbanned':
 * bannedAppids читает наличие строки, и любой «отменяющий» маркер пришлось бы
 * учитывать в каждом месте, где бан фильтрует выдачу. Пропадает только запрет —
 * лайки, скипы и открытия этой игры остаются на месте.
 */
export async function unbanGame(db: Db, steamid: string, appid: number): Promise<void> {
  await db.execute({
    sql: "DELETE FROM feedback WHERE steamid = ? AND appid = ? AND action = 'banned'",
    args: [steamid, appid],
  })
}

/* ---------- удаление по запросу ---------- */

/**
 * Где лежат данные одного игрока. Один список и для удаления, и для
 * предпросмотра в scripts/forget-user.ts.
 *
 * Список один намеренно. Если бы счёт и удаление держали свои копии условий,
 * первая же новая таблица попала бы только в одну из них, и предпросмотр
 * обещал бы то, чего удаление не делает. Что сюда попадают ВСЕ таблицы с
 * колонкой steamid или created_by, проверяет lib/db.test.ts.
 *
 * Комнаты, созданные игроком, уходят целиком, вместе с чужими участниками и
 * голосами в них. Создатель — часть самой комнаты: обезличить его значит
 * оставить комнату без хозяина, из которой никто не сможет убрать участника
 * (leave/route.ts сверяет право по createdBy). Комната живёт один вечер, и
 * потеря чужих свайпов в ней дешевле недоудалённого человека. Поэтому голоса
 * и участники идут раньше rooms: находятся они по rooms.created_by.
 *
 * Сессии удаляются, хотя в остальном коде надгробия не убираются. Там отзыв
 * обязан отличаться от «строки нет», чтобы икота базы не разлогинивала людей.
 * Здесь человек сам попросил убрать всё; если он вернётся с прежней кукой,
 * это будет первый визит с чистого листа.
 *
 * rate_limits: ключ устроен как bucket:id:окно (lib/ratelimit.ts), и id
 * бывает steamid. instr, а не LIKE: в LIKE `_` и `%` — подстановки.
 *
 * news_poll не трогается: это очередь опроса игр, а не людей, и в ней нет
 * следа того, чья библиотека её пополнила.
 */
const USER_ROWS = [
  {
    table: 'room_votes',
    where: 'steamid = ? OR room_id IN (SELECT id FROM rooms WHERE created_by = ?)',
  },
  {
    table: 'room_members',
    where: 'steamid = ? OR room_id IN (SELECT id FROM rooms WHERE created_by = ?)',
  },
  // Людей в колоде нет, но она часть комнаты и уходит вместе с ней: иначе
  // осиротевшие карты достались бы новой комнате с тем же кодом.
  { table: 'room_deck', where: 'room_id IN (SELECT id FROM rooms WHERE created_by = ?)' },
  { table: 'rooms', where: 'created_by = ?' },
  { table: 'feedback', where: 'steamid = ?' },
  { table: 'daily_picks', where: 'steamid = ?' },
  { table: 'library_snapshots', where: 'steamid = ?' },
  { table: 'library_baselines', where: 'steamid = ?' },
  { table: 'sessions', where: 'steamid = ?' },
  { table: 'users', where: 'steamid = ?' },
  { table: 'rate_limits', where: "instr(key, ':' || ? || ':') > 0" },
] as const

/** Таблицы, которые чистит forgetUser, — для сторожа в тестах */
export const FORGET_TABLES: readonly string[] = USER_ROWS.map((r) => r.table)

/** Сколько строк нашлось (или удалено) по каждой таблице, в порядке удаления */
export type ForgetReport = Array<{ table: string; rows: number }>

/**
 * Пустая строка или опечатка здесь стоили бы чужих данных: instr с пустым
 * steamid совпал бы с каждым ключом лимитера. Формат тот же, что проверяют
 * все маршруты и подпись сессии.
 */
function userArgs(steamid: string, where: string): string[] {
  if (!/^\d{17}$/.test(steamid)) throw new Error(`не SteamID64: «${steamid}»`)
  return Array.from({ length: where.split('?').length - 1 }, () => steamid)
}

/** Предпросмотр forgetUser: только читает */
export async function countUserRows(db: Db, steamid: string): Promise<ForgetReport> {
  const res = await db.batch(
    USER_ROWS.map((r) => ({
      sql: `SELECT COUNT(*) AS n FROM ${r.table} WHERE ${r.where}`,
      args: userArgs(steamid, r.where),
    })),
    'read',
  )
  return USER_ROWS.map((r, i) => ({ table: r.table, rows: Number(res[i]?.rows[0]?.n ?? 0) }))
}

/**
 * Удалить всё, что хранится об игроке, — по запросу из /privacy, раздел 06.
 *
 * Одной пачкой: либо ушло всё, либо ничего. Половинное удаление хуже любого
 * из двух: человеку ответили «удалили», а годовые отметки или голоса
 * остались, и искать их потом по уже пустым users никто не станет.
 */
export async function forgetUser(db: Db, steamid: string): Promise<ForgetReport> {
  const res = await db.batch(
    USER_ROWS.map((r) => ({
      sql: `DELETE FROM ${r.table} WHERE ${r.where}`,
      args: userArgs(steamid, r.where),
    })),
    'write',
  )
  return USER_ROWS.map((r, i) => ({ table: r.table, rows: Number(res[i]?.rowsAffected ?? 0) }))
}

/* ---------- уборка ---------- */

/** Демо-личность живёт неделю с последнего признака жизни */
export const DEMO_TTL_SEC = 7 * 86_400

/**
 * Комната живёт один вечер. Две недели — запас на ссылку, открытую позже,
 * и на церемонию матча, к которой возвращаются показать друзьям.
 */
export const ROOM_TTL_SEC = 14 * 86_400

/**
 * Запас сверх срока куки, прежде чем строка сессии уйдёт.
 *
 * Строку можно удалить, только когда ни один токен с её sid уже не пройдёт
 * проверку срока. Иначе «строки нет» прочтётся как «вход жив» (см. шапку
 * sessions и resolveSession): погашенное устройство воскресло бы, а вход
 * через Steam потерял бы verified. Последний токен выдан не позже последнего
 * продления, а его отметка — seen_at, но touchSession после продления может
 * не записаться, и отметка отстанет. Отсюда запас: месяц, а не минута
 * REVOKE_CACHE_SEC, на которую может опоздать сам отзыв.
 */
const SESSION_SWEEP_MARGIN_SEC = 30 * 86_400

/**
 * Демо-личность, от которой неделю нет вестей: ни нового демо-входа
 * (users.last_seen_at), ни визита по живой сессии, ни оценок. Префикс '000' —
 * признак демо (isDemoId в lib/server): у настоящих SteamID64 он 7656119.
 * GLOB по префиксу идёт по первичному ключу users, а не сканом всех людей.
 *
 * Визит по сессии узнаётся по seen_at, но это отметка ПРОДЛЕНИЯ, а не
 * визита: /api/session/touch переставляет куку и отметку не чаще раза в
 * SESSION_TOUCH_AFTER_SEC. Человек, заходящий в демо каждый день без единой
 * оценки, неделю держал seen_at на месте — и уборка сносила его посреди
 * пользования. Зато позже seen_at + SESSION_TOUCH_AFTER_SEC он заходить не
 * мог: такой визит продлил бы куку и сдвинул отметку. Поэтому у сессии
 * порог свой — DEMO_TTL_SEC плюс этот лаг (второй аргумент, см. sweepStale).
 */
const STALE_DEMO = `steamid IN (
  SELECT u.steamid FROM users u
   WHERE u.steamid GLOB '000*' AND u.last_seen_at < ?
     AND NOT EXISTS (SELECT 1 FROM sessions s
                      WHERE s.steamid = u.steamid AND s.revoked_at IS NULL AND s.seen_at >= ?)
     AND NOT EXISTS (SELECT 1 FROM feedback f
                      WHERE f.steamid = u.steamid AND f.created_at >= ?)
)`

const OLD_ROOM = 'room_id IN (SELECT id FROM rooms WHERE created_at < ?)'

export type SweepReport = { demos: number; sessions: number; rooms: number }

/**
 * Суточная уборка того, что иначе копилось бы вечно. Зовётся из крона
 * новостей рядом с sweepRateLimits, никогда — из запроса.
 *
 *   • Демо-личности. Каждый клик «Демо» заводил новую — строки в users,
 *     sessions, library_snapshots, library_baselines, — и ни одна не
 *     удалялась: один адрес под потолком /api/connect выпускал больше тысячи
 *     личностей в сутки, и данные живых людей тонули в демо-строках.
 *   • Сессии, чей вход истёк у всех токенов, — с запасом, см.
 *     SESSION_SWEEP_MARGIN_SEC. Надгробия моложе этого остаются: отзыв обязан
 *     отличаться от «строки нет».
 *   • Комнаты старше ROOM_TTL_SEC — вместе с участниками, голосами и колодой.
 *     Опоздавший по старой ссылке увидит «Такой комнаты нет».
 *
 * Одной пачкой: предикат демо опирается на users, поэтому users уходит
 * последней, а обрыв посередине не оставит личность без половины строк.
 */
export async function sweepStale(db: Db, nowSec: number): Promise<SweepReport> {
  const demoCutoff = nowSec - DEMO_TTL_SEC
  const demo = [demoCutoff, demoCutoff - SESSION_TOUCH_AFTER_SEC, demoCutoff]
  const roomCutoff = nowSec - ROOM_TTL_SEC
  const [, , , , sessions, demos, , , , rooms] = await db.batch(
    [
      ...['feedback', 'daily_picks', 'library_snapshots', 'library_baselines'].map((table) => ({
        sql: `DELETE FROM ${table} WHERE ${STALE_DEMO}`,
        args: demo,
      })),
      // Истёкшие и демо — одним проходом. Индекс по steamid у sessions
      // частичный (только живые), и демо-сессии отдельной инструкцией всё
      // равно стоили бы полного скана — второго за ту же уборку.
      {
        sql: `DELETE FROM sessions
               WHERE max(seen_at, COALESCE(revoked_at, 0)) < ? OR ${STALE_DEMO}`,
        args: [nowSec - SESSION_TTL_SEC - SESSION_SWEEP_MARGIN_SEC, ...demo],
      },
      { sql: `DELETE FROM users WHERE ${STALE_DEMO}`, args: demo },
      { sql: `DELETE FROM room_votes WHERE ${OLD_ROOM}`, args: [roomCutoff] },
      { sql: `DELETE FROM room_members WHERE ${OLD_ROOM}`, args: [roomCutoff] },
      { sql: `DELETE FROM room_deck WHERE ${OLD_ROOM}`, args: [roomCutoff] },
      { sql: 'DELETE FROM rooms WHERE created_at < ?', args: [roomCutoff] },
    ],
    'write',
  )
  return {
    demos: Number(demos?.rowsAffected ?? 0),
    sessions: Number(sessions?.rowsAffected ?? 0),
    rooms: Number(rooms?.rowsAffected ?? 0),
  }
}

/* ---------- патчноуты ---------- */

export type NewsKind = 'patch' | 'news'
export type NewsScale = 'major' | 'hotfix'

export type StoredNews = {
  appid: number
  gid: string
  title: string
  url: string
  publishedAt: number
  kind: NewsKind
  scale: NewsScale | null
  blocks: NewsBlock[]
  bodyHash: string
  imageUrl?: string
  rank: number
  tldr?: string
}

/**
 * Строка ленты без тела патча.
 *
 * Ровно то, что уезжает в клиентские островки «Что нового». Тело приходит
 * отдельно (см. getNewsBlocks и app/api/news): в разметке страницы оно
 * занимало больше половины веса, а раскрывают одну строку из тридцати.
 */
export type FeedItem = Omit<StoredNews, 'blocks'>

/**
 * Строка ленты без тела патча.
 *
 * Всё, что передано клиентскому островку, уезжает в браузер
 * сериализованным. На /whatsnew тела тридцати патчей были 277 КБ из 476 на
 * проде — 58% веса страницы на текст, который раскрывают у одной строки из
 * тридцати. На карточке игры то же самое: 69 КБ инлайновых скриптов при 6.5
 * КБ видимого текста. Тело отдаёт app/api/news по требованию.
 *
 * Живёт рядом с FeedItem, а не в разметке: потребителей теперь два, и
 * разъехаться им нельзя.
 */
export function withoutBody(item: StoredNews): FeedItem {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { blocks, ...row } = item
  return row
}

/** Статусы опроса: gone — игра без ленты, mismatch — фид отдаёт чужие appid */
export type PollStatus = 'new' | 'ok' | 'empty' | 'error' | 'gone' | 'mismatch'

type NewsRow = {
  appid: number
  gid: string
  title: string
  url: string
  published_at: number
  kind: string
  scale: string | null
  blocks_json: string
  body_hash: string
  image_url: string | null
  rank: number
  tldr: string | null
}

function rowToNews(r: NewsRow): StoredNews {
  let blocks: NewsBlock[] = []
  try {
    const parsed = JSON.parse(r.blocks_json)
    if (Array.isArray(parsed)) blocks = parsed as NewsBlock[]
  } catch {
    // битый блоб не должен ронять страницу игры
  }
  return {
    appid: r.appid,
    gid: r.gid,
    title: r.title,
    url: r.url,
    publishedAt: r.published_at,
    kind: r.kind === 'patch' ? 'patch' : 'news',
    scale: r.scale === 'major' || r.scale === 'hotfix' ? r.scale : null,
    blocks,
    bodyHash: r.body_hash,
    ...(r.image_url ? { imageUrl: r.image_url } : {}),
    rank: r.rank,
    ...(r.tldr ? { tldr: r.tldr } : {}),
  }
}

const NEWS_COLS =
  'appid, gid, title, url, published_at, kind, scale, blocks_json, body_hash, image_url, rank, tldr'

/**
 * Во сколько раз перебираем строк, чтобы после схлопывания по играм осталось
 * столько, сколько просили. Четырёх хватает: даже Valve, патчащая всю линейку
 * разом, не занимает больше четверти окна.
 */
const OVERFETCH = 4

/**
 * Не больше одного патча на игру в ленте.
 *
 * Без этого лента перестаёт быть лентой: Valve выкатывает движковый апдейт
 * сразу во все свои старые игры, Warhammer патчится через день — и десяток
 * верхних карточек оказывается одной и той же игрой. Показываем самый свежий
 * патч каждой, остальное — на странице игры.
 */
function onePerGame<T extends { appid: number }>(rows: T[], limit: number): T[] {
  const seen = new Set<number>()
  const out: T[] = []
  for (const r of rows) {
    if (seen.has(r.appid)) continue
    seen.add(r.appid)
    out.push(r)
    if (out.length >= limit) break
  }
  return out
}

/**
 * Записывает посты, не переписывая то, что не изменилось: Turso тарифицирует и
 * записи тоже, а лента перечитывается целиком на каждом опросе.
 *
 * Пересказ Claude сбрасывается ТОЛЬКО когда изменилось тело (body_hash) —
 * иначе за один и тот же патч платили бы каждые сутки.
 */
export async function upsertNewsItems(
  db: Db,
  items: StoredNews[],
  nowSec: number,
): Promise<number> {
  if (!items.length) return 0
  const stmts = items.map((n) => ({
    sql: `INSERT INTO news_items (${NEWS_COLS}, tldr_at, tldr_tries, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?, ?)
          ON CONFLICT(appid, gid) DO UPDATE SET
            title = excluded.title,
            url = excluded.url,
            published_at = excluded.published_at,
            kind = excluded.kind,
            blocks_json = excluded.blocks_json,
            body_hash = excluded.body_hash,
            image_url = excluded.image_url,
            -- не MAX: вес считается из games одинаково для любого опроса, так
            -- что свежее значение всегда вернее. Иначе игра, умершая после
            -- попадания в ленту, застревала бы в ней навсегда
            rank = excluded.rank,
            updated_at = excluded.updated_at,
            scale = CASE WHEN news_items.body_hash IS excluded.body_hash
                         THEN news_items.scale ELSE excluded.scale END,
            tldr = CASE WHEN news_items.body_hash IS excluded.body_hash
                        THEN news_items.tldr ELSE NULL END,
            tldr_at = CASE WHEN news_items.body_hash IS excluded.body_hash
                           THEN news_items.tldr_at ELSE NULL END,
            tldr_tries = CASE WHEN news_items.body_hash IS excluded.body_hash
                              THEN news_items.tldr_tries ELSE 0 END
          WHERE news_items.body_hash IS NOT excluded.body_hash
             OR news_items.title IS NOT excluded.title
             OR news_items.kind IS NOT excluded.kind
             OR news_items.rank IS NOT excluded.rank`,
    args: [
      n.appid,
      n.gid,
      n.title,
      n.url,
      n.publishedAt,
      n.kind,
      n.scale,
      JSON.stringify(n.blocks),
      n.bodyHash,
      n.imageUrl ?? null,
      n.rank,
      nowSec,
      nowSec,
    ],
  }))
  const res = await db.batch(stmts, 'write')
  return res.reduce((sum, r) => sum + Number(r.rowsAffected ?? 0), 0)
}

/**
 * Тело одного патча — для ленты, которая раскрывает строку по требованию.
 *
 * Отдельный запрос вместо колонки в ленте: в общей выборке тридцати строк
 * blocks_json занимал больше половины веса страницы, а прочитан бывает
 * один из тридцати. Возвращает null и на «нет такой записи», и на битый
 * блоб — вызывающему в обоих случаях нечего показать.
 */
export async function getNewsBlocks(
  db: Db,
  appid: number,
  gid: string,
): Promise<NewsBlock[] | null> {
  const res = await db.execute({
    sql: 'SELECT blocks_json FROM news_items WHERE appid = ? AND gid = ?',
    args: [appid, gid],
  })
  const raw = res.rows[0]?.blocks_json
  if (typeof raw !== 'string') return null
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as NewsBlock[]) : null
  } catch {
    return null
  }
}

/** Страница игры: тут показываем и мелкие патчи тоже */
export async function getGameNews(db: Db, appid: number, limit = 8): Promise<StoredNews[]> {
  if (appid <= 0) return []
  const res = await db.execute({
    sql: `SELECT ${NEWS_COLS} FROM news_items
          WHERE appid = ? AND kind = 'patch'
          ORDER BY published_at DESC LIMIT ?`,
    args: [appid, limit],
  })
  return (res.rows as unknown as NewsRow[]).map(rowToNews)
}

/**
 * Общая лента: и для гостя, и для вкладки «в популярных играх». Предикат
 * повторяет idx_news_feed ДОСЛОВНО — иначе SQLite не возьмёт частичный индекс,
 * и это станет сканом всей таблицы, который noscan не поймает (LIMIT-то на месте).
 *
 * minRank — этаж популярности, и он идёт ВДОБАВОК к rank > 0, а не вместо.
 * Соблазн схлопнуть два условия в одно проверен планом запроса на живой базе:
 *
 *   … rank > 0 AND rank >= ?  →  SEARCH news_items USING INDEX idx_news_feed
 *   … rank >= ?  (без rank>0) →  SCAN news_items + USE TEMP B-TREE FOR ORDER BY
 *
 * Доказать rank > 0 из rank >= ? SQLite не может: значения параметра он не
 * видит. Лишнее AND-условие индексу при этом не мешает.
 *
 * Порог по умолчанию нулевой: «какая игра считается популярной» — решение
 * страницы, а не слоя данных, и живёт оно рядом с LIBRARY_CAP и FEED_LIMIT.
 */
export async function getMajorFeed(
  db: Db,
  limit = 30,
  opts: { before?: number; minRank?: number } = {},
): Promise<StoredNews[]> {
  const { before, minRank = 0 } = opts
  const res = await db.execute({
    sql: `SELECT ${NEWS_COLS} FROM news_items
          WHERE kind = 'patch' AND scale = 'major' AND rank > 0
            AND rank >= ?
            AND published_at < ?
          ORDER BY published_at DESC LIMIT ?`,
    args: [minRank, before ?? 2_000_000_000, limit * OVERFETCH],
  })
  return onePerGame((res.rows as unknown as NewsRow[]).map(rowToNews), limit)
}

/** Личная лента: крупные патчи по играм библиотеки */
export async function getFeedForApps(
  db: Db,
  appids: number[],
  limit = 30,
  before?: number,
): Promise<StoredNews[]> {
  const ids = appids.filter((a) => a > 0).slice(0, 400)
  if (!ids.length) return []
  const res = await db.execute({
    sql: `SELECT ${NEWS_COLS} FROM news_items
          WHERE appid IN (${placeholders(ids.length)})
            AND kind = 'patch' AND scale = 'major' AND published_at < ?
          ORDER BY published_at DESC LIMIT ?`,
    args: [...ids, before ?? 2_000_000_000, limit * OVERFETCH],
  })
  return onePerGame((res.rows as unknown as NewsRow[]).map(rowToNews), limit)
}

/* ---------- голова ленты: то же, но без тел патчей ---------- */

export type FeedHeadItem = { appid: number; gid: string; publishedAt: number }

type HeadRow = { appid: number; gid: string; published_at: number }

const HEAD_COLS = 'appid, gid, published_at'

function rowToHead(r: HeadRow): FeedHeadItem {
  return { appid: r.appid, gid: r.gid, publishedAt: r.published_at }
}

/**
 * Голова общей ленты: те же строки в том же порядке, что у getMajorFeed, но
 * без blocks_json.
 *
 * Строк из базы читается СТОЛЬКО ЖЕ, и Turso тарифицирует строки — экономии в
 * счёте здесь нет вовсе, и обещать её не надо. Экономия в другом: blocks_json
 * это тела тридцати патчей, и возить их по проводу вместе с тридцатью вызовами
 * JSON.parse каждые две минуты на каждую открытую вкладку — только ради ответа
 * «изменилось или нет» — несоразмерно.
 *
 * Предикат и порядок обязаны совпадать с getMajorFeed до последнего слова:
 * на этом держится честность числа на плашке. За совпадением следит тест
 * «голова и лента отдают одни и те же ключи» в lib/db.test.ts.
 */
export async function getMajorFeedHead(
  db: Db,
  limit = 30,
  opts: { before?: number; minRank?: number } = {},
): Promise<FeedHeadItem[]> {
  const { before, minRank = 0 } = opts
  const res = await db.execute({
    sql: `SELECT ${HEAD_COLS} FROM news_items
          WHERE kind = 'patch' AND scale = 'major' AND rank > 0
            AND rank >= ?
            AND published_at < ?
          ORDER BY published_at DESC LIMIT ?`,
    args: [minRank, before ?? 2_000_000_000, limit * OVERFETCH],
  })
  return onePerGame((res.rows as unknown as HeadRow[]).map(rowToHead), limit)
}

/** Голова личной ленты. Зеркало getFeedForApps — см. докблок выше. */
export async function getFeedHeadForApps(
  db: Db,
  appids: number[],
  limit = 30,
  before?: number,
): Promise<FeedHeadItem[]> {
  const ids = appids.filter((a) => a > 0).slice(0, 400)
  if (!ids.length) return []
  const res = await db.execute({
    sql: `SELECT ${HEAD_COLS} FROM news_items
          WHERE appid IN (${placeholders(ids.length)})
            AND kind = 'patch' AND scale = 'major' AND published_at < ?
          ORDER BY published_at DESC LIMIT ?`,
    args: [...ids, before ?? 2_000_000_000, limit * OVERFETCH],
  })
  return onePerGame((res.rows as unknown as HeadRow[]).map(rowToHead), limit)
}

/**
 * Очередь на пересказ. Предикат дословно повторяет idx_news_tldr_v2.
 *
 * scale IS NOT 'hotfix' — ключевое условие: посты, которым эвристика уже
 * сказала «мелочь», до модели не доезжают, иначе Claude переписывал бы
 * «обновлена карта из мастерской» обратно в major и это лезло бы в ленту
 * крупных обновлений.
 */
export async function getUnsummarized(db: Db, limit = 12): Promise<StoredNews[]> {
  const res = await db.execute({
    sql: `SELECT ${NEWS_COLS} FROM news_items
          WHERE kind = 'patch' AND tldr IS NULL AND tldr_tries < 3
            AND scale IS NOT 'hotfix'
          ORDER BY published_at DESC LIMIT ?`,
    args: [limit],
  })
  return (res.rows as unknown as NewsRow[]).map(rowToNews)
}

/**
 * tldr = null засчитывает попытку, но не выжигает запись: три неудачи подряд
 * (нет ключа, отказ модели, битый JSON) — и запись выпадает из очереди.
 */
export async function setNewsDigest(
  db: Db,
  appid: number,
  gid: string,
  digest: { tldr: string; scale: NewsScale } | null,
  nowSec: number,
): Promise<void> {
  if (digest) {
    await db.execute({
      sql: `UPDATE news_items SET tldr = ?, scale = ?, tldr_at = ?, tldr_tries = tldr_tries + 1
            WHERE appid = ? AND gid = ?`,
      args: [digest.tldr, digest.scale, nowSec, appid, gid],
    })
    return
  }
  await db.execute({
    sql: 'UPDATE news_items SET tldr_tries = tldr_tries + 1 WHERE appid = ? AND gid = ?',
    args: [appid, gid],
  })
}

/** Ретенция на игру. Держим больше, чем берём из фида, иначе вечный цикл
 *  «выкинули — перекачали — снова выкинули» на каждом опросе. */
export async function pruneNewsForApp(db: Db, appid: number, keep = 30): Promise<void> {
  await db.execute({
    sql: `DELETE FROM news_items WHERE appid = ? AND gid NOT IN (
            SELECT gid FROM news_items WHERE appid = ? ORDER BY published_at DESC LIMIT ?
          )`,
    args: [appid, appid, keep],
  })
}

/* ---------- очередь опроса новостей ---------- */

/**
 * Ставит игры в очередь. next_at задаётся СРАЗУ и с детерминированным
 * разбросом по appid: иначе вся библиотека станет доступной одной секундой и
 * первый же срез упрётся в темп, а хвост будет голодать.
 */
export async function enrollNewsPoll(
  db: Db,
  appids: number[],
  tier: 0 | 1,
  nowSec: number,
  jitterSec = 3600,
): Promise<void> {
  const ids = [...new Set(appids.filter((a) => Number.isInteger(a) && a > 0))].slice(0, 1200)
  if (!ids.length) return
  const CHUNK = 200
  for (let i = 0; i < ids.length; i += CHUNK) {
    await db.batch(
      ids.slice(i, i + CHUNK).map((appid) => ({
        sql: `INSERT INTO news_poll (appid, tier, next_at, enrolled_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(appid) DO UPDATE SET tier = MIN(news_poll.tier, excluded.tier)`,
        args: [appid, tier, nowSec + (jitterSec ? appid % jitterSec : 0), nowSec],
      })),
      'write',
    )
  }
}

/**
 * Возвращает в очередь то, что было похоронено давно.
 *
 * status = 'gone' ставится после MAX_FAILS отказов подряд, и до сих пор это
 * был билет в один конец: claimNewsPollBatch фильтрует 'gone', а enrollNewsPoll
 * при повторной постановке трогает только tier (ON CONFLICT DO UPDATE SET
 * tier = MIN(...)) и статус не сбрасывает. Между тем главная причина трёх
 * отказов подряд — не мёртвая игра, а закрывшийся от нашего IP Steam, то есть
 * причина временная, а отметка вечная. Очередь молча подтекала.
 *
 * Порог по last_at, а не безусловное воскрешение: игре, которую Steam правда
 * не отдаёт, хватит одной попытки в месяц, и на пропускную способность это не
 * влияет — таких строк единицы. Разброс next_at по appid тот же, что в
 * enrollNewsPoll: воскресшие не должны становиться доступными одной секундой.
 *
 * fail_count обнуляем: иначе воскресшая игра умирала бы с первого же отказа.
 */
export async function reviveGoneNewsPoll(
  db: Db,
  staleBefore: number,
  nowSec: number,
  jitterSec = 3600,
): Promise<number> {
  const res = await db.execute({
    sql: `UPDATE news_poll
             SET status = 'new', fail_count = 0,
                 next_at = ? + (appid % ?)
           WHERE status = 'gone' AND COALESCE(last_at, 0) < ?`,
    args: [nowSec, Math.max(1, jitterSec), staleBefore],
  })
  return Number(res.rowsAffected ?? 0)
}

/**
 * Забирает пачку и СРАЗУ продлевает аренду. Без этого срез, убитый по времени
 * на третьей игре, вечно перевыбирал бы те же три, а хвост очереди никогда бы
 * не опрашивался — самый простой способ построить неубиваемый цикл запросов
 * к Steam.
 */
export type PollTarget = { appid: number; tier: number; failCount: number; lastPubAt?: number }

type PollRow = {
  appid: number
  tier: number
  fail_count: number
  last_pub_at: number | null
}

export async function claimNewsPollBatch(
  db: Db,
  nowSec: number,
  limit = 20,
  leaseSec = 900,
  tier1Share = 0.6,
): Promise<PollTarget[]> {
  // Каталогу (tier 1) достаётся гарантированная доля пачки.
  //
  // Сортировка по одному next_at выглядит честной, но честна она только если
  // очередь однородна. Она не однородна: saveSnapshot ставит В ОЧЕРЕДЬ ВСЮ
  // библиотеку каждого подключившегося (tier 0), и таких строк уже вчетверо
  // больше каталожных. Каталожные при этом единственные, у кого бывает
  // rank > 0, то есть единственные, кто вообще может попасть в общую ленту.
  // Без доли достаточно одной большой библиотеки, чтобы «Что нового» у гостей
  // перестало обновляться — и никакая настройка каденции этого не чинит,
  // потому что проблема в порядке выборки, а не в частоте.
  const want1 = Math.min(limit, Math.ceil(limit * tier1Share))
  const first = await db.execute({
    sql: `SELECT appid, tier, fail_count, last_pub_at FROM news_poll
          WHERE next_at <= ? AND status != 'gone' AND tier = 1
          ORDER BY next_at LIMIT ?`,
    args: [nowSec, want1],
  })
  const rows = [...(first.rows as unknown as PollRow[])]

  // Добираем остаток из очереди целиком: если каталог свою долю не выбрал
  // (все опрошены), пачка не должна приезжать полупустой.
  if (rows.length < limit) {
    const taken = rows.map((r) => r.appid)
    const rest = await db.execute({
      sql: `SELECT appid, tier, fail_count, last_pub_at FROM news_poll
            WHERE next_at <= ? AND status != 'gone'
              ${taken.length ? `AND appid NOT IN (${placeholders(taken.length)})` : ''}
            ORDER BY next_at LIMIT ?`,
      args: [nowSec, ...taken, limit - rows.length],
    })
    rows.push(...(rest.rows as unknown as PollRow[]))
  }

  if (!rows.length) return []
  await db.batch(
    rows.map((r) => ({
      sql: 'UPDATE news_poll SET next_at = ?, last_at = ? WHERE appid = ?',
      args: [nowSec + leaseSec, nowSec, r.appid],
    })),
    'write',
  )
  return rows.map((r) => ({
    appid: r.appid,
    tier: r.tier,
    failCount: r.fail_count,
    ...(r.last_pub_at ? { lastPubAt: r.last_pub_at } : {}),
  }))
}

export type PollOutcome = {
  appid: number
  status: PollStatus
  nextAt: number
  failCount: number
  lastPubAt?: number
}

/** Один batch на весь срез вместо двадцати round-trip'ов по 30-80 мс */
export async function flushPollResults(
  db: Db,
  outcomes: PollOutcome[],
  nowSec: number,
): Promise<void> {
  if (!outcomes.length) return
  await db.batch(
    outcomes.map((o) => ({
      sql: `UPDATE news_poll
            SET status = ?, next_at = ?, fail_count = ?, last_at = ?,
                last_pub_at = COALESCE(?, last_pub_at)
            WHERE appid = ?`,
      args: [o.status, o.nextAt, o.failCount, nowSec, o.lastPubAt ?? null, o.appid],
    })),
    'write',
  )
}

/**
 * Топ каталога меняется от силы раз в сутки, а спрашивают его сотнями раз.
 *
 * Прогрев библиотеки законно зовёт /api/prepare до восьмидесяти раз подряд
 * (WARMUP_MAX_CALLS), и каждый вызов брал этот список заново. Замер на проде:
 * 34мс на вызов и 400 прочитанных строк — то есть 2.7 секунды и 32 000 строк
 * за один прогрев одного человека, ради списка, который между вызовами не
 * меняется вовсе. Turso считает деньги по прочитанным строкам.
 *
 * Ключ — сама база, а не глобальная переменная: тесты открывают свежую базу в
 * памяти на каждый случай, и общий кэш склеил бы их между собой. WeakMap
 * заодно снимает вопрос о времени жизни.
 *
 * per в записи хранится и сверяется: три вызывающих сегодня просят по 200, но
 * молча отдать двести там, где попросили пятьсот, — это баг, который проявится
 * не сразу.
 *
 * Десять минут — с запасом внутри одного прогрева и много меньше суток, за
 * которые каталог переиздаётся. Устаревший на десять минут список популярного
 * не значит ничего: из него собирают пул «попробуй новое» и очередь опроса
 * новостей.
 */
const TOP_CATALOG_TTL_MS = 10 * 60_000
const topCatalogCache = new WeakMap<Db, { at: number; per: number; ids: number[] }>()

/**
 * Набор каталога для общей ленты: топ по живому онлайну плюс топ по числу
 * отзывов. Онлайн — потому что лента отвечает на «во что играют сейчас»,
 * отзывы — потому что у половины каталога ccu ещё не замерен.
 *
 * Предикаты повторяют idx_games_ccu и idx_games_pool ДОСЛОВНО: иначе SQLite
 * не возьмёт частичный индекс и это станет полным сканом games. Стабы
 * «App {appid}» из /api/prepare отсекаются сами — у них tag_count = 0.
 */
export async function topCatalogAppids(db: Db, per = 200): Promise<number[]> {
  const кэш = topCatalogCache.get(db)
  if (кэш && кэш.per === per && Date.now() - кэш.at < TOP_CATALOG_TTL_MS) return кэш.ids

  const alive = 'alive = 1 AND superseded_by IS NULL AND tag_count > 0'
  const [byCcu, byReviews] = await Promise.all([
    db.execute({
      sql: `SELECT appid FROM games WHERE ${alive} AND appid > 0
            ORDER BY ccu DESC LIMIT ?`,
      args: [per],
    }),
    db.execute({
      sql: `SELECT appid FROM games WHERE ${alive} AND appid > 0
            ORDER BY reviews_total DESC LIMIT ?`,
      args: [per],
    }),
  ])
  const ids = [...byCcu.rows, ...byReviews.rows].map(
    (r) => (r as unknown as { appid: number }).appid,
  )
  const итог = [...new Set(ids)]
  topCatalogCache.set(db, { at: Date.now(), per, ids: итог })
  return итог
}

/**
 * Вес игры для денормализованного rank у постов: он решает, пускать ли её в
 * ОБЩУЮ ленту. Личной ленты это не касается — там игры и так свои.
 *
 * Вес получают ТОЛЬКО игры, прошедшие фильтры каталога. Иначе выходит вот что:
 * Valve выкатывает движковый апдейт разом во всю старую линейку, и общая лента
 * забивается Half-Life 2: Deathmatch и Condition Zero — теми самыми играми,
 * которые проект сам метит alive = 0 и не показывает в рекомендациях. В личной
 * ленте они по-прежнему видны: это твои игры, и патч к ним тебе интересен.
 *
 * Внутри — максимум из числа отзывов и онлайна: у свежих игр мало отзывов, у
 * старых не замерен ccu, и любой сигнал по отдельности обнулял бы часть
 * каталога.
 */
export async function getGameRanks(db: Db, appids: number[]): Promise<Map<number, number>> {
  const ids = appids.filter((a) => a > 0)
  if (!ids.length) return new Map()
  const res = await db.execute({
    sql: `SELECT appid,
            CASE WHEN alive = 1 AND superseded_by IS NULL AND tag_count > 0
                 THEN MAX(COALESCE(reviews_total, 0), COALESCE(ccu, 0))
                 ELSE 0 END AS rank
          FROM games WHERE appid IN (${placeholders(ids.length)})`,
    args: ids,
  })
  return new Map(
    (res.rows as unknown as Array<{ appid: number; rank: number | null }>).map(
      (r) => [r.appid, r.rank ?? 0] as const,
    ),
  )
}

export async function countNewsPollDue(db: Db, nowSec: number): Promise<number> {
  const res = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM news_poll WHERE next_at <= ? AND status != 'gone'",
    args: [nowSec],
  })
  return Number((res.rows[0] as unknown as { n: number })?.n ?? 0)
}
