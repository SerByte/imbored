import { timingSafeEqual } from 'node:crypto'

/**
 * Авторизация фоновых задач. Первый в проекте путь, не завязанный на куку
 * imbored_session: у крона сессии нет и быть не может.
 *
 * Vercel сам подставляет заголовок Authorization: Bearer $CRON_SECRET, когда
 * переменная задана в окружении проекта. x-cron-secret оставлен для ручного
 * curl и внешнего пингера.
 *
 * Без секрета в проде — закрыто наглухо: иначе публичный роут, дёргающий
 * Steam и Claude, становится бесплатным усилителем для любого желающего.
 * Локально без секрета открыто, чтобы не мешать разработке.
 */
export function cronAuthorized(headers: Headers): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return !process.env.VERCEL && process.env.NODE_ENV !== 'production'

  const given =
    headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? headers.get('x-cron-secret') ?? ''

  // сравнение длин до timingSafeEqual: на разной длине он бросает
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Запас на хвост вызова крона — то, что идёт ПОСЛЕ последнего звена.
 *
 * Хвост — это итоговая отметка в catalog_meta, отдача аренды и конец запуска
 * (onEnd в lib/chain): пинки соседних кронов, проба ключа, IndexNow. Пинок
 * самый долгий: kickCron делает до двух запросов с паузой 1.5 с, а соседний
 * роут отвечает не сразу, а после getDb и взятия аренды — на холодном старте
 * это секунды. Не уложился хвост — инстанс снимают на maxDuration: итоговой
 * отметки нет (health покажет «снят»), аренда висит до своего срока.
 */
export const CRON_TAIL_MS = 12_000

/**
 * Потолок длины вызова крона, секунд, — maxDuration всех трёх роутов.
 *
 * Триста — потолок Hobby с Fluid Compute (без Fluid было бы шестьдесят, и
 * сборка с этим числом не прошла бы). Пока звенья передавались HTTP-запросом
 * самому себе, хватало шестидесяти: на звено одна функция. Теперь звенья идут
 * подряд внутри одного вызова (lib/chain), и длина вызова — это и есть
 * пропускная способность запуска: около шести звеньев по LINK_MS.
 *
 * Сам экспорт в роуте обязан быть литералом — Next читает конфиг сегмента
 * статически, — поэтому число записано и там, а сторож в lib/chain.test.ts
 * сверяет их. Отсюда его читают /api/cron/health (когда запуск считать снятым)
 * и срок аренды.
 */
export const CRON_MAX_DURATION_SEC = 300

/**
 * Срок среза — от НАЧАЛА вызова, а не от старта after().
 *
 * Стояло `Date.now() + 50_000` внутри after(), то есть уже после ответа. До
 * него на холодном старте проходят getDb с миграциями, взятие аренды и счёт
 * очереди — секунды, которых в бюджете не было. А maxDuration считает их все:
 * after живёт не дольше maxDuration маршрута (docs Next, after.md, Duration).
 * Бюджет 50 с плюс неучтённое начало плюс хвост выходили за 60.
 *
 * startedAt берётся первой строкой GET; maxDurationSec — экспорт того же роута,
 * чтобы срок не разъехался с потолком при его правке.
 */
export function sliceDeadline(startedAt: number, maxDurationSec: number): number {
  return startedAt + maxDurationSec * 1000 - CRON_TAIL_MS
}

export type SliceClock = {
  /**
   * Зовётся в начале каждой итерации. false — следующая, если окажется не
   * короче самой долгой из уже пройденных, до срока не уложится.
   */
  next(): boolean
  /** Самая долгая итерация среза на сейчас, мс */
  readonly longestMs: number
}

/**
 * Часы среза: не пускают в итерацию, которая заведомо не уложится.
 *
 * Срок проверялся только на входе в итерацию: «прошёл ли он». Итерация
 * карточки — это два похода в Steam через пейсер (1.7 с на шаг, таймаут по
 * 10 с) и вызов модели; начатая за секунду до срока, она выходила за него на
 * всю свою длину — ровно в хвост, отведённый под finally.
 *
 * Вопрос теперь другой: «уложится ли ещё одна». Длина итерации заранее не
 * известна, поэтому берётся самая долгая из уже пройденных в этом срезе —
 * оценка сверху по фактам, а не по худшему случаю (худший — двадцать с лишним
 * секунд на таймаутах — урезал бы срез вдвое ради редкого события). Первая
 * итерация идёт по-старому, по одному сроку: сравнить её ещё не с чем.
 *
 * Итерация меряется от начала до начала следующей, поэтому в неё попадает всё,
 * включая ветки с continue.
 */
export function sliceClock(deadlineAt: number): SliceClock {
  let longest = 0
  let prev: number | null = null
  return {
    next() {
      const t = Date.now()
      if (prev !== null) longest = Math.max(longest, t - prev)
      prev = t
      return t + longest <= deadlineAt
    },
    get longestMs() {
      return longest
    },
  }
}

type Stopped = 'done' | 'budget' | 'blocked'

/**
 * Почему звено само сказало «хватит» — решение задачи по итогу звена
 * (*LinkVerdict ниже):
 *   • done    — работа кончилась: очередь выбрана;
 *   • blocked — Steam закрылся от нашего IP, следующее звено начало бы с
 *               похода в закрытый магазин;
 *   • llm     — модели нет: бюджет суток выбран (lib/llmcap) или сервис
 *               отказал, а без неё звену делать нечего;
 *   • failed  — звено упало, и эта задача после падения дальше не идёт.
 */
export type LinkStop = 'done' | 'blocked' | 'llm' | 'failed'

/**
 * Почему запуск кончился — поле ended в отметке *_last_slice. Сверх решений
 * звена (LinkStop) — то, что проверяет сам цикл (lib/chain) перед каждым
 * звеном:
 *   • time   — до срока функции осталось меньше, чем нужно звену (LINK_MS);
 *   • links  — потолок звеньев на запуск;
 *   • daily  — суточный потолок звеньев (у карточек, pagesDailyLinks);
 *   • paused — килл-свитч поставили посреди запуска;
 *   • lease  — аренду взял кто-то другой: два потока к Steam хуже остановки.
 *
 * Нормальны все, кроме failed (его видно и по полю «упало») и lease: это
 * значит, что рядом работал второй поток, — строка в лог с console.error.
 */
export type ChainStop = LinkStop | 'time' | 'links' | 'daily' | 'paused' | 'lease'

/**
 * Идти ли карточкам на следующее звено. null — идти.
 *
 * Работа есть у среза карточек (hasMore) ИЛИ у сверки сигналов каталога
 * (lib/catalogsignals: budget — устаревшие остались). Второе нужно, когда
 * очередь карточек выбрана: без него запуск кончался бы первым звеном, и
 * сверка шла бы одной пачкой в сутки — круг по пулу в месяц вместо недели.
 *
 * Блок Steam у карточек останавливает запуск и при работе у сверки:
 * следующее звено всё равно начало бы с похода в закрывшийся магазин.
 *
 * Упавшее звено не останавливает: бросить может любой db.execute внутри
 * среза — сетевой вызов к Turso, — и следующее звено заново выберет очередь
 * и, скорее всего, отработает. Долбёжку держат потолки звеньев.
 *
 * Модель карточкам не обязательна: выбранный бюджет суток срез переживает
 * эвристикой (llmCapped), и скриншоты, вердикт отзывов и семантика нетронутых
 * карточек от модели не зависят. Поэтому «llm» здесь не бывает.
 */
export function pagesLinkVerdict(s: {
  failed: boolean
  slice: { hasMore: boolean; stopped: Stopped } | null
  signals: { stopped: Stopped } | null
}): LinkStop | null {
  if (s.failed) return null
  if (s.slice?.stopped === 'blocked') return 'blocked'
  return s.slice?.hasMore || s.signals?.stopped === 'budget' ? null : 'done'
}

/**
 * Идти ли новостям на следующее звено. Упавшее звено идёт дальше — довод тот
 * же, что у карточек: одно моргнувшее соединение с Turso не должно стоить
 * часа ленты.
 */
export function newsLinkVerdict(s: {
  failed: boolean
  result: { hasMore: boolean; stopped: Stopped } | null
}): LinkStop | null {
  if (s.failed) return null
  if (s.result?.stopped === 'blocked') return 'blocked'
  return s.result?.hasMore ? null : 'done'
}

/**
 * Идти ли пересказам на следующее звено.
 *
 * Упавшее звено здесь запуск ОСТАНАВЛИВАЕТ, в отличие от карточек и новостей,
 * и это про деньги. Из runDigestSlice наружу летят только ошибки базы (отказ
 * модели он гасит сам), и одна из них — запись пересказа, которая идёт уже
 * ПОСЛЕ оплаченного вызова. Если база перестала принимать записи, следующее
 * звено взяло бы ту же запись и заплатило бы за неё ещё раз, и так до потолка
 * звеньев. Цена остановки мала: через час придёт воркфлоу, а
 * /api/cron/health покажет «упало».
 *
 * Модель пересказам нужна целиком: 'capped' (бюджет суток выбран) и
 * 'unavailable' (ключа нет или сервис отказал) — это «llm».
 */
export function digestLinkVerdict(s: {
  failed: boolean
  result: { hasMore: boolean; stopped: 'done' | 'budget' | 'unavailable' | 'capped' } | null
}): LinkStop | null {
  if (s.failed) return 'failed'
  if (s.result?.stopped === 'capped' || s.result?.stopped === 'unavailable') return 'llm'
  return s.result?.hasMore ? null : 'done'
}

/**
 * Потолок звеньев карточек в сутки по Fluid Active CPU.
 *
 * Hobby даёт 4 часа Active CPU в месяц — это 480 с в сутки, — и на замере за
 * окно их уже почти половина занята (1 ч 56 мин: рендеры страниц, остальные
 * кроны). Звено карточек почти всё время ЖДЁТ — пейсер Steam (1.7 с на шаг),
 * ответы магазина и модели, — а Active CPU считает только работу: разбор
 * двадцати ответов appdetails и appreviews, отбор цитат и семантика, запросы
 * к Turso. Оценка сверху — около 2 с на звено плюс секунда холодного старта на
 * запуск. 24 звена — это ~50 с в сутки, около 25 минут в месяц: десятая часть
 * тарифа. Больше — уже заметный кусок остатка, который делят все.
 */
export const PAGES_LINKS_CPU_CAP = 24

/**
 * Сколько вызовов модели тратит звено карточек, когда модель есть.
 *
 * Звено — LINK_MS, 48 с. Без модели в него влезает около четырнадцати
 * карточек (замер на проде: claimed 20, enriched 14, stopped budget). С
 * моделью к каждой добавляется вызов pros/cons, 3–5 с у Haiku, и карточек
 * становится около восьми — и все восемь с вызовом: верх каталога, которому
 * он и нужен, весь с отзывами (порог PROS_CONS_MIN_REVIEWS в lib/pagejob).
 */
export const PAGES_LLM_PER_LINK = 8

/**
 * Какую долю суточного бюджета модели (LLM_DAILY_CAP) могут взять карточки.
 *
 * Бюджет общий: пересказы патчей, подбор и портреты берут из него же. Половина
 * — чтобы карточки не выбирали его целиком: при LLM_DAILY_CAP=150 это 75
 * вызовов, то есть девять звеньев (pagesDailyLinks).
 *
 * Это ПОТОЛОК, а не резерв: вторую половину никто карточкам не держит, бюджет
 * берёт тот, кто успел первым (takeLlmBudget). Сколько достаётся на деле —
 * см. pagesDailyLinks.
 */
export const PAGES_LLM_SHARE = 0.5

/**
 * Меньше этого потолок не опускается: даже при крошечном бюджете модели
 * карточкам нужны скриншоты, вердикт отзывов и семантика — работа без модели.
 * Три звена — половина одного запуска.
 */
export const PAGES_LINKS_MIN = 3

/**
 * Суточный потолок звеньев крона карточек.
 *
 * Карточек в каталоге пять тысяч нетронутых и три сотни верха с эвристикой
 * вместо модели, так что работа есть всегда — ограничивать приходится не
 * очередью, а ценой. Цена двух видов, и потолок — меньшее из двух чисел:
 *   • Active CPU — PAGES_LINKS_CPU_CAP;
 *   • модель — PAGES_LLM_SHARE бюджета суток по PAGES_LLM_PER_LINK на звено.
 * Бюджет суток — живой LLM_DAILY_CAP, а не число из головы: владелец его
 * меняет, и потолок едет следом. Модели нет вовсе (нет ключа, бюджет 0) —
 * остаётся один CPU. Считается при каждом вызове: vi.stubEnv и смена
 * переменной без передеплоя.
 *
 * При LLM_DAILY_CAP=150: min(24, floor(150 × 0.5 / 8)) = 9 звеньев, до
 * семидесяти карточек с моделью в сутки против двадцати–сорока до перехода на
 * звенья внутри вызова.
 *
 * «До» — не оговорка. Доля карточкам не резервируется (PAGES_LLM_SHARE), а
 * пересказы с бэклогом за первый запуск суток, в 00:17 UTC, берут по 25
 * вызовов на звено — шесть звеньев, весь бюджет 150. Первый запуск карточек
 * идёт в те же минуты (его пинает конец запуска новостей), по 8 вызовов на
 * звено, и бюджет кончается у обоих минуты через четыре: карточкам достаётся
 * около тридцати вызовов, а не семьдесят пять. Остальные их звенья суток идут
 * эвристикой (llmCapped) — и всё равно засчитываются в потолок, посчитанный
 * от модели, хотя по CPU их пустили бы до PAGES_LINKS_CPU_CAP. Пока пересказы
 * не разобраны, так и будет; честная доля — это порог в проверке перед звеном
 * пересказов, отдельная правка.
 */
export function pagesDailyLinks(o: { llmCap: number; llmOn: boolean }): number {
  if (!o.llmOn || o.llmCap <= 0) return PAGES_LINKS_CPU_CAP
  const byLlm = Math.floor((o.llmCap * PAGES_LLM_SHARE) / PAGES_LLM_PER_LINK)
  return Math.min(PAGES_LINKS_CPU_CAP, Math.max(PAGES_LINKS_MIN, byLlm))
}

/** Сколько крон пересказов может молчать, прежде чем его считают отвалившимся */
export const DIGEST_STALE_SEC = 3 * 3600

/**
 * Сколько может молчать крон новостей. Ходит ежечасно из GitHub (и раз в сутки
 * из vercel.json), так что три часа — это два пропущенных слота подряд.
 */
export const NEWS_STALE_SEC = 3 * 3600

/**
 * Сколько может молчать крон карточек.
 *
 * Его зовут конец запуска новостей (раз в час, pagesNeedKick) и суточное
 * расписание в vercel.json — но только пока не выбран суточный потолок
 * звеньев (pagesDailyLinks). Выбирается он в первые часы суток UTC, и дальше
 * карточки молчат до следующей полуночи: почти сутки тишины — норма. Сутки
 * плюс два часа: на эту норму, на опоздания GitHub и на разброс Hobby внутри
 * часа.
 */
export const PAGES_STALE_SEC = 26 * 3600

export type CronJob = 'news' | 'digest' | 'pages'

type CronJobMeta = {
  /** Ключ catalog_meta, куда каждое звено пишет отметку о себе */
  lastKey: string
  /** Килл-свитч: '1' — крон стоит */
  pausedKey: string
  /** Сколько крону можно молчать, секунд */
  staleSec: number
}

/**
 * Где каждый крон оставляет след и сколько ему можно молчать.
 *
 * Одно место и для роутов, которые пишут отметку, и для тех, кто её читает
 * (пинок из /api/cron/news, /api/cron/health). Ключ, записанный одной
 * строкой, а прочитанный другой, — тот самый молчаливый обрыв, от которого
 * всё это и строится.
 */
export const CRON_JOBS: Record<CronJob, CronJobMeta> = {
  news: { lastKey: 'news_last_slice', pausedKey: 'news_paused', staleSec: NEWS_STALE_SEC },
  digest: { lastKey: 'digest_last_slice', pausedKey: 'digest_paused', staleSec: DIGEST_STALE_SEC },
  pages: { lastKey: 'pages_last_slice', pausedKey: 'pages_paused', staleSec: PAGES_STALE_SEC },
}

/**
 * Отметка суточной уборки (sweepStale): пишет крон новостей, читает
 * /api/cron/health. Одно имя на обоих — по той же причине, что CRON_JOBS.
 */
export const SWEEP_KEY = 'sweep_last'

/**
 * То, что крон пишет о себе в *_last_slice. Поля среза сверх этих не нужны.
 * llm — отказ сервиса модели внутри среза (DigestResult, PageSliceResult):
 * срез при этом отработал эвристикой и сам не «упал».
 *
 * links и ended пишет цикл звеньев (lib/chain): links — сколько звеньев
 * прошло в этом запуске, ended — почему он кончился (ChainStop). Отметка с
 * links, но без ended, — промежуточная: запуск ещё идёт или его сняли.
 * В отметках до перехода на звенья внутри вызова обоих полей нет.
 */
type SliceMark = {
  at: number
  упало?: string
  llm?: 'down'
  llmStatus?: number | null
  links?: number
  ended?: string
}

/** null — записи нет или в ней мусор: подтверждения, что крон жив, нет. */
function readMark(raw: string | null): SliceMark | null {
  if (!raw) return null
  try {
    const o = JSON.parse(raw) as {
      at?: unknown
      упало?: unknown
      llm?: unknown
      llmStatus?: unknown
      links?: unknown
      ended?: unknown
    }
    const at = Number(o?.at ?? 0)
    if (!Number.isFinite(at) || at <= 0) return null
    return {
      at,
      ...(typeof o.упало === 'string' ? { упало: o.упало } : {}),
      ...(o.llm === 'down'
        ? { llm: 'down' as const, llmStatus: typeof o.llmStatus === 'number' ? o.llmStatus : null }
        : {}),
      ...(typeof o.links === 'number' && Number.isFinite(o.links) ? { links: o.links } : {}),
      ...(typeof o.ended === 'string' ? { ended: o.ended } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Через сколько промежуточную отметку считать запуском, который сняли.
 *
 * Промежуточную отметку цикл пишет после каждого звена, итоговую — в конце
 * запуска, а весь запуск укладывается в maxDuration от своего начала. Значит
 * промежуточная отметка старше maxDuration — это запуск, который до итоговой
 * не дожил: инстанс сняли по сроку посреди звена (звено вышло за LINK_MS так,
 * что съело и хвост). Минута сверху — на расхождение часов и на то, что after
 * стартует не в ту же миллисекунду, что и вызов.
 */
export const RUN_LOST_SEC = CRON_MAX_DURATION_SEC + 60

/**
 * Сколько отказ модели в отметке считается новостью. Пересказы пишут отметку
 * каждый час, и живой отказ там не устаревает. А отметка карточек живёт сутки
 * (PAGES_STALE_SEC): мимолётный сбой в утреннем звене красил бы health весь
 * день — и присылал письмо «воркфлоу упал» каждый час.
 */
export const LLM_DOWN_FRESH_SEC = 3 * 3600

/**
 * Пора ли пнуть крон вручную: последний срез старше maxAgeSec.
 *
 * Началось с пересказов. У новостей есть подстраховка — суточный крон в
 * vercel.json, — а у пересказов нет: на Hobby лимит два расписания на проект,
 * и оба заняты. Значит пересказы висят на одном GitHub Actions, а он глушит
 * расписания после шестидесяти дней тишины в репозитории и вообще ничего не
 * обещает по срокам. Отвалиться это может молча. Три часа (DIGEST_STALE_SEC) —
 * с запасом на обычные опоздания GitHub (10–15 минут) и на пропущенный
 * слот-другой.
 *
 * Неразобранный JSON, отсутствующая запись и мусор в поле означают одно и то
 * же: подтверждения, что крон жив, у нас нет. Значит пинаем.
 */
export function sliceLooksStale(raw: string | null, nowSec: number, maxAgeSec: number): boolean {
  const mark = readMark(raw)
  return !mark || nowSec - mark.at >= maxAgeSec
}

/**
 * Пора ли крону новостей пнуть крон карточек: суточный потолок звеньев
 * (pagesDailyLinks) ещё не выбран.
 *
 * Отсюда карточки и берут часовой ритм, а не из .github/workflows/cron.yml, и
 * это не случайность. Аренда Steam у карточек и новостей ОДНА (STEAM_LEASE:
 * тот же хост, тот же лимит), а воркфлоу пингует новости первыми. Пинг
 * карточек секундой позже почти всегда упирался бы в аренду новостей и
 * отвечал skipped: locked — час за часом. Конец запуска новостей — ровно тот
 * момент, когда аренду только что отдали: запуски идут друг за другом, а не
 * наперегонки.
 *
 * Пинок — один HTTP-запрос от корневого вызова (новости зовёт воркфлоу или
 * расписание Vercel), а не цепочка: 508 (INFINITE_LOOP_DETECTED) Vercel
 * отвечал со второго шага самовызова, первый проходил и раньше. Карточки
 * дальше никого не зовут.
 *
 * Долбёжки нет: пинает только конец запуска новостей, раз в час, а выбранный
 * потолок пинки прекращает до полуночи UTC. Если пинок не дошёл, остаётся
 * суточное расписание в vercel.json.
 */
export function pagesNeedKick(o: { linksToday: number; cap: number }): boolean {
  return o.linksToday < o.cap
}

export type SliceHealth =
  | { ok: true; ageSec?: number; paused?: true }
  | {
      ok: false
      problem: 'нет записи' | 'протух' | 'упало' | 'снят' | 'модель недоступна' | 'ключ Steam'
      ageSec?: number
      /** Причина из самой отметки: текст исключения или сколько звеньев успело пройти */
      detail?: string
    }

/**
 * Здоров ли крон по его последней отметке — для /api/cron/health.
 *
 * Отказ крона не оставлял следов снаружи: воркфлоу проверял только код
 * первого ответа, а это 202 ДО after(), то есть до всякой работы. Узнавали по
 * пустым карточкам неделями позже.
 *
 * Нездоров, если отметки нет, она старше staleSec, либо последнее, что крон о
 * себе записал, — «упало», либо запуск сняли, не дав дописать итог («снят»,
 * RUN_LOST_SEC). И если в свежей отметке (моложе
 * LLM_DOWN_FRESH_SEC) сервис модели отказал: пустой баланс или отозванный
 * ключ иначе видно только по тому, что пересказы перестали появляться, а
 * карточки собираются эвристикой. «Ключа нет вовсе» отказом не считается —
 * это настройка (без ключа сервис работает на эвристике), а не авария.
 *
 * «Обрыва» — отказа передать звено HTTP-запросом самому себе — больше нет:
 * звенья идут внутри одного вызова (lib/chain). Он и был нормой: Vercel
 * отвечал 508 на втором шаге самовызова, и health краснел каждый день. На его
 * месте «снят» — единственный путь, которым такой запуск умирает молча.
 * Старая отметка с «обрывом» ничего не значит и перезапишется первым же
 * запуском.
 *
 * Пауза (килл-свитч *_paused) — здорова, но видна. Паузу ставят руками и во
 * время разбора аварии, и ежечасное письмо «воркфлоу упал» в это время —
 * шум, а не сигнал. Забытую паузу показывает отчёт (scripts/news-report.ts,
 * раздел J) и поле paused в ответе.
 */
export function sliceHealth(
  raw: string | null,
  nowSec: number,
  staleSec: number,
  paused = false,
): SliceHealth {
  const mark = readMark(raw)
  const ageSec = mark ? nowSec - mark.at : undefined
  if (paused) return { ok: true, paused: true, ...(ageSec !== undefined ? { ageSec } : {}) }
  if (!mark || ageSec === undefined) return { ok: false, problem: 'нет записи' }
  if (mark.упало) return { ok: false, problem: 'упало', ageSec, detail: mark.упало }
  if (mark.links !== undefined && mark.ended === undefined && ageSec >= RUN_LOST_SEC) {
    return { ok: false, problem: 'снят', ageSec, detail: `звеньев: ${mark.links}` }
  }
  if (ageSec >= staleSec) return { ok: false, problem: 'протух', ageSec }
  if (mark.llm === 'down' && ageSec < LLM_DOWN_FRESH_SEC) {
    const detail = mark.llmStatus == null ? 'нет связи' : `HTTP ${mark.llmStatus}`
    return { ok: false, problem: 'модель недоступна', ageSec, detail }
  }
  return { ok: true, ageSec }
}

/**
 * Есть ли в отметке тревога, которую health ещё обязан показать: «упало»,
 * «снят» или свежий отказ модели. Возраст против staleSec не в счёт: «протух»
 * лечит сам запуск, который как раз начинается.
 *
 * Нужна циклу звеньев (lib/chain): стартовая отметка запуска такую не
 * затирает. Иначе итог упавшего запуска жил бы до следующего триггера, то есть
 * до первой сотни миллисекунд после его 202, а health, которого зовут секундами
 * позже (воркфлоу, ручной curl), видел бы свежее { links: 0 } и отвечал 200 —
 * каждый час, сколько бы запусков подряд ни падало.
 */
export function sliceAlarm(raw: string | null, nowSec: number): boolean {
  const h = sliceHealth(raw, nowSec, Infinity)
  return !h.ok && h.problem !== 'нет записи'
}

/**
 * Жив ли ключ Steam Web API — по отметке пробы (lib/steamprobe.ts), которую
 * пишет конец запуска новостей раз в час. Отозванный или просроченный ключ
 * иначе виден только как проглоченные строки в логе входа: люди просто не
 * могут войти.
 *
 * Отметки нет или она старше staleSec — пробы не было: запуск новостей не
 * доходит до конца (это же покажет и сам news). Пауза новостей — здорово,
 * как у кронов: проба стоит вместе с ними.
 */
export function steamKeyHealth(
  raw: string | null,
  nowSec: number,
  staleSec: number,
  paused = false,
): SliceHealth {
  let mark: { at: number; ok: boolean; transient: boolean; detail?: string } | null = null
  try {
    const o = raw
      ? (JSON.parse(raw) as { at?: unknown; ok?: unknown; detail?: unknown; transient?: unknown })
      : null
    const at = Number(o?.at ?? 0)
    if (o && Number.isFinite(at) && at > 0) {
      mark = {
        at,
        ok: o.ok === true,
        transient: o.transient === true,
        ...(typeof o.detail === 'string' ? { detail: o.detail } : {}),
      }
    }
  } catch {
    mark = null
  }
  const ageSec = mark ? nowSec - mark.at : undefined
  if (paused) return { ok: true, paused: true, ...(ageSec !== undefined ? { ageSec } : {}) }
  if (!mark || ageSec === undefined) return { ok: false, problem: 'нет записи' }
  if (ageSec >= staleSec) return { ok: false, problem: 'протух', ageSec }
  // Мигание Steam (5xx, 429, таймаут) про ключ ничего не говорит
  if (!mark.ok && !mark.transient) {
    return { ok: false, problem: 'ключ Steam', ageSec, ...(mark.detail ? { detail: mark.detail } : {}) }
  }
  return { ok: true, ageSec }
}
