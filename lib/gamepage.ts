import {
  getGamePageRow,
  getGameNews,
  topGamesByTag,
  withoutBody,
  type FeedItem,
  type SimilarGame,
} from './db'
import { judgeLiveness, type DeadReason } from './liveness'
import { plural } from './plural'
import type { ProsCons } from './reviews'
import { getDb } from './server'
import type { GameMeta } from './types'

export type GamePageData = {
  meta: GameMeta
  reviewsSummary: {
    scoreDesc: string
    totalPositive: number
    totalNegative: number
  } | null
  prosCons: ProsCons | null
  /** без тел патчей — их отдаёт app/api/news по раскрытию, см. withoutBody */
  news: FeedItem[]
  /** соседи по самому характерному тегу; пусто, если тегов нет */
  similar: SimilarGame[]
  /** по какому тегу они подобраны — он же стоит в заголовке блока */
  similarTag: string | null
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
 * нельзя. Без сводки рядом с кольцом остаётся «из N отзывов — за», и этого
 * достаточно: процент уже стоит внутри кольца.
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

/**
 * Самый характерный тег игры.
 *
 * Вес в tags_json — это характерность (доля от максимума), а не популярность,
 * поэтому «первый по весу» и означает «чем эта игра является больше всего».
 * Тай-брейк по имени обязателен: страница кэшируется на сутки и пререндерится,
 * и блок «похожие» не должен меняться от того, в каком порядке Object.entries
 * вернул ключи после очередной пересборки каталога.
 */
export function topTagOf(meta: GameMeta): string | null {
  const entries = Object.entries(meta.tags ?? {})
  if (!entries.length) return null
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return entries[0][0]
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

/**
 * Сколько описания показывает выдача. Дальше Google и Яндекс режут сами — и
 * режут посреди слова: «…brandish the power of the Elden» стояло в сниппете
 * Elden Ring.
 */
export const DESCRIPTION_MAX = 155

/**
 * Написан ли текст по-русски.
 *
 * short_description каталог берёт у магазина с language=english, и русский
 * есть только у тех карточек, до которых дошёл крон страниц. Выборка из 25
 * адресов карты сайта: английский хвост у 19. Кириллицы больше, чем латиницы, —
 * а не «есть хоть одна буква»: названия и аббревиатуры в русском тексте
 * латиницей («Станьте вором в VR!») его русским быть не мешают.
 */
export function isRussianText(text: string | null | undefined): boolean {
  if (!text) return false
  const cyr = text.match(/[А-Яа-яЁё]/g)?.length ?? 0
  const lat = text.match(/[A-Za-z]/g)?.length ?? 0
  return cyr > 0 && cyr >= lat
}

/**
 * Обрезка по слову с многоточием. null — когда в место не влезает и одного
 * слова: обрубок хуже отсутствия.
 *
 * Целое предложение лучше начала следующего: «ролевая игра.» читается как
 * законченная мысль, «ролевая игра. Восстань…» — как оборванная. Но только если
 * предложение занимает хотя бы половину места: иначе отдали бы полстроки ради
 * точки.
 */
function clip(text: string, max: number): string | null {
  if (text.length <= max) return text
  if (max < 2) return null
  const whole = text.slice(0, max + 1).match(/^[\s\S]*[.!?](?=\s)/)?.[0]
  if (whole && whole.length >= max / 2) return whole
  const cut = text.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  if (space <= 0) return null
  return `${cut.slice(0, space).replace(/[\s.,;:!?…—–-]+$/, '')}…`
}

/** Пункт из pros/cons как предложение: без своей точки в конце, одной строкой */
function point(text: string): string {
  return text.replace(/\s+/g, ' ').trim().replace(/[.,;:!?…]+$/, '')
}

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
 *   первый пункт «любят» и первый «ругают»;
 *   описание магазина — только русское и одно оно обрезается по слову.
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
  const phrases: Array<{ text: string; clip?: boolean }> = []
  if (verdict) phrases.push({ text: verdict })
  if (facts) {
    const total = facts.total.toLocaleString('ru-RU')
    const noun = plural(facts.total, 'отзыва', 'отзывов', 'отзывов')
    phrases.push({ text: `${facts.percent}% из ${total} ${noun} — положительные.` })
  }
  const pro = prosCons?.pros[0]
  const con = prosCons?.cons[0]
  if (pro) phrases.push({ text: `Любят: ${point(pro)}.` })
  if (con) phrases.push({ text: `Ругают: ${point(con)}.` })
  if (meta.shortDescription && isRussianText(meta.shortDescription)) {
    phrases.push({ text: meta.shortDescription.replace(/\s+/g, ' ').trim(), clip: true })
  }

  const head = `${meta.name}:`
  let out = head
  for (const p of phrases) {
    const room = DESCRIPTION_MAX - out.length - 1
    const text = p.clip ? clip(p.text, room) : p.text.length <= room ? p.text : null
    if (text) out += ` ${text}`
  }
  if (out === head) out = `${meta.name} — отзывы, теги и патчноуты на русском.`
  // Длинное название само по себе может не влезть — режем и его, по слову
  return clip(out, DESCRIPTION_MAX) ?? out.slice(0, DESCRIPTION_MAX)
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
  const topTag = topTagOf(meta)
  const similarOf = async () => (topTag ? topGamesByTag(db, topTag, appid) : [])

  if (appid < 0) {
    return {
      meta,
      reviewsSummary: null,
      prosCons: null,
      news: [],
      similar: await similarOf(),
      similarTag: topTag,
    }
  }

  const reviewsSummary = строка.reviewsSummary as GamePageData['reviewsSummary']
  const stored = строка.prosCons as GamePageData['prosCons']
  const [news, similar] = await Promise.all([
    getGameNews(db, appid, 8).then((rows) => rows.map(withoutBody)),
    similarOf(),
  ])

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
  const prosCons = stored?.source === 'claude' ? stored : null

  return { meta, reviewsSummary, prosCons, news, similar, similarTag: topTag }
}
