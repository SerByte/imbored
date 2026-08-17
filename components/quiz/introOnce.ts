/**
 * «Показывать ли титры» как внешний источник истины.
 *
 * Почему не useState + эффект. Решение зависит от sessionStorage и медиазапроса,
 * то есть от вещей, которых на сервере нет. Ленивый инициализатор состояния дал
 * бы на сервере false, а на клиенте true — расхождение гидратации на целом
 * поддереве. Внешний стор решает это ровно так, как задумано в React: во время
 * гидратации читается серверный снимок, после — клиентский.
 *
 * Побочный эффект (пометка сессии) живёт в subscribe, а не в getSnapshot:
 * снимок обязан быть чистым и может вызываться сколько угодно раз.
 *
 * Флаг пишется СРАЗУ, а не в конце церемонии: иначе перезагрузка посреди неё
 * показала бы карточку заново.
 */

const KEY = 'imbored-quiz-intro'
const REDUCE = '(prefers-reduced-motion: reduce)'

/** null — ещё не решено; дальше только true или false. */
let state: boolean | null = null
const listeners = new Set<() => void>()

function decide(): boolean {
  let seen: boolean
  try {
    seen = sessionStorage.getItem(KEY) === '1'
    sessionStorage.setItem(KEY, '1')
  } catch {
    // Приватный режим бросает. Церемония не стоит того, чтобы из-за неё
    // падала страница: считаем, что титры уже были.
    return false
  }
  if (seen) return false
  // Карточка не несёт сигнала состояния, только церемонию: при выключенных
  // анимациях её правильно убрать целиком. Комната и так уже освещена ключом
  // первого шага, а это и есть всё её содержание.
  return !window.matchMedia(REDUCE).matches
}

export function subscribeIntro(onChange: () => void): () => void {
  listeners.add(onChange)
  if (state === null) {
    state = decide()
    // subscribe вызывается после монтирования — здесь побочный эффект уместен,
    // и React перечитает снимок по этому уведомлению.
    if (state) for (const l of listeners) l()
  }
  return () => {
    listeners.delete(onChange)
  }
}

export function readIntro(): boolean {
  return state ?? false
}

/** На сервере титров нет никогда: в серверном HTML нет чёрного оверлея. */
export function readIntroOnServer(): boolean {
  return false
}

/** Церемония окончена — руками или по таймеру. Обратно уже не включается. */
export function endIntro(): void {
  if (state === false) return
  state = false
  for (const l of listeners) l()
}
