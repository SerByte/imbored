/**
 * Патчноуты и новости игр из RSS-ленты Steam.
 *
 * Источник — store.steampowered.com/feeds/news/app/{appid}/?l=russian, а не
 * ISteamNews/GetNewsForApp, и вот почему:
 *   • RSS отдаёт заголовки и тела УЖЕ переведёнными на русский там, где
 *     издатель загрузил перевод; у JSON-эндпоинта параметр l= не работает;
 *   • RSS отдаёт готовую разметку, JSON — сырой BBCode;
 *   • у JSON без feeds= в выдачу подмешиваются посты агрегаторов с ЧУЖИМ appid.
 * Тег tags:["patchnotes"] из JSON заманчив, но у части издателей его нет
 * (у Cyberpunk «Патч 2.31» — без тега), так что классификатор всё равно нужен,
 * и второй запрос на игру ради ненадёжного признака не окупается.
 */

import { createHash } from 'node:crypto'
import { STORE_PACE_MS } from './catalog'
import { pace } from './pace'
import { blocksToText, decodeEntities, parseSteamHtml, type NewsBlock } from './steamhtml'

export type RawNewsItem = {
  appid: number
  /** стабильный id поста: хвост permalink'а Steam */
  gid: string
  title: string
  url: string
  blocks: NewsBlock[]
  /** unix-секунды */
  publishedAt: number
  imageUrl?: string
}

const FEED_BASE = 'https://store.steampowered.com/feeds/news/app'

/**
 * ВНИМАНИЕ: границы слов здесь — юникодные lookaround'ы, а НЕ `\b`.
 * В JS `\w` это [A-Za-z0-9_], поэтому между пробелом и кириллической буквой
 * границы слова нет вовсе: /\bпатч/u.test('новый патч') === false. Регексп с
 * `\b` вокруг русских слов молча не совпадает никогда, и классификатор
 * посчитал бы новостью каждый русский патч.
 */
const NB = '[\\p{L}\\p{N}]'
const words = (alts: string, flags = 'iu') =>
  new RegExp(`(?<!${NB})(?:${alts})(?!${NB})`, flags)

/** Заголовок прямо называет себя описанием изменений */
const PATCH_TITLE = words(
  'патч\\s?ноут\\p{L}*|patch\\s?notes?|release\\s?notes?|changelog|' +
    'список\\s+изменений|описание\\s+изменений|заметки\\s+к\\s+обновлению',
)

/** Заголовок содержит слово из лексикона обновлений */
const PATCH_WORD = words(
  'обновлени\\p{L}*|обновление|обновлен\\p{L}*|обнова|обновы|патч\\p{L}*|' +
    'хотфикс\\p{L}*|исправлени\\p{L}*|updated?|updates|patch(?:ed|es)?|hotfix|bugfix',
)

/** Номер версии рядом со словом версии: голое \d+\.\d+ ловит «19.99» и «с 1.5 по 3.6» */
const VERSION =
  /(?:^|[^\p{L}\p{N}])(?:v|версия|версии|patch|update|обновление|обновлени\p{L}*|патч\p{L}*)\s*#?\s*\d+\.\d+/iu

/** Заголовок обещает что угодно, только не патч */
const NEWS_WORD = words(
  'скидк\\p{L}*|распродаж\\p{L}*|sale|free\\s+weekend|бесплатные\\s+выходные|' +
    'предзаказ\\p{L}*|pre-?order|конкурс\\p{L}*|розыгрыш\\p{L}*|giveaway|' +
    'турнир\\p{L}*|чемпионат\\p{L}*|трансляц\\p{L}*|фэнтези|стрим\\p{L}*|' +
    'дневник\\p{L}*|dev\\s?diary|анонс\\p{L}*|announc\\p{L}*|трейлер\\p{L}*|trailer|' +
    'wishlist|бандл|bundle|наклейк\\p{L}*|статуэтк\\p{L}*|statue|vinyl|merch\\p{L}*|' +
    'годовщин\\p{L}*|фигурк\\p{L}*',
)

/** Глаголы изменений — по ним узнаём патч, когда заголовок молчит */
const CHANGE_VERBS =
  'исправлен\\p{L}*|починен\\p{L}*|добавлен\\p{L}*|удалён\\p{L}*|удален\\p{L}*|' +
  'улучшен\\p{L}*|переработан\\p{L}*|изменен\\p{L}*|изменён\\p{L}*|оптимизирован\\p{L}*|' +
  'вылет\\p{L}*|баланс\\p{L}*|fixed|added|removed|changed|improved|reworked|crash|balance'

/** Тело, которое не стоит отправлять в LLM: там нечего пересказывать */
const TRIVIAL_BODY = /мастерск|workshop|версии из/i

function tagText(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))
  if (!m) return undefined
  const v = m[1].trim()
  const cdata = v.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/)
  if (cdata) return cdata[1].trim()
  // RSS отдаёт HTML в XML-экранировании: снимаем внешний слой,
  // внутренний снимет parseSteamHtml на текстовых узлах
  return decodeEntities(v)
}

function attrOf(xml: string, tag: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${tag}\\s[^>]*${name}\\s*=\\s*"([^"]*)"`, 'i'))
  return m ? decodeEntities(m[1]).trim() : undefined
}

/**
 * Главный фильтр ленты. Принимаем пост, только если его permalink — настоящая
 * страница новости Steam И номер игры в нём совпадает с запрошенным.
 *
 * Одним правилом закрываются сразу три подтверждённых случая: в ленту
 * подмешиваются посты агрегаторов (SteamDB, PCGamesN) с ЧУЖИМ appid — на
 * запрос по 1091500 приезжали записи с appid 252490 и 1086940.
 *
 * Побочный, но важный эффект: раз ссылку мы собираем сами из двух чисел, в
 * базу никогда не попадает URL, подконтрольный третьей стороне.
 */
const PERMALINK = /^https:\/\/store\.steampowered\.com\/news\/app\/(\d+)\/view\/(\d+)/i

/** Ленты бывают длинными, а нам нужен только хвост свежего */
const MAX_ITEMS = 25
const MAX_XML = 512 * 1024

export function parseNewsRss(xml: string, appid: number, nowSec?: number): RawNewsItem[] {
  if (!xml || !xml.includes('<item')) return []
  const now = nowSec ?? Math.floor(Date.now() / 1000)
  const out: RawNewsItem[] = []
  const seen = new Set<string>()

  for (const m of xml.slice(0, MAX_XML).matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    if (out.length >= MAX_ITEMS) break
    const chunk = m[1]

    const guid = tagText(chunk, 'guid') ?? tagText(chunk, 'link') ?? ''
    const link = PERMALINK.exec(guid) ?? PERMALINK.exec(tagText(chunk, 'link') ?? '')
    if (!link || Number(link[1]) !== appid) continue
    const gid = link[2]
    if (seen.has(gid)) continue

    const title = (tagText(chunk, 'title') ?? '').slice(0, 300)
    if (!title) continue

    const pub = tagText(chunk, 'pubDate')
    const ms = pub ? Date.parse(pub) : Number.NaN
    if (!Number.isFinite(ms)) continue
    const publishedAt = Math.floor(ms / 1000)
    // пост «из будущего» навсегда прибился бы к верху ленты, отсортированной по дате
    if (publishedAt > now + 86_400) continue

    seen.add(gid)
    const imageUrl = attrOf(chunk, 'enclosure', 'url')
    out.push({
      appid,
      gid,
      title,
      // собрано нами, а не взято из фида
      url: `https://store.steampowered.com/news/app/${appid}/view/${gid}`,
      blocks: parseSteamHtml(tagText(chunk, 'description') ?? ''),
      publishedAt,
      ...(imageUrl && /^https:\/\//i.test(imageUrl) ? { imageUrl: imageUrl.slice(0, 500) } : {}),
    })
  }
  return out
}

/**
 * null — новостей нет или Steam недоступен; пустой массив — лента есть, но
 * пуста. Разница важна крону: null не должен выглядеть как «проверили,
 * ничего нет».
 */
export async function fetchGameNews(
  appid: number,
  fetchFn: typeof fetch = fetch,
  nowSec?: number,
): Promise<RawNewsItem[] | null> {
  // отрицательные appid — кураторский пул других магазинов, в Steam их нет;
  // на несуществующий appid Steam отвечает 403, но незачем и спрашивать
  if (!Number.isInteger(appid) || appid <= 0) return null
  // Общий лимитер хоста store.steampowered.com с appreviews и appdetails.
  // Гэп задаёт вызывающий (lib/pace.ts:17), поэтому он обязан совпадать с
  // STORE_PACE_MS: меньшее значение на общем ключе понизило бы фактический
  // пол и для fetchAppDetails, и для fetchReviews.
  await pace('steam-store', STORE_PACE_MS)
  try {
    const res = await fetchFn(`${FEED_BASE}/${appid}/?l=russian`, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return null
    return parseNewsRss(await res.text(), appid, nowSec)
  } catch {
    return null
  }
}

/**
 * Патч это или новость. Счёт, а не жёсткий приоритет анти-сигналов: при
 * приоритете «нашли слово про распродажу — значит не патч» навсегда терялись бы
 * заголовки вида «Обновление 1.5 — новый сезон и скидки», а это ровно тот
 * крупный патч, ради которого затевалась лента.
 */
export function newsScore(title: string, text: string): number {
  const t = title ?? ''
  let score = 0
  if (PATCH_TITLE.test(t)) score += 3
  if (PATCH_WORD.test(t)) score += 2
  if (VERSION.test(t)) score += 2
  // −2, а не −3: «Обновление 1.5 — новый сезон и скидки» должно остаться патчем
  if (NEWS_WORD.test(t)) score -= 2

  const body = (text ?? '').slice(0, 4000)
  const bullets = body.split('\n').filter((l) => l.startsWith('•')).length
  const verbs = (body.match(new RegExp(`(?<!${NB})(?:${CHANGE_VERBS})(?!${NB})`, 'giu')) ?? []).length
  // форма «список правок с глаголами изменений» — сильная улика, но одной её
  // мало: у анонсов турниров тоже бывают длинные списки, и их спасает минус
  // за слово в заголовке
  if (bullets >= 3 && verbs >= 3) score += 2
  else if (bullets >= 2 && verbs >= 2) score += 1
  if (NEWS_WORD.test(body.slice(0, 400))) score -= 1
  return score
}

export function isPatchNote(title: string, text: string): boolean {
  return newsScore(title, text) >= 2
}

/**
 * Дешёвый предфильтр перед Claude: такие патчи сразу получают scale='minor'
 * без обращения к модели. «Карта обновлена до последней версии из мастерской»
 * — самый частый пост CS2, пересказывать там нечего.
 */
export function looksTrivial(title: string, text: string): boolean {
  const body = (text ?? '').trim()
  if (!body) return true
  if (body.length > 400) return false
  return TRIVIAL_BODY.test(body) || body.length < 120
}

/** Текст поста для классификатора и промпта — из уже разобранных блоков */
export function newsText(item: RawNewsItem, limit = 4000): string {
  return blocksToText(item.blocks, limit)
}

/**
 * Отпечаток ТЕЛА поста: по нему решается, устарел ли пересказ Claude.
 *
 * Считается по нормализованному плейнтексту, а не по blocks_json. Хеш от блоба
 * менялся бы от «?t=» в CDN-ссылке картинки, от смены потолка обрезки и от
 * любой правки пробелов — и мы бы заново платили за пересказ каждого патча
 * при каждом опросе. Заголовок в хеш не входит: он сверяется отдельно.
 */
export function bodyHash(blocks: NewsBlock[]): string {
  const norm = blocksToText(blocks, 20_000).replace(/\s+/g, ' ').trim()
  return createHash('sha1').update(norm).digest('hex').slice(0, 32)
}

/** Язык поста: у части игр перевода нет и лента приезжает английской */
export function detectLang(text: string): 'ru' | 'en' {
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  if (!letters) return 'en'
  const cyr = text.match(/[Ѐ-ӿ]/g)?.length ?? 0
  return cyr / letters > 0.15 ? 'ru' : 'en'
}
