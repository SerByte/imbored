import { clip, DESCRIPTION_MAX } from './clip'
import { hashString, mulberry32 } from './daily'
import {
  gamesByDeveloper,
  getGamePageRow,
  getGameNews,
  getNeighbors,
  topGamesByTag,
  type Db,
  type FeedItem,
  type SimilarGame,
  type StoredNews,
  type StudioGame,
} from './db'
import { collapseEditions, editionKey } from './editions'
import { logSwallowed } from './errlog'
import {
  characterTrait,
  entryTrait,
  languageTrait,
  lengthTrait,
  sessionTrait,
  type GameTrait,
} from './gametraits'
import { distinctiveTags } from './hook'
import { looksLikeJunkName } from './junk'
import { judgeLiveness, type DeadReason } from './liveness'
import { claimsNoUpdates, modelTextFlaw, point } from './modeltext'
import { NEIGHBORS_K } from './neighbors'
import { plural } from './plural'
import { isEndless } from './recommend'
import type { ProsCons } from './reviews'
import { getDb } from './server'
import { tagStatsFor } from './tagstats'
import { tagRu } from './tagsru'
import { rarityOf, rarityScale, tagWeightFrom } from './tagweight'
import { isRussianText } from './textlang'
import type { GameMeta } from './types'

export type GamePageData = {
  meta: GameMeta
  reviewsSummary: {
    scoreDesc: string
    totalPositive: number
    totalNegative: number
  } | null
  prosCons: ProsCons | null
  /** без тел патчей — их отдаёт app/api/news по раскрытию; см. cardNews */
  news: CardNews[]
  /**
   * «Похожие»: готовые соседи по всему вектору тегов (nearGames), а пока их
   * не залили — соседи по тегу полки (topTagOf, pickSimilar); пусто, если
   * тегов нет
   */
  similar: SimilarGame[]
  /**
   * По какому тегу подобрана полка — он же стоит в заголовке блока. null у
   * готовых соседей: они похожи всем вектором, и один тег в заголовке был бы
   * неправдой; общее у каждой пары стоит под её плиткой (SimilarGame.shared)
   */
  similarTag: string | null
  /**
   * «Чем выделяется»: до двух характерных тегов (lib/hook, английскими
   * ключами). null — сказать честно нечего: нет карты тегов или ни один тег
   * не прошёл порог. Строку из него собирает gameTraits.
   */
  hook: string[] | null
  /**
   * «Ещё у <студии>»: строка текстовых ссылок под «Похожими» (studioLine).
   * null — строки нет: у студии одна игра, корпоративный каталог, всё уже на
   * полке «Похожие», или страница чужого магазина.
   */
  studio: StudioLine | null
}

/**
 * Строка «Что нового» на карточке — ровно то, что рисует островок GameNews.
 *
 * Не FeedItem целиком (withoutBody), и дело не в байтах. Всё, что уходит в
 * клиентский островок, лежит в RSC-части страницы, а страница живёт в ISR
 * неделю и пишется заново, только если её вывод разошёлся с прошлым (см.
 * lib/gamecache). У FeedItem есть поля, которые меняются без единой
 * видимой перемены:
 *   • rank — вес игры, max(отзывы, онлайн), переписывается у всех её постов
 *     на каждом опросе, где сдвинулись отзывы (upsertNewsItems). Карточке из
 *     него нужен один бит — в каталоге ли игра (indexedNewsPath: rank > 0);
 *   • bodyHash и imageUrl — островок их не читает вовсе.
 * С ними каждая перегенерация писала бы страницу заново из-за числа, которого
 * на ней не видно.
 */
export type CardNews = Pick<FeedItem, 'appid' | 'gid' | 'title' | 'url' | 'publishedAt' | 'kind' | 'scale' | 'tldr' | 'rank'>

export function cardNews(item: StoredNews): CardNews {
  return {
    appid: item.appid,
    gid: item.gid,
    title: item.title,
    url: item.url,
    publishedAt: item.publishedAt,
    kind: item.kind,
    scale: item.scale,
    ...(item.tldr !== undefined ? { tldr: item.tldr } : {}),
    rank: item.rank > 0 ? 1 : 0,
  }
}

export type ReviewFacts = {
  /** Доля положительных отзывов, 0…100. */
  percent: number
  /** Сколько отзывов учтено. */
  total: number
  /**
   * Словесная оценка Steam («Very Positive»). Есть ТОЛЬКО когда пришла
   * сводка: выводить её из процента мы намеренно не будем — это была бы наша
   * догадка, выданная за оценку площадки.
   */
  label: string | null
}

/**
 * Оценка игры из того, что есть.
 *
 * Страница называется «стоит ли играть», а кольцо с процентом рисовалось
 * только из reviews_summary_json — отдельной сводки, которую наполняет крон.
 * В каталоге на тысячу игр её нет у 278. То есть 28% страниц не отвечали на
 * вопрос из собственного заголовка — при том что reviews_percent и
 * reviews_total лежат в той же строке базы и заполнены у ВСЕХ до одной.
 * Half-Life: Opposing Force — 95% из 13 440 отзывов — показывал пустое место
 * там, где должно стоять число.
 *
 * Порядок источников: сводка точнее (в ней сырые количества, из которых
 * процент считается на месте), поэтому она первая. Колонки — запасной путь.
 *
 * Слово при этом берётся только из сводки. Числа — факт площадки, и мы их
 * пересказываем; словесная шкала — её суждение, и придумывать его за неё
 * нельзя. Без сводки рядом с кольцом остаётся «положительных из N отзывов», и
 * этого достаточно: процент уже стоит внутри кольца.
 */
export function reviewFacts(
  meta: Pick<GameMeta, 'reviewsPercent' | 'reviewsTotal'>,
  summary: GamePageData['reviewsSummary'],
): ReviewFacts | null {
  const counted = summary ? summary.totalPositive + summary.totalNegative : 0
  if (summary && counted > 0) {
    return {
      percent: Math.round((summary.totalPositive / counted) * 100),
      total: counted,
      label: summary.scoreDesc,
    }
  }
  const { reviewsPercent, reviewsTotal } = meta
  if (typeof reviewsPercent === 'number' && typeof reviewsTotal === 'number' && reviewsTotal > 0) {
    return { percent: Math.max(0, Math.min(100, Math.round(reviewsPercent))), total: reviewsTotal, label: null }
  }
  return null
}

/** Сколько игр стоит на полке «Похожие». */
export const SIMILAR_SHOWN = 6

/**
 * Из скольких кандидатов полка выбирает свои шесть. Больше — ссылки разойдутся
 * по большему числу карточек, но в полку чаще попадут менее характерные
 * соседи. Тридцать — по замеру на каталоге, см. pickSimilar.
 */
export const SIMILAR_CANDIDATES = 30

/**
 * Среди скольких первых по весу тегов ищется тег полки. Без потолка редкость
 * вытаскивала хвост: у The Witcher 3 полка стала бы «Похожие · Nudity», у DayZ
 * с его ровными весами — «Choose Your Own Adventure». Пять — примерно столько
 * тегов Steam показывает у игры сразу, без раскрытия списка.
 */
const SHELF_TAG_POOL = 5

/** Тег, который в каталоге есть меньше чем у семи игр, полку не наполнит. */
const SHELF_MIN_GAMES = SIMILAR_SHOWN + 1

/**
 * Тег, по которому подбирается полка «Похожие».
 *
 * Вес в tags_json — это характерность, а не популярность, поэтому «первый по
 * весу» означает «чем эта игра является больше всего». Но первым почти всегда
 * стоит широкий тег — Action, Free to Play, RPG, — и полка превращалась в
 * случайную выборку из тысяч игр: у God of War «Похожие · Action», у Dota 2 —
 * «Похожие · Free to Play». С картой тегов каталога (loadTagStats) из первых
 * пяти по весу берётся тот, у которого вес × редкость больше, — тем же
 * rarityOf, что у подбора и совместимости: God of War получает Mythology,
 * Dota 2 — MOBA, Baldur's Gate 3 — Turn-Based Combat.
 *
 * Без карты (непрогретая база, сбой чтения) или когда все пять тегов
 * частотные — прежний порядок, первый по весу.
 *
 * Тай-брейк по имени обязателен: страница кэшируется на неделю и пререндерится,
 * и блок «похожие» не должен меняться от того, в каком порядке Object.entries
 * вернул ключи после очередной пересборки каталога.
 */
export function topTagOf(meta: GameMeta, tagStats?: Map<string, number> | null): string | null {
  const entries = Object.entries(meta.tags ?? {}).filter(([, w]) => Number.isFinite(w))
  if (!entries.length) return null
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const top = tagStats ? rarityScale(tagStats) : 0
  if (!tagStats || !top) return entries[0][0]
  let best = entries[0][0]
  let bestScore = 0
  // Обход — по весу, затем по имени, и сравнение строгое: при равном счёте
  // побеждает более весомый тег, а при равном весе — первый по алфавиту
  for (const [tag, weight] of entries.slice(0, SHELF_TAG_POOL)) {
    if ((tagStats.get(tag) ?? 0) < SHELF_MIN_GAMES) continue
    const score = weight * rarityOf(tag, tagStats, top)
    if (score > bestScore) {
      best = tag
      bestScore = score
    }
  }
  return best
}

/**
 * Шесть соседей из кандидатов — детерминированно по appid страницы.
 *
 * Кандидаты приходят упорядоченными (topGamesByTag: характерность, затем
 * отзывы), и раньше полка была просто первой шестёркой. Тогда у всех 339
 * карточек с главным тегом Action стояли одни и те же шесть игр: каждая из них
 * получала по 338 внутренних ссылок, а 3443 из 5000 страниц карты сайта — ни
 * одной. Полка — единственная перелинковка между карточками.
 *
 * Теперь шестёрка — взвешенная выборка без возвращения (ключ u^(1/w),
 * Efraimidis–Spirakis), где вес — место с конца: верхние кандидаты попадают
 * чаще, но не всегда. Замер на копии каталога, 5000 страниц карты сайта
 * вместе с выбором тега по редкости (topTagOf): страниц со входящей ссылкой с
 * полки — 3580 вместо 1535, самая «популярная» карточка — 45 входящих вместо
 * 339. Равномерная выборка разносит чуть шире (3718 и 39), но чаще выкидывает
 * самых похожих.
 *
 * Сид — appid страницы, а не время: страница кэшируется на неделю, и полка не
 * должна меняться от пересборки к пересборке, пока не поменялись кандидаты.
 * Показываются выбранные в исходном порядке — самые характерные первыми.
 */
export function pickSimilar<T>(ranked: readonly T[], pageAppid: number, shown = SIMILAR_SHOWN): T[] {
  if (ranked.length <= shown) return [...ranked]
  const rnd = mulberry32(hashString(`similar:${pageAppid}`))
  const n = ranked.length
  return ranked
    .map((_, i) => ({ i, key: rnd() ** (1 / (n - i)) }))
    .sort((a, b) => b.key - a.key || a.i - b.i)
    .slice(0, shown)
    .map((k) => k.i)
    .sort((a, b) => a - b)
    .map((i) => ranked[i])
}

/**
 * Соседи игры — для полки «Похожие» и для «Как «X», но…» на /play.
 *
 * Сначала готовые (getNeighbors, lib/neighbors): похожие по всему вектору
 * тегов с весом редкости, посчитанные офлайн. Замер на копии каталога, 5816
 * живых игр: первая шестёрка соседей даёт входящую ссылку 5348 карточкам из
 * 5816 (полка по тегу со взвешенной выборкой — 3580), самая «популярная» —
 * 48 входящих (было 45) — и это соседи по сути, а не шесть случайных из тысяч
 * игр с тем же Action. Поэтому готовые показываются просто по порядку, без
 * выборки pickSimilar: разносить ссылки им уже не нужно.
 *
 * Меньше шести живых — прежняя полка по тегу: таблицу ещё не залили (или
 * игры не было в каталоге при сборке), а половинная полка хуже полной по
 * тегу. Это же фолбэк держит «Как «X», но…» до первой заливки.
 *
 * stats — карта тегов или её промис: соседям она не нужна, и чтение соседей
 * идёт параллельно с ней, а не после.
 */
export async function nearGames(
  db: Db,
  meta: GameMeta,
  stats: Map<string, number> | null | Promise<Map<string, number> | null>,
): Promise<{ games: SimilarGame[]; tag: string | null; basis: 'neighbors' | 'tag' | 'none' }> {
  if (!Object.keys(meta.tags ?? {}).length) return { games: [], tag: null, basis: 'none' }
  const near = await getNeighbors(db, meta.appid, NEIGHBORS_K)
  if (near.length >= SIMILAR_SHOWN) return { games: near, tag: null, basis: 'neighbors' }
  const tag = topTagOf(meta, await stats)
  if (!tag) return { games: [], tag: null, basis: 'none' }
  return {
    games: await topGamesByTag(db, tag, meta.appid, SIMILAR_CANDIDATES),
    tag,
    basis: 'tag',
  }
}

/**
 * Больше стольких живых игр у студии — строки нет. Supergiant, Klei, Amanita,
 * Zachtronics укладываются в десяток, а у Square Enix, CAPCOM и Ubisoft в
 * каталоге десятки игр: на странице NieR строка «Ещё у Square Enix» позвала бы
 * в FINAL FANTASY XIV Online, и это был бы список издательства, а не почерк
 * авторов. Число игр считается ДО фильтров, включая саму страницу: вопрос
 * «корпорация ли это» — про студию, а не про то, что от неё осталось на полке.
 */
export const STUDIO_MAX_GAMES = 12

/** Меньше двух названий — не строка «ещё», а одна ссылка, которой хватает героя */
export const STUDIO_MIN_SHOWN = 2

/** Сколько названий в строке: одна строка текста, не сетка, и кнопка ниже не уезжает */
export const STUDIO_SHOWN = 4

export type StudioLine = {
  /** Как в подписи героя — та же строка games.developer, только без краевых пробелов */
  developer: string
  games: Array<{ appid: number; name: string }>
}

/**
 * «Ещё у <студии>: A · B · C» под полкой «Похожие» — чистая часть: что из игр
 * студии (gamesByDeveloper) стоит назвать на этой странице.
 *
 * Отсев по порядку причин:
 *   • чужой магазин (appid < 0) и игра без разработчика — строки нет вовсе;
 *   • у студии больше STUDIO_MAX_GAMES живых игр — корпоративный каталог;
 *   • сама страница и её издания (editionKey): «Ещё у CD PROJEKT RED: The
 *     Witcher 3: Wild Hunt — Complete Edition» на странице The Witcher 3 —
 *     это та же игра в другой коробке;
 *   • мусор по названию (looksLikeJunkName): саундтрек или демо студии живым
 *     в пуле бывает, а советовать его как «ещё игру» — нет;
 *   • то, что уже стоит в «Похожих», по appid и по изданию: дважды на одной
 *     странице одна игра — место, потраченное впустую, а у студий с сильной
 *     серией соседи и так её игры (у Hades первый сосед — Hades II);
 *   • издания между собой схлопываются (collapseEditions), побеждает первый
 *     по отзывам — тот же, что и так стоит левее, порядок не двигается.
 *
 * Порядок пересчитывается здесь, а не берётся из запроса: отзывы по убыванию,
 * затем appid. Страница живёт в ISR неделю и обязана быть той же байт в байт,
 * пока не поменялись данные, — от порядка строк на входе вывод зависеть не
 * должен.
 */
export function studioLine(
  page: Pick<GameMeta, 'appid' | 'name' | 'developer'>,
  candidates: readonly StudioGame[],
  similar: ReadonlyArray<Pick<SimilarGame, 'appid' | 'name'>>,
): StudioLine | null {
  const developer = page.developer?.trim()
  if (page.appid < 0 || !developer) return null
  if (candidates.length > STUDIO_MAX_GAMES) return null

  const pageKey = editionKey(page.name)
  const shownIds = new Set(similar.map((g) => g.appid))
  const shownKeys = new Set(similar.map((g) => editionKey(g.name)).filter(Boolean))
  const kept = [...candidates]
    .sort((a, b) => b.reviewsTotal - a.reviewsTotal || a.appid - b.appid)
    .filter((g) => {
      if (g.appid === page.appid || g.appid <= 0 || shownIds.has(g.appid)) return false
      if (looksLikeJunkName(g.name)) return false
      const key = editionKey(g.name)
      return !key || (key !== pageKey && !shownKeys.has(key))
    })
  // Внутри группы изданий побеждает первый: вход уже отсортирован по отзывам
  const games = collapseEditions(kept, (g) => g.name, () => 1)
    .slice(0, STUDIO_SHOWN)
    .map(({ appid, name }) => ({ appid, name }))
  return games.length >= STUDIO_MIN_SHOWN ? { developer, games } : null
}

/**
 * Карта тегов каталога для выбора тега полки — с памятью на процесс.
 *
 * Карточка — самая массовая страница: пять тысяч адресов в карте сайта, у
 * каждой ещё и OG-картинка. Без памяти один проход краулера стоил бы больше
 * двух миллионов прочитанных строк Turso ради карты, которая меняется только
 * с заливкой каталога. Память общая с горячими путями подбора — lib/tagstats.
 *
 * Сбой чтения страницу не роняет: tagStatsFor без запомненной карты бросает
 * (подбору молчаливая пустая карта вредна), а здесь это null — полка просто
 * подбирается по-старому.
 */
async function pageTagStats(db: Db, nowSec: number): Promise<Map<string, number> | null> {
  try {
    return await tagStatsFor(db, nowSec)
  } catch (err) {
    logSwallowed('gamepage:tagstats', err)
    return null
  }
}

/**
 * Вердикт мёртвой игре — одной фразой, словами, а не кодом причины.
 *
 * Курация каталога знает про 181 карточку, что играть в неё сегодня не выйдет:
 * у Dirty Bomb и Team Fortress Classic пустые серверы, у Kerbal Space Program 2
 * разгромные отзывы. Из подбора, карты сайта и «Похожих» они убраны, но по
 * прямой ссылке и из старого индекса страница отвечала на «стоит ли играть»
 * кнопкой «Запустить» и молчала о том, что продукт уже решил.
 *
 * Фраза без чисел: число рядом уже нарисовано — онлайн строкой PlayersNow,
 * доля отзывов в кольце. Повторять его здесь значило бы завести второе число,
 * которое разойдётся с первым после очередного замера.
 */
const DEAD_VERDICT: Record<DeadReason, string> = {
  'dead-multiplayer': 'Сетевая игра, в которой почти не осталось людей, — матч, скорее всего, не соберётся.',
  panned: 'Большинство отзывов отрицательные — игроки её не советуют.',
  'asset-flip': 'Отзывов почти нет — судить о ней пока не по чему.',
  'solo-only': 'В неё играют только в одиночку — компанию здесь не собрать.',
}

/** Причина неизвестна, а курация всё равно сняла игру с подбора */
const DEAD_VERDICT_UNKNOWN = 'Из подбора она снята: по нашим данным, сегодня это не лучший выбор.'

/**
 * Есть ли у страницы свежее число, которым проверяется эта причина. Без него
 * спорить с курацией нечем, и верим ей; с ним — верим ему.
 */
const SIGNAL_OF: Record<DeadReason, (m: GameMeta) => boolean> = {
  'dead-multiplayer': (m) => m.ccu !== undefined || m.reviews30d !== undefined,
  panned: (m) => m.reviewsPercent !== undefined && m.reviewsTotal !== undefined,
  'asset-flip': (m) => m.reviewsTotal !== undefined,
  'solo-only': () => true,
}

/**
 * Фраза-вердикт для мёртвой игры, либо null.
 *
 * Курация пишет alive раз в прогон, а онлайн и отзывы обновляются чаще —
 * поэтому вердикт сверяется с теми числами, что стоят на странице сейчас.
 * У игры, в которую вернулись люди, строка «2 400 сейчас играют» рядом с
 * «почти не осталось людей» была бы ровно той ложью, против которой вердикт и
 * заведён. Если свежие числа с курацией спорят — молчим; если согласны, но по
 * другой причине, — называем ту, что видно на странице.
 */
export function deadVerdict(meta: GameMeta): string | null {
  if (meta.alive !== false) return null
  const now = judgeLiveness({
    categories: meta.categories,
    ccu: meta.ccu,
    reviews30d: meta.reviews30d,
    reviewsTotal: meta.reviewsTotal,
    reviewsPercent: meta.reviewsPercent,
  })
  if (!now.alive && now.reason) return DEAD_VERDICT[now.reason]
  const stored = meta.deadReason
  if (!stored) return DEAD_VERDICT_UNKNOWN
  return SIGNAL_OF[stored](meta) ? null : DEAD_VERDICT[stored]
}

/** Потолок описания — в lib/clip, рядом с обрезкой; отсюда его берут тесты карточки */
export { DESCRIPTION_MAX }

/**
 * Написан ли текст по-русски. Правило переехало в lib/textlang: оно нужно и
 * клиентским строкам ленты патчей, а этот модуль тянет базу. Реэкспорт — для
 * серверных потребителей, которые брали его отсюда (cards, хабы жанров).
 */
export { isRussianText }

/**
 * Меньше этого остатка описание магазина в сниппет не обрезается: в узкий
 * хвост помещалось только начало первой фразы — «DARK SOULS™…» после плюса на
 * /game/335300, то есть обрубок имени, которое и так стоит в начале. Целая
 * короткая фраза встаёт и в узкий хвост — обрубком она не будет.
 */
const STORE_CLIP_MIN = 40

/**
 * meta description карточки игры.
 *
 * Было `имя: 93% положительных отзывов · Action, FPS, Shooter · <первые 120
 * символов short_description>` — 190–207 символов, английские теги и у
 * трёх карточек из четырёх английский хвост, оборванный посреди слова. А
 * главное, что есть у страницы своего — «за что любят» и «за что ругают» по-
 * русски, — в сниппет не попадало вовсе.
 *
 * Теперь фразы идут по важности и берутся целиком, пока влезают:
 *   вердикт мёртвой игре — он и есть ответ на «стоит ли играть»;
 *   доля положительных и число отзывов — те же, что в кольце на странице;
 *   «любят» и «ругают» — парой, см. ниже;
 *   описание магазина — только русское и одно оно обрезается по слову, и то
 *   если остаток не меньше STORE_CLIP_MIN.
 *
 * «Любят» и «Ругают» — пара, а не две независимые фразы. Раньше брались
 * pros[0] и cons[0] по отдельности, и плюс, который не влез, просто
 * пропускался — а следом вставал минус покороче. У DARK SOULS II (84%,
 * «Очень положительные», имя в 40 знаков) в сниппете и превью в мессенджерах
 * об игре стояла одна жалоба. Теперь плюс — первый по порядку из тех, что
 * влезают целиком (порядок модели — порядок важности; обрезанный посреди
 * мысли первый хуже целого второго), а минус — первый влезающий и только
 * если плюс встал.
 *
 * Исключение — плюсов нет вовсе: модель честно не нашла, за что хвалить
 * (claudeProsCons такой ответ публикует, а карточка показывает блок минусов
 * одним). Это не плюс, который не влез, а ответ отзывов — у игры с 25%
 * «В основном отрицательные» одна жалоба в сниппете и есть правда, и
 * прятать её значит оставить сниппет без мнения игроков вовсе.
 */
export function gameDescription({
  meta,
  facts,
  prosCons,
  verdict,
}: {
  meta: GameMeta
  facts: ReviewFacts | null
  prosCons: ProsCons | null
  verdict: string | null
}): string {
  const head = `${meta.name}:`
  let out = head
  const room = () => DESCRIPTION_MAX - out.length - 1
  /** Целую фразу — если влезает, иначе ничего; true — встала */
  const add = (text: string): boolean => {
    if (text.length > room()) return false
    out += ` ${text}`
    return true
  }

  if (verdict) add(verdict)
  if (facts) {
    const total = facts.total.toLocaleString('ru-RU')
    const noun = plural(facts.total, 'отзыва', 'отзывов', 'отзывов')
    add(`${facts.percent}% из ${total} ${noun} — положительные.`)
  }
  const pros = (prosCons?.pros ?? []).map((t) => `Любят: ${point(t)}.`)
  const cons = (prosCons?.cons ?? []).map((t) => `Ругают: ${point(t)}.`)
  const proPlaced = pros.some(add)
  if (proPlaced || !pros.length) cons.some(add)
  if (meta.shortDescription && isRussianText(meta.shortDescription)) {
    const store = meta.shortDescription.replace(/\s+/g, ' ').trim()
    const text = clip(store, room())
    // Целиком или целой первой фразой — встаёт в любой остаток; обрезанное по
    // слову с многоточием — только в достаточно широкий
    const stub = text !== store && text?.endsWith('…')
    if (text && (!stub || room() >= STORE_CLIP_MIN)) out += ` ${text}`
  }

  if (out === head) out = `${meta.name} — отзывы, теги и патчноуты на русском.`
  // Длинное название само по себе может не влезть — режем и его, по слову
  return clip(out, DESCRIPTION_MAX) ?? out.slice(0, DESCRIPTION_MAX)
}

/*
 * Строка сессии переехала в lib/gametraits: её показывают и клиентские экраны
 * (герой /play, колода пати), а этот модуль тянет за собой базу. Реэкспорт —
 * ради карточки игры и её тестов, которые берут всё отсюда.
 */
export { SESSION_MIN_CONFIDENCE, sessionTrait, type GameTrait } from './gametraits'

/**
 * «Чем выделяется» — характерные теги игры (distinctiveTags в lib/hook)
 * русскими подписями. Подпись честная: это теги, которые проставили игроки,
 * а не пересказ. null — строки нет.
 */
export function hookTrait(hook: readonly string[] | null): GameTrait | null {
  if (!hook?.length) return null
  return { label: 'Чем выделяется', value: hook.map(tagRu).join(', ') }
}

/**
 * Строки фактов карточки по порядку; пустой список — блока нет вовсе.
 *
 * Чем выделяется → сессия → вход → наиграли → характер → русский. Всё без
 * модели и только то, что знаем: сессия и характер — из уверенной семантики,
 * вход — из числа, которое назвали отзывы, наиграли — из минут хваливших
 * (lengthTrait), русский — из отметок Steam (languageTrait).
 * «Можно бросить в любой момент» здесь нет намеренно: этот признак семантика
 * берёт только из тегов (canStopAnytime), и на публичной карточке он был бы
 * жанровым приором, выданным за факт об игре.
 *
 * Три строки про время — подряд, от короткого к длинному: сколько длится
 * заход, когда игра раскрывается, сколько наиграли те, кто её хвалит.
 * Игре без конца «Наиграли» не пишем (isEndless, см. lengthTrait).
 *
 * Русский — последним: строки выше про то, как в неё играется, а язык — про
 * то, можно ли в неё сесть вообще. Строке с русским соответствует
 * inLanguage в микроразметке (lib/jsonld); у «нет» поля там нет — других
 * языков игры мы не знаем.
 */
export function gameTraits(
  meta: Pick<GameMeta, 'semantics' | 'categories'> & Partial<Pick<GameMeta, 'tags' | 'ruLang'>>,
  hook: readonly string[] | null,
): GameTrait[] {
  const tags = meta.tags ?? {}
  return [
    hookTrait(hook),
    sessionTrait(meta),
    entryTrait({ tags, semantics: meta.semantics }),
    lengthTrait(meta, { endless: isEndless({ tags, categories: meta.categories }) }),
    characterTrait(meta),
    languageTrait(meta),
  ].filter((t): t is GameTrait => t !== null)
}

/**
 * Собирает данные карточки игры. ТОЛЬКО ЧТЕНИЕ ИЗ БАЗЫ — ни одного сетевого
 * вызова и ни одного обращения к модели.
 *
 * Это главное правило страницы, и оно стоило дорого, пока не соблюдалось.
 * Раньше здесь на промахе кэша вызывались appdetails, appreviews и Claude.
 * Страница публичная, кэша у неё не было, а в каталоге 6000 живых игр, у
 * которых ни один из этих полей не был заполнен, — то есть один проход
 * поискового краулера означал 6000 вызовов модели и 12000 запросов к Steam.
 * Злоумышленник для этого не нужен, достаточно карты сайта.
 *
 * Ровно это правило уже было сформулировано двадцатью строками ниже для
 * патчноутов — просто не применено к остальным полям. Теперь всё, что требует
 * сети, живёт в lib/pagejob.ts и ходит по расписанию с бюджетом и темпом.
 *
 * Следствие, с которым надо считаться: игры, до которой очередь ещё не дошла,
 * карточка покажет без скриншотов и без pros/cons. Это правильный компромисс —
 * неполная страница дешевле неограниченного счёта.
 */
export async function loadGamePage(appid: number): Promise<GamePageData | null> {
  const db = await getDb()

  // Строка и оба её блоба — одним чтением: см. докблок getGamePageRow.
  const строка = await getGamePageRow(db, appid)
  // Незнакомый appid — это и есть тот случай, ради которого всё написано:
  // краулер, перебирающий пространство идентификаторов, должен получать 404
  // после одного чтения из базы, а не запускать наполнение каталога.
  if (!строка) return null
  const meta = строка.meta

  // Отрицательные appid — кураторский пул других магазинов: у Steam про них
  // ничего нет, показываем только собственные данные
  // Соседей ищем и для чужих магазинов: тег у такой записи есть, а вот патчей
  // и отзывов Steam про неё нет — поэтому блок «похожие» стоит ДО раннего
  // возврата, а не после
  //
  // Карта тегов — только когда теги есть: игре без них ни полку, ни «Чем
  // выделяется» не собрать всё равно, и читать ради неё нечего. Одна на оба
  // потребителя; pageTagStats не бросает — сбой чтения даёт null
  const hasTags = Object.keys(meta.tags ?? {}).length > 0
  const statsOf = hasTags
    ? pageTagStats(db, Math.floor(Date.now() / 1000))
    : Promise.resolve(null)
  const similarOf = async (): Promise<Pick<GamePageData, 'similar' | 'similarTag' | 'hook'>> => {
    const [stats, near] = await Promise.all([statsOf, nearGames(db, meta, statsOf)])
    // Редкость — по той же карте, что у полки: тег, которым игра выделяется,
    // должен быть редким по каталогу, а не просто первым по голосам
    const hook = distinctiveTags(meta, stats ? tagWeightFrom(stats) : null)
    // Готовые соседи — по порядку сходства, полка по тегу — выборкой, см. nearGames
    const similar =
      near.basis === 'neighbors' ? near.games.slice(0, SIMILAR_SHOWN) : pickSimilar(near.games, appid)
    return { similar, similarTag: near.tag, hook }
  }

  if (appid < 0) {
    return {
      meta,
      reviewsSummary: null,
      prosCons: null,
      news: [],
      ...(await similarOf()),
      studio: null,
    }
  }

  const reviewsSummary = строка.reviewsSummary as GamePageData['reviewsSummary']
  const stored = строка.prosCons as GamePageData['prosCons']
  // Игры студии — параллельно с полкой, а отсев — после неё: строка не
  // повторяет того, что уже стоит в «Похожих». Лимит на одну больше порога —
  // так studioLine узнаёт корпоративный каталог, не читая его целиком
  const [news, shelf, studioGames] = await Promise.all([
    getGameNews(db, appid, 8).then((rows) => rows.map(cardNews)),
    similarOf(),
    meta.developer?.trim()
      ? gamesByDeveloper(db, meta.developer, STUDIO_MAX_GAMES + 1)
      : Promise.resolve([]),
  ])
  const studio = studioLine(meta, studioGames, shelf.similar)

  /*
   * Наружу отдаём ТОЛЬКО собранное моделью.
   *
   * Эвристический вариант — это первые предложения самых залайканных отзывов
   * Steam, как есть. На витрине это выглядело так: китайский, испанский,
   * зацензуренный мат и прямая непристойность в блоке «за что любят» — на
   * русскоязычной странице, лежащей в карте сайта. Отбор по числу голосов
   * этого не чинит, скорее наоборот: залайкивают как раз шутки.
   *
   * Правило стоит здесь, а не в разметке, чтобы его нельзя было обойти новым
   * потребителем и чтобы оно было покрыто тестом.
   *
   * В базе эвристику при этом храним: source: 'reviews' и есть тот маркер, по
   * которому карточка вернётся в очередь на пересборку моделью (см.
   * claimPageEnrichBatch, redoHeuristic). 'thin' — та же эвристика у игры,
   * где полезных отзывов слишком мало, чтобы звать модель (lib/pagejob.ts);
   * её не показываем тем более.
   */
  const prosCons = shownProsCons(stored, news, Math.floor(Date.now() / 1000))

  return { meta, reviewsSummary, prosCons, news, ...shelf, studio }
}

/**
 * Окно, в котором свежий патч опровергает минус «игру не обновляют». Три
 * месяца: патч полугодовой давности такому минусу уже не противоречит —
 * затишье бывает и у живых игр, — а патч прошлой недели противоречит прямо.
 */
const FRESH_PATCH_SEC = 90 * 86_400

/**
 * Что из сохранённых pros/cons показывать. Только собранное моделью (см.
 * докблок выше в loadGamePage) — и из него только то, что проходит проверку
 * сегодня.
 *
 * Проверка после модели (modelTextFlaw) появилась позже сотен карточек в
 * базе, а пересобирает их крон раз в полгода. Поэтому битое прячется и здесь,
 * при чтении: «…справедливо'],», «в каждой матч», «неработает» уходят со
 * страницы, из её meta description и og-карточки сразу, без похода в модель.
 *
 * Минус «разработчики не обновляют игру» сверяется с фактом, который страница
 * показывает сама: свежий патч в «Что нового» (news — ровно эти строки). На
 * CS2 такой минус стоял над восемью патчами за три недели. Сверка — при
 * чтении, а не при записи: факт меняется, а пересказ отзывов живёт полгода.
 *
 * Плюсы были, но не уцелел ни один, — блока нет вовсе: «только ругают» у игры,
 * которую хвалят, врёт перекосом (то же правило у записи, в claudeProsCons).
 */
function shownProsCons(
  stored: ProsCons | null,
  news: ReadonlyArray<Pick<CardNews, 'kind' | 'publishedAt'>>,
  nowSec: number,
): ProsCons | null {
  if (stored?.source !== 'claude') return null
  const fresh = news.some((n) => n.kind === 'patch' && n.publishedAt >= nowSec - FRESH_PATCH_SEC)
  const ok = (t: unknown): t is string => typeof t === 'string' && !modelTextFlaw(t)
  const storedPros = Array.isArray(stored.pros) ? stored.pros : []
  const pros = storedPros.filter(ok)
  const cons = (Array.isArray(stored.cons) ? stored.cons : []).filter(
    (t) => ok(t) && !(fresh && claimsNoUpdates(t)),
  )
  if (storedPros.length && !pros.length) return null
  if (!pros.length && !cons.length) return null
  return { ...stored, pros, cons }
}
