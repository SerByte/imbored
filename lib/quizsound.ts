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
 * и тогда честный ответ «выключено», а не падение экрана. Пока человек сам
 * не выбрал в этой вкладке — см. unsaved ниже.
 */

const KEY = 'imbored-quiz-sound'

type Listener = () => void

const listeners = new Set<Listener>()

/**
 * Выбор, сделанный в этой вкладке, который хранилище не приняло. null —
 * хранилище приняло последний выбор (или выбора не было), и правда в нём.
 *
 * Комментарий в setSoundOn обещал «в этой сессии звук всё равно работает»,
 * а держать выбор было негде: isSoundOn перечитывал хранилище, ловил то же
 * исключение и отвечал «выключено». На сайте с запрещёнными данными тумблер
 * не менял подпись, и звук не играл никогда. Тот же приём, что кэш вкладки у
 * createLocalStore: выбор живёт в памяти до перезагрузки.
 *
 * Проверяется раньше хранилища, а не в catch чтения: бывает, что бросает
 * только запись (переполненное хранилище), а чтение отдаёт прежнее «off».
 */
let unsaved: boolean | null = null

export function isSoundOn(): boolean {
  if (unsaved !== null) return unsaved
  try {
    return localStorage.getItem(KEY) === 'on'
  } catch {
    return false
  }
}

export function setSoundOn(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off')
    // Записалось — правда снова в хранилище, и выбор соседней вкладки (событие
    // storage) память этой не заслоняет
    unsaved = null
  } catch {
    // Не сохранилось — выбор живёт в памяти вкладки до перезагрузки (unsaved)
    unsaved = on
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
