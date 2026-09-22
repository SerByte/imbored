/**
 * Маленькое значение на устройстве — для useSyncExternalStore.
 *
 * Выросло из lib/sessionhint.ts: там тот же приём написан руками под один
 * ключ, а таких ключей становится несколько (раскрытые секции /play, прошлое
 * настроение, недавний запуск). Каждый раз заново выписывать кэш снимка,
 * try/catch и подписку на соседние вкладки — значит однажды где-то забыть одно
 * из трёх. Здесь они один раз.
 *
 * Что обещает фабрика и почему:
 *
 *   get     — одна и та же ссылка, пока значение не менялось. Этого требует
 *             useSyncExternalStore: новый объект на каждый вызов уводит React
 *             в бесконечный рендер;
 *   server  — всегда null. React берёт этот снимок для гидратации, и разметка
 *             сервера обязана совпасть с первым рендером клиента, а на сервере
 *             устройства нет;
 *   set     — записать и оповестить; null — стереть;
 *   subscribe — своя запись и запись из соседней вкладки (для localStorage).
 *
 * Ни один метод не бросает. Хранилище бросает в приватном режиме и при
 * выключенных куках, а в node его нет вовсе — это не повод ронять страницу:
 * нет значения, значит показываем то же, что и без него.
 *
 * Значение из чужих рук: в хранилище пишет кто угодно — консоль, расширение,
 * прошлая версия сайта. Поэтому каждое чтение проходит через parse, и всё, что
 * он не узнал, — null, а не «что-то похожее».
 */

export type LocalStore<T> = {
  get: () => T | null
  server: () => T | null
  set: (value: T | null) => void
  subscribe: (onChange: () => void) => () => void
}

export function createLocalStore<T>(
  key: string,
  parse: (raw: unknown) => T | null,
  storage: 'local' | 'session' = 'local',
): LocalStore<T> {
  /**
   * undefined — «ещё не читали», null — «читали, ничего нет». Разница нужна
   * снимку: без неё пустое хранилище читалось бы на каждом рендере заново.
   */
  let cache: T | null | undefined
  const listeners = new Set<() => void>()

  // Голое имя, а не window.localStorage: в node и в песочнице без хранилища
  // обращение бросает — и попадает в тот же catch, что и приватный режим
  const area = (): Storage => (storage === 'local' ? localStorage : sessionStorage)

  function read(): T | null {
    try {
      const raw = area().getItem(key)
      return raw === null ? null : parse(JSON.parse(raw))
    } catch {
      return null
    }
  }

  const get = (): T | null => {
    if (cache === undefined) cache = read()
    return cache
  }

  const server = (): T | null => null

  function set(value: T | null): void {
    cache = value
    try {
      if (value === null) area().removeItem(key)
      else area().setItem(key, JSON.stringify(value))
    } catch {
      // Не записалось — значит в следующий раз будет как без значения. Терпимо:
      // на этой вкладке оно всё равно живёт в кэше до перезагрузки.
    }
    for (const cb of [...listeners]) cb()
  }

  function subscribe(onChange: () => void): () => void {
    listeners.add(onChange)
    // Соседняя вкладка — тоже событие. У sessionStorage соседей нет: оно
    // своё у каждой вкладки, и событие storage про него не приходит
    const win = storage === 'local' && typeof window !== 'undefined' ? window : null
    const onStorage = (e: StorageEvent) => {
      // key === null — хранилище очистили целиком
      if (e.key !== null && e.key !== key) return
      cache = undefined
      onChange()
    }
    win?.addEventListener('storage', onStorage)
    return () => {
      listeners.delete(onChange)
      win?.removeEventListener('storage', onStorage)
    }
  }

  return { get, server, set, subscribe }
}

/** Разбор флага «раскрыто»: только настоящий boolean, остальное — «не знаю». */
export function parseFlag(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null
}
