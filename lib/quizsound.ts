/**
 * Хранилище одного факта: разрешён ли звук в квизе.
 *
 * Отдельный модуль, а не состояние внутри тумблера, по двум причинам. Читает
 * этот факт не тумблер, а страница — в обработчике ответа, вне рендера; и
 * ключ хранилища обязан быть объявлен ровно один раз, иначе два его написания
 * разойдутся молча. Заодно это единственная логика звука, которую можно
 * покрыть тестом: vitest собирает только lib.
 *
 * localStorage, а не sessionStorage: выбор «звук включён» — настройка, а не
 * состояние прохождения. Тот же срок жизни, что у темы, и тот же приём с
 * try/catch — в приватном режиме и при запрещённом хранилище доступ бросает,
 * и тогда честный ответ «выключено», а не падение экрана.
 */

const KEY = 'imbored-quiz-sound'

type Listener = () => void

const listeners = new Set<Listener>()

export function isSoundOn(): boolean {
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
  } catch {
    // Не сохранилось — переживём: в этой сессии звук всё равно работает.
  }
  // Подписчиков оповещаем ВСЕГДА, даже если запись не удалась: тумблер обязан
  // показать то состояние, в котором приложение действительно находится.
  for (const l of listeners) l()
}

/** Подписка для useSyncExternalStore — источник правды один на все вкладки. */
export function subscribeSound(onChange: Listener): () => void {
  listeners.add(onChange)
  // storage приходит только из ДРУГИХ вкладок; свои изменения раздаёт цикл выше.
  const cross = (e: StorageEvent) => {
    if (e.key === KEY) onChange()
  }
  // Гард на window не ради SSR (подписка живёт только на клиенте), а ради
  // тестов: vitest гоняет lib в окружении node, где window нет вовсе.
  if (typeof window !== 'undefined') window.addEventListener('storage', cross)
  return () => {
    listeners.delete(onChange)
    if (typeof window !== 'undefined') window.removeEventListener('storage', cross)
  }
}

/** Сервер про localStorage не знает — там звука нет никогда. */
export function soundOffSnapshot(): boolean {
  return false
}
