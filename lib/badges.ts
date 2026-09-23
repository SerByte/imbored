import { MIN_REVIEWS_TAIL } from './liveness'
import type { CandidateSource, ScoreParts } from './types'

/**
 * Чем карточка лучше соседних — одним словом на плитке и одной фразой у героя.
 *
 * Бейдж источника («Куплена, но не распакована») говорит, ОТКУДА игра, но не
 * говорит, зачем она рядом с остальными четырьмя. Человеку, который не знает,
 * чего хочет, нужен именно второй ответ: пять одинаково «подходящих» карточек
 * — это снова выбор с нуля.
 *
 * Считается из частей скора (ScoreParts) на сервере, а не на клиенте: части
 * наружу не уходят, наружу уходит только вывод. Модуль при этом чистый и без
 * серверных зависимостей — подписи нужны и /play.
 *
 * Правила честности, ради которых здесь тест, а не договорённость:
 *   - у карточки не больше одного преимущества, и каждое — не больше чем у
 *     одной карточки: два «ближе всего к вкусу» на экране — это ни одного;
 *   - превосходная степень только там, где она правда: никакая карточка на
 *     экране не может быть лучше обладательницы бейджа по тому же признаку
 *     (своя наигранная по вкусу не мерится вовсе — её вкус посчитан из неё
 *     же, см. TASTE_RIVALS);
 *   - меньше трёх карточек — сравнивать не с чем, преимуществ нет.
 */

export const PICK_EDGES = ['taste', 'mood', 'underrated'] as const

export type PickEdge = (typeof PICK_EDGES)[number]

/** Подпись на плитке «Ещё варианты» — вместо бейджа источника */
export const EDGE_BADGE: Record<PickEdge, string> = {
  taste: 'Ближе всего к вкусу',
  mood: 'Лучше всего под настроение',
  underrated: 'Недооценённая',
}

/** Одна фраза под причиной у героя: чем он лучше остальных в этой выдаче */
export const EDGE_LINE: Record<PickEdge, string> = {
  taste: 'Из всей подборки она ближе всего к тому, во что ты играешь.',
  mood: 'Из всей подборки она лучше всех попадает в это настроение.',
  underrated: 'Её мало кто знает, но почти все, кто играл, её хвалят.',
}

export type EdgeItem = {
  appid: number
  /** Нет частей — нет и сравнения по вкусу и настроению (карточка собрана руками) */
  parts?: ScoreParts
  /** Откуда карточка: своя наигранная за вкус не соревнуется (TASTE_RIVALS) */
  source?: CandidateSource
  reviewsTotal?: number
  reviewsPercent?: number
}

/** Меньше — сравнивать не с чем: у двух карточек «лучшая» — просто другая */
const MIN_ITEMS = 3

/**
 * На сколько лидер по вкусу обязан обгонять вторую карточку. Пять процентов,
 * а не «хоть на волос»: косинусы соседей в пятёрке часто стоят в сотых друг от
 * друга, и бейдж по сотой доле был бы жребием, а не преимуществом.
 */
const TASTE_LEAD = 1.05

/**
 * Кто вообще соревнуется за «ближе всего к вкусу».
 *
 * Вкус — это профиль, собранный из часов (buildTagProfile), и у своей
 * наигранной игры — «Любимое» (familiar) и «Давно не заходил» (comeback) —
 * taste завышен её же вкладом: Counter-Strike 2 с восемьюстами часами ближе
 * всего к вкусу, потому что вкус из неё и посчитан. Бейдж говорил тавтологию
 * вместо преимущества и заодно снимал с плитки бейдж источника — пометку, что
 * игра своя и знакомая.
 *
 * Поэтому свои наигранные в сравнении по вкусу не участвуют вовсе — ни как
 * лидер, ни как вторая карточка, которую лидер обязан обогнать: мерить новое
 * по зеркалу значило бы снова сравнивать вкус с самим собой. Непройденное
 * (untouched, backlog) и некупленное (new) — ровно то, про что «ближе всего к
 * тому, во что ты играешь» что-то сообщает. Карточка без источника
 * соревнуется, как раньше.
 */
const TASTE_RIVALS: ReadonlySet<CandidateSource> = new Set(['untouched', 'backlog', 'new'])

/*
 * «Недооценённая» — мало отзывов и почти все хвалят. Нижняя граница — хвост
 * каталога (lib/liveness.ts): ниже тридцати отзывов «девяносто процентов» —
 * это два друга разработчика. Верхняя — две тысячи: дальше игру уже знают.
 */
const UNDERRATED_MAX_REVIEWS = 2000
const UNDERRATED_MIN_PERCENT = 90

function isUnderrated(it: EdgeItem): boolean {
  const total = it.reviewsTotal
  const percent = it.reviewsPercent
  if (total === undefined || percent === undefined) return false
  return (
    total >= MIN_REVIEWS_TAIL &&
    total <= UNDERRATED_MAX_REVIEWS &&
    percent >= UNDERRATED_MIN_PERCENT
  )
}

/**
 * Преимущества карточек выдачи: appid → одно преимущество.
 *
 * Порядок раздачи — вкус, настроение, недооценённость: вкус — самое личное и
 * самое редкое, поэтому выбирает первым. Равенство решает порядок в списке,
 * то есть порядок выдачи.
 *
 * `taste: false` — вкуса ещё нет (пустой профиль): тогда parts.taste — это
 * популярность, и «ближе всего к вкусу» было бы неправдой.
 */
export function assignEdges(
  items: readonly EdgeItem[],
  opts: { taste?: boolean } = {},
): Map<number, PickEdge> {
  const edges = new Map<number, PickEdge>()
  if (items.length < MIN_ITEMS) return edges
  const scored = items.filter(
    (it): it is EdgeItem & { parts: ScoreParts } => it.parts !== undefined,
  )

  // Вкус: лидер обязан уйти от второй карточки заметно, а не на сотую
  if (opts.taste !== false) {
    const [first, second] = scored
      .filter((it) => it.source === undefined || TASTE_RIVALS.has(it.source))
      .sort((a, b) => b.parts.taste - a.parts.taste)
    if (
      first &&
      first.parts.taste > 0 &&
      (!second || first.parts.taste >= second.parts.taste * TASTE_LEAD)
    ) {
      edges.set(first.appid, 'taste')
    }
  }

  // Настроение: лучшая из оставшихся, если она вообще лучше нейтрального, ни
  // с кем из оставшихся не делит место и никто на экране её не обгоняет. Без
  // последнего условия бейдж доставался бы второй по настроению карточке, пока
  // первая стоит рядом с бейджем вкуса, — превосходная степень была бы ложью.
  const rest = scored.filter((it) => !edges.has(it.appid))
  if (rest.length) {
    const best = Math.max(...rest.map((it) => it.parts.mood))
    const leaders = rest.filter((it) => it.parts.mood === best)
    const beaten = scored.some((it) => it.parts.mood > best)
    if (best > 1 && leaders.length === 1 && !beaten) edges.set(leaders[0].appid, 'mood')
  }

  // Недооценённая: из подходящих — та, о которой знают меньше всех
  let underrated: EdgeItem | null = null
  for (const it of items) {
    if (edges.has(it.appid) || !isUnderrated(it)) continue
    if (!underrated || (it.reviewsTotal ?? 0) < (underrated.reviewsTotal ?? 0)) underrated = it
  }
  if (underrated) edges.set(underrated.appid, 'underrated')

  return edges
}
