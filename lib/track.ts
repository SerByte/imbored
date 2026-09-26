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
 * общей ссылке пришли (сравнение, портрет, комната, выбор), или 'direct'.
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
  /** нажал «Запустить» / «Установить» */
  'launch_click',
  /** поделился ссылкой (сравнение, портрет, комната) */
  'share_click',
  /** открыл чужую комнату по приглашению, ещё не войдя в неё */
  'invite_open',
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
export const REF_SOURCES = ['compat', 'portrait', 'room', 'pick'] as const
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

/** Строгий разбор тела маяка на сервере: чужое — null */
export function parseTrackEvent(body: unknown): { event: ClientEvent; source: Source } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const { event, source } = body as { event?: unknown; source?: unknown }
  if (typeof event !== 'string' || !(CLIENT_EVENTS as readonly string[]).includes(event)) return null
  const src = typeof source === 'string' ? parseRef(source) : null
  return { event: event as ClientEvent, source: src ?? 'direct' }
}

/** Ключ счётчика: «событие:источник» (или «событие:канал» у серверных) */
export function eventKey(event: ClientEvent, source: Source): string
export function eventKey(event: ServerEvent, channel: Channel): string
export function eventKey(event: string, second: string): string {
  return `${event}:${second}`
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
 */
export function track(event: ClientEvent): void {
  try {
    const body = JSON.stringify({ event, source: currentSource() })
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
