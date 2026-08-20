/**
 * Подсказка «этот человек уже входил» — на устройстве, а не на сервере.
 *
 * Задача одна: убрать с парадного экрана мёртвое место. Главная статическая
 * (и должна такой остаться — её отдаёт CDN), поэтому узнать вошедшего в
 * разметке нельзя: кука читается только запросом. Пока ответ ехал, карточка
 * показывала «Секунду…» — то есть первое, что видел человек на сайте, было
 * место, где ничего нельзя сделать, и держалось оно целый круг до сервера.
 *
 * Теперь ответ на прошлый визит лежит рядом, и его видно сразу после
 * гидратации, без сети. Запрос всё равно уходит и всё равно главнее: подсказка
 * — это догадка, а не право входа. Ничего, что ею открывается, здесь нет;
 * ошибись она — человек увидит не тот заголовок на долю секунды, и запрос его
 * поправит. Пускать по ней внутрь нельзя, и никто не пускает.
 *
 * Хранится ник — свой собственный, на своём же устройстве. Гасится в выходе
 * (components/SignOut.tsx): без этого вышедший возвращался бы на главную и
 * читал «С возвращением».
 */

export type SessionHint = { authed: boolean; personaName: string | null }

const KEY = 'imbored.session-hint'

/**
 * undefined — «ещё не читали», null — «читали, ничего нет». Разница нужна
 * useSyncExternalStore: getSnapshot обязан возвращать ОДНУ И ТУ ЖЕ ссылку,
 * пока значение не менялось, иначе React уходит в бесконечный рендер.
 */
let cache: SessionHint | null | undefined
const listeners = new Set<() => void>()

/** Значение из чужих рук: пришло из localStorage, где его мог править кто угодно. */
function parse(raw: string): SessionHint | null {
  try {
    const v: unknown = JSON.parse(raw)
    if (typeof v !== 'object' || v === null) return null
    const o = v as Record<string, unknown>
    if (o.authed !== true) return null
    return { authed: true, personaName: typeof o.personaName === 'string' ? o.personaName : null }
  } catch {
    return null
  }
}

function read(): SessionHint | null {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? parse(raw) : null
    // localStorage бросает в приватном режиме и при выключенных куках. Это не
    // повод ронять главную: нет подсказки — покажем вход, как и раньше.
  } catch {
    return null
  }
}

export function subscribeSessionHint(onChange: () => void): () => void {
  listeners.add(onChange)
  // Выход в соседней вкладке — тоже событие: там подсказка гаснет, здесь
  // заголовок обязан перестать здороваться.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== null && e.key !== KEY) return
    cache = undefined
    onChange()
  }
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener('storage', onStorage)
  }
}

export function getSessionHint(): SessionHint | null {
  if (cache === undefined) cache = read()
  return cache
}

/**
 * На сервере подсказки нет и быть не может. Возвращаем null отдельной
 * функцией, а не тем же getSessionHint: React берёт этот снимок для
 * гидратации, и разметка сервера обязана совпасть с первым рендером клиента.
 */
export function getServerSessionHint(): SessionHint | null {
  return null
}

/** Записать ответ сервера. Гость и отсутствие ника — это стереть, а не хранить. */
export function rememberSession(hint: SessionHint | null): void {
  const next = hint && hint.authed ? hint : null
  cache = next
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next))
    else localStorage.removeItem(KEY)
  } catch {
    // Не записалось — значит в следующий раз снова будет «вход». Терпимо.
  }
  for (const cb of [...listeners]) cb()
}

/** Для выхода: забыть, что здесь кто-то был. */
export function forgetSessionHint(): void {
  rememberSession(null)
}
