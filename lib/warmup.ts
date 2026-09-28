/**
 * Прогрев каталога перед первой выдачей.
 *
 * Клиент дёргает /api/prepare в цикле, пока тот не скажет «больше нечего
 * разбирать»: один вызов укладывается примерно в десять секунд, а у человека
 * с большой библиотекой таких вызовов набирается несколько десятков.
 *
 * Логика живёт здесь, а не в странице, по двум причинам. Первая: её гоняли
 * ДВЕ страницы (/play и /daily) двумя почти одинаковыми копиями, и копии
 * успели разойтись — на /daily не было ни прогресса, ни обработки ошибок.
 * Вторая: цикл, который ходит в сеть по несколько минут, обязан быть покрыт
 * тестами, а vitest собирает только lib/.
 *
 * Что здесь важно и чего не было в копиях:
 *   • ответ проверяется на ok — 500 больше не читается как «прогрев закончен»;
 *   • любое исключение возвращается как 'error', а не оставляет страницу
 *     в вечном спиннере (на /daily экран ошибки был недостижим в принципе);
 *   • есть предел по ВРЕМЕНИ, а не только по числу вызовов: восемьдесят
 *     вызовов по десять секунд — это больше тринадцати минут ожидания;
 *   • цикл замечает, что работа не движется (см. WARMUP_STALL_LIMIT), и
 *     уходит вместе со страницей (opts.signal).
 */

import { plural } from './plural'
import type { SessionHint } from './sessionhint'

/**
 * Два факта о библиотеке, которые /api/prepare отдаёт с первого же ответа.
 * Считаются по снапшоту без метаданных, поэтому доступны раньше, чем каталог
 * вообще тронут, — экрану ожидания есть что сказать с первой секунды.
 */
export type LibraryFacts = {
  games: number
  untouched: number
  /**
   * Время скрыто настройками Steam (lib/playtime.ts): вместо «ни разу не
   * открывал» экран говорит, что время скрыто. Необязательно: ответ старой
   * версии сервера поля не несёт — тогда молчим, как и раньше.
   */
  timeHidden?: boolean
  /**
   * Стена экрана ожидания: appid самых наигранных игр (libraryWall). Пока
   * идёт подбор, за кольцом плывут обложки ЕГО библиотеки, и выбранная игра
   * выходит из них вперёд — «из многих — одна». Необязательна: ответ старой
   * версии сервера её не несёт, и экран остаётся просто экраном ожидания.
   */
  wall?: number[]
}

/** Стена — украшение: мусорный элемент выпадает сам, а не роняет факты */
function wallIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw)) return null
  const ids = raw
    .filter((x): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x > 0)
    .slice(0, WALL_MAX)
  return ids.length > 0 ? ids : null
}

/**
 * Последняя стена на устройстве. Вернувшийся в течение десяти минут прогрев
 * пропускает (warmIsFresh), и /api/prepare в этот заход не звучит вовсе — без
 * памяти экран ожидания остался бы пустым ровно у того, кто здесь частый.
 */
export type WallMemo = { games: number; wall: number[] }

export function parseWallMemo(raw: unknown): WallMemo | null {
  if (!raw || typeof raw !== 'object') return null
  const { games, wall } = raw as { games?: unknown; wall?: unknown }
  if (typeof games !== 'number' || !Number.isSafeInteger(games) || games < 0) return null
  const ids = wallIds(wall)
  return ids ? { games, wall: ids } : null
}

/** Сколько обложек уходит на стену: три ряда по восемь на широком экране */
export const WALL_MAX = 24

/**
 * Стена — самые наигранные, а не случайные: человек должен узнать на ней
 * СВОЮ библиотеку с первого взгляда, а узнаёт он то, во что играл.
 * Игры не из Steam (отрицательный appid) пропускаются — постера у них нет.
 */
export function libraryWall(games: ReadonlyArray<{ appid: number; playtimeForever: number }>): number[] {
  return games
    .filter((g) => g.appid > 0)
    .sort((a, b) => b.playtimeForever - a.playtimeForever)
    .slice(0, WALL_MAX)
    .map((g) => g.appid)
}

export type WarmupProgress = {
  /** сколько игр ещё осталось разобрать */
  remaining: number
  /** сколько их было в самом начале — знаменатель для процента */
  total: number
  /** появляется с первого ответа; null, пока ответа не было */
  library: LibraryFacts | null
}

/**
 * Ответ прогрева бывает и от старой версии приложения (человек держал вкладку
 * открытой через деплой), поэтому факты валидируются, а не приводятся: экран
 * ожидания не должен показывать «NaN игр».
 */
function parseFacts(raw: unknown): LibraryFacts | null {
  if (!raw || typeof raw !== 'object') return null
  const { games, untouched } = raw as { games?: unknown; untouched?: unknown }
  if (typeof games !== 'number' || !Number.isFinite(games) || games < 0) return null
  if (typeof untouched !== 'number' || !Number.isFinite(untouched) || untouched < 0) return null
  const facts: LibraryFacts = { games, untouched }
  if ((raw as { timeHidden?: unknown }).timeHidden === true) facts.timeHidden = true
  const wall = wallIds((raw as { wall?: unknown }).wall)
  if (wall) facts.wall = wall
  return facts
}

/**
 * 'aborted' — страница ушла сама (opts.signal): ни выдачу, ни ошибку
 * показывать уже некому, и вызывающий обязан просто выйти.
 */
export type WarmupResult = 'done' | 'unauthorized' | 'error' | 'aborted'

/** Потолок вызовов. Дальше почти наверняка что-то зациклилось. */
export const WARMUP_MAX_CALLS = 80

/**
 * Потолок ожидания. Три минуты — это уже за гранью терпения, но лучше отдать
 * выдачу по неполному каталогу, чем не отдать ничего: /api/recommend и
 * /api/daily работают и на частично прогретых данных.
 */
export const WARMUP_MAX_MS = 3 * 60_000

/**
 * После скольких вызовов отдать управление странице.
 *
 * Один. За первый вызов ensureMeta разбирает 200 игр (GetItems берёт их пачкой),
 * а scoreCandidates большего и не требует — этого хватает на пять карточек.
 * Всё остальное время цикла оплачивало данные для ШЕСТОЙ карточки и дальше,
 * при том что до трёх минут (WARMUP_MAX_MS) человек смотрел на экран ожидания
 * и уходил. Премиса, что выдача работает на частично прогретых данных, не
 * новая — она записана в докблоке выше и на ней уже держатся оба предела.
 *
 * Что при этом ХУЖЕ и с чем надо считаться: онлайн и цены обновляются в
 * /api/prepare только когда remaining дошёл до нуля. Значит первая выдача судит
 * о живости по старым замерам, а цены может не показать вовсе. Поэтому догрев
 * не молчит: полоса внизу и предложение обновить выдачу, когда он закончится.
 */
export const WARMUP_YIELD_AFTER = 1

/**
 * Сколько ответов ПОДРЯД без продвижения терпим, прежде чем сдаться.
 *
 * Steam отвечает 429 на GetItems или не отдаёт словарь тегов — ensureMeta
 * глотает сбой, метаданные не двигаются, и /api/prepare честно отдаёт тот же
 * остаток. Цикл этого не замечал: три минуты «Осталось разобрать 412 игр» с
 * неподвижной цифрой и до восьмидесяти пачек GetItems по двести appid от
 * одного человека — ровно пока нас ограничивают.
 *
 * Два, а не один: остаток законно стоит на месте, если вызов успел только
 * освежить снапшот библиотеки или засеять пул. Если же сервер сам говорит,
 * что Steam не ответил (stalled), второго раза не ждём — выходим сразу.
 * Выход — 'done', как и у пределов ниже: выдача работает и на неполном каталоге.
 */
export const WARMUP_STALL_LIMIT = 2

/**
 * Пауза перед повтором после ответа без продвижения. Повтор сразу же упёрся
 * бы в тот же отказ Steam; пара секунд — шанс, что окно лимита сдвинулось, и
 * заодно на один запрос меньше в то же окно.
 */
export const WARMUP_STALL_PAUSE_MS = 2_000

/**
 * Потолок одного вызова /api/prepare. Честный вызов укладывается в десять
 * секунд с небольшим (одна пачка GetItems — до семи); без потолка зависшее
 * соединение держало экран ожидания столько, сколько его держит браузер, —
 * мимо WARMUP_MAX_MS, который проверяется только между вызовами.
 */
export const WARMUP_CALL_TIMEOUT_MS = 30_000

/**
 * Сигнал одного вызова: ушла страница или вызов вышел за свой потолок.
 *
 * AbortSignal.any есть не во всех живых браузерах (Safari до 17.4), а
 * исключение здесь уронило бы прогрев целиком — там остаётся сигнал страницы:
 * уход важнее потолка.
 */
function callSignal(page: AbortSignal | undefined): AbortSignal | undefined {
  const timeout =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(WARMUP_CALL_TIMEOUT_MS) : undefined
  if (!page || !timeout) return page ?? timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([page, timeout]) : page
}

/** Пауза, которую прерывает уход страницы: ждать ради ушедшего незачем. */
function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve()
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/* ──────────────── вызов, от которого ушли, а сервер дорабатывает ──────────────── */

/**
 * Сколько /api/prepare считается занятым вызовом, ответа на который никто не
 * дождался, мс от начала вызова.
 *
 * Уход страницы отменяет fetch только у нас (opts.signal): маршрут сигнал
 * запроса не слушает и свою пачку GetItems дорабатывает. Пачку он выбирает по
 * «протухшим» строкам каталога (getStaleAppids в ensureMeta), и пока первый
 * вызов их не записал, второй, начатый рядом, выберет те же двести appid —
 * второй GetItems на ту же пачку. Конца такого вызова клиенту не видно,
 * поэтому срок: честный вызов — десять секунд с небольшим, отсюда пятнадцать.
 * WARMUP_CALL_TIMEOUT_MS — потолок нашего терпения, а не длина работы сервера.
 */
export const WARMUP_ORPHAN_MS = 15_000

type OpenCall = { quiet: Promise<void>; close: () => void }

/** Вызовы /api/prepare из этого документа, которые сервер, возможно, ещё разбирает */
const openCalls = new Set<OpenCall>()

/**
 * Вызов /api/prepare с отметкой «сервер занят». Снимает её ответ — любой, хоть
 * 401: сервер закончил, — или срок WARMUP_ORPHAN_MS. Отказ не снимает: и уход
 * страницы, и обрыв сети говорят только о нашей стороне разговора.
 */
function callPrepare(init: RequestInit, fetchFn: typeof fetch): Promise<Response> {
  const res = fetchFn('/api/prepare', { method: 'POST', ...init })
  let quieted = () => {}
  const call: OpenCall = {
    quiet: new Promise<void>((done) => {
      quieted = done
    }),
    close: () => {
      clearTimeout(timer)
      openCalls.delete(call)
      quieted()
    },
  }
  const timer = setTimeout(call.close, WARMUP_ORPHAN_MS)
  openCalls.add(call)
  void Promise.resolve(res).then(call.close, () => {})
  return res
}

/**
 * Вызов /api/prepare в очередь за нашими же: уходит, когда ответили или
 * отжили свой срок все вызовы этого документа, начатые раньше.
 *
 * Очередь нужна тем, кто зовёт /api/prepare не из цикла страницы: первому
 * кругу под квизом (startPrewarm) и WarmCatalog на /library. «Изменить
 * настроение» уводит с /play на квиз посреди догрева, «Выбрать одну» — с
 * /library на квиз, пока WarmCatalog ждёт ответа; в обоих случаях новый вызов
 * тут же рядом со старым — тот самый второй GetItems (WARMUP_ORPHAN_MS).
 *
 * Проверка и вызов — в одном синхронном шаге: двое ждущих одного и того же
 * вызова иначе проснулись бы вместе и ушли бы рядом друг с другом.
 *
 * init — функция, а не объект: потолок вызова (callSignal) считается от его
 * выхода, а не от начала очереди. null — вызов за время ожидания стал не
 * нужен (wanted): квиз забыл ответ, WarmCatalog ушёл со страницей.
 */
export async function queuePrepare(
  opts: { init?: () => RequestInit; fetchFn?: typeof fetch; wanted?: () => boolean } = {},
): Promise<Response | null> {
  while (openCalls.size > 0) await Promise.all([...openCalls].map((c) => c.quiet))
  if (opts.wanted && !opts.wanted()) return null
  return callPrepare(opts.init?.() ?? {}, opts.fetchFn ?? fetch)
}

/** Только для тестов: вызовы в полёте живут на модуле и иначе текут между случаями */
export function resetPrepareCalls(): void {
  for (const call of [...openCalls]) call.close()
}

/* ─────────────────────── первый круг под квизом ─────────────────────── */

/**
 * ПЕРВЫЙ ВЫЗОВ ПРОГРЕВА — ПОКА ЧЕЛОВЕК ОТВЕЧАЕТ НА ТРИ ВОПРОСА.
 *
 * /api/prepare впервые звучал только на /play. Вошедший тратил секунды на
 * квиз, а потом смотрел на экран ожидания, пока первый вызов разбирал пачку
 * GetItems на двести игр, — до десяти секунд работы, которую можно было
 * сделать под вопросами. Теперь квиз начинает этот вызов сам (startPrewarm),
 * а цикл прогрева берёт его ответ своим первым кругом (runWarmup): ждёт
 * недоехавший или забирает готовый.
 *
 * Забирает, а не повторяет, — ради Steam. Вызов /play поверх незаконченного
 * вызова квиза разбирал бы ту же пачку: два GetItems по двести appid вместо
 * одного, и ни один из них не быстрее. В обратную сторону то же: квиз, куда
 * ушли посреди догрева /play, встаёт со своим вызовом в очередь (queuePrepare)
 * за брошенным, который сервер ещё дорабатывает.
 *
 * В памяти модуля, а не в хранилище: квиз уводит на /play клиентским
 * переходом, документ тот же. Перезагрузка ответ забывает — /play сделает
 * первый вызов сам, как раньше, а разобранное сервером всё равно останется в
 * каталоге. keepalive — ради того же: вызов, начатый под квизом, доезжает до
 * сервера и тогда, когда документ ушёл посреди него.
 */
type Prewarm = { at: number; reply: Promise<unknown> }
let prewarm: Prewarm | null = null

/**
 * Сколько ответ квиза годится первым кругом, мс от начала вызова. Три вопроса
 * — это секунды, две минуты — с запасом. Дальше это уже не «пока отвечал», и
 * /play начнёт своим вызовом: то, что квиз успел разобрать, лежит в каталоге
 * и так. Тесный срок держит и метку прогрева (lib/playcache): /play ставит её
 * по такому ответу на десять минут, и от самого вызова до её конца пройдёт
 * не больше двенадцати.
 */
export const PREWARM_TTL_MS = 2 * 60_000

function prewarmFresh(p: Prewarm, nowMs: number): boolean {
  const age = nowMs - p.at
  // «Из будущего» — часы перевели назад, и сколько ему на самом деле, не узнать
  return age >= -60_000 && age <= PREWARM_TTL_MS
}

/**
 * Кому греть под квизом.
 *
 * Квиз открыт и гостю, а ему сервер ответил бы 401 — пустой вызов с каждого
 * захода. Демо греть нечего: библиотека статична и засеяна, /api/prepare
 * отвечает ей remaining: 0, не трогая Steam, и свой первый вызов /play
 * делает за один круг до сервера.
 *
 * Вошедшего узнаём без сети, по двум догадкам: подсказке о входе
 * (lib/sessionhint) и признаку записи из ответа touch (lib/writer). Одной
 * подсказки мало ровно там, где прогрев нужнее всего: возврат из Steam ведёт
 * новичка прямо на /quiz (loginTarget), новым документом, а подсказку заводит
 * только главная. На квизе вход тогда подтверждает touch из SessionKeeper —
 * признак записи перестаёт быть «не знаем». Ошибись догадки — сервер ответит
 * 401, и /play сделает первый вызов сам.
 */
export function prewarmWanted(
  hint: Pick<SessionHint, 'authed' | 'demo'> | null,
  writer: boolean | null,
): boolean {
  if (hint?.demo) return false
  return hint?.authed === true || writer !== null
}

/**
 * Начать первый круг заранее. Один на заход: пока прошлый ответ свежий —
 * доехал он, едет или ждёт очереди, — второй не начинается. Возвращает,
 * начат ли круг.
 *
 * Вызов уходит не сразу, если сервер ещё занят нашим же брошенным вызовом
 * (queuePrepare). Ждёт сам ответ, а не квиз: /play, пришедший раньше, ждёт
 * вместе с ним (takePrewarm) — своим вызовом рядом он сделал бы тот же дубль.
 *
 * Ответ хранится разобранным и только удачный: тело Response читается один
 * раз, а отказ (401, 409, 500, обрыв) цикл на /play должен получить своим
 * вызовом — со своими развилками «иди подключайся» и «ошибка».
 */
export function startPrewarm(opts: { fetchFn?: typeof fetch; nowMs?: () => number } = {}): boolean {
  const now = (opts.nowMs ?? (() => Date.now()))()
  if (prewarm && prewarmFresh(prewarm, now)) return false
  const entry: Prewarm = { at: now, reply: Promise.resolve(null) }
  // Через then, а не прямым вызовом: fetch, бросивший синхронно, не должен
  // уронить квиз — прогрев здесь только ускорение
  entry.reply = Promise.resolve()
    .then(() =>
      queuePrepare({
        fetchFn: opts.fetchFn,
        init: () => ({ keepalive: true, signal: callSignal(undefined) }),
        // Забыт, пока стоял в очереди (сменился вход), — не нужен никому
        wanted: () => prewarm === entry,
      }),
    )
    .then(async (res): Promise<unknown> => (res?.ok ? await res.json() : null))
    .catch(() => null)
  prewarm = entry
  return true
}

/**
 * Забыть ответ квиза — вход сменился. Ответ не знает, чей он: /api/prepare
 * отвечает про того, кто вошёл в момент вызова, и после выхода или входа
 * другим профилем в том же документе /play показал бы стену и числа
 * прежнего человека.
 */
export function forgetPrewarm(): void {
  prewarm = null
}

/**
 * Сменился ли вход между двумя подсказками — повод квизу забыть свой ответ.
 *
 * Выход и вход другим профилем в ЭТОМ документе забывают ответ сами
 * (forgetPlay, ConnectCard). В соседней вкладке — нет, а кука у вкладок
 * общая: следующий /play здесь забрал бы стену и числа прежнего человека.
 * Узнать о чужой вкладке можно только по подсказке (lib/sessionhint): та её
 * переписывает, и сюда доходит событие storage. steamid в подсказке нет,
 * поэтому сравнивается всё, что есть. Лишнее «сменился» стоит одного круга
 * заново, а не дубля: новый вызов встаёт в очередь за прежним (queuePrepare).
 */
export function hintChanged(prev: SessionHint | null, next: SessionHint | null): boolean {
  if (!prev || !next) return prev !== next
  return (
    prev.authed !== next.authed ||
    prev.personaName !== next.personaName ||
    prev.demo !== next.demo ||
    prev.readOnly !== next.readOnly
  )
}

/** Ожидание, которое прерывает уход страницы: тогда null. */
function untilAbort<T>(p: Promise<T>, signal: AbortSignal | undefined): Promise<T | null> {
  if (!signal) return p
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve) => {
    const gone = () => resolve(null)
    signal.addEventListener('abort', gone, { once: true })
    void p.then((v) => {
      signal.removeEventListener('abort', gone)
      resolve(v)
    })
  })
}

/**
 * Ответ квиза для первого круга, или null: его нет, он протух или не удался.
 * Недоехавший ждём здесь, а не зовём /api/prepare рядом с ним (см. докблок
 * выше). Страница ушла посреди ожидания — ответ остаётся следующему заходу:
 * он всё ещё свежий и всё ещё единственный вызов в полёте.
 */
async function takePrewarm(signal: AbortSignal | undefined, nowMs: number): Promise<unknown> {
  const p = prewarm
  if (!p) return null
  if (!prewarmFresh(p, nowMs)) {
    prewarm = null
    return null
  }
  const reply = await untilAbort(p.reply, signal)
  if (signal?.aborted) return null
  // Забран: следующий заход на /play начнёт свой цикл, а не повторит этот круг
  if (prewarm === p) prewarm = null
  return reply
}

export async function runWarmup(
  opts: {
    onProgress?: (p: WarmupProgress) => void
    /**
     * Вызывается ОДИН раз, когда прогрева уже достаточно для первой выдачи, а
     * работа ещё не кончилась. Если работа кончилась раньше — не вызывается
     * вовсе: страница получит обычный 'done' и покажет выдачу как раньше.
     */
    onYield?: (p: WarmupProgress) => void
    yieldAfter?: number
    /**
     * Уход страницы. Без него цикл переживал уход с /play и продолжал ходить
     * в /api/prepare, а новый заход запускал второй такой же параллельно.
     * Отменяет и текущий вызов, и паузу между вызовами.
     */
    signal?: AbortSignal
    /**
     * Первый круг пришёл из квиза (startPrewarm), а не своим вызовом. Страница
     * узнаёт об этом ради замера ожидания (pick_wait в lib/track): без него не
     * отличить выдачу, которую ускорил квиз, от обычной.
     */
    onPrewarm?: () => void
    fetchFn?: typeof fetch
    /** подменяется в тестах, иначе предел по времени не проверить */
    nowMs?: () => number
    /** подменяется в тестах, чтобы паузы не ждать по-настоящему */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
    maxCalls?: number
    maxMs?: number
  } = {},
): Promise<WarmupResult> {
  const fetchFn = opts.fetchFn ?? fetch
  const nowMs = opts.nowMs ?? (() => Date.now())
  const sleep = opts.sleep ?? pause
  const { signal } = opts
  const maxCalls = opts.maxCalls ?? WARMUP_MAX_CALLS
  const maxMs = opts.maxMs ?? WARMUP_MAX_MS
  const yieldAfter = opts.yieldAfter ?? WARMUP_YIELD_AFTER
  let yielded = false

  const startedAt = nowMs()
  let total = 0
  let library: LibraryFacts | null = null
  /** Остаток прошлого ответа — с ним сравнивается продвижение */
  let prevRemaining: number | null = null
  /** Ответов подряд без продвижения */
  let stalls = 0

  for (let i = 0; i < maxCalls; i++) {
    if (signal?.aborted) return 'aborted'

    // Первый круг — ответ квиза, если он есть: вызов уже сделан под вопросами
    // (см. startPrewarm). Нет его или не удался — круг идёт своим вызовом.
    let body: unknown = i === 0 ? await takePrewarm(signal, nowMs()) : null
    if (signal?.aborted) return 'aborted'
    if (body !== null) {
      opts.onPrewarm?.()
    } else {
      let res: Response
      try {
        // Не в очередь: цикл страницы — главный, кто зовёт /api/prepare. Но с
        // отметкой — уйди страница посреди вызова, квиз подождёт его конца
        res = await callPrepare({ signal: callSignal(signal) }, fetchFn)
      } catch {
        // Ушла страница — не сбой, а конец разговора. Иначе сеть отвалилась
        // или вызов вышел за потолок — и это не «прогрев закончен»
        return signal?.aborted ? 'aborted' : 'error'
      }

      // 401 без сессии, 409 без снапшота библиотеки: обоим лечение одно —
      // отправить человека подключаться заново, а не показывать ошибку
      if (res.status === 401 || res.status === 409) return 'unauthorized'
      if (!res.ok) return 'error'

      try {
        body = await res.json()
      } catch {
        return signal?.aborted ? 'aborted' : 'error'
      }
    }

    let remaining: number
    let stalled: boolean
    try {
      const data = body as { remaining?: number; library?: unknown; stalled?: unknown }
      remaining = data.remaining ?? 0
      // Флаг сервера: Steam не отдал метаданные, и повтор прямо сейчас упрётся
      // в тот же отказ (см. ensureMeta и /api/prepare)
      stalled = data.stalled === true
      // Единожды: числа не меняются в течение цикла, а вот пропасть в ответе
      // могут — тогда экран продолжит показывать то, что уже знает
      library ??= parseFacts(data.library)
    } catch {
      return signal?.aborted ? 'aborted' : 'error'
    }

    // Первый замер — он же общий объём работы: дальше остаток только убывает.
    if (remaining > total) total = remaining
    const progress: WarmupProgress = { remaining, total, library }
    opts.onProgress?.(progress)

    if (remaining <= 0) return 'done'

    // Порог пройден, а работа осталась — пора показать выдачу. Строго после
    // проверки remaining: если всё разобралось за один вызов, никакого «догрева
    // в фоне» нет и обещать его нечего.
    if (!yielded && i + 1 >= yieldAfter) {
      yielded = true
      opts.onYield?.(progress)
    }

    // Работа стоит — см. WARMUP_STALL_LIMIT. Как и предел по времени ниже,
    // проверяется ПОСЛЕ прогресса и сигнала отдачи: выдача по тому, что успело
    // доехать, лучше ещё минуты неподвижной цифры.
    if (stalled) return 'done'
    stalls = prevRemaining !== null && remaining >= prevRemaining ? stalls + 1 : 0
    prevRemaining = remaining
    if (stalls >= WARMUP_STALL_LIMIT) return 'done'

    // Предел по времени проверяем ПОСЛЕ прогресса: пусть человек увидит, до
    // какого места дошло, прежде чем мы сдадимся.
    if (nowMs() - startedAt >= maxMs) return 'done'

    if (stalls > 0) {
      await sleep(WARMUP_STALL_PAUSE_MS, signal)
      if (signal?.aborted) return 'aborted'
    }
  }

  // Вызовы кончились, а работа нет. Это всё равно 'done': выдача по неполному
  // каталогу лучше, чем экран ошибки на ровном месте.
  return 'done'
}

/**
 * Доля выполненного, 0…100. Отдельно, потому что нужна и в UI, и в тестах.
 *
 * Принимает только те два поля, которые считает: факты о библиотеке к проценту
 * отношения не имеют, и требовать их от вызывающего значило бы заставлять
 * выдумывать данные ради арифметики.
 */
export function warmupPercent(p: Pick<WarmupProgress, 'remaining' | 'total'> | null): number {
  if (!p || p.total <= 0) return 0
  const done = p.total - p.remaining
  return Math.max(0, Math.min(100, (done / p.total) * 100))
}

/**
 * Строка статуса, пока идёт разбор. Одна на /play и /daily: по ней экран
 * ожидания узнаёт счётчик и не отдаёт его скринридеру (см. warmupStage).
 */
export function remainingLine(remaining: number): string {
  return `Осталось разобрать ${remaining} ${plural(remaining, 'игру', 'игры', 'игр')}`
}

/** Этап разбора для скринридера — вместо счётчика, который меняется на каждом ответе */
export const COUNTING_STAGE = 'Разбираю библиотеку…'

/**
 * Что экран ожидания отдаёт в живую область: этап, а не счётчик.
 *
 * Видимая строка меняется с каждым ответом /api/prepare — «Осталось разобрать
 * 812 игр», «…790…», «…765…», — и в живой области это была бы очередь чисел
 * на минуту, из которой не услышать, когда начался подбор. Скринридеру
 * достаётся только смена этапа: «Изучаю библиотеку», «Разбираю», «Подбираю».
 * Сколько разобрано, говорит кольцо — своим именем, по запросу, а не вслух.
 *
 * Счётчик опознаётся точным совпадением с remainingLine, а не по началу
 * строки: подпись, которой нет в этом модуле, проходит как есть.
 */
export function warmupStage(
  message: string,
  p: Pick<WarmupProgress, 'remaining'> | null,
): string {
  if (p && p.remaining > 0 && message === remainingLine(p.remaining)) return COUNTING_STAGE
  return message
}
