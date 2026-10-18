import { parseStoreAssets, type StoreAssets } from './art'
import { hasCyrillic } from './cyrillic'
import { getGamesMeta, getStaleAppids, upsertGamesMeta, type Db } from './db'
import { logSwallowed } from './errlog'
import { pace } from './pace'
import { META_CC, priceRegion, regionCurrency } from './steamregion'
import {
  parseStoreScreenshots,
  parseStoreTrailer,
  type StoreScreenshots,
  type StoreTrailers,
  type Trailer,
} from './trailer'
import type { GameMeta, RuLang } from './types'

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
  price_overview?: { currency?: string; final?: number; initial?: number; discount_percent?: number }
  release_date?: { date?: string }
  /** HTML-строка языков на языке запроса (l=russian), см. appDetailsRuLang */
  supported_languages?: unknown
}

/**
 * Русский из строки языков appdetails — только то, что она говорит наверняка.
 *
 * Строка — HTML на языке запроса: «английский<strong>*</strong>, русский,
 * японский<br><strong>*</strong>озвучивание доступно на этих языках».
 * Звёздочка — полная озвучка, а интерфейс от субтитров эта строка не отличает
 * вовсе: у Hades (субтитры) и у CS2 (один интерфейс) русский в ней стоит
 * одинаково, без звёздочки.
 *
 * Поэтому ответов два, а не три: звёздочка — 3, русского в непустом списке
 * нет — 0. Русский без звёздочки — undefined, и это не потеря, а защита: крон
 * карточек сначала пишет точную ступень из GetItems (setGamesMedia), а потом
 * сливает поверх неё ответ appdetails (mergeMeta). Догадка «1» затёрла бы там
 * точную «2». Строка — страховка на случай, когда пачка GetItems не пришла, и
 * говорит ровно то, что знает.
 *
 * Слово сравнивается целиком, а не подстрокой: «белорусский» содержит
 * «русский». Английская локаль («Russian») — на случай, если запрос сменит l.
 */
function appDetailsRuLang(html: unknown): RuLang | undefined {
  if (typeof html !== 'string') return undefined
  // Сноска про звёздочку живёт после <br> — в список языков она не входит
  const list = html.split(/<br\s*\/?>/i)[0]
  const langs = list
    .split(',')
    .map((part) => ({
      name: part.replace(/<[^>]*>/g, '').replace(/\*/g, '').trim().toLowerCase(),
      audio: part.includes('*'),
    }))
    .filter((l) => l.name)
  if (!langs.length) return undefined
  const ru = langs.find((l) => l.name === 'русский' || l.name === 'russian')
  if (!ru) return 0
  return ru.audio ? 3 : undefined
}

/**
 * cc — регион, в котором спрашивали (fetchAppDetails ходит в META_CC). Цену
 * отсюда берём, только если это и есть регион цен сервиса и валюта ответа —
 * его валюта: appdetails в `us` при ценах из `ru` принёс бы доллары, которые
 * апсерт подписал бы рублями. Валюта сверяется и при совпавшем регионе —
 * Steam назначает её по адресу запроса, и ответ в чужой валюте ценой этого
 * региона не считается.
 */
export function parseAppDetails(json: unknown, appid: number, cc: string = META_CC): GameMeta | null {
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
  if (
    price?.final !== undefined &&
    cc === priceRegion() &&
    price.currency === regionCurrency(cc)
  ) {
    meta.priceFinal = price.final
    // initial у Steam есть всегда, когда есть final, и вне распродажи равен ему
    meta.priceInitial = price.initial ?? price.final
    meta.discountPercent = price.discount_percent ?? 0
    // Цена пришла — значит, в этом регионе игру продают
    meta.priceCc = cc
    meta.storeHidden = false
  }
  if (d.release_date?.date) meta.releaseDate = d.release_date.date
  const ru = appDetailsRuLang(d.supported_languages)
  if (ru !== undefined) meta.ruLang = ru
  return meta
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
  /** только с include_screenshots — см. STORE_MEDIA_DATA_REQUEST */
  screenshots?: StoreScreenshots
  /** только с include_trailers */
  trailers?: StoreTrailers
  /** только с include_supported_languages — см. ruLangOf */
  supported_languages?: unknown
}

/** Номер русского в ELanguage Steam */
const RU_ELANGUAGE = 8

/**
 * Ступень русского (RuLang в lib/types) из списка языков GetItems.
 *
 * Элемент списка — { elanguage, eadditionallanguage, supported, full_audio,
 * subtitles }; supported — столбец «Интерфейс» на странице магазина. Русский —
 * только elanguage 8: у языков вне основного перечня elanguage -1 и своя
 * нумерация в eadditionallanguage, и восьмёрка там — другой язык (у Factorio
 * в одном ответе стоят обе записи).
 *
 * Замер на двухстах играх верха каталога (октябрь 2026): у 34 русская
 * озвучка с субтитрами, у 7 озвучка без субтитров, у 78 субтитры, у 45 один
 * интерфейс, у 36 русского нет вовсе. Записей русского, где supported:false, а
 * субтитры или озвучка есть, не встретилось ни одной — но ступень берёт любую
 * отметку, а не одну supported.
 *
 * undefined — «не знаем»: поля нет (языков не просили), список пуст или не
 * разобрался. Пустой список ничего не утверждает, и «Без русского» по нему
 * было бы выдумкой.
 */
function ruLangOf(list: unknown): RuLang | undefined {
  if (!Array.isArray(list)) return undefined
  const entries = list.filter(
    (x): x is { elanguage?: unknown; supported?: unknown; full_audio?: unknown; subtitles?: unknown } =>
      typeof x === 'object' && x !== null,
  )
  if (!entries.length) return undefined
  const ru = entries.find((x) => x.elanguage === RU_ELANGUAGE)
  if (!ru) return 0
  if (ru.full_audio === true) return 3
  if (ru.subtitles === true) return 2
  return ru.supported === true ? 1 : 0
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
 * «не знаю». При регионе цен `us` цену подтянет appdetails при заходе на
 * страницу игры; в любом другом appdetails цены не несёт (parseAppDetails),
 * и она вернётся со следующей котировкой GetItems, где лучшим окажется не
 * бандл. Прежняя акционная цена до тех пор не держится (updateGamePrices).
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
    // Кадры, трейлер и языки приходят, только если их просили (fetchStoreItems
    // с media). Пустое не пишем: без поля mergeMeta и апсерт сберегут то, что
    // уже привезли appdetails или прошлый обход
    Object.assign(meta, mediaOf(it))
    out.push(meta)
  }
  return out
}

/**
 * Кадры, трейлер и русский язык одной игры из ответа GetItems — только то,
 * что нашлось. Языки живут здесь, рядом с медиа, по той же причине, что и
 * медиа: это то, что нужно карточке и не нужно прогреву (см.
 * STORE_MEDIA_DATA_REQUEST). ruLang 0 — тоже находка: Steam ответил, что
 * русского нет.
 */
export type StoreMedia = { screenshots?: string[]; trailer?: Trailer; ruLang?: RuLang }

function mediaOf(it: StoreItem): StoreMedia {
  const out: StoreMedia = {}
  const shots = parseStoreScreenshots(it.screenshots)
  if (shots.length) out.screenshots = shots
  const trailer = parseStoreTrailer(it.trailers)
  if (trailer) out.trailer = trailer
  const ru = ruLangOf(it.supported_languages)
  if (ru !== undefined) out.ruLang = ru
  return out
}

/**
 * appid -> кадры, трейлер и язык. Игры, у которых не нашлось ничего из этого,
 * в карту не попадают: писать им нечего.
 */
export function parseStoreMedia(json: unknown): Map<number, StoreMedia> {
  const items = (json as { response?: { store_items?: StoreItem[] } })?.response?.store_items
  const out = new Map<number, StoreMedia>()
  if (!Array.isArray(items)) return out
  for (const it of items) {
    const appid = it?.appid ?? it?.id
    if (!appid || !it.visible) continue
    const media = mediaOf(it)
    if (media.screenshots || media.trailer || media.ruLang !== undefined) out.set(appid, media)
  }
  return out
}

/**
 * Свежие данные побеждают, но накопленное не теряется: GetItems не отдаёт
 * жанры и медиану наигранного, а кадры, трейлер и языки — только когда их
 * просили (прогрев не просит, см. STORE_MEDIA_DATA_REQUEST). `upsertGameMeta`
 * перезаписывает строку целиком — без слияния лёгкий ответ стёр бы уже
 * загруженное. Трейлер и русский язык отдельной строки не требуют: у свежей
 * записи без них поля нет вовсе, и спред оставляет прежние. Ноль русского —
 * ответ, а не пустота, и он побеждает, как любое свежее знание.
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
  /*
   * Описание — не про пустоту, а про ЯЗЫК.
   *
   * Прогрев ходит в GetItems по-английски (STORE_LANGUAGE ниже) и раз в
   * META_MAX_AGE_SEC приносит английский short_description. Русский кладёт
   * только обогащение карточки, и следующий его проход — через полгода
   * (PAGE_MAX_AGE_SEC). Без этой строки CS2, открытая в /play через две
   * недели после обогащения, снова становилась английской и на /game/730, и в
   * её meta description — и чем популярнее игра, тем вернее: она чаще других
   * попадает в чьи-то библиотеки.
   *
   * Правило то же, что у заливки и у SQL апсерта (lib/cyrillic): русское не
   * заменяется нерусским, в том числе пустым. Всё остальное едет как прежде.
   */
  if (hasCyrillic(existing.shortDescription) && !hasCyrillic(fresh.shortDescription)) {
    out.shortDescription = existing.shortDescription
  }
  /*
   * Название — тоже про язык, но здесь его НЕ берегут, и намеренно. Русское
   * название из appdetails (обогащение карточки, l=russian) едет в запись
   * как есть, и апсерт сам раскладывает его: английское остаётся в name,
   * русское встаёт вторым, в name_ru (nameSql в lib/db). Сбереги его здесь —
   * апсерт русского не увидел бы вовсе, и «ведьмак 3» в «Найти игру» снова
   * не находил бы ничего.
   */
  /*
   * Замер без цены (priceAt есть, priceFinal нет — fetchStoreItems в регионе
   * цен, когда блока покупки не пришло) гасит скидку нулём, а цену спред
   * переносит из прежней записи. Обычную — пусть: правило то же, что в
   * updateGamePrices. Но акционная («было» выше «стало») без скидки рядом —
   * это trustedPrice, рисующий её обычной ценой, поэтому пара уходит целиком:
   * «не знаю». Регион тут сверять не нужно: чужую цену rowToMeta прячет ещё
   * при чтении existing.
   */
  if (
    fresh.priceAt !== undefined &&
    fresh.priceFinal === undefined &&
    out.priceFinal !== undefined &&
    out.priceInitial !== undefined &&
    out.priceInitial > out.priceFinal
  ) {
    delete out.priceFinal
    delete out.priceInitial
  }
  return out
}

/* ---------- сетевые фетчеры с бережным темпом ---------- */

/*
 * Регион запросов к магазину — META_CC (lib/steamregion), а не
 * STEAM_STORE_CC. Замер 28.09.2026: GetItems с country_code RU отдаёт
 * visible:false у Cyberpunk 2077, Starfield, The Witcher 3, Hogwarts Legacy,
 * Spider-Man 2 и Helldivers 2 — без отзывов и без блока покупки, а appdetails
 * с cc=ru у Cyberpunk — success:false. BG3 там же приходит с
 * final_price_in_cents 199900, то есть 1 999 ₽ в копейках. Одна переменная на
 * всё сделала бы новым играм с региональным запретом заглушки «App N» в
 * прогреве, пустые карточки в кроне (page_tries) и застывшие отзывы у верха
 * каталога. Поэтому метаданные — всегда из `us`, а цены — отдельным запросом
 * в регионе цен (lib/deals).
 */
const FETCH_TIMEOUT_MS = 10_000
// ~200 запросов/5 мин на store.steampowered.com => >=1.7с между запросами
export const STORE_PACE_MS = 1700

/** GetItems берёт до 200 appid за запрос; замерено 200 штук за ~7 секунд. */
export const STORE_ITEMS_BATCH = 200
export const STORE_API_PACE_MS = 400
const TAG_DICT_TTL_SEC = 24 * 3600

/** Язык словаря тегов: английский — ключи, русский — только подписи */
export type TagLang = 'english' | 'russian'

const tagDictCache = new Map<TagLang, { at: number; map: Map<number, string> }>()

/**
 * Только для тестов: кэш словаря живёт на модуле, срок у него по настоящим
 * часам, и иначе он течёт между случаями. Словарь, который положил в кэш
 * один тест (прогрев медиа отвечает {19: 'Action'}), другой получал вместо
 * своего, и итог зависел от порядка тестов в файле.
 */
export function resetTagDictCache(): void {
  tagDictCache.clear()
}

/**
 * Словарь тегов Steam. По умолчанию английский: ключи тегов используются в
 * скоринге (VIBE_TAGS в lib/mood.ts, HARDCORE_TAGS в lib/recommend.ts) и в
 * портрете, они английские.
 *
 * Русский — тот же список с теми же tagid, только имена переведены. Им ничего
 * не сравнивается: он склеивается с английским по tagid и нужен для вывода
 * (tags.name_ru, lib/tagsru.ts). Кэш у каждого языка свой: общий отдал бы
 * русские имена тому, кто просил ключи, и прогрев записал бы в tags_json
 * «Рогалик» вместо Roguelike — мимо всех таблиц подбора разом.
 */
export async function fetchTagDictionary(
  fetchFn: typeof fetch = fetch,
  lang: TagLang = 'english',
): Promise<Map<number, string>> {
  const now = Math.floor(Date.now() / 1000)
  const hit = tagDictCache.get(lang)
  if (hit && now - hit.at < TAG_DICT_TTL_SEC) return hit.map
  const res = await fetchFn(`https://store.steampowered.com/tagdata/populartags/${lang}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`populartags/${lang}: HTTP ${res.status}`)
  const map = parseTagDictionary(await res.json())
  // Пустой словарь — не «у Steam нет тегов», а сбой или заглушка вместо
  // ответа. Отданный дальше, он записал бы пачке прогрева tags {} со
  // свежестью на две недели — мимо всех таблиц подбора, как и пустой
  // GetItems (см. callStoreItems). Исключение уводит ensureMeta в false.
  if (!map.size) throw new Error(`populartags/${lang}: пустой словарь`)
  tagDictCache.set(lang, { at: now, map })
  return map
}

/**
 * Метаданные пачки игр одним запросом. Без ключа, до 200 appid за раз.
 * Несуществующие appid не роняют батч — Valve помечает их visible:false.
 */
export async function fetchStoreItems(
  appids: number[],
  opts: {
    fetchFn?: typeof fetch
    tagNames?: Map<number, string>
    /** кадры, трейлер и языки тем же запросом — втрое тяжелее, см. STORE_MEDIA_DATA_REQUEST */
    media?: boolean
  } = {},
): Promise<GameMeta[]> {
  const positive = appids.filter((id) => id > 0)
  if (!positive.length) return []
  const { fetchFn = fetch } = opts
  const tagNames = opts.tagNames ?? (await fetchTagDictionary(fetchFn))
  const dataRequest = opts.media
    ? { ...STORE_ITEMS_DATA_REQUEST, ...STORE_MEDIA_DATA_REQUEST }
    : STORE_ITEMS_DATA_REQUEST

  // Цена этого ответа — цена региона META_CC. Годится она, только когда
  // регион цен сервиса тот же; иначе её нет вовсе, а не «есть, но чужая»
  const pricesHere = priceRegion() === META_CC

  const out: GameMeta[] = []
  for (let i = 0; i < positive.length; i += STORE_ITEMS_BATCH) {
    const chunk = positive.slice(i, i + STORE_ITEMS_BATCH)
    const json = await callStoreItems(chunk, dataRequest, fetchFn)
    // Отметка свежести цены ставится здесь, а не у вызывающих: «сейчас» знает
    // только тот, кто сходил в сеть. Разбор (parseStoreItems) остаётся чистым и
    // без часов, а любой потребитель — прогрев, офлайн-сборка каталога, будущий
    // третий — получает датированную цену, не помня об этом.
    const at = Math.floor(Date.now() / 1000)
    for (const meta of parseStoreItems(json, tagNames)) {
      if (pricesHere) {
        // Ответ без блока покупки — это тоже ответ: игра стала бесплатной или
        // снята с продажи. Промолчать здесь значит оставить в базе вчерашние
        // «−70%», которые mergeMeta бережно перенесёт в новую запись, а карточка
        // покажет как действующую скидку. Обычную цену при этом не трогаем —
        // «Steam не назвал цену» и «игра подешевела до нуля» отсюда
        // неразличимы, и то же правило действует в updateGamePrices. Акционную
        // снимает mergeMeta: без скидки рядом она читалась бы обычной.
        if (meta.discountPercent === undefined) meta.discountPercent = 0
        meta.priceAt = at
        meta.priceCc = META_CC
        // В ответе только видимые (parseStoreItems), а видимую — продают
        meta.storeHidden = false
      } else {
        // Удалить, а не обнулить: mergeMeta спредом перенёс бы undefined
        // поверх цены своего региона, и прогрев стирал бы её раз в две недели
        delete meta.priceFinal
        delete meta.priceInitial
        delete meta.discountPercent
        delete meta.discountEndsAt
      }
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
 * Кадры и трейлеры — тот же GetItems, два флага.
 *
 * В прогрев (/api/prepare) их нет намеренно. Замер на двухстах играх верха
 * каталога: обычный ответ — 551 КБ, с кадрами и трейлерами — 1,73 МБ, втрое
 * тяжелее; одни трейлеры — 950 КБ (у каждого ролика ещё и три ссылки на
 * адаптивный поток). Прогрев платит за это на каждой пачке каждой библиотеки,
 * а показываются кадры и трейлер у пяти героев выдачи и на странице игры.
 *
 * Поэтому просят их те, кто и так ходит за карточкой: промоут каталога
 * (fetchStoreItems с media), крон карточек — отдельной пачкой по своему срезу
 * (fetchStoreMedia в lib/pagejob) — и разовая доливка scripts/backfill-media.
 *
 * Языки (русский на карточке и в выдаче, ruLangOf) — третьим флагом сюда же,
 * и по той же причине. Замер на тех же двухстах играх, октябрь 2026: обычный
 * ответ прогрева — 552 КБ, с языками — 807 КБ, на 46% тяжелее: у CS2 в
 * списке 29 языков по пять полей. Прогреву язык ни к чему — подбор по нему
 * не фильтрует, — а карточке, герою выдачи и полке покупок он нужен там же,
 * где кадры. Отдельным запросом в кроне карточек это был бы ещё один поход
 * в GetItems на каждое звено ради двадцати строк. (Отдельный поход за одними
 * языками у крона всё же есть — догон уже обогащённых игр, по сотне за
 * звено и только пока догонять есть кого: fetchStoreLanguages ниже.)
 */
const STORE_MEDIA_DATA_REQUEST = {
  include_screenshots: true,
  include_trailers: true,
  include_supported_languages: true,
}

/** Сколько миллисекунд таймаута на игру: ответ с медиа втрое тяжелее обычного */
const MEDIA_MS_PER_APP = 300

/**
 * Кадры, трейлеры и языки для пачки игр — без тегов, арта и цены. Для тех,
 * кто пишет их узким UPDATE (setGamesMedia), не трогая остальной строки.
 */
export async function fetchStoreMedia(
  appids: number[],
  opts: { fetchFn?: typeof fetch } = {},
): Promise<Map<number, StoreMedia>> {
  const positive = appids.filter((id) => id > 0)
  const out = new Map<number, StoreMedia>()
  if (!positive.length) return out
  const { fetchFn = fetch } = opts
  for (let i = 0; i < positive.length; i += STORE_ITEMS_BATCH) {
    const chunk = positive.slice(i, i + STORE_ITEMS_BATCH)
    const json = await callStoreItems(chunk, STORE_MEDIA_DATA_REQUEST, fetchFn, MEDIA_MS_PER_APP)
    for (const [appid, media] of parseStoreMedia(json)) out.set(appid, media)
  }
  return out
}

/**
 * Один флаг — языки, и ничего больше: для догона русского кроном карточек.
 * На двухстах играх языки весят около 255 КБ сверх обычного ответа (замер у
 * STORE_MEDIA_DATA_REQUEST) — 1,3 КБ на игру против ~8 КБ у кадров с
 * трейлером.
 */
const STORE_LANGUAGES_DATA_REQUEST = { include_supported_languages: true }

/** Таймаут на игру у ответа из одних языков: вшестеро легче медиа */
const LANGUAGES_MS_PER_APP = 100

/**
 * Ступень русского (RuLang) для пачки игр — одним GetItems с одним флагом.
 *
 * Для догона кроном карточек (runCardCatchUp в lib/pagejob): уже обогащённым
 * играм крон вернётся только через полгода (PAGE_MAX_AGE_SEC), и без догона
 * верх каталога ждал бы языка до весны — или ручной доливки, которую на
 * проде так и не запустили. Кадров и трейлеров здесь нет намеренно: их везут
 * срез карточек и доливка медиа, а догону они утяжелили бы каждую пачку
 * вшестеро.
 *
 * Игры, о языках которых Steam промолчал (невидимые, пустой список), в карту
 * не попадают: «не знаем» — не ноль (ruLangOf).
 */
export async function fetchStoreLanguages(
  appids: number[],
  opts: { fetchFn?: typeof fetch } = {},
): Promise<Map<number, RuLang>> {
  const positive = appids.filter((id) => id > 0)
  const out = new Map<number, RuLang>()
  if (!positive.length) return out
  const { fetchFn = fetch } = opts
  for (let i = 0; i < positive.length; i += STORE_ITEMS_BATCH) {
    const chunk = positive.slice(i, i + STORE_ITEMS_BATCH)
    const json = await callStoreItems(chunk, STORE_LANGUAGES_DATA_REQUEST, fetchFn, LANGUAGES_MS_PER_APP)
    for (const [appid, media] of parseStoreMedia(json)) {
      if (media.ruLang !== undefined) out.set(appid, media.ruLang)
    }
  }
  return out
}

/** eresult Steam «всё хорошо» — тот же, что в lib/steam.ts */
const ERESULT_OK = '1'

/**
 * Один вызов GetItems. Вынесен из fetchStoreItems, потому что тем же ручкой
 * ходит обновление цен (lib/deals) — но с пустым data_request: блок покупки
 * приезжает и без единого include-флага, а лишние поля на батче в 200 игр
 * стоят секунд.
 *
 * cc — регион запроса. По умолчанию META_CC: метаданные и отзывы. Регион цен
 * передают только те, кто пришёл за ценой (fetchStorePrices).
 *
 * Ответом считается только тело со списком store_items. Сервисный метод Steam
 * отвечает на свой сбой — Fail, Busy, ServiceUnavailable, Timeout — тем же
 * 200 с пустым response, различает их только X-eresult (то же правило — в
 * fetchWishlist, lib/steam.ts). Прочитанный как ответ, такой 200 значил «Steam
 * промолчал про все двести», и каждый вызывающий записывал это надолго:
 * замер цен гасил скидки и ставил отметку на полсуток, прогрев делал
 * библиотеку заглушками со свежестью на две недели, сверка каталога метила
 * пачку сверенной на неделю. Исключение же у всех них — давно отработанный
 * путь «ничего не пишем».
 *
 * Пустой же список — ответ, а не сбой. Промолчать про игру Steam может
 * (снята с продажи — см. fetchStorePrices), и на запрос из одного appid, а
 * таких много: герой дня, одна протухшая игра полки желаемого, последняя
 * игра прогрева, — «промолчал про часть пачки» и «про всю» неразличимы.
 * Сочти мы его сбоем, такая игра стала бы вечным отказом без отметки: замер
 * цен бросал бы на каждом заходе и ставил паузу всему процессу, прогрев
 * навсегда застревал бы в stalled, а сверка каталога упиралась бы в blocked
 * на той же пачке в голове очереди. Сбой от ответа отличают код в X-eresult
 * и форма тела: у сбоя store_items нет вовсе, а не пустой список. Нет
 * заголовка — верим телу, как и fetchWishlist.
 */
export async function callStoreItems(
  appids: number[],
  dataRequest: Record<string, unknown>,
  fetchFn: typeof fetch = fetch,
  msPerApp = 200,
  language = STORE_LANGUAGE,
  cc: string = META_CC,
): Promise<unknown> {
  await pace('steam-api', STORE_API_PACE_MS)
  const input = JSON.stringify({
    ids: appids.map((appid) => ({ appid })),
    context: { language, country_code: cc.toUpperCase(), steam_realm: 1 },
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
  const eresult = res.headers.get('x-eresult')
  if (eresult !== null && eresult !== ERESULT_OK) {
    await res.body?.cancel().catch(() => {})
    throw new Error(`GetItems: eresult ${eresult}`)
  }
  const json: unknown = await res.json()
  const items = (json as { response?: { store_items?: unknown } } | null)?.response?.store_items
  if (!Array.isArray(items)) throw new Error('GetItems: нет store_items')
  return json
}

export async function fetchAppDetails(
  appid: number,
  fetchFn: typeof fetch = fetch,
): Promise<GameMeta | null> {
  await pace('steam-store', STORE_PACE_MS)
  // META_CC: в регионе цен часть игр отвечает success:false (см. выше), а
  // цену отсюда parseAppDetails возьмёт, только если регионы совпали
  const url = `https://store.steampowered.com/api/appdetails?appids=${appid}&cc=${META_CC}&l=russian`
  const res = await fetchFn(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  // rate limit/сбой — исключение, чтобы вызывающий не закэшировал неудачу как «данных нет»
  if (!res.ok) throw new Error(`appdetails ${appid}: HTTP ${res.status}`)
  try {
    return parseAppDetails(await res.json(), appid, META_CC)
  } catch (err) {
    // Ответ 200, а тело не разобралось: Steam сменил формат или отдал заглушку
    logSwallowed('catalog:appdetails-parse', err, { appid })
    return null
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
  } catch (err) {
    logSwallowed('catalog:most-played', err)
    return []
  }
}

/**
 * Срок годности метаданных каталога — один на ensureMeta и /api/prepare.
 *
 * Экспортирован, потому что прогрев отбирает протухшее ДО ensureMeta и
 * отдаёт ему только отобранное. Своя копия в маршруте — тихая ловушка: срок
 * здесь укоротили бы до недели, а маршрут со старыми двумя неделями не отдал
 * бы ensureMeta строк возрастом от семи до четырнадцати дней — без ошибки и
 * с remaining: 0.
 */
export const META_MAX_AGE_SEC = 14 * 86_400

/**
 * Догружает метаданные (GetItems + при необходимости appdetails) для appid'ов,
 * которых нет в кэше или которые протухли. Ограничен по количеству за один вызов,
 * чтобы не подвешивать запрос пользователя.
 *
 * Возвращает false, если было что догружать, а записать не вышло: Steam не
 * отдал пачку или словарь тегов (429, сеть, 200 без ответа — см.
 * callStoreItems). Сбой по-прежнему не роняет запрос, но и не молчит:
 * /api/prepare отдаёт по нему stalled, и прогрев
 * перестаёт спрашивать тот же остаток по кругу (см. WARMUP_STALL_LIMIT).
 */
export async function ensureMeta(
  db: Db,
  appids: number[],
  opts: { maxFetch?: number; names?: Map<number, string>; fetchFn?: typeof fetch } = {},
): Promise<boolean> {
  const { maxFetch = STORE_ITEMS_BATCH, names, fetchFn = fetch } = opts
  const now = Math.floor(Date.now() / 1000)
  const stale = (await getStaleAppids(db, appids, META_MAX_AGE_SEC, now)).slice(0, maxFetch)
  if (!stale.length) return true

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
    return true
  } catch (err) {
    // сеть/лимиты: пропускаем без записи — updated_at не двигается,
    // игры останутся «протухшими» и догрузятся в следующий раз. Но строку
    // оставляем: прогрев отдаёт по этому stalled, и без неё «Steam ответил
    // 429» не отличить от «база не приняла запись».
    logSwallowed('catalog:ensure-meta', err, { batch: stale.length })
    return false
  }
}
