import { discountOf } from './discount'
import { editionKey } from './editions'
import { entryCost } from './entry'
import { isJunk } from './junk'
import type { Lean } from './mood'
import { axisBucket, SEMANTICS_MIN_CONFIDENCE } from './semantics'
import {
  cosine,
  cosineOf,
  weightedCosine,
  weightedCosineTo,
  weightedSide,
  weighsSomething,
  type CosineSide,
  type TagWeight,
} from './tagweight'
import {
  SCORE_FACTORS,
  type CandidateSource,
  type GameMeta,
  type GameSemantics,
  type LibraryGame,
  type Mood,
  type ScoreParts,
  type ScoredCandidate,
} from './types'

/** id категорий Steam, означающих «можно с друзьями» */
const MULTIPLAYER_CATEGORIES = new Set([1, 9, 24, 36, 38, 39, 49])

const UNPLAYED_MAX_MIN = 120
const COMEBACK_AFTER_SEC = 180 * 86_400

/**
 * Экспортируется ради отбора кандидатов: там надо
 * оценить игру по ОДНОЙ оси, а scoreCandidates умеет только целое настроение.
 */
export const VIBE_TAGS: Record<Mood['vibe'], string[]> = {
  chill: ['Casual', 'Relaxing', 'Cozy', 'Wholesome', 'Puzzle', 'Atmospheric', 'Farming Sim'],
  engaged: ['Difficult', 'Competitive', 'Souls-like', 'Tactical', 'Strategy', 'Fast-Paced'],
}

/*
 * Корзины длины сессии.
 *
 * Раньше medium был ПУСТ, то есть самый частый ответ на самый ценный вопрос
 * квиза не двигал ни скор, ни объяснение на карточке. А он же — дефолт четырёх
 * входов: NEUTRAL_MOOD, «Игра дня», прямой заход на /play и половина пресетов.
 * Треть опроса была декорацией.
 *
 * В корзины идут теги, говорящие о ДЛИНЕ, а не о жанре. Поэтому из long убраны
 * 'Adventure' (53% каталога), 'Story Rich' и 'Simulation': тег у половины игр
 * не может ничего разделить — с ними поправка становилась почти равномерной,
 * то есть снова no-op. Замерено на 5723 играх: с ними охват long 81%, без них
 * 62%, и именно во втором случае ответ начинает что-то значить.
 *
 * Покрытие по пулу: short 34%, medium 59%, long 62%. У 7% игр не срабатывает
 * ни одна корзина — про их длину ничего не известно, и это причина не судить,
 * а не судить плохо.
 */
export const TIME_TAGS: Record<Mood['time'], string[]> = {
  short: [
    'Roguelike',
    'Roguelite',
    'Arcade',
    'Card Game',
    'Fast-Paced',
    'Short',
    'Twin Stick Shooter',
    'Bullet Hell',
    'Party Game',
    'Auto Battler',
    'Score Attack',
    'Time Attack',
    'Board Game',
    'Word Game',
    'Runner',
    'Racing',
    'Sports',
    'Rhythm',
    'Deckbuilding',
    'Roguelike Deckbuilder',
    "Shoot 'Em Up",
    'Idler',
    'Chess',
  ],
  medium: [
    'Platformer',
    'Metroidvania',
    'Puzzle Platformer',
    'Precision Platformer',
    'Action-Adventure',
    'Point & Click',
    'Detective',
    'Mystery',
    'Psychological Horror',
    'Stealth',
    'Turn-Based Tactics',
    'Dungeon Crawler',
    'Linear',
    'Walking Simulator',
    'Visual Novel',
    'Interactive Fiction',
    'Choose Your Own Adventure',
    'Hack and Slash',
    'Episodic',
    'Tower Defense',
  ],
  long: [
    'Open World',
    'RPG',
    'JRPG',
    'CRPG',
    'MMORPG',
    'Grand Strategy',
    '4X',
    'Colony Sim',
    'City Builder',
    'Base Building',
    'Automation',
    'Survival',
    'Sandbox',
    'Life Sim',
    'Farming Sim',
    'Crafting',
    'Management',
  ],
}

/*
 * Насколько игра подходит под заявленное время — и матрица намеренно
 * НЕСИММЕТРИЧНА.
 *
 * Аудит просил «сделать симметрично». На данных выяснилось, что честнее иначе:
 * «меньше часа» — это ОГРАНИЧЕНИЕ (стосчасовую RPG за сорок минут физически не
 * начать), а «весь вечер» — ПОЖЕЛАНИЕ (короткую игру никто не мешает включить
 * на весь вечер). Поэтому штраф за «слишком длинную» больше штрафа за
 * «слишком короткую».
 *
 * До этого штрафа не было вовсе — только буст за совпадение, — и игра на сто
 * часов при ответе «меньше часа» не получала ничего.
 */
const TIME_FIT: Record<Mood['time'], Record<Mood['time'], number>> = {
  //          длина игры:  short  medium  long
  short: { short: 0.15, medium: -0.1, long: -0.2 },
  medium: { short: 0, medium: 0.15, long: -0.1 },
  long: { short: -0.1, medium: 0, long: 0.15 },
}

/**
 * Игра может попасть в несколько корзин сразу (Roguelike + Open World).
 * Берём самую выгодную для неё: сомнение толкуем в пользу игры, иначе один
 * случайный тег вычёркивал бы её из выдачи целиком.
 */
export function timeFit(tags: Set<string>, time: Mood['time']): number {
  let best: number | null = null
  for (const [bucket, weight] of Object.entries(TIME_FIT[time]) as Array<
    [Mood['time'], number]
  >) {
    if (!TIME_TAGS[bucket].some((t) => tags.has(t))) continue
    if (best === null || weight > best) best = weight
  }
  return best ?? 0
}

/**
 * Косинус переехал в lib/tagweight.ts вместе с весом редкости; реэкспорт —
 * ради тестов, которые берут его отсюда. Новому коду — weightedCosineTo оттуда
 * же: сырой косинус остался только её частным случаем без карты тегов.
 */
export { cosine }

/**
 * Тег-вектор игры, нормированный к максимуму голосов (0..1).
 *
 * Не-числа пропускаются, а не делятся. Одно NaN здесь — и NaN становится весь
 * профиль вкуса: максимум, косинус, скор каждого кандидата. Базу от этого
 * бережёт parseTagMap в lib/db, но мета приходит и не из базы — демо,
 * заготовки, ответы Steam, — и вектор обязан пережить её мусор сам.
 */
export function normalizedTags(meta: GameMeta): Record<string, number> {
  const votes = Object.entries(meta.tags).filter(
    ([, v]) => typeof v === 'number' && Number.isFinite(v) && v >= 0,
  )
  const max = Math.max(...votes.map(([, v]) => v), 1)
  const out: Record<string, number> = {}
  for (const [tag, v] of votes) out[tag] = v / max
  return out
}

/**
 * Главные теги игры — по числу голосов, n штук. Чипсы карточки выдачи,
 * «Игры дня» и колоды пати: одна мера на все три места, иначе одна и та же
 * игра показывала бы в разных местах разные теги. Нет меты — пусто.
 */
export function topTags(meta: GameMeta | undefined, n = 4): string[] {
  return Object.entries(meta?.tags ?? {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([t]) => t)
}

export function buildTagProfile(
  library: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
): Record<string, number> {
  const profile: Record<string, number> = {}
  for (const g of library) {
    const meta = metaOf(g.appid)
    if (!meta) continue
    let weight = Math.log1p(g.playtimeForever / 60)
    if (weight === 0) continue
    if (g.playtime2Weeks > 0) weight *= 1.5
    for (const [tag, v] of Object.entries(normalizedTags(meta))) {
      profile[tag] = (profile[tag] ?? 0) + weight * v
    }
  }
  return profile
}

/** Только тип: сама база этому модулю не нужна, он чистый */
type FeedbackRow = import('./db').FeedbackRow

/*
 * Шаги фидбека: «зашло» > «запустил» > «открыл карточку». Запуск — сильнее
 * любопытства, но слабее оценки: человек мог запустить и закрыть через минуту.
 */
const LIKE_BOOST = 1.0
const LAUNCH_BOOST = 0.5
const OPEN_BOOST = 0.3
const GENRE_PENALTY = 0.8
const HARD_PENALTY = 1.0
const HARDCORE_TAGS = ['Difficult', 'Souls-like', 'Competitive', 'Tactical', 'Hardcore']

/**
 * Шаг фидбека на большом профиле — эта доля от максимума профиля.
 *
 * Профиль копит часы: у человека с тысячей часов вес любимого тега — десятки,
 * и прежний шаг в единицу был шумом — «зашло» не двигало ничего. Десятая
 * доля от максимума профиля держит шаг соразмерным библиотеке, а пол в
 * единицу оставляет маленькие профили (и тесты) как были.
 */
const FEEDBACK_STEP_SHARE = 0.1

function feedbackStep(profile: Record<string, number>): number {
  let max = 0
  for (const v of Object.values(profile)) if (v > max) max = v
  return Math.max(1, FEEDBACK_STEP_SHARE * max)
}

/**
 * Одна строка на (игру, действие, причину) — самая свежая.
 *
 * Пять нажатий «Зашло» — один сигнал, а не пять: иначе вкус уезжал бы к игре,
 * по которой человек просто кликал, пока грузилась страница. Дедуп в
 * logFeedback держит только сутки, и строки за разные дни здесь тоже
 * схлопываются: для вкуса важно, ЧТО сказано про игру, а не сколько раз.
 *
 * Отдаёт строки ОТ СТАРЫХ К НОВЫМ, а не в порядке входа. Штрафы упираются в
 * ноль, поэтому от порядка шагов зависит результат, а вход — listFeedback —
 * идёт от новых к старым. Применённые по нему, последние слова звучали
 * первыми: «Зашло» неделю назад и «не мой жанр» сегодня давали рогалику 1.0
 * вместо 0.7 — свежий штраф упирался в ноль, а старый лайк потом добавлял
 * своё, и жанр оказывался выше, чем без всякого фидбека. Хронология —
 * это «передумал»: что сказано позже, то и остаётся в силе.
 *
 * Равные createdAt (секундная точность, два нажатия подряд) идут в обратном
 * порядке входа: listFeedback при равном времени сортирует по id вниз, и
 * разворот возвращает им порядок записи. Сортировка стабильная.
 */
function latestPerKind(feedback: FeedbackRow[]): FeedbackRow[] {
  const keyOf = (f: FeedbackRow) => `${f.appid}:${f.action}:${f.reason ?? ''}`
  const newest = new Map<string, FeedbackRow>()
  for (const f of feedback) {
    const cur = newest.get(keyOf(f))
    if (!cur || f.createdAt > cur.createdAt) newest.set(keyOf(f), f)
  }
  return feedback
    .filter((f) => newest.get(keyOf(f)) === f)
    .reverse()
    .sort((a, b) => a.createdAt - b.createdAt)
}

/**
 * Корректирует тег-профиль по истории фидбека: «зашло» усиливает вкус,
 * запуск и открытие карточки — слабее, скип с причиной «не тот жанр»
 * ослабляет, «слишком сложная» бьёт только по хардкорным тегам. «Не сейчас»,
 * «Крутить ещё» и скип без причины — это состояние или случай, а не вкус:
 * профиль не трогают.
 *
 * «Надоела» тоже больше не штрафует вкус. Раньше она била по всем тегам
 * игры тем же штрафом, что и «не тот жанр», — и человек, наигравший в
 * Factorio триста часов, одним нажатием терял вкус к Automation. Надоела
 * игра, а не жанр: это пауза на месяц (cooldownOf), а не приговор тегам.
 *
 * Шаги идут в порядке времени (latestPerKind), от какого бы порядка ни пришёл
 * вход: сменивший мнение об игре должен получить последнее мнение, а не первое.
 */
export function applyFeedbackToProfile(
  profile: Record<string, number>,
  feedback: FeedbackRow[],
  metaOf: (appid: number) => GameMeta | undefined,
): Record<string, number> {
  const out = { ...profile }
  const step = feedbackStep(profile)
  for (const f of latestPerKind(feedback)) {
    const meta = metaOf(f.appid)
    if (!meta) continue
    const norm = normalizedTags(meta)

    if (f.action === 'liked' || f.action === 'launched' || f.action === 'opened') {
      const boost =
        step * (f.action === 'liked' ? LIKE_BOOST : f.action === 'launched' ? LAUNCH_BOOST : OPEN_BOOST)
      for (const [tag, v] of Object.entries(norm)) out[tag] = (out[tag] ?? 0) + boost * v
    } else if (f.action === 'skipped' && f.reason === 'genre') {
      for (const [tag, v] of Object.entries(norm)) {
        out[tag] = Math.max((out[tag] ?? 0) - step * GENRE_PENALTY * v, 0)
      }
    } else if (f.action === 'skipped' && f.reason === 'hard') {
      for (const tag of HARDCORE_TAGS) {
        if (tag in norm) out[tag] = Math.max((out[tag] ?? 0) - step * HARD_PENALTY * norm[tag], 0)
      }
    }
  }
  return out
}

/*
 * Паузы после скипа.
 *
 * До них «Просто не сейчас» не значило ничего: вкус оно намеренно не трогает,
 * а исключения из кандидатов не было — и отложенная игра возвращалась на
 * следующей же перезагрузке, как будто человека не услышали.
 *
 *   notnow — скрыта трое суток, потом до двух недель чуть выше обычного (×1.1)
 *            с пометкой «Откладывал N дней назад»: отложил — значит, хотел
 *            вернуться, и напомнить об этом честнее, чем забыть;
 *   skip   — скип без причины, «не тот жанр», «слишком сложная»: сутки. Не
 *            трое: скип без причины — самое частое нажатие, и длинная пауза
 *            выжгла бы кандидатов маленькой библиотеки за вечер;
 *   tired  — «надоела»: месяц с линейным возвратом, от нуля до единицы.
 *            Надоедает на время, а не навсегда — для навсегда есть бан.
 *
 * «Крутить ещё» (spin) паузы не даёт: это бросок кубика, а не ответ про игру.
 */
const HOUR = 3600
const NOTNOW_HIDE_SEC = 72 * HOUR
const NOTNOW_MARK_SEC = 14 * 86_400
const NOTNOW_RETURN_MULT = 1.1
const SKIP_HIDE_SEC = 24 * HOUR
const TIRED_SEC = 30 * 86_400
/** С каким множителем отложенная своя возвращается, когда без неё не набрать выдачу */
const RESTORED_MULT = 0.5

export type CooldownKind = 'skip' | 'notnow' | 'tired'

/** mult — множитель скора; 0 — игра скрыта. at — когда был скип (unix-секунды). */
export type Cooldown = { mult: number; kind: CooldownKind; at: number }

function cooldownMult(kind: CooldownKind, elapsed: number): number | null {
  if (kind === 'notnow') {
    if (elapsed < NOTNOW_HIDE_SEC) return 0
    return elapsed < NOTNOW_MARK_SEC ? NOTNOW_RETURN_MULT : null
  }
  if (kind === 'skip') return elapsed < SKIP_HIDE_SEC ? 0 : null
  return elapsed < TIRED_SEC ? elapsed / TIRED_SEC : null
}

/**
 * Паузы по истории фидбека: appid → пауза. Игры без паузы в карте нет.
 *
 * Решает самый свежий скип игры: сказанное позже заменяет сказанное раньше.
 * «Зашло», запуск или открытие карточки ПОСЛЕ скипа снимают паузу — человек
 * передумал сам, и прятать от него игру дальше было бы упрямством.
 *
 * only — какие паузы вообще учитывать. «Игре дня» нужна только «надоела»:
 * пропуск на /play посреди дня иначе сменил бы игру, выбранную на сутки.
 */
export function cooldownOf(
  feedback: readonly FeedbackRow[],
  nowSec: number,
  only?: readonly CooldownKind[],
): Map<number, Cooldown> {
  const lastSkip = new Map<number, FeedbackRow>()
  const lastWarm = new Map<number, number>()
  for (const f of feedback) {
    if (f.action === 'skipped') {
      if (f.reason === 'spin') continue
      const cur = lastSkip.get(f.appid)
      // Равное время — первая по входу: listFeedback отдаёт свежие первыми
      if (!cur || f.createdAt > cur.createdAt) lastSkip.set(f.appid, f)
    } else if (f.action === 'liked' || f.action === 'launched' || f.action === 'opened') {
      lastWarm.set(f.appid, Math.max(lastWarm.get(f.appid) ?? -Infinity, f.createdAt))
    }
  }

  const out = new Map<number, Cooldown>()
  for (const [appid, f] of lastSkip) {
    if ((lastWarm.get(appid) ?? -Infinity) > f.createdAt) continue
    const kind: CooldownKind = f.reason === 'notnow' ? 'notnow' : f.reason === 'tired' ? 'tired' : 'skip'
    if (only && !only.includes(kind)) continue
    // Скип «из будущего» (часы разъехались) — считаем, что он только что
    const mult = cooldownMult(kind, Math.max(0, nowSec - f.createdAt))
    if (mult !== null) out.set(appid, { mult, kind, at: f.createdAt })
  }
  return out
}

/**
 * Пометка «Откладывал N дней назад» — только у «не сейчас»: у прочих пауз
 * напоминать не о чем, человек не обещал вернуться.
 */
export function deferredOf(
  cd: Cooldown | undefined,
  nowSec: number,
): { daysAgo: number } | null {
  if (!cd || cd.kind !== 'notnow') return null
  return { daysAgo: Math.floor(Math.max(0, nowSec - cd.at) / 86_400) }
}

/**
 * Разделяет выдачу на «своё» и «нет в библиотеке». Пользователь просил не
 * смешивать: основной ответ на «во что поиграть» — это игры, за которые уже
 * заплачено, а покупки идут отдельной секцией и по своей воле.
 */
export function splitBySource<T extends { source: CandidateSource }>(
  candidates: T[],
): { own: T[]; discovery: T[] } {
  const own: T[] = []
  const discovery: T[] = []
  for (const c of candidates) (c.source === 'new' ? discovery : own).push(c)
  return { own, discovery }
}

/** Явно запрошенный режим выдачи — не настроение, а «покажи только вот это» */
export type Focus = 'untouched'

export function parseFocus(raw: unknown): Focus | null {
  return raw === 'untouched' ? 'untouched' : null
}

/**
 * «Как «X», но…» — appid игры, на соседей которой сужается выдача. Любое
 * ненулевое целое: у записей чужих магазинов appid отрицательные, и соседи
 * по тегу у них есть. Мусор — «без затравки», а не 400: у каждого кода
 * отказа на /play свой экран, а кривое поле его не стоит. Выдача эхом
 * говорит, применилась ли затравка (seed в ответе).
 */
export function parseSeed(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw !== 0 ? raw : null
}

/**
 * Откуда вообще берутся главные карточки: только из своей библиотеки или из
 * всего каталога.
 *
 * Ось отдельная от Focus, потому что вопрос другой. Focus сужает СВОЁ («покажи
 * только нераспакованное»), scope решает, участвует ли в главной выдаче то,
 * чего у человека нет. По умолчанию 'all': на «во что поиграть» честный ответ
 * не обязан ограничиваться уже оплаченным — но и не должен превращаться в
 * витрину, поэтому у покупок есть потолок (MAX_NEW_PICKS) и весь блок
 * гасится, когда включён Focus.
 */
export type Scope = 'library' | 'all'

export function parseScope(raw: unknown): Scope {
  return raw === 'library' ? 'library' : 'all'
}

/** Карточек в главной выдаче */
export const PICK_COUNT = 5

/**
 * Сколько из них максимум может быть не куплено.
 *
 * Двойка — не про баланс жанров, а про то, за чем человек пришёл: ответ на
 * «во что поиграть сейчас» должен оставаться играбельным сегодня же, без
 * похода в магазин. Потолок поднимается сам, когда играбельного просто мало:
 * у человека с тремя играми в библиотеке пять карточек иначе не набрать.
 */
export const MAX_NEW_PICKS = 2

/**
 * Общий пул для главной выдачи: своё плюс дозированное «нет в библиотеке».
 *
 * Ограничение стоит ЗДЕСЬ, на входе в подбор, а не на выходе: и Claude, и
 * эвристика возвращают карточки вместе с объяснением, привязанным к конкретной
 * игре, и подменять лишнюю покупку после выбора было бы нечем — объяснение
 * пришлось бы выдумывать заново.
 */
export function mixHeroPool<T extends { score: number }>(
  own: T[],
  discovery: T[],
  opts: { maxNew?: number; picks?: number } = {},
): T[] {
  const { maxNew = MAX_NEW_PICKS, picks = PICK_COUNT } = opts
  const allowed = Math.max(maxNew, picks - own.length)
  return [...own, ...discovery.slice(0, allowed)].sort((a, b) => b.score - a.score)
}

/** Ниже этого числа режим «только запечатанное» превращается в тупик */
const FOCUS_FLOOR = 3

/**
 * «Покажи только то, во что я не играл». Жёсткий фильтр, но с полом.
 *
 * У игрока может не найтись трёх запечатанных игр с метаданными, а пустой экран
 * — худший из возможных ответов на «во что поиграть». Тогда добираем бэклогом
 * («открыл и закрыл»), и только потом сдаёмся и отдаём всё. Тот же приём, что в
 * filterActual и filterPlayable: фильтр, который всё выкинул, — не фильтр.
 *
 * Порядок сохраняется: вход уже отранжирован.
 */
export function applyFocus<T extends { source: CandidateSource }>(
  candidates: T[],
  focus: Focus | null,
): T[] {
  if (focus !== 'untouched') return candidates
  const untouched = candidates.filter((c) => c.source === 'untouched')
  if (untouched.length >= FOCUS_FLOOR) return untouched
  const widened = [...untouched, ...candidates.filter((c) => c.source === 'backlog')]
  return widened.length ? widened : candidates
}

/**
 * Не больше max кандидатов одного источника; порядок сохраняется, лишние —
 * хвост этого источника — выпадают.
 *
 * Нужен знакомому: у человека с сотней наигранных песочниц оно заняло бы всю
 * пятёрку, и сервис превратился бы в «играй в то же, что всегда».
 */
export function capSource<T extends { source: CandidateSource }>(
  list: T[],
  source: CandidateSource,
  max: number,
): T[] {
  let seen = 0
  return list.filter((c) => c.source !== source || ++seen <= max)
}

export type MatchExplanation = {
  matchPercent: number | null
  sharedTags: string[]
  moodTags: string[]
  /**
   * Настроение словами из уверенной семантики (moodWordsOf): «спокойная,
   * короткие сессии». Пусто — семантики нет, и /play называет теги вайба.
   */
  moodWords: string[]
}

/** Сколько совпавших тегов вообще имеет смысл называть. */
const SHARED_TAGS = 3

/**
 * Теги игры, которые уже есть во вкусе игрока, — по убыванию вклада в
 * совпадение.
 *
 * Отдельной функцией, а не строкой внутри explainMatch, потому что спрашивают
 * об этом ДВА экрана, и оба показывают ответ человеку. Выдача берёт список
 * через explainMatch (там же процент и вайб), «Игре дня» нужны только теги:
 * настроения у неё нет вообще — игра одна на сутки и ни под какой вайб не
 * подбиралась. Дублировать эти четыре строки во второй роут значило бы
 * завести второй источник правды ровно для того, что на обоих экранах
 * подсвечивается одинаково.
 */
export function sharedTasteTags(
  profile: Record<string, number>,
  meta: GameMeta,
  /**
   * Вес редкости (lib/tagweight.ts). Без него порядок прежний — по сырому
   * вкладу, и тогда наверх почти всегда выходят Indie и Action: они есть в
   * каждой второй игре, поэтому в профиле весят больше всего. С весом вклад
   * считается так же, как во взвешенном косинусе, — (профиль·вес)·(игра·вес),
   * и называется то, что человека отличает: «Automation», а не «Indie».
   */
  tagWeight: TagWeight | null = null,
): string[] {
  const norm = normalizedTags(meta)
  return Object.entries(norm)
    .filter(([tag]) => (profile[tag] ?? 0) > 0)
    .map(([tag, v]) => {
      const raw = (profile[tag] ?? 0) * v
      return { tag, raw, weighted: tagWeight ? raw * tagWeight(tag) ** 2 : raw }
    })
    // Равный взвешенный вклад (например, у двух тегов, которых нет в карте
    // редкости) решает сырой: иначе порядок зависел бы от порядка ключей
    .sort((a, b) => b.weighted - a.weighted || b.raw - a.raw)
    .slice(0, SHARED_TAGS)
    .map((x) => x.tag)
}

/** Прозрачность выдачи: из чего сложился скоринг этой игры */
export function explainMatch(
  profile: Record<string, number>,
  meta: GameMeta,
  mood: Mood,
  tagWeight: TagWeight | null = null,
): MatchExplanation {
  const profileEmpty = Object.keys(profile).length === 0
  const norm = normalizedTags(meta)
  // Процент — тем же взвешенным косинусом, что и порядок выдачи: число,
  // расходящееся с настоящим порядком, объясняло бы чужую выдачу
  const matchPercent = profileEmpty ? null : Math.round(weightedCosine(profile, norm, tagWeight) * 100)

  const sharedTags = sharedTasteTags(profile, meta, tagWeight)

  const moodWanted = new Set([...VIBE_TAGS[mood.vibe], ...TIME_TAGS[mood.time]])
  const moodTags = Object.keys(meta.tags)
    .filter((t) => moodWanted.has(t))
    .slice(0, 3)

  return { matchPercent, sharedTags, moodTags, moodWords: moodWordsOf(meta, mood) }
}

export type LibraryGameState = 'unplayed' | 'comeback' | 'active' | 'played'

/**
 * «Так и не запущена»: меньше двух часов и без активности за две недели.
 * Единое определение для /library и портрета — раньше они расходились и
 * показывали разные числа для одного и того же игрока.
 */
export function isUnplayed(g: LibraryGame): boolean {
  return g.playtimeForever < UNPLAYED_MAX_MIN && g.playtime2Weeks === 0
}

/**
 * «Ни разу не запускал»: строже, чем isUnplayed — не «меньше двух часов»,
 * а ноль минут. Игра, которую даже не скачивали.
 *
 * Строгое подмножество isUnplayed, и это инвариант, а не совпадение. Счётчики
 * бэклога, цена в долларах и «Чистилище» на портрете считают ВЕСЬ бэклог и
 * остаются на isUnplayed — разойтись этим определениям нельзя, см. докблок
 * выше: они уже расходились однажды и показывали разные числа одному игроку.
 *
 * Проверка playtime2Weeks избыточна арифметически (ноль за всё время не может
 * быть меньше нуля за две недели), но повторяет форму isUnplayed и страхует от
 * битой записи Steam, где эти два поля противоречат друг другу.
 */
export function isUntouched(g: LibraryGame): boolean {
  return g.playtimeForever === 0 && g.playtime2Weeks === 0
}

export function classifyLibraryGame(g: LibraryGame, nowSec: number): LibraryGameState {
  if (g.playtime2Weeks > 0) return 'active'
  if (g.playtimeForever < UNPLAYED_MAX_MIN) return 'unplayed'
  // Steam отдаёт rtime_last_played только владельцу ключа; без даты считаем
  // наигранную, но не тронутую 2 недели игру кандидатом на возвращение.
  // Сравнение с undefined, а не truthy: lastPlayed = 0 теперь доезжает из
  // Steam и должен идти по общей ветке (now - 0 всегда больше порога, то есть
  // результат тот же 'comeback' — правка нейтральна по поведению).
  if (g.lastPlayed === undefined) return 'comeback'
  if (nowSec - g.lastPlayed > COMEBACK_AFTER_SEC) return 'comeback'
  return 'played'
}

/**
 * Состояние для подписи плитки: то же самое, но с отделённым «запечатано».
 *
 * Отдельная функция, а не пятый член LibraryGameState: добавление 'untouched'
 * в тот union молча сломало бы четыре места, ни одно из которых не является
 * ошибкой типов — lib/stats.ts (`!== 'unplayed'`) перестал бы считать нулевые
 * игры и цена бэклога просела бы, а wrapped и portrait считают через
 * isUnplayed и продолжили бы показывать старое число.
 */
export type LibraryTileState = 'untouched' | LibraryGameState

export function libraryTileState(g: LibraryGame, nowSec: number): LibraryTileState {
  const state = classifyLibraryGame(g, nowSec)
  return state === 'unplayed' && isUntouched(g) ? 'untouched' : state
}

/**
 * Сколько нераспакованного должно лежать в библиотеке, чтобы срок распродажи
 * пропал с экрана.
 *
 * Тридцать игр, которые ни разу не запускались, — это год вечеров без единой
 * покупки. «Скидка кончится через два дня» такому человеку говорит «купи ещё
 * одну, которую тоже не распакуешь», и продукт, обещавший разгрести выбор, сам
 * подкидывал бы в него. Цена и процент остаются — это факт; уходит только
 * обратный отсчёт, то есть давление.
 */
export const URGENCY_UNTOUCHED_MAX = 30

/**
 * Прятать ли срок распродажи (discountView {urgency}, heuristicPicks
 * hideUrgency). Считается нераспакованное без мусора: саундтреки и демо с
 * нулём минут в бэклог не входят — их и не собирались «проходить».
 */
export function hideUrgencyFor(
  library: readonly LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
): boolean {
  let untouched = 0
  for (const g of library) {
    if (!isUntouched(g) || isJunk(g, metaOf(g.appid))) continue
    if (++untouched > URGENCY_UNTOUCHED_MAX) return true
  }
  return false
}

/*
 * Знакомое любимое — источник 'familiar'.
 *
 * Выбор между незнакомыми играми — самый дорогой: каждую надо осваивать. У
 * игры с десятками своих часов этот порог нулевой — управление в руках,
 * правила в голове. Раньше такие игры в кандидаты не попадали вовсе: 'played'
 * и 'active' выпадали из scoreCandidates, и на «нет сил разбираться» продукт
 * отвечал только новым.
 *
 *   — не меньше десяти часов: знакомой игру делают не два вечера;
 *   — только без финала (isReplayable);
 *   — пауза не меньше месяца: то, во что играл на прошлой неделе, человек и
 *     без нас помнит, совет «поиграй в него» ничего не добавляет;
 *   — насыщение: вес растёт с паузой и доходит до единицы за два месяца.
 *     Через полгода игра уже 'comeback' — там свой разговор.
 *
 * relaxed — когда человек сам попросил знакомого (lean 'familiar'). Тогда
 * шлюзы жанра и паузы снимаются, и в знакомое пускается даже то, во что он
 * играет сейчас: «хочу то, что знаю» — прямой ответ на вопрос, а не наш
 * догадливый совет. Десять часов остаются — меньше это ещё не знакомая игра.
 * Насыщение не обнуляет вес, а держит пол в 0.5.
 */
const FAMILIAR_MIN_MIN = 600
const FAMILIAR_PAUSE_SEC = 30 * 86_400
const FAMILIAR_FULL_SEC = 60 * 86_400
const FAMILIAR_RELAXED_FLOOR = 0.5

/** Вес знакомой игры (0.5…1) или null — знакомым её не считаем. */
export function familiarWeight(
  g: LibraryGame,
  meta: GameMeta,
  state: LibraryGameState,
  nowSec: number,
  opts: { relaxed?: boolean } = {},
): number | null {
  if (g.playtimeForever < FAMILIAR_MIN_MIN) return null
  if (opts.relaxed) {
    if (state !== 'played' && state !== 'active') return null
    const paused = g.lastPlayed ? Math.max(0, nowSec - g.lastPlayed) : 0
    return Math.max(FAMILIAR_RELAXED_FLOOR, Math.min(1, paused / FAMILIAR_FULL_SEC))
  }
  if (state !== 'played') return null
  if (!isReplayable(meta)) return null
  // У 'played' lastPlayed есть всегда: без даты classifyLibraryGame даёт 'comeback'
  const paused = nowSec - (g.lastPlayed ?? nowSec)
  if (paused < FAMILIAR_PAUSE_SEC) return null
  return Math.min(1, paused / FAMILIAR_FULL_SEC)
}

/**
 * «Продолжить «X»» — то, во что человек играет сейчас.
 *
 * Активная игра (playtime2Weeks > 0) в кандидаты не попадает, и правильно:
 * совет «поиграй в то, что ты запускал вчера» ничего не добавляет. Но вечер,
 * когда выбирать не хочется, чаще всего кончается ровно ею, и молчать о ней —
 * делать вид, что её нет. Поэтому не карточкой в пятёрке, где она спорила бы
 * с рекомендацией, а отдельной строкой под героем: один тап, без спора.
 *
 * Самая наигранная за две недели. Мимо — мусор (саундтрек тоже «наигрывается»,
 * пока играет фоном), игры без меты, exclude (баны и паузы) и skip — то, что
 * уже лежит в выдаче: lean 'familiar' пускает активное в пятёрку, и одна игра
 * дважды на экране выглядела бы сбоем. При равных минутах — первая по списку.
 */
export function pickContinue(
  library: readonly LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  exclude: ReadonlySet<number>,
  skip: ReadonlySet<number>,
): LibraryGame | null {
  let best: LibraryGame | null = null
  for (const g of library) {
    if (g.playtime2Weeks <= 0) continue
    if (best && g.playtime2Weeks <= best.playtime2Weeks) continue
    if (exclude.has(g.appid) || skip.has(g.appid)) continue
    const meta = metaOf(g.appid)
    if (!meta || isJunk(g, meta)) continue
    best = g
  }
  return best
}

/** Что уходит на клиент для строки «Продолжить»: часы за две недели, а не минуты */
export type ContinueGame = { appid: number; name: string; recentHours: number }

export function continueView(g: LibraryGame): ContinueGame {
  return { appid: g.appid, name: g.name, recentHours: Math.round(g.playtime2Weeks / 60) }
}

/**
 * Порядок по вкусу: косинус между тег-профилем и тегами игры.
 *
 * Игры без метаданных уезжают в конец, а не выбрасываются: мета приезжает
 * прогревом, и у части библиотеки её может не быть вовсе. Сортировка
 * стабильная, поэтому при равном вкусе порядок не скачет между запросами.
 *
 * tagWeight — та же мера, что у подбора (weightedCosineTo): с картой тегов
 * совпадение по Automation весит больше совпадения по Indie. Без неё полка
 * «Не распакованы» на /library и «начни с этой» на портрете ранжировали по
 * частотным тегам, а /play — по редкости, и одна и та же пара «человек — игра»
 * стояла на двух экранах в разном порядке. null — сырой косинус, до бита
 * прежний.
 */
export function rankByTaste(
  games: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  profile: Record<string, number>,
  tagWeight: TagWeight | null = null,
): LibraryGame[] {
  // Сторона профиля готовится один раз, а не на каждую игру
  const tasteOf = weightedCosineTo(profile, tagWeight)
  return games
    .map((g) => {
      const meta = metaOf(g.appid)
      return { g, score: meta ? tasteOf(normalizedTags(meta)) : -1 }
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.g)
}

/**
 * Своя игра, на которую кандидат похож сильнее всего: «ближе всего к «X», где
 * у тебя N ч».
 *
 * Теги — это язык каталога, а человек помнит игры. «По тегам (Automation) это
 * твоё» он должен перевести в опыт сам; «ближе всего к Factorio, где у тебя
 * 300 ч» — уже его опыт. Путь Claude частично делал это словами, но кого
 * модель назовёт, было неизвестно, а у эвристики не было и этого.
 */
export type OwnAnchor = { appid: number; name: string; hours: number }

/**
 * Не ниже этого сходства. Замерено на демо-библиотеке (22 игры, карты тегов
 * нет — сырой косинус): при 0.5 якорь находится у 5 из 23 кандидатов, и все
 * пары осмысленные — Satisfactory → Factorio, Balatro → Slay the Spire,
 * Sekiro → Elden Ring. Сразу под порогом начинается натяжка: Lethal Company →
 * Portal 2 (0.43), Baldur's Gate 3 → Portal 2 (0.35). Лучше промолчать, чем
 * назвать чужую игру «твоей».
 */
export const ANCHOR_MIN_SIM = 0.5

function medianOf(sorted: number[]): number {
  if (!sorted.length) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Строит поиск якоря один раз на запрос: вектора своих игр взвешиваются здесь,
 * а спрашивают потом для пяти карточек, полки находок и строк промпта.
 *
 * Якорем может быть только игра, в которую человек действительно играл:
 *   — не меньше двух часов (меньше — это проба, см. isUnplayed);
 *   — не ниже медианы по сыгранным играм его же библиотеки: у того, кто
 *     наигрывает по сотне часов, игра на три часа — брошенная, а не любимая;
 *   — не бан и не мусор (саундтрек с часами «ближе всего» ни к чему);
 *   — не сам кандидат и не его издание (editionKey): «ближе всего к Skyrim» у
 *     Skyrim Special Edition — тавтология, а не объяснение.
 *
 * Сходство — взвешенный косинус (lib/tagweight.ts). Без веса редкости якорем
 * становилась бы «любая инди»: частотный костяк похож у всех. Карты тегов нет —
 * работает сырой косинус с тем же порогом.
 */
export function buildAnchorFinder(
  library: LibraryGame[],
  metaOf: (appid: number) => GameMeta | undefined,
  tagWeight: TagWeight | null,
  exclude?: ReadonlySet<number>,
): (meta: GameMeta) => OwnAnchor | null {
  const median = medianOf(
    library
      .map((g) => g.playtimeForever)
      .filter((m) => m > 0)
      .sort((a, b) => a - b),
  )

  // Сторона якоря — взвешенный вектор с готовой длиной. Раньше у якоря было
  // замыкание simTo, и кандидат взвешивался заново внутри него — для КАЖДОГО
  // якоря; теперь он взвешивается один раз на вызов (ниже).
  const anchors: Array<OwnAnchor & { key: string; side: CosineSide }> = []
  for (const g of library) {
    if (g.playtimeForever < UNPLAYED_MAX_MIN || g.playtimeForever < median) continue
    if (exclude?.has(g.appid)) continue
    const meta = metaOf(g.appid)
    if (!meta || isJunk(g, meta)) continue
    const tags = normalizedTags(meta)
    // Игра из одних частотных тегов с весом сказать ничего не может: её
    // сходство откатилось бы к сырому косинусу — другой шкале — и обходило
    // якоря с настоящим совпадением
    if (!weighsSomething(tags, tagWeight)) continue
    anchors.push({
      appid: g.appid,
      name: g.name,
      hours: Math.round(g.playtimeForever / 60),
      key: editionKey(g.name),
      // weighsSomething выше гарантирует, что weightedCosineTo не откатился бы
      // на сырой косинус, — значит, готовая взвешенная сторона даёт то же самое
      side: weightedSide(tags, tagWeight),
    })
  }

  // Одну и ту же игру спрашивают дважды: для строки промпта и для карточки
  const memo = new Map<number, OwnAnchor | null>()
  return (meta) => {
    const cached = memo.get(meta.appid)
    if (cached !== undefined) return cached
    const key = editionKey(meta.name)
    const side = weightedSide(normalizedTags(meta), tagWeight)
    let best: OwnAnchor | null = null
    let bestSim = 0
    for (const a of anchors) {
      if (a.appid === meta.appid || (key && a.key === key)) continue
      const sim = cosineOf(a.side, side)
      // Не «sim < порога»: NaN (битые теги в базе) это сравнение проходит, и
      // первая же такая игра становилась якорем для любого кандидата
      if (!(sim >= ANCHOR_MIN_SIM)) continue
      // При равном сходстве — та, где больше часов: её человек помнит лучше
      if (!best || sim > bestSim || (sim === bestSim && a.hours > best.hours)) {
        best = { appid: a.appid, name: a.name, hours: a.hours }
        bestSim = sim
      }
    }
    memo.set(meta.appid, best)
    return best
  }
}

/**
 * tagBoost — прибавка за теги сверх вайба и времени («Про историю»,
 * lib/nudge.ts). Берётся самая большая из совпавших, а не сумма: Story Rich и
 * Narrative говорят об одном, и два тега не должны весить вдвое.
 */
function moodMultiplier(
  meta: GameMeta,
  mood: Mood,
  tagBoost: Readonly<Record<string, number>> | null = null,
): number {
  const tags = new Set(Object.keys(meta.tags))
  const hasAny = (list: string[]) => list.some((t) => tags.has(t))
  let mult = 1
  if (hasAny(VIBE_TAGS[mood.vibe])) mult += 0.25
  const oppositeVibe = mood.vibe === 'chill' ? 'engaged' : 'chill'
  if (hasAny(VIBE_TAGS[oppositeVibe])) mult -= 0.25
  mult += timeFit(tags, mood.time)
  if (tagBoost) {
    let boost = 0
    for (const [tag, b] of Object.entries(tagBoost)) if (tags.has(tag) && b > boost) boost = b
    mult += boost
  }
  return Math.max(mult, 0.1)
}

/*
 * НАСТРОЕНИЕ ПО ОСЯМ, А НЕ ТОЛЬКО ПО СПИСКАМ ТЕГОВ.
 *
 * moodMultiplier видит только, ЕСТЬ ли у игры тег из списка. Relaxing у
 * Stardew Valley и Relaxing у игры, где его поставили за саундтрек, для него
 * одно и то же, а игра без единого тега из VIBE_TAGS для него просто никакая.
 * Семантика (lib/semantics) знает больше: насколько игра сложная, сколько в
 * ней осваивать, какой темп и сколько минут уходит на заход, — и по отзывам,
 * а не только по тегам.
 *
 * Поэтому оси не заменяют теговую оценку, а смешиваются с ней пополам:
 *
 *   настроение = 0.5 · теговое + 0.5 · (0.6 + 0.8 · fit),  fit ∈ 0..1
 *
 * Правая половина живёт в 0.6…1.4, левая — в 0.55…1.40, так что смесь не
 * выходит за прежний разброс настроения, на котором откалиброван наклон
 * нетронутого (SOURCE_WEIGHT 1.25). Частью скора это становится отдельной —
 * semantics — как поправка к теговой: во сколько раз оси меняют то, что
 * сказали теги. mood × semantics и есть смесь. Так часть mood остаётся ровно
 * прежней, а игра без семантики получает semantics = 1 и скор до бита старый.
 *
 * Верим семантике только с SEMANTICS_MIN_CONFIDENCE, то есть когда оси уточнили
 * отзывы: приор по тегам подбор и так слышит через сами теги.
 */

/** На столько пунктов оси (0..100) от цели — совпадение по ней ноль */
const AXIS_SPAN = 50

/**
 * Цели осей под вайб. chill — спокойная (сложность 25), без долгого освоения
 * (35), не быстрая (темп не выше 50: медленное chill не мешает). engaged —
 * с вызовом (70) и с глубиной (65); темп ему безразличен — тактика бывает и
 * пошаговой.
 */
const VIBE_AXES: Record<Mood['vibe'], Array<{ axis: keyof GameSemantics['axes']; target: number; atMost?: boolean }>> = {
  chill: [
    { axis: 'challenge', target: 25 },
    { axis: 'complexity', target: 35 },
    { axis: 'pace', target: 50, atMost: true },
  ],
  engaged: [
    { axis: 'challenge', target: 70 },
    { axis: 'complexity', target: 65 },
  ],
}

/** Желаемые минуты захода под ответ «сколько времени» */
const SESSION_TARGET_MIN: Record<Mood['time'], number> = { short: 20, medium: 90, long: 180 }

/*
 * Та же асимметрия, что у TIME_FIT: «меньше часа» — ограничение, «весь вечер»
 * — пожелание. Расстояние считается в разах (log2), и заход вчетверо длиннее
 * желаемого обнуляет совпадение, а короче — только в тридцать два раза.
 * Короче короткого и длиннее длинного не бывает плохо вовсе.
 */
const SESSION_LONGER_SPAN = 2
const SESSION_SHORTER_SPAN = 5

function sessionFit(minutes: number, time: Mood['time']): number {
  const d = Math.log2(Math.max(1, minutes) / SESSION_TARGET_MIN[time])
  if (d > 0) return time === 'long' ? 1 : Math.max(0, 1 - d / SESSION_LONGER_SPAN)
  if (d < 0) return time === 'short' ? 1 : Math.max(0, 1 + d / SESSION_SHORTER_SPAN)
  return 1
}

/**
 * Насколько игра попадает в настроение по осям семантики: 0..1. Половина —
 * вайб (среднее по осям его цели), половина — длина захода.
 */
export function moodFitAxes(s: GameSemantics, mood: Mood): number {
  const goals = VIBE_AXES[mood.vibe]
  let vibe = 0
  for (const { axis, target, atMost } of goals) {
    const x = s.axes[axis]
    const off = atMost ? Math.max(0, x - target) : Math.abs(x - target)
    vibe += Math.max(0, 1 - off / AXIS_SPAN)
  }
  return (vibe / goals.length + sessionFit(s.session.minutes, mood.time)) / 2
}

/*
 * Короткий вечер. «Меньше часа» — ограничение, и игра, заход в которую
 * дольше часа, в него физически не влезает: ×0.5. Штраф, а не фильтр, и с
 * полом по образцу applyFocus: если своих, которые в час влезают, меньше
 * FOCUS_FLOOR, штраф ослабляется до ×0.75 (scoreCandidates) — фильтр,
 * выкинувший всё, не фильтр, а у человека из одних длинных игр выдача иначе
 * целиком уехала бы в каталог.
 *
 * Игра, которую можно бросить в любой момент (пошаговое, новелла, головоломка),
 * при «меньше часа» и «расслабиться» получает ×1.1: это ровно вечер «полчаса
 * перед сном» — сыграл сколько успел, и ничего не потерял.
 */
const SHORT_EVENING_MAX_MIN = 60
const LONG_SESSION_PENALTY = 0.5
const LONG_SESSION_SOFT = 0.75
const STOP_ANYTIME_BONUS = 1.1

/** Семантика, которой подбор верит; null — её нет или она по одним тегам */
function trustedSemantics(meta: GameMeta): GameSemantics | null {
  const s = meta.semantics
  return s && s.confidence >= SEMANTICS_MIN_CONFIDENCE ? s : null
}

/** Заход дольше часа при ответе «меньше часа» — по уверенной семантике */
function tooLongForShort(meta: GameMeta, mood: Mood): boolean {
  const s = trustedSemantics(meta)
  return mood.time === 'short' && s !== null && s.session.minutes > SHORT_EVENING_MAX_MIN
}

/**
 * Часть semantics скора: поправка теговой оценки настроения по осям, штраф
 * длинного захода на короткий вечер и бонус «можно бросить в любой момент».
 * tagMood — moodMultiplier той же игры; soft — пол короткого вечера сработал.
 * Без уверенной семантики ровно 1.
 */
export function semanticsMultiplier(
  meta: GameMeta,
  mood: Mood,
  tagMood: number,
  opts: { soft?: boolean } = {},
): number {
  const s = trustedSemantics(meta)
  if (!s) return 1
  const blend = 0.5 * tagMood + 0.5 * (0.6 + 0.8 * moodFitAxes(s, mood))
  let mult = blend / tagMood
  if (tooLongForShort(meta, mood)) mult *= opts.soft ? LONG_SESSION_SOFT : LONG_SESSION_PENALTY
  if (mood.time === 'short' && mood.vibe === 'chill' && s.session.canStopAnytime) {
    mult *= STOP_ANYTIME_BONUS
  }
  return mult
}

/*
 * Цена входа на короткий вечер «расслабиться» (lib/entry): игра, которая по
 * отзывам раскрывается не сразу, — ×0.8. Вечер на полчаса без сил уйдёт на
 * обучение, и до того, ради чего в неё играют, человек не доберётся.
 *
 * Только по отзывам (basis 'reviews'), а не по тегам, хотя строку на карточке
 * entryCost умеет и по тегам. Жанры из его списков подбор уже слышит: Grand
 * Strategy, 4X, CRPG, Automation и Management стоят в TIME_TAGS.long (−0.2 на
 * «меньше часа»), Souls-like и Difficult — в VIBE_TAGS.engaged (−0.25 на
 * «расслабиться»). Третий штраф за тот же тег был бы тем же голосом, посчитанным
 * трижды, — и без семантики этот множитель ровно 1, как и все новые.
 *
 * «С вызовом» не штрафуется: там порог — часть удовольствия. Знакомое тоже:
 * управление в руках, осваивать нечего.
 */
const ENTRY_PENALTY = 0.8

export function entryMultiplier(meta: GameMeta, source: CandidateSource, mood: Mood): number {
  if (source === 'familiar' || mood.vibe !== 'chill' || mood.time !== 'short') return 1
  const entry = entryCost(meta)
  return entry?.level === 'high' && entry.basis === 'reviews' ? ENTRY_PENALTY : 1
}

/*
 * Настроение словами для «Почему она?» — только из уверенной семантики и
 * только то, что за игру: «спокойная, короткие сессии». Теги сюда не идут —
 * их объяснение называет само (moodTags). Слова совпадают с корзинами осей
 * (axisBucket): «спокойная» — это ровно та сложность, которую отчёт по
 * семантике называет низкой.
 */
const SESSION_MOOD_WORD: Record<Mood['time'], string> = {
  short: 'короткие сессии',
  medium: 'заход на час',
  long: 'на весь вечер',
}

/** Больше трёх слов — уже не объяснение, а анкета */
const MOOD_WORDS = 3

export function moodWordsOf(meta: GameMeta, mood: Mood): string[] {
  const s = trustedSemantics(meta)
  if (!s) return []
  const words: string[] = []
  const { challenge, complexity, pace } = s.axes
  if (mood.vibe === 'chill') {
    if (axisBucket(challenge) === 'low') words.push('спокойная')
    if (axisBucket(pace) === 'low') words.push('неторопливая')
    if (axisBucket(complexity) === 'low') words.push('без долгого освоения')
  } else {
    if (axisBucket(challenge) === 'high') words.push('с вызовом')
    if (axisBucket(complexity) === 'high') words.push('есть что осваивать')
    if (axisBucket(pace) === 'high') words.push('динамичная')
  }
  // Длина идёт последней, но оси вайба её не вытесняют, когда слов много:
  // про время человек ответил прямо, и совпадение с ответом важнее оттенков
  const session =
    s.session.bucket === mood.time
      ? SESSION_MOOD_WORD[mood.time]
      : mood.time === 'short' && s.session.canStopAnytime
        ? 'можно бросить в любой момент'
        : null
  if (session) return [...words.slice(0, MOOD_WORDS - 1), session]
  return words.slice(0, MOOD_WORDS)
}

/** Фолбэк для реального режима: appdetails с categories может быть не загружен */
const MULTIPLAYER_TAGS = [
  'Multiplayer',
  'Multi-player',
  'Co-op',
  'Online Co-Op',
  'Local Co-Op',
  'Co-op Campaign',
  'PvP',
  'Online PvP',
  'Massively Multiplayer',
  'MOBA',
]

/** Годится ли игра для совместной игры (категории Steam или теги как фолбэк) */
export function isMultiplayerMeta(meta: GameMeta): boolean {
  if (meta.categories.length) return meta.categories.some((c) => MULTIPLAYER_CATEGORIES.has(c))
  return MULTIPLAYER_TAGS.some((t) => t in meta.tags)
}

/**
 * Игры без финала: песочницы, выживание, фабрики, фермы, рогалики, MOBA.
 * К ним возвращаются не «доиграть», а поиграть ещё — потому их и можно
 * советовать как знакомое.
 *
 * Достижений мы не спрашиваем, и отличить «прошёл» от «бросил» у сюжетной
 * игры нечем: вернуть человека в пройденную Disco Elysium — не совет, а
 * промах. Поэтому знакомым становится только то, где проходить нечего.
 */
const REPLAYABLE_TAGS = [
  'Sandbox',
  'Survival',
  'Automation',
  'Life Sim',
  'Colony Sim',
  'Farming Sim',
  'City Builder',
  'Base Building',
  'Roguelike',
  'Roguelite',
  'MOBA',
  'Massively Multiplayer',
]

/**
 * Соревновательный мультиплеер (36 Online PvP, 49 PvP) — тоже без финала.
 * Кооп (1, 9, 38) сюда НЕ идёт, хотя isMultiplayerMeta его считает: у
 * It Takes Two и Portal 2 есть титры, и после них возвращаться некуда.
 */
const PVP_CATEGORIES = new Set([36, 49])
/** Фолбэк, когда categories не загружены, — тот же приём, что в isMultiplayerMeta */
const PVP_TAGS = ['PvP', 'Online PvP']

export function isReplayable(meta: GameMeta): boolean {
  if (REPLAYABLE_TAGS.some((t) => t in meta.tags)) return true
  if (meta.categories.length) return meta.categories.some((c) => PVP_CATEGORIES.has(c))
  return PVP_TAGS.some((t) => t in meta.tags)
}

function fitsSocial(meta: GameMeta, mood: Mood): boolean {
  if (mood.social !== 'friends') return true
  return isMultiplayerMeta(meta)
}

/** Запасной скоринг при пустом тег-профиле: популярность по голосам тегов */
function popularityScore(meta: GameMeta): number {
  const total = Object.values(meta.tags).reduce((s, v) => s + v, 0)
  return Math.min(total / 20_000, 1)
}

/**
 * Вес источника. Двигается ровно одно число — «ни разу не запускал»: за этим
 * человек и приходит («куча игр, которые я даже не скачивал»).
 *
 * 1.25 откалибровано по уже существующему разбросу: moodMultiplier живёт в
 * 0.55…1.40 (нижнюю границу опустила ось времени: −0.25 за противоположный
 * вайб плюс −0.20 за слишком длинную игру), то есть настроение решает примерно
 * в два с половиной раза. Запечатанная игра
 * выигрывает ничью и почти-ничью, но проигрывает тому, что заметно ближе по
 * вкусу. Это наклон, а не фильтр — фильтр отдельно, в applyFocus.
 *
 * У 'new' вес намеренно единичный: равномерный множитель не переупорядочил бы
 * блок открытий, но изменил бы, кто из каталога переживёт отсечку limit.
 *
 * У 'familiar' — 0.9, ступенька вниз: знакомое — хороший ответ, когда на новое
 * нет сил, но не повод оттеснять то, ради чего человек пришёл. Сверху на неё
 * ложится насыщение (familiarWeight).
 */
const SOURCE_WEIGHT: Record<CandidateSource, number> = {
  untouched: 1.25,
  backlog: 1,
  comeback: 1,
  familiar: 0.9,
  new: 1,
}

/*
 * Ось состояния (lib/mood.ts) — наклоны источников под «чего хочется».
 *
 *   familiar — своё знакомое вперёд, заброшенное почти вровень с ним: и там,
 *              и там руки помнят управление. Нетронутое и покупки — назад:
 *              их пришлось бы осваивать;
 *   fresh    — нетронутое и новое вперёд, открытое-и-закрытое чуть вперёд,
 *              заброшенное назад. Знакомое не пускается вовсе (см.
 *              scoreCandidates): просьба о новом — прямое «не то, что знаю»;
 *   lowenergy — источники не трогает: мало сил — это не про новизну, а про
 *              сложность. Хардкорные теги ×0.7.
 *
 * Множители — того же порядка, что наклон нетронутого (1.25): ось двигает
 * выдачу, но вкус и настроение остаются главными.
 */
const LEAN_SOURCE_WEIGHT: Record<Lean, Partial<Record<CandidateSource, number>>> = {
  familiar: { familiar: 1.4, comeback: 1.3, untouched: 0.8, new: 0.7 },
  fresh: { untouched: 1.2, new: 1.2, backlog: 1.1, comeback: 0.8 },
  lowenergy: {},
}
const LOWENERGY_HARDCORE = 0.7

/** Часть lean скора: наклон источника под ось и штраф хардкору при «сил мало» */
export function leanMultiplier(meta: GameMeta, source: CandidateSource, lean: Lean | null): number {
  if (!lean) return 1
  const mult = LEAN_SOURCE_WEIGHT[lean][source] ?? 1
  if (lean === 'lowenergy' && HARDCORE_TAGS.some((t) => t in meta.tags)) return mult * LOWENERGY_HARDCORE
  return mult
}

/**
 * Доля лимита, забронированная за каталогом.
 *
 * Ранжирование общее, а бюджет раздельный, и это обязательный спутник наклона:
 * scoreCandidates режет глобально, дальше splitBySource отдаёт discovery в
 * отдельный блок «Нет в твоей библиотеке», и без брони усиленный бэклог
 * выбрал бы все слоты — блок просто перестал бы рендериться. Без ошибки,
 * без пустого состояния, молча.
 *
 * 0.4, а не прежние 0.3, ровно по этой же причине: у брони появился второй
 * потребитель. При scope = 'all' главная выдача берёт из тех же кандидатов
 * (mixHeroPool), и восьми забронированных мест хватало впритык — две уходили
 * наверх, шесть оставались нижнему блоку, ноль запаса. Десять возвращают
 * запас, не трогая ни порядок, ни длину результата.
 */
const DISCOVERY_SHARE = 0.4

/**
 * Насколько скидка поднимает кандидата из каталога.
 *
 * Максимум +15% к скору при −90% и больше — меньше, чем стоит один тег в
 * профиле. Это наклон, а не сортировка по распродаже: витрину скидок человек
 * и сам откроет, а здесь скидка отвечает лишь на вопрос «раз уж два кандидата
 * одинаково твои, какой показать сегодня».
 *
 * Купленного не касается вовсе: у бэклога цена в прошлом, и скидка на него
 * не меняет ничего, кроме настроения.
 */
const DEAL_BOOST_MAX = 0.15
const DEAL_BOOST_FULL_PERCENT = 90

export function dealMultiplier(meta: GameMeta, source: CandidateSource, nowSec: number): number {
  if (source !== 'new') return 1
  const deal = discountOf(meta, nowSec)
  if (!deal) return 1
  const share = Math.min(deal.percent, DEAL_BOOST_FULL_PERCENT) / DEAL_BOOST_FULL_PERCENT
  return 1 + DEAL_BOOST_MAX * share
}

/*
 * Доверие к новинке по объёму и качеству отзывов.
 *
 * Скор каталога не знал про отзывы ничего, кроме отсечки хвоста в liveness:
 * игра с «97% из трёхсот» и игра с «92% из сорока восьми тысяч» при равном
 * вкусе стояли вровень, а первая с её скидкой — и выше. Но «97% из трёхсот» —
 * это триста человек, которые её нашли сами, то есть уже её аудитория, а
 * «92% из сорока восьми тысяч» пережило встречу с людьми, которые её не
 * искали. Советовать покупку честнее по второму.
 *
 * Байесовское среднее — тот же приём, что у взвешенного рейтинга IMDb: доля
 * положительных сжимается к средней по пулу так, будто у игры есть ещё
 * CONFIDENCE_PRIOR_REVIEWS отзывов ровно со средней долей. У тонкой игры
 * своих отзывов мало, и она остаётся у средней, то есть около единицы; у
 * проверенной её собственная доля перевешивает. Множитель — отклонение от
 * средней: 1 + (сжатая − средняя)/100, зажатое в [0.85, 1.1]:
 *
 *   92% из 48 тыс. → ×1.067   97% из 300 → ×1.016   60% из 5 тыс. → ×0.85
 *
 * Средняя 85% и вес 2000 — замер на пуле открытий (5816 живых игр): средняя
 * доля 84.5%, медиана объёма 2300 отзывов, то есть игра на медиане доверяет
 * себе чуть больше, чем пулу. Коридор уже, чем у скидки (DEAL_BOOST_MAX
 * 0.15): доверие — наклон при равном вкусе, а не второй вкус.
 *
 * Своего не касается вовсе: купленное уже выбрано, и советуем мы его не по
 * рейтингу. Без отзывов (демо главной, прогрев без них) — ровно 1.
 */
const CONFIDENCE_PRIOR_PERCENT = 85
const CONFIDENCE_PRIOR_REVIEWS = 2000
const CONFIDENCE_MIN = 0.85
const CONFIDENCE_MAX = 1.1

export function confidenceMultiplier(meta: GameMeta, source: CandidateSource): number {
  if (source !== 'new') return 1
  const { reviewsTotal: total, reviewsPercent: percent } = meta
  if (typeof total !== 'number' || !Number.isFinite(total) || total <= 0) return 1
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return 1
  const p = Math.min(100, Math.max(0, percent))
  const shrunk =
    (p * total + CONFIDENCE_PRIOR_PERCENT * CONFIDENCE_PRIOR_REVIEWS) / (total + CONFIDENCE_PRIOR_REVIEWS)
  const mult = 1 + (shrunk - CONFIDENCE_PRIOR_PERCENT) / 100
  return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, mult))
}

/*
 * ПОДТАЛКИВАНИЯ (lib/nudge.ts) — В ЯЗЫКЕ СКОРИНГА.
 *
 * План подталкивания меняет настроение и источник сам, до скоринга; сюда
 * доезжает то, что без игры не решить: кого отсечь, кого наклонить и на кого
 * похожа уже показанная выдача.
 */
export type NudgeTilt = {
  /** 'long' — во что за короткий вечер не войти, 'intense' — напряжённое */
  cut?: 'long' | 'intense' | null
  /** Наклон источников сверх SOURCE_WEIGHT — часть nudge */
  sourceWeight?: Readonly<Partial<Record<CandidateSource, number>>> | null
  /** Прибавка к настроению за теги — часть mood (moodMultiplier) */
  tagBoost?: Readonly<Record<string, number>> | null
  /** Главные теги уже показанного: совпадение с главными тегами кандидата — ×SIMILAR_PENALTY */
  seenTags?: ReadonlySet<string> | null
}

/**
 * Отсечь ли игру по подталкиванию. Сначала — уверенная семантика: она знает
 * длину захода и сложность по отзывам. Без неё — теги, и сомнение толкуется в
 * пользу игры, как в timeFit: рогалик с открытым миром за вечер войти даёт,
 * тактика с тегом Relaxing — не обязательно напряжённая.
 */
export function cutByNudge(meta: GameMeta, cut: 'long' | 'intense'): boolean {
  const s = trustedSemantics(meta)
  if (cut === 'long') {
    if (s) return s.session.bucket === 'long'
    return hasAnyTag(meta, TIME_TAGS.long) && !hasAnyTag(meta, TIME_TAGS.short)
  }
  if (s) return axisBucket(s.axes.challenge) === 'high' || axisBucket(s.axes.pace) === 'high'
  return hasAnyTag(meta, VIBE_TAGS.engaged) && !hasAnyTag(meta, VIBE_TAGS.chill)
}

function hasAnyTag(meta: GameMeta, list: readonly string[]): boolean {
  return list.some((t) => t in meta.tags)
}

/**
 * «Что-то другое»: похожее на показанное — ×0.8, а не фильтр. Похожесть — по
 * трём главным тегам (topTags): у двух рогаликов общий Indie ещё ничего не
 * значит, а общий главный тег — уже «то же самое».
 */
const SIMILAR_PENALTY = 0.8
const SIMILAR_TOP = 3

/** Часть nudge скора: наклон источника и штраф похожести; без подталкивания 1 */
export function nudgeMultiplier(meta: GameMeta, source: CandidateSource, tilt: NudgeTilt | null): number {
  if (!tilt) return 1
  let mult = tilt.sourceWeight?.[source] ?? 1
  const seen = tilt.seenTags
  if (seen?.size && topTags(meta, SIMILAR_TOP).some((t) => seen.has(t))) mult *= SIMILAR_PENALTY
  return mult
}

/** Главные теги уже показанного — для штрафа похожести «Что-то другое» */
export function seenTagsOf(metas: Iterable<GameMeta>): Set<string> {
  const out = new Set<string>()
  for (const m of metas) for (const t of topTags(m, SIMILAR_TOP)) out.add(t)
  return out
}

/** Реестр множителей живёт в lib/types.ts рядом с типом частей; здесь — ради тех, кто берёт скоринг отсюда */
export { SCORE_FACTORS }

/**
 * Скор из частей — свёртка в порядке реестра SCORE_FACTORS. Порядок тот же,
 * что был до появления частей (вкус × настроение × источник × скидка), и это
 * не педантизм: плавающая точка не ассоциативна, а демо-пятёрки главной
 * зафиксированы тестом до бита. Начальная единица ничего не меняет: умножение
 * на неё точное, и первым множителем по-прежнему стоит вкус.
 */
export function scoreOfParts(p: ScoreParts): number {
  return SCORE_FACTORS.reduce((score, k) => score * p[k], 1)
}

/**
 * Все множители единичные, кроме переданных. Для частей, собранных руками
 * (тесты, бейджи на литералах): с реестром новый множитель не требует править
 * каждый такой литерал — он просто единичный там, где о нём не спрашивали.
 */
export function neutralParts(over: Partial<ScoreParts> = {}): ScoreParts {
  const parts = Object.fromEntries(SCORE_FACTORS.map((k) => [k, 1])) as ScoreParts
  return { ...parts, ...over }
}

export function scoreCandidates(args: {
  profile: Record<string, number>
  library: LibraryGame[]
  metaOf: (appid: number) => GameMeta | undefined
  newPool: GameMeta[]
  mood: Mood
  nowSec: number
  limit?: number
  /**
   * Кого не показывать вовсе — баны. Отсекаются ЗДЕСЬ, до среза limit, а не
   * фильтром после: иначе забаненные занимали места в тридцатке и выпадали
   * уже за отсечкой, и у человека с десятком банов выдача молча худела.
   */
  exclude?: ReadonlySet<number>
  /**
   * Вес редкости тегов (lib/tagweight.ts). Без него вкус — сырой косинус, и
   * совпадение по Indie с Action решало выдачу наравне с совпадением по
   * Automation: частотный костяк есть в любом профиле и в любой игре. null и
   * отсутствие дают ровно прежние скоры — демо-пятёрки главной на этом стоят.
   */
  tagWeight?: TagWeight | null
  /**
   * Паузы после скипа (cooldownOf). mult 0 — игра уходит в сторону и
   * возвращается, только если своих без неё не набрать на выдачу. Без карты —
   * ровно прежние скоры.
   */
  cooldown?: ReadonlyMap<number, Cooldown>
  /**
   * Пускать ли знакомое любимое (familiarWeight). По умолчанию нет: «Игра
   * дня» и демо главной собираются без него, и их выдача не меняется.
   */
  allowFamiliar?: boolean
  /**
   * Сколько знакомого вызывающий оставит после capSource. Пол паузы считает
   * своими только столько знакомых: срезанное потолком выдачу не наберёт.
   * Без него — всё знакомое, как прежде.
   */
  familiarCap?: number
  /**
   * Ось состояния (lib/mood.ts): знакомое, новое, без сил. null и отсутствие —
   * часть lean ровно 1, скоры прежние.
   */
  lean?: Lean | null
  /**
   * Подталкивание после выдачи (lib/nudge.ts): отсев, наклон источников,
   * прибавка к настроению за теги и штраф похожести на показанное. null и
   * отсутствие — ровно прежние скоры: часть nudge 1, настроение без прибавки.
   */
  nudge?: NudgeTilt | null
}): ScoredCandidate[] {
  const { profile, library, metaOf, newPool, mood, nowSec, limit = 25, exclude, cooldown } = args
  type Scored = ScoredCandidate & { parts: ScoreParts }
  const out: Scored[] = []
  // Скрытые паузой — отдельно: они нужны только полу ниже
  const hidden: Scored[] = []
  const profileEmpty = Object.keys(profile).length === 0
  // Профиль взвешивается один раз на весь запрос, а не на каждого кандидата
  const tasteOf = weightedCosineTo(profile, args.tagWeight ?? null)
  const lean = args.lean ?? null
  // «Хочу нового» знакомое не пускает вовсе, «хочу знакомого» снимает с него
  // шлюзы жанра и паузы
  const familiarOn = Boolean(args.allowFamiliar) && lean !== 'fresh'
  const relaxed = lean === 'familiar'

  // Кому штраф короткого вечера и какой была бы его мягкая версия: пол ниже
  // ослабляет его, не пересчитывая остального
  const softSemantics = new Map<number, number>()

  const tilt = args.nudge ?? null

  /** sourceMult — насыщение знакомого; у прочих источников ровно 1 */
  const push = (meta: GameMeta, source: ScoredCandidate['source'], sourceMult = 1) => {
    if (exclude?.has(meta.appid)) return
    if (!fitsSocial(meta, mood)) return
    // Отсев подталкивания — до пауз: отсечённое не должно вернуться и полом
    if (tilt?.cut && cutByNudge(meta, tilt.cut)) return
    const pause = cooldown?.get(meta.appid)
    const tagMood = moodMultiplier(meta, mood, tilt?.tagBoost ?? null)
    const parts: ScoreParts = {
      taste: profileEmpty ? popularityScore(meta) : tasteOf(normalizedTags(meta)),
      mood: tagMood,
      source: SOURCE_WEIGHT[source] * sourceMult,
      deal: dealMultiplier(meta, source, nowSec),
      lean: leanMultiplier(meta, source, lean),
      cooldown: pause && pause.mult > 0 ? pause.mult : 1,
      semantics: semanticsMultiplier(meta, mood, tagMood),
      entry: entryMultiplier(meta, source, mood),
      confidence: confidenceMultiplier(meta, source),
      nudge: nudgeMultiplier(meta, source, tilt),
    }
    if (tooLongForShort(meta, mood)) {
      softSemantics.set(meta.appid, semanticsMultiplier(meta, mood, tagMood, { soft: true }))
    }
    const c = { appid: meta.appid, name: meta.name, source, score: scoreOfParts(parts), parts }
    if (pause?.mult === 0) hidden.push(c)
    else out.push(c)
  }

  for (const g of library) {
    const meta = metaOf(g.appid)
    if (!meta) continue
    // Саундтрек, демка или SDK с нулём минут иначе становятся «ни разу не
    // запускал» с наклоном 1.25 — и в режиме одной игры занимают единственное
    // место. Тот же отсев, что у полки забытого на /library: одно определение
    // мусора на весь продукт.
    if (isJunk(g, meta)) continue
    const state = classifyLibraryGame(g, nowSec)
    if (state === 'unplayed') push(meta, isUntouched(g) ? 'untouched' : 'backlog')
    else if (state === 'comeback') push(meta, 'comeback')
    else if (familiarOn) {
      const weight = familiarWeight(g, meta, state, nowSec, { relaxed })
      if (weight !== null) push(meta, 'familiar', weight)
    }
  }

  const owned = new Set(library.map((g) => g.appid))
  for (const meta of newPool) {
    if (!owned.has(meta.appid)) push(meta, 'new')
  }

  // Пол короткого вечера — то же правило, что у applyFocus: если своих, чей
  // заход влезает в час, меньше FOCUS_FLOOR, длинным своим штраф ослабляется.
  // Не снимается: влезающее всё равно стоит впереди. Каталог не смягчается —
  // короткого там хватает и без него. Скрытые паузой смягчаются тоже: пол
  // паузы ниже может их вернуть, и вернуться они должны уже со смягчённым
  if (softSemantics.size) {
    const fitting = out.filter((c) => c.source !== 'new' && !softSemantics.has(c.appid)).length
    if (fitting < FOCUS_FLOOR) {
      const soften = (c: Scored): Scored => {
        const soft = softSemantics.get(c.appid)
        if (soft === undefined || c.source === 'new') return c
        const parts = { ...c.parts, semantics: soft }
        return { ...c, parts, score: scoreOfParts(parts) }
      }
      for (let i = 0; i < out.length; i++) out[i] = soften(out[i])
      for (let i = 0; i < hidden.length; i++) hidden[i] = soften(hidden[i])
    }
  }

  // Пол паузы — то же правило, что у applyFocus: фильтр, выкинувший всё, — не
  // фильтр. У маленькой библиотеки несколько «не сейчас» подряд съели бы
  // выдачу целиком, поэтому лучшие из отложенных своих возвращаются — но
  // вполсилы, чтобы стоять за всем, что не откладывали. Каталог не
  // возвращается: его и без того хватает. Баны сюда не попадают вовсе —
  // exclude отсекает их раньше паузы.
  //
  // Знакомое считается не всё, а сколько пропустит потолок маршрута: четыре
  // песочницы, из которых до выдачи дойдёт одна, пятёрку не набирают. По той
  // же причине знакомое сверх потолка не возвращается и из-под паузы.
  const familiarCap = args.familiarCap ?? Infinity
  const familiarLeft = out.filter((c) => c.source === 'familiar').length
  const ownLeft =
    out.filter((c) => c.source !== 'new' && c.source !== 'familiar').length +
    Math.min(familiarLeft, familiarCap)
  if (ownLeft < PICK_COUNT) {
    let familiarRoom = Math.max(0, familiarCap - familiarLeft)
    const back = hidden
      .filter((c) => c.source !== 'new')
      .sort((a, b) => b.score - a.score)
      .filter((c) => c.source !== 'familiar' || familiarRoom-- > 0)
      .slice(0, PICK_COUNT - ownLeft)
    for (const c of back) {
      const parts = { ...c.parts, cooldown: RESTORED_MULT }
      out.push({ ...c, parts, score: scoreOfParts(parts) })
    }
  }

  const ranked = out.sort((a, b) => b.score - a.score)
  const { own, discovery } = splitBySource(ranked)
  // Каждая сторона добирает то, что не выбрала другая, поэтому длина результата
  // остаётся min(limit, всего кандидатов) — ровно как до появления брони.
  const discoveryTake = Math.min(
    discovery.length,
    Math.max(limit - own.length, Math.round(limit * DISCOVERY_SHARE)),
  )
  return [...own.slice(0, limit - discoveryTake), ...discovery.slice(0, discoveryTake)].sort(
    (a, b) => b.score - a.score,
  )
}
