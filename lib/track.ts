/**
 * Шаги воронки — числом за час, без человека.
 *
 * Вопрос «сколько людей дошло от входа до запуска игры и откуда они пришли»
 * до сих пор не имел ответа: Vercel Web Analytics считает открытые страницы,
 * а не то, что на них делают. Здесь — несколько поворотных моментов, и
 * каждый ложится в telemetry_hourly (lib/telemetry.ts) строкой
 * «событие:источник» с числом за час.
 *
 * Ничего о человеке: ни SteamID, ни адреса, ни идентификатора вкладки.
 * Шаги не связываются между собой — воронка видна как отношение чисел, а не
 * как путь конкретного человека. Источник — из закрытого списка: по какой
 * общей ссылке пришли (сравнение, портрет, комната, выбор, патч), или 'direct'.
 *
 * Модуль общий для браузера и сервера: сервер берёт отсюда разбор тела и
 * списки, браузер — отправку. Ни базы, ни next/server здесь быть не должно.
 */

export const TRACK_PATH = '/api/event'

/** Тело маяка — пара десятков байт; больше — не наш маяк */
export const TRACK_MAX_BODY = 512

/** Что шлёт браузер. Вход, демо и вход в комнату считает сервер сам. */
export const CLIENT_EVENTS = [
  /** пришёл по общей ссылке с ?ref= — раз на вкладку */
  'ref_open',
  /** ответил на квиз или нажал пресет — ушёл на выдачу */
  'quiz_done',
  /** выдача показана (первый показ, не перебор) */
  'pick_shown',
  /**
   * сколько ждал её показа — вместо источника корзина ожидания (см. WaitLabel);
   * шлётся вместе с pick_shown и только с ним, но не с каждым: «Подобрать
   * заново» — показ, а не заход
   */
  'pick_wait',
  /** нажал «Запустить» / «Установить» */
  'launch_click',
  /** поделился ссылкой (сравнение, портрет, комната) */
  'share_click',
  /** открыл чужую комнату по приглашению, ещё не войдя в неё */
  'invite_open',
  /** увидел полосу «это чужая демо-библиотека» — раз на страницу за документ */
  'demo_door_shown',
  /** нажал в ней «Войти через Steam» */
  'demo_door_steam',
  /** нажал в ней «вставить ссылку» */
  'demo_door_link',
] as const
export type ClientEvent = (typeof CLIENT_EVENTS)[number]

/**
 * Что считает сервер сам — там, где исход известен только ему. Второе поле
 * ключа у них — канал, а не источник: 'openid' (вход через Steam), 'link'
 * (ссылка на профиль), 'demo', 'room' (кнопка в комнате), 'login' (вход по
 * приглашению сразу в комнату).
 */
export const SERVER_EVENTS = ['connect_start', 'connect_ok', 'demo_start', 'invite_join'] as const
export type ServerEvent = (typeof SERVER_EVENTS)[number]
export type Channel = 'openid' | 'link' | 'demo' | 'room' | 'login'

/** Откуда пришли: закрытый список, ничего личного в значении */
export const REF_SOURCES = ['compat', 'portrait', 'room', 'pick', 'patch'] as const
export type RefSource = (typeof REF_SOURCES)[number]
export type Source = RefSource | 'direct'

export function parseRef(v: string | null | undefined): RefSource | null {
  return (REF_SOURCES as readonly string[]).includes(v ?? '') ? (v as RefSource) : null
}

/** Адрес общей ссылки с меткой источника. Прочие параметры не трогаются. */
export function withRef(url: string, source: RefSource): string {
  try {
    const u = new URL(url)
    u.searchParams.set('ref', source)
    return u.toString()
  } catch {
    return url
  }
}

/*
 * СКОЛЬКО /play ДЕРЖАЛ ЭКРАН ОЖИДАНИЯ.
 *
 * Шаги выше времени не несут и между собой не связаны, поэтому «стала ли
 * первая выдача быстрее» из них не узнать: quiz_done и pick_shown — два числа
 * за час, а не два момента одного человека. pick_wait закрывает это, не
 * нарушая правила модуля: страница сама меряет ожидание от захода на /play до
 * первой выдачи и шлёт не число, а корзину из закрытого списка. Счётчик
 * остаётся счётчиком в той же таблице — «pick_wait:путь.корзина» за час.
 *
 * Замер — только у захода на /play. «Подобрать заново» тоже показ (pick_shown
 * его считает), но ждёт он на каталоге, который этот же заход уже тронул, и в
 * cold ложился бы вторым, непохожим на заход ожиданием — ровно тем, что
 * мешает сравнить cold с prewarm.
 *
 * Путь — откуда взялся каталог к выдаче, иначе корзины ничего не сравнивают:
 *   cold    — /play грел сам, первым вызовом /api/prepare;
 *   prewarm — первый круг сделал квиз, пока человек отвечал (lib/warmup);
 *   skip    — прогрев пропущен по свежей метке (lib/playcache);
 *   demo    — демо-библиотека: греть в ней нечего, ожидание — чистый подбор.
 * Демо отдельно, а не в cold: его «прогрев» — один пустой круг до сервера, и
 * в общей корзине он делал бы холодный путь быстрее, чем тот есть. Зато он —
 * пол, ниже которого ускорять прогрев бессмысленно.
 * Источника в ключе нет: на время ожидания ссылка не влияет, а ключ и так
 * делится на двадцать.
 */
export const WAIT_PATHS = ['cold', 'prewarm', 'skip', 'demo'] as const
export type WaitPath = (typeof WAIT_PATHS)[number]

/**
 * Верхние границы корзин, секунды. Разрез по тому, что внутри: ответ модели
 * — до восьми секунд, один вызов прогрева — около десяти; всё, что дольше
 * двадцати, — уже не про скорость, а про то, дождались ли вообще.
 */
const WAIT_EDGES_SEC = [2, 5, 10, 20] as const
export const WAIT_BUCKETS = [...WAIT_EDGES_SEC.map((s) => `lt${s}` as const), 'ge20'] as const
export type WaitBucket = (typeof WAIT_BUCKETS)[number]
export type WaitLabel = `${WaitPath}.${WaitBucket}`

const WAIT_LABELS: readonly string[] = WAIT_PATHS.flatMap((p) => WAIT_BUCKETS.map((b) => `${p}.${b}`))

/** Корзина ожидания. Отрицательное и не число — ноль: часы, а не человек */
export function waitBucket(ms: number): WaitBucket {
  const sec = Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0
  for (const edge of WAIT_EDGES_SEC) if (sec < edge) return `lt${edge}`
  return 'ge20'
}

/** Разобранный маяк. wait — только у pick_wait, и у него обязателен */
export type TrackStep =
  | { event: Exclude<ClientEvent, 'pick_wait'>; source: Source }
  | { event: 'pick_wait'; source: Source; wait: WaitLabel }

/** Строгий разбор тела маяка на сервере: чужое — null */
export function parseTrackEvent(body: unknown): TrackStep | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const { event, source, wait } = body as { event?: unknown; source?: unknown; wait?: unknown }
  if (typeof event !== 'string' || !(CLIENT_EVENTS as readonly string[]).includes(event)) return null
  const src = typeof source === 'string' ? parseRef(source) : null
  if (event === 'pick_wait') {
    // Без корзины из списка маяк пуст: считать «ждал неизвестно сколько» незачем
    if (typeof wait !== 'string' || !WAIT_LABELS.includes(wait)) return null
    return { event, source: src ?? 'direct', wait: wait as WaitLabel }
  }
  return { event: event as Exclude<ClientEvent, 'pick_wait'>, source: src ?? 'direct' }
}

/**
 * Ключ счётчика: «событие:источник» (или «событие:канал» у серверных).
 *
 * Перегрузки — пары, а не «любое событие с любой второй половиной»: маршрут
 * пишет в таблицу тот ключ, что получил, и 'pick_shown:cold.lt2' или
 * 'pick_wait:direct' легли бы строками, которые никто не ждёт.
 */
export function eventKey(event: Exclude<ClientEvent, 'pick_wait'>, source: Source): string
export function eventKey(event: 'pick_wait', wait: WaitLabel): string
export function eventKey(event: ServerEvent, channel: Channel): string
export function eventKey(event: string, second: string): string {
  return `${event}:${second}`
}

/** Ключ шага от браузера: у pick_wait вместо источника — корзина ожидания */
export function stepKey(step: TrackStep): string {
  return step.event === 'pick_wait' ? eventKey(step.event, step.wait) : eventKey(step.event, step.source)
}

/* ─────────────────────────── браузер ─────────────────────────── */

/**
 * Источник этой вкладки. sessionStorage, а не cookie: метка нужна только
 * маякам этой же вкладки, на сервер сама по себе не уходит и живёт, пока
 * вкладка открыта.
 */
const REF_KEY = 'imbored-ref'

function session(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** Источник, с которым пришли в этой вкладке; 'direct' — без метки */
export function currentSource(): Source {
  try {
    return parseRef(session()?.getItem(REF_KEY)) ?? 'direct'
  } catch {
    return 'direct'
  }
}

/**
 * Запомнить метку ?ref= из адреса — первую за вкладку — и отметить приход.
 * Вторая общая ссылка в той же вкладке источник не перебивает: считаем, что
 * привело, а не что открыли следом.
 */
export function captureRef(search: string): void {
  try {
    const ref = parseRef(new URLSearchParams(search).get('ref'))
    const store = session()
    if (!ref || !store || store.getItem(REF_KEY)) return
    store.setItem(REF_KEY, ref)
    track('ref_open')
  } catch {
    // метка не записалась — страница важнее
  }
}

/**
 * Отметить шаг. Никогда не бросает и ничего не ждёт: маяк уходит и после
 * закрытия вкладки. Запрос на свой же адрес — проверка Origin в proxy.ts
 * его пропускает (Sec-Fetch-Site: same-origin).
 *
 * pick_wait сюда не ходит: без корзины сервер его не примет — для него trackWait.
 */
export function track(event: Exclude<ClientEvent, 'pick_wait'>): void {
  send({ event, source: currentSource() })
}

/**
 * Отметить, сколько /play ждал первой выдачи (pick_wait выше). Число
 * миллисекунд не уходит с устройства — только корзина.
 */
export function trackWait(path: WaitPath, ms: number): void {
  send({ event: 'pick_wait', source: currentSource(), wait: `${path}.${waitBucket(ms)}` })
}

function send(step: TrackStep): void {
  try {
    const body = JSON.stringify(step)
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(TRACK_PATH, new Blob([body], { type: 'application/json' }))) return
    }
    if (typeof fetch === 'function') {
      void fetch(TRACK_PATH, {
        method: 'POST',
        body,
        headers: { 'content-type': 'application/json' },
        keepalive: true,
      }).catch(() => {})
    }
  } catch {
    // шаг не посчитан — страница важнее
  }
}
