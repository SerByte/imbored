/**
 * Может ли эта сессия писать — со слов сервера, на время одного документа.
 *
 * Сессия по вставленной ссылке на профиль только читает (isWriter в
 * lib/server): оценки, баны и комнаты ей отвечают 403 needsteam. Страницам
 * нужно знать это ДО нажатия, иначе «Зашло» горит, жмётся и ничего не
 * сохраняет, а бан показывает «не получилось — нажми ещё раз» тому, у кого не
 * получится никогда.
 *
 * Ответ приносит /api/session/touch — его и так зовёт каждая страница
 * (components/SessionKeeper, на главной — карточка входа), так что лишнего
 * запроса ради признака нет. Второй источник — сам отказ needsteam: если
 * пишущий роут его вернул, значит сессия только читает, как бы ни ответил
 * touch раньше.
 *
 * Только память, без localStorage. Признак меняется входом через Steam, а
 * вход — это полный переход страницы, то есть новый документ и чистое
 * значение. Сохранённое на устройстве пережило бы вход и прятало бы кнопки у
 * того, кто только что получил право ими пользоваться.
 *
 * null — «не знаем»: гость, ответ не пришёл или ещё едет. Кнопки при этом
 * показываются как раньше, а правду скажет первый же отказ.
 *
 * Модуль без импортов: его читают клиентские страницы.
 */

let writer: boolean | null = null
const listeners = new Set<() => void>()

/** Хранилище для useSyncExternalStore — та же форма, что у createLocalStore. */
export const writerStore = {
  get: (): boolean | null => writer,
  /** На сервере сессии нет — гидратация начинается с «не знаем». */
  server: (): boolean | null => null,
  set(value: boolean | null): void {
    if (value === writer) return
    writer = value
    for (const l of listeners) l()
  },
  subscribe(onChange: () => void): () => void {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  },
}

/** Признак из тела ответа touch или connect. Всё, что не boolean, — «не знаем». */
export function writerFrom(body: unknown): boolean | null {
  if (typeof body !== 'object' || body === null) return null
  const w = (body as { writer?: unknown }).writer
  return typeof w === 'boolean' ? w : null
}

/**
 * Отказ пишущего роута «сессия только читает».
 *
 * Код читается из тела, а не выводится из статуса: под 403 живут и nothost,
 * и notmember, и private, и советы у них разные. Тело читается с копии, чтобы
 * вызывающий мог разобрать ответ и сам.
 */
export async function isNeedSteam(res: Response): Promise<boolean> {
  if (res.status !== 403) return false
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null)
  return typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'needsteam'
}
