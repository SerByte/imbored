import { hashString } from './daily'
import { isJunk } from './junk'
import { type AnswerValue, STEPS } from './quiz'
import {
  classifyLibraryGame,
  isMultiplayerMeta,
  isUntouched,
  timeFit,
  VIBE_TAGS,
} from './recommend'
import type { GameMeta, LibraryGame } from './types'

/**
 * Какие обложки стоят за каждым ответом квиза.
 *
 * Квиз показывает панели с игровым артом из СВОЕЙ библиотеки. Обложка здесь —
 * фактура, а не обещание: примари размыт в атмосферу, хвосты стопки маленькие
 * и полутоновые, названий нет. Но фактура всё равно должна что-то значить,
 * иначе это просто картинки.
 *
 * Почему не переиспользуется scoreCandidates: она по построению отбирает только
 * 'unplayed' и 'comeback' (см. её тело), то есть игра, в которой человек утонул
 * на триста часов, кандидатом не станет никогда. Для рекомендации это верно —
 * незачем советовать то, во что и так играют, — а для обложки «Весь вечер»
 * ровно наоборот: именно она и есть лучший ответ.
 *
 * Второе отличие: там нужно целое настроение, здесь — одна ось за раз.
 */

type MetaOf = (appid: number) => GameMeta | undefined

/**
 * Обложка створки: header 460×215 и его retina-двойник 920×430.
 *
 * Прежняя формулировка — «только header, hero и 2x здесь не нужны» — была
 * верна ровно до тех пор, пока ответ жил в карточке ~330×300. Створка теперь
 * идёт от потолка до пола, и 460px растягиваются на ней в три с половиной
 * раза. Второй размер стоит одну строку и впервые ВКЛЮЧАЕТ artSrcSet: до сих
 * пор он возвращал undefined, а значит все sizes в квизе были мёртвыми
 * атрибутами.
 *
 * hero (1920×620) по-прежнему НЕ берём, и это не про вес: у него пропорция
 * 3.10:1 против 2.14:1 у header, то есть в вертикальной створке его обрежет
 * СИЛЬНЕЕ, а не слабее. Портретного ассета в проекте нет вовсе.
 */
export type QuizCover = {
  appid: number
  name: string
  headerImage?: string
  art?: { header: string; header2x?: string }
}

/**
 * Стопка панели: [0] — примари (ровно тот же выбор, что давал одиночный
 * алгоритм: он питает фон и шов до /play), дальше до двух хвостов.
 * Инвариант: ключ присутствует ⇒ массив непуст.
 */
export type QuizCovers = Partial<Record<AnswerValue, QuizCover[]>>

/** Сколько обложек несёт одна панель: примари + до двух хвостов. */
const STACK_SIZE = 3

/** Сколько обложек несёт полка бэклога под панелями. С запасом над дюжиной:
 *  клиент вычитает совпадения с текущим шагом (до шести), а киноплёнке для
 *  дрейфа нужен период шире контейнера — десять плиток и больше. */
const SHELF_SIZE = 18

/**
 * Сколько верхних кандидатов участвуют в недельной ротации ПРИМАРИ.
 *
 * Не весь список: иначе под «Весь вечер» мог бы встать трёхчасовой проходняк
 * вместо той самой игры на триста часов. Три — это «набор оживает раз в
 * неделю», а не «набор случайный». Хвосты стопки от окна не зависят: они
 * сканируют список циклически от позиции примари, поэтому набор недели
 * меняется даже при ширине окна, равной размеру стопки.
 */
const ROTATION_WINDOW = 3

/**
 * Сдвиг выборки: свой у каждого игрока и свой на каждой неделе.
 *
 * Тот же приём, что rotationSlot в lib/pool.ts, но посчитанный здесь на общем
 * hashString: pool.ts тянет за собой доступ к базе, а этот модуль обязан
 * оставаться чистым — его зовут и из маршрута, и из тестов.
 *
 * Никакого Math.random: результат обязан совпадать между рендерами, иначе
 * обложки перетасовывались бы сами по себе прямо во время прохождения квиза.
 */
function rotation(seed: string, nowSec: number): number {
  const week = Math.floor(nowSec / (7 * 86_400))
  return hashString(`${seed}:${week}`) % ROTATION_WINDOW
}

/**
 * Насколько игра похожа на ответ. Положительное — подходит, ноль и меньше —
 * не подходит, и тогда лучше пустая панель, чем обложка, спорящая с ответом.
 *
 * Шкалы у осей разные (время ±0.2, вайб и компания ±1) и это нормально:
 * значения сравниваются только внутри одной оси.
 */
export function affinity(meta: GameMeta, value: AnswerValue): number {
  const tags = new Set(Object.keys(meta.tags))
  switch (value) {
    case 'short':
    case 'medium':
    case 'long':
      return timeFit(tags, value)
    case 'chill':
    case 'engaged': {
      const hasAny = (list: string[]) => list.some((t) => tags.has(t))
      const opposite = value === 'chill' ? 'engaged' : 'chill'
      return (hasAny(VIBE_TAGS[value]) ? 1 : 0) - (hasAny(VIBE_TAGS[opposite]) ? 1 : 0)
    }
    case 'solo':
      return isMultiplayerMeta(meta) ? -1 : 1
    case 'friends':
      return isMultiplayerMeta(meta) ? 1 : -1
  }
}

/**
 * Звучит ли игра как этот ответ. Ровно та же граница, по которой отбираются
 * обложки (`score > 0` ниже), — поэтому число в квизе и картинки под ним
 * не могут разойтись в трактовке одного и того же ответа.
 */
export function fitsAnswer(meta: GameMeta, value: AnswerValue): boolean {
  return affinity(meta, value) > 0
}

/**
 * Записи библиотеки, о которых вообще есть что сказать: своя игра Steam, мета
 * приехала, не мусор.
 *
 * Общая часть для обложек и для счётчика. Дальше они расходятся намеренно:
 * обложке нужен арт и годится любая игра (в том числе та, где наиграно триста
 * часов), а счётчику нужен бэклог и арт не нужен вовсе.
 *
 * Гард appid > 0 — записи чужих магазинов лежат под отрицательными id (тот же
 * гард стоит на полке забытого и на портрете).
 */
export function usableLibrary(
  library: LibraryGame[],
  metaOf: MetaOf,
): Array<{ game: LibraryGame; meta: GameMeta }> {
  const out: Array<{ game: LibraryGame; meta: GameMeta }> = []
  for (const game of library) {
    if (game.appid <= 0) continue
    const meta = metaOf(game.appid)
    if (!meta) continue
    if (isJunk(game, meta)) continue
    out.push({ game, meta })
  }
  return out
}

function toCover(game: LibraryGame, meta: GameMeta): QuizCover {
  const header = meta.art?.header
  const header2x = meta.art?.header2x
  return {
    appid: game.appid,
    name: meta.name || game.name,
    ...(meta.headerImage ? { headerImage: meta.headerImage } : {}),
    // 2x кладём только вместе с базовым: artSrcSet строит набор лишь когда
    // размеров больше одного, а одинокий 2x сломал бы порядок деградации
    ...(header ? { art: { header, ...(header2x ? { header2x } : {}) } } : {}),
  }
}

/** Индекс первого подходящего кандидата, начиная со сдвига и по кругу; -1 если нет */
function firstFreeIdx(
  ranked: LibraryGame[],
  start: number,
  ok: (g: LibraryGame) => boolean,
): number {
  for (let i = 0; i < ranked.length; i++) {
    const idx = (start + i) % ranked.length
    if (ok(ranked[idx])) return idx
  }
  return -1
}

export function pickQuizCovers(args: {
  library: LibraryGame[]
  metaOf: MetaOf
  /** steamid — чтобы недельная ротация была своя у каждого; пустая строка для гостя */
  seed: string
  nowSec: number
  /** вход с /library «Разгрести →»: только то, что ни разу не запускали */
  untouchedOnly?: boolean
}): QuizCovers {
  const { library, metaOf, seed, nowSec, untouchedOnly = false } = args

  const candidates = usableLibrary(library, metaOf)
    // Арт обязателен именно здесь: панель без картинки — не панель
    .filter(({ meta }) => Boolean(meta.headerImage || meta.art))
    .filter(({ game }) => !untouchedOnly || isUntouched(game))
    .map(({ game }) => game)

  const rot = rotation(seed, nowSec)

  /*
   * Две фазы, и порядок — гарантия, а не оптимизация.
   *
   * Фаза 1 выбирает СЕМЬ ПРИМАРИ ровно тем алгоритмом, который выбирал
   * одиночные обложки: те же множества дедупа, тот же порядок мутаций.
   * Хвосты стопок добираются только после того, как все примари зафиксированы,
   * поэтому появление стопок не может сдвинуть ни один примари — а на примари
   * держатся фон, шов до /play и вся ротационная история.
   */
  const primary: Partial<Record<AnswerValue, LibraryGame>> = {}
  const primaryIdx: Partial<Record<AnswerValue, number>> = {}
  const rankedByValue = new Map<AnswerValue, LibraryGame[]>()
  const usedAnywhere = new Set<number>()
  const stepPrimaries: Array<Set<number>> = []

  for (const step of STEPS) {
    // Строгий запрет на повтор — в пределах шага: две панели с одной обложкой
    // рядом читаются как поломка. Между шагами повтор допускается, но только
    // если свободных кандидатов не осталось: пустая панель хуже повтора,
    // который человек к тому же увидит через экран.
    const usedInStep = new Set<number>()

    for (const option of step.options) {
      const value = option.value as AnswerValue
      const ranked = candidates
        .map((g) => ({ g, score: affinity(metaOf(g.appid) as GameMeta, value) }))
        .filter((x) => x.score > 0)
        .sort(
          (a, b) =>
            b.score - a.score ||
            // наигранное вперёд: обложка «Весь вечер» — та игра, в которой
            // человек действительно провёл вечера, а не случайная из корзины
            b.g.playtimeForever - a.g.playtimeForever ||
            a.g.appid - b.g.appid,
        )
        .map((x) => x.g)
      rankedByValue.set(value, ranked)

      if (!ranked.length) continue

      const start = rot % Math.min(ROTATION_WINDOW, ranked.length)
      let idx = firstFreeIdx(
        ranked,
        start,
        (g) => !usedAnywhere.has(g.appid) && !usedInStep.has(g.appid),
      )
      if (idx === -1) idx = firstFreeIdx(ranked, start, (g) => !usedInStep.has(g.appid))
      if (idx === -1) continue

      const chosen = ranked[idx]
      primary[value] = chosen
      primaryIdx[value] = idx
      usedAnywhere.add(chosen.appid)
      usedInStep.add(chosen.appid)
    }
    stepPrimaries.push(usedInStep)
  }

  /*
   * Фаза 2: хвосты. Дедуп внутри шага остаётся жёстким для ВСЕХ плиток
   * (шаг «Время» — до девяти различных обложек на экране), между шагами —
   * двумя ярусами: сначала свежая во всём квизе, потом свежая в пределах
   * шага. Нет кандидата — стопка деградирует до двух или одной, а не
   * повторяется: короткая стопка честнее трёх одинаковых.
   *
   * Хвосты сканируют ВЕСЬ ранжированный список циклически от позиции примари,
   * поэтому недельная ротация двигает и набор целиком, а не только лицо.
   */
  const covers: QuizCovers = {}
  const usedEver = new Set(usedAnywhere)

  STEPS.forEach((step, si) => {
    const stepUsed = new Set(stepPrimaries[si])

    for (const option of step.options) {
      const value = option.value as AnswerValue
      const p = primary[value]
      if (!p) continue

      const ranked = rankedByValue.get(value) ?? []
      const tailStart = ((primaryIdx[value] ?? 0) + 1) % ranked.length
      const stack: LibraryGame[] = [p]

      while (stack.length < STACK_SIZE) {
        const freshIdx = firstFreeIdx(
          ranked,
          tailStart,
          (g) => !stepUsed.has(g.appid) && !usedEver.has(g.appid),
        )
        const idx =
          freshIdx !== -1
            ? freshIdx
            : firstFreeIdx(ranked, tailStart, (g) => !stepUsed.has(g.appid))
        if (idx === -1) break
        const next = ranked[idx]
        stack.push(next)
        stepUsed.add(next.appid)
        usedEver.add(next.appid)
      }

      covers[value] = stack.map((g) => toCover(g, metaOf(g.appid) as GameMeta))
    }
  })

  return covers
}

/**
 * Полка бэклога под панелями: «за квизом действительно много игр».
 *
 * В отличие от панелей, полка утверждает именно БЭКЛОГ — то же множество
 * unplayed|comeback, которое считает quizcount: маленькие резкие обложки
 * читаются буквально, и показывать среди них игру с тремя сотнями часов
 * значило бы врать про «неразобранное».
 *
 * exclude — appid всех обложек панелей: панель анонимна размытием, и её же
 * обложка на полке в резкости деанонимировала бы ответ совпадением.
 *
 * Свой недельный сдвиг с собственной солью: полка ротируется независимо от
 * панелей, но так же детерминированно — без Math.random.
 */
export function pickQuizShelf(args: {
  library: LibraryGame[]
  metaOf: MetaOf
  seed: string
  nowSec: number
  untouchedOnly?: boolean
  exclude?: Set<number>
}): QuizCover[] {
  const { library, metaOf, seed, nowSec, untouchedOnly = false, exclude } = args

  const pool = usableLibrary(library, metaOf)
    .filter(({ meta }) => Boolean(meta.headerImage || meta.art))
    .filter(({ game }) => !untouchedOnly || isUntouched(game))
    .filter(({ game }) => {
      const state = classifyLibraryGame(game, nowSec)
      return state === 'unplayed' || state === 'comeback'
    })
    .filter(({ game }) => !exclude?.has(game.appid))
    // ненаигранное вперёд: полка — про то, что ждёт, а не про то, что затянуло
    .sort(
      (a, b) => a.game.playtimeForever - b.game.playtimeForever || a.game.appid - b.game.appid,
    )

  if (!pool.length) return []

  const week = Math.floor(nowSec / (7 * 86_400))
  const off = hashString(`${seed}:shelf:${week}`) % pool.length
  const take = Math.min(SHELF_SIZE, pool.length)

  const out: QuizCover[] = []
  for (let i = 0; i < take; i++) {
    const { game, meta } = pool[(off + i) % pool.length]
    out.push(toCover(game, meta))
  }
  return out
}
