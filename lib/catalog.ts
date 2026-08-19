import { parseStoreAssets, type StoreAssets } from './art'
import { getGamesMeta, getStaleAppids, upsertGamesMeta, type Db } from './db'
import { pace } from './pace'
import type { GameMeta } from './types'

type AppDetailsData = {
  type?: string
  name?: string
  steam_appid?: number
  is_free?: boolean
  short_description?: string
  header_image?: string
  screenshots?: Array<{ path_full?: string }>
  genres?: Array<{ description?: string }>
  categories?: Array<{ id?: number }>
  price_overview?: { final?: number; initial?: number; discount_percent?: number }
  release_date?: { date?: string }
}

export function parseAppDetails(json: unknown, appid: number): GameMeta | null {
  const entry = (json as Record<string, { success?: boolean; data?: AppDetailsData }>)?.[
    String(appid)
  ]
  if (!entry?.success || !entry.data) return null
  const d = entry.data
  if (d.type !== 'game') return null
  const meta: GameMeta = {
    appid,
    name: d.name ?? `App ${appid}`,
    tags: {},
    genres: (d.genres ?? []).map((g) => g.description).filter((x): x is string => Boolean(x)),
    categories: (d.categories ?? []).map((c) => c.id).filter((x): x is number => x !== undefined),
  }
  if (d.short_description) meta.shortDescription = d.short_description
  if (d.header_image) meta.headerImage = d.header_image
  const shots = (d.screenshots ?? [])
    .map((s) => s.path_full)
    .filter((x): x is string => Boolean(x))
    .slice(0, 8)
  if (shots.length) meta.screenshots = shots
  if (d.is_free !== undefined) meta.isFree = d.is_free
  const price = d.price_overview
  if (price?.final !== undefined) {
    meta.priceFinal = price.final
    // initial у Steam есть всегда, когда есть final, и вне распродажи равен ему
    meta.priceInitial = price.initial ?? price.final
    meta.discountPercent = price.discount_percent ?? 0
  }
  if (d.release_date?.date) meta.releaseDate = d.release_date.date
  return meta
}

export function parseSteamSpyTags(json: unknown): Record<string, number> {
  const tags = (json as { tags?: unknown })?.tags
  if (!tags || Array.isArray(tags) || typeof tags !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [tag, votes] of Object.entries(tags as Record<string, unknown>)) {
    if (typeof votes === 'number') out[tag] = votes
  }
  return out
}

/* ---------- IStoreBrowseService/GetItems ---------- */

/**
 * Основной источник метаданных: работает без ключа, берёт до 200 appid за запрос
 * и в одном ответе отдаёт теги с весами, категории, описание, отзывы и — главное —
 * настоящие ссылки на арт. Заменяет SteamSpy (он отдаёт 403 с серверных IP)
 * и поштучный appdetails (1 игра на запрос при лимите ~200 запросов / 5 минут).
 */

type StoreItem = {
  id?: number
  appid?: number
  name?: string
  visible?: boolean
  tags?: Array<{ tagid?: number; weight?: number }>
  categories?: { supported_player_categoryids?: number[] }
  basic_info?: {
    short_description?: string
    developers?: Array<{ name?: string }>
    publishers?: Array<{ name?: string }>
    franchises?: Array<{ name?: string }>
  }
  assets?: StoreAssets
  release?: { steam_release_date?: number }
  is_free?: boolean
  best_purchase_option?: PurchaseOption
}

/**
 * Блок покупки в ответе GetItems. Цены приходят СТРОКАМИ, а полей скидки при
 * полной цене нет вовсе — Steam их просто не присылает.
 */
export type PurchaseOption = {
  final_price_in_cents?: string
  original_price_in_cents?: string
  discount_pct?: number
  active_discounts?: Array<{ discount_end_date?: number }>
  /** есть у варианта-бандла: цена там за НАБОР, а не за эту игру */
  bundleid?: number
  packageid?: number
}

export type PriceInfo = {
  priceFinal?: number
  priceInitial?: number
  discountPercent?: number
  discountEndsAt?: number
}

/**
 * Цена и скидка из блока покупки.
 *
 * Ключевое решение — нормализация «скидки нет» в явный ноль, а не в
 * отсутствие поля. Со скидкой Steam присылает discount_pct и
 * original_price_in_cents, без неё не присылает ничего, и если так же
 * промолчать при записи, то в базе останется вчерашнее «−70%»: у скидки,
 * которая кончилась, нет своего события — есть только ответ без полей.
 *
 * Срок берём самый ранний из активных: если акций несколько, цена вырастет
 * на первой же истёкшей.
 *
 * Вариант-бандл отбрасывается целиком. «Лучшим» Steam называет самое выгодное
 * предложение, и у части игр это набор из нескольких: у Forever Skies — Deluxe
 * Edition за $16.00 при цене самой игры $29.99, у Drug Dealer Simulator 2 —
 * «Thieves'n'Dealers» за $24.10 вместо $40.48 с честным discount_pct: 40.
 * Взять оттуда цену значит показать ценник другого товара, а взять скидку —
 * пообещать её на игру, которая в магазине стоит полную. Цена самой игры в
 * этом ответе не приходит вовсе, поэтому единственный правдивый ответ —
 * «не знаю»: цену подтянет appdetails при заходе на страницу игры.
 */
export function parsePurchaseOption(bpo: PurchaseOption | undefined | null): PriceInfo {
  if (!bpo) return {}
  if (bpo.bundleid !== undefined) return {}
  const final = Number(bpo.final_price_in_cents)
  if (!Number.isFinite(final)) return {}

  const initialRaw = Number(bpo.original_price_in_cents)
  const initial = Number.isFinite(initialRaw) ? initialRaw : final
  const pct = typeof bpo.discount_pct === 'number' ? bpo.discount_pct : 0

  const info: PriceInfo = {
    priceFinal: final,
    priceInitial: Math.max(initial, final),
    discountPercent: initial > final ? pct : 0,
  }

  const ends = (bpo.active_discounts ?? [])
    .map((d) => d.discount_end_date)
    .filter((d): d is number => typeof d === 'number' && d > 0)
  if (info.discountPercent && ends.length) info.discountEndsAt = Math.min(...ends)
  return info
}

/** Словарь Steam: числовой tagid -> человеческое имя тега. */
export function parseTagDictionary(json: unknown): Map<number, string> {
  const out = new Map<number, string>()
  if (!Array.isArray(json)) return out
  for (const row of json) {
    const tagid = (row as { tagid?: unknown })?.tagid
    const name = (row as { name?: unknown })?.name
    if (typeof tagid === 'number' && typeof name === 'string') out.set(tagid, name)
  }
  return out
}

function isoDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().slice(0, 10)
}

export function parseStoreItems(json: unknown, tagNames: Map<number, string>): GameMeta[] {
  const items = (json as { response?: { store_items?: StoreItem[] } })?.response?.store_items
  if (!Array.isArray(items)) return []

  const out: GameMeta[] = []
  for (const it of items) {
    const appid = it.appid ?? it.id
    // Несуществующий appid приходит как visible:false с пустым именем — это не ошибка батча.
    if (!appid || !it.visible || !it.name) continue

    const tags: Record<string, number> = {}
    for (const t of it.tags ?? []) {
      if (typeof t.tagid !== 'number' || typeof t.weight !== 'number') continue
      const name = tagNames.get(t.tagid)
      if (name) tags[name] = t.weight
    }

    const meta: GameMeta = {
      appid,
      name: it.name,
      tags,
      genres: [],
      categories: it.categories?.supported_player_categoryids ?? [],
    }
    if (it.basic_info?.short_description) meta.shortDescription = it.basic_info.short_description
    // Издатель и разработчик нужны, чтобы не слепить в одну серию чужие игры
    // с похожим названием: без них «Sniper Elite» и «Sniper Ghost Warrior»
    // выглядят роднёй
    const dev = it.basic_info?.developers?.[0]?.name
    const pub = it.basic_info?.publishers?.[0]?.name
    if (dev) meta.developer = dev
    if (pub) meta.publisher = pub
    // Пустой объект тоже пишем: это отметка «арт искали», см. upsertGameMeta
    const art = parseStoreAssets(it.assets)
    meta.art = art
    if (art.header) meta.headerImage = art.header
    if (it.is_free !== undefined) meta.isFree = it.is_free
    Object.assign(meta, parsePurchaseOption(it.best_purchase_option))
    if (it.release?.steam_release_date) meta.releaseDate = isoDate(it.release.steam_release_date)
    out.push(meta)
  }
  return out
}

/**
 * Свежие данные побеждают, но накопленное не теряется: GetItems не отдаёт
 * скриншоты, жанры и медиану наигранного, а `upsertGameMeta` перезаписывает
 * строку целиком — без слияния лёгкий ответ стёр бы уже загруженное.
 */
export function mergeMeta(existing: GameMeta | null | undefined, fresh: GameMeta): GameMeta {
  if (!existing) return fresh
  const out: GameMeta = { ...existing, ...fresh }
  if (!Object.keys(fresh.tags).length) out.tags = existing.tags
  if (!fresh.genres.length) out.genres = existing.genres
  if (!fresh.categories.length) out.categories = existing.categories
  if (!fresh.screenshots?.length && existing.screenshots?.length) {
    out.screenshots = existing.screenshots
  }
  if (!fresh.art || !Object.keys(fresh.art).length) {
    if (existing.art && Object.keys(existing.art).length) out.art = existing.art
  }
  return out
}

/* ---------- сетевые фетчеры с бережным темпом ---------- */

const STORE_CC = process.env.STEAM_STORE_CC ?? 'us'
const FETCH_TIMEOUT_MS = 10_000
// ~200 запросов/5 мин на store.steampowered.com => >=1.7с между запросами
export const STORE_PACE_MS = 1700
const STEAMSPY_PACE_MS = 1100

/** GetItems берёт до 200 appid за запрос; замерено 200 штук за ~7 секунд. */
export const STORE_ITEMS_BATCH = 200
export const STORE_API_PACE_MS = 400
const TAG_DICT_TTL_SEC = 24 * 3600

let tagDictCache: { at: number; map: Map<number, string> } | null = null

/**
 * Словарь тегов Steam. Берём английский: ключи тегов используются в скоринге
 * (VIBE_TAGS, HARDCORE_TAGS в lib/recommend.ts) и в портрете, они английские.
 */
export async function fetchTagDictionary(fetchFn: typeof fetch = fetch): Promise<Map<number, string>> {
  const now = Math.floor(Date.now() / 1000)
  if (tagDictCache && now - tagDictCache.at < TAG_DICT_TTL_SEC) return tagDictCache.map
  const res = await fetchFn('https://store.steampowered.com/tagdata/populartags/english', {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`populartags: HTTP ${res.status}`)
  const map = parseTagDictionary(await res.json())
  if (map.size) tagDictCache = { at: now, map }
  return map
}

/**
 * Метаданные пачки игр одним запросом. Без ключа, до 200 appid за раз.
 * Несуществующие appid не роняют батч — Valve помечает их visible:false.
 */
export async function fetchStoreItems(
  appids: number[],
  opts: { fetchFn?: typeof fetch; tagNames?: Map<number, string> } = {},
): Promise<GameMeta[]> {
  const positive = appids.filter((id) => id > 0)
  if (!positive.length) return []
  const { fetchFn = fetch } = opts
  const tagNames = opts.tagNames ?? (await fetchTagDictionary(fetchFn))

  const out: GameMeta[] = []
  for (let i = 0; i < positive.length; i += STORE_ITEMS_BATCH) {
    const chunk = positive.slice(i, i + STORE_ITEMS_BATCH)
    const json = await callStoreItems(chunk, STORE_ITEMS_DATA_REQUEST, fetchFn)
    // Отметка свежести цены ставится здесь, а не у вызывающих: «сейчас» знает
    // только тот, кто сходил в сеть. Разбор (parseStoreItems) остаётся чистым и
    // без часов, а любой потребитель — прогрев, офлайн-сборка каталога, будущий
    // третий — получает датированную цену, не помня об этом.
    const at = Math.floor(Date.now() / 1000)
    for (const meta of parseStoreItems(json, tagNames)) {
      // Ответ без блока покупки — это тоже ответ: игра стала бесплатной или
      // снята с продажи. Промолчать здесь значит оставить в базе вчерашние
      // «−70%», которые mergeMeta бережно перенесёт в новую запись, а карточка
      // покажет как действующую скидку. Цену при этом не трогаем — «Steam не
      // назвал цену» и «игра подешевела до нуля» отсюда неразличимы, и то же
      // правило действует в updateGamePrices.
      if (meta.discountPercent === undefined) meta.discountPercent = 0
      meta.priceAt = at
      out.push(meta)
    }
  }
  return out
}

/**
 * Язык метаданных каталога — АНГЛИЙСКИЙ, и это не недосмотр.
 *
 * Из этого ответа берутся названия игр, а на них стоят эвристики: junk.ts
 * отсеивает по словам soundtrack/demo/playtest, editions.ts склеивает издания
 * по «Edition»/«Deluxe». На русских названиях («Издание», «Саундтрек») обе
 * промахнутся по всему каталогу разом.
 *
 * Теги языком запроса не затрагиваются вовсе: GetItems отдаёт их числовыми
 * tagid, а имена берутся из отдельного словаря, который тоже английский и
 * тоже намеренно (см. fetchTagDictionary).
 */
const STORE_LANGUAGE = 'english'

/**
 * А вот описание — единственное, что человек ЧИТАЕТ, и оно обязано быть на
 * языке сайта.
 *
 * Замер по проду: из 5000 карточек в карте сайта у 4723 описание английское
 * и лишь у 93 русское. То есть «THE CRITICALLY ACCLAIMED FANTASY ACTION RPG»
 * стоит абзацем под заголовком «ELDEN RING — стоит ли играть», и он же
 * уезжает в meta description и в микроразметку.
 *
 * Русское описание кладёт и обогащение карточек (fetchAppDetails ходит с
 * l=russian), но оно доходит по очереди — на весь каталог это месяцы. Этот
 * проход чинит всё сразу и стоит дёшево: один include-флаг вместо шести.
 */
export const DESCRIPTION_LANGUAGE = 'russian'

const STORE_DESCRIPTION_DATA_REQUEST = { include_basic_info: true }

/** appid -> короткое описание на языке сайта. Пустые и отсутствующие пропускаем. */
export function parseStoreDescriptions(json: unknown): Map<number, string> {
  const items = (json as { response?: { store_items?: StoreItem[] } })?.response?.store_items
  const out = new Map<number, string>()
  if (!Array.isArray(items)) return out
  for (const it of items) {
    const appid = it.appid ?? it.id
    const text = it.basic_info?.short_description
    if (appid && typeof text === 'string' && text.trim()) out.set(appid, text)
  }
  return out
}

/**
 * Описания на языке сайта для пачки игр. Отдельный проход, а не поле в общем:
 * общий обязан оставаться английским ради названий (см. STORE_LANGUAGE).
 */
export async function fetchStoreDescriptions(
  appids: number[],
  opts: { fetchFn?: typeof fetch; language?: string } = {},
): Promise<Map<number, string>> {
  const positive = appids.filter((id) => id > 0)
  const out = new Map<number, string>()
  if (!positive.length) return out
  const { fetchFn = fetch, language = DESCRIPTION_LANGUAGE } = opts
  for (let i = 0; i < positive.length; i += STORE_ITEMS_BATCH) {
    const chunk = positive.slice(i, i + STORE_ITEMS_BATCH)
    // msPerApp меньше общего: в ответе одно поле, а не ассеты с тегами
    const json = await callStoreItems(chunk, STORE_DESCRIPTION_DATA_REQUEST, fetchFn, 60, language)
    for (const [appid, text] of parseStoreDescriptions(json)) out.set(appid, text)
  }
  return out
}

const STORE_ITEMS_DATA_REQUEST = {
  include_assets: true,
  include_basic_info: true,
  include_categories: true,
  include_release: true,
  include_tag_count: 20,
}

/**
 * Один вызов GetItems. Вынесен из fetchStoreItems, потому что тем же ручкой
 * ходит обновление цен (lib/deals) — но с пустым data_request: блок покупки
 * приезжает и без единого include-флага, а лишние поля на батче в 200 игр
 * стоят секунд.
 */
export async function callStoreItems(
  appids: number[],
  dataRequest: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
  msPerApp = 200,
  language = STORE_LANGUAGE,
): Promise<unknown> {
  await pace('steam-api', STORE_API_PACE_MS)
  const input = JSON.stringify({
    ids: appids.map((appid) => ({ appid })),
    context: { language, country_code: STORE_CC.toUpperCase(), steam_realm: 1 },
    data_request: dataRequest,
  })
  const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(input)}`
  // Батч на 200 игр отвечает за 7 секунд и более, поэтому общий таймаут в
  // 10 секунд для него слишком тесный: растим пропорционально размеру пачки.
  // Насколько именно — знает вызывающий: полные метаданные с ассетами и
  // тегами и голая цена по тем же двум сотням игр весят по-разному.
  const timeout = Math.max(FETCH_TIMEOUT_MS, appids.length * msPerApp)
  const res = await fetchFn(url, { signal: AbortSignal.timeout(timeout) })
  // лимит/сбой — исключение, чтобы вызывающий не закэшировал неудачу как «данных нет»
  if (!res.ok) throw new Error(`GetItems: HTTP ${res.status}`)
  return res.json()
}

export async function fetchAppDetails(
  appid: number,
  fetchFn: typeof fetch = fetch,
): Promise<GameMeta | null> {
  await pace('steam-store', STORE_PACE_MS)
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${STORE_CC}&l=russian`
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  // rate limit/сбой — исключение, чтобы вызывающий не закэшировал неудачу как «данных нет»
  if (!res.ok) throw new Error(`appdetails ${appid}: HTTP ${res.status}`)
  try {
    return parseAppDetails(await res.json(), appid)
  } catch {
    return null
  }
}

export async function fetchSteamSpyTags(
  appid: number,
  fetchFn: typeof fetch = fetch,
): Promise<Record<string, number>> {
  await pace('steamspy', STEAMSPY_PACE_MS)
  const res = await fetchFn(`https://steamspy.com/api.php?request=appdetails&appid=${appid}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`steamspy ${appid}: HTTP ${res.status}`)
  try {
    return parseSteamSpyTags(await res.json())
  } catch {
    return {}
  }
}

/** Официальные чарты Steam: appid в порядке пикового онлайна. */
export function parseMostPlayed(json: unknown): number[] {
  const ranks = (json as { response?: { ranks?: Array<{ appid?: unknown }> } })?.response?.ranks
  if (!Array.isArray(ranks)) return []
  return ranks.map((r) => r.appid).filter((id): id is number => typeof id === 'number')
}

/**
 * Топ-100 по онлайну. Работает без ключа и с серверных IP — в отличие от
 * SteamSpy, который в 2026 отдаёт 403 на запросы из дата-центров.
 */
export async function fetchMostPlayed(fetchFn: typeof fetch = fetch): Promise<number[]> {
  try {
    await pace('steam-api', STORE_API_PACE_MS)
    const res = await fetchFn(
      'https://api.steampowered.com/ISteamChartsService/GetMostPlayedGames/v1/',
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    )
    if (!res.ok) return []
    return parseMostPlayed(await res.json())
  } catch {
    return []
  }
}

/** Популярные игры за 2 недели по SteamSpy — пул кандидатов «попробуй новое» */
export async function fetchSteamSpyTop(
  fetchFn: typeof fetch = fetch,
): Promise<Array<{ appid: number; name: string }>> {
  await pace('steamspy', STEAMSPY_PACE_MS)
  try {
    const res = await fetchFn('https://steamspy.com/api.php?request=top100in2weeks', {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    if (!res.ok) return []
    const json = (await res.json()) as Record<string, { appid?: number; name?: string }> | null
    if (!json || typeof json !== 'object') return []
    return Object.values(json)
      .filter((g) => g && typeof g.appid === 'number' && typeof g.name === 'string')
      .map((g) => ({ appid: g.appid as number, name: g.name as string }))
  } catch {
    return []
  }
}

const META_MAX_AGE_SEC = 14 * 86_400

/**
 * Догружает метаданные (SteamSpy теги + при необходимости appdetails) для appid'ов,
 * которых нет в кэше или которые протухли. Ограничен по количеству за один вызов,
 * чтобы не подвешивать запрос пользователя.
 */
export async function ensureMeta(
  db: Db,
  appids: number[],
  opts: { maxFetch?: number; names?: Map<number, string>; fetchFn?: typeof fetch } = {},
): Promise<void> {
  const { maxFetch = STORE_ITEMS_BATCH, names, fetchFn = fetch } = opts
  const now = Math.floor(Date.now() / 1000)
  const stale = (await getStaleAppids(db, appids, META_MAX_AGE_SEC, now)).slice(0, maxFetch)
  if (!stale.length) return

  try {
    const fresh = await fetchStoreItems(stale, { fetchFn })
    const byAppid = new Map(fresh.map((m) => [m.appid, m]))

    // Один запрос на чтение и одна пачка на запись вместо двух round-trip'ов
    // на каждую игру. При батче в 200 это было до 400 последовательных
    // обращений к Turso на КАЖДЫЙ вызов /api/prepare, а клиент дёргает его в
    // цикле — то есть дороже здесь была не сеть Steam, а собственная база.
    const existingAll = await getGamesMeta(db, stale)

    const rows = stale.map((appid) => {
      const existing = existingAll.get(appid) ?? null
      const got = byAppid.get(appid)
      if (got) return mergeMeta(existing, got)
      // Steam не показывает приложение (снято с продажи, региональное
      // ограничение) либо это игра вне Steam с отрицательным appid.
      // Помечаем попытку пустым артом, иначе строка осталась бы «протухшей»
      // навсегда и прогрев крутился бы вхолостую на каждом заходе.
      const base: GameMeta = existing ?? {
        appid,
        name: names?.get(appid) ?? `App ${appid}`,
        tags: {},
        genres: [],
        categories: [],
      }
      return { ...base, art: base.art ?? {} }
    })

    await upsertGamesMeta(db, rows, now)
  } catch {
    // сеть/лимиты: пропускаем без записи — updated_at не двигается,
    // игры останутся «протухшими» и догрузятся в следующий раз
  }
}
