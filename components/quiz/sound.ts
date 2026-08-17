/**
 * Состояние звука квиза. По умолчанию ВЫКЛЮЧЕНО.
 *
 * Тот же приём внешнего стора, что у титров: значение зависит от localStorage,
 * которого на сервере нет, и ленивый инициализатор состояния дал бы расхождение
 * гидратации.
 *
 * Синтезатор загружается динамически, поэтому не включивший звук не качает его
 * вовсе — это видно во вкладке «Сеть».
 */

const KEY = 'imbored-quiz-sound'

type Audio = typeof import('@/lib/quizaudio')

let on = false
let ready = false
let mod: Audio | null = null
const listeners = new Set<() => void>()

function notify() {
  for (const l of listeners) l()
}

/** Загрузка + создание контекста. Обязана вызываться из жеста человека. */
async function arm(): Promise<void> {
  mod ??= await import('@/lib/quizaudio')
  mod.armAudio()
}

export function subscribeSound(onChange: () => void): () => void {
  listeners.add(onChange)
  if (!ready) {
    ready = true
    try {
      on = localStorage.getItem(KEY) === '1'
    } catch {
      on = false
    }
    if (on) {
      // Сохранённое «включено» НЕ создаёт контекст на загрузке: браузер
      // отказал бы и написал в консоль про автоплей. Ждём первого жеста —
      // любого, хоть по фону.
      const once = () => void arm()
      window.addEventListener('pointerdown', once, { once: true })
      window.addEventListener('keydown', once, { once: true })
      notify()
    }
  }
  return () => {
    listeners.delete(onChange)
  }
}

export function readSound(): boolean {
  return on
}

export function readSoundOnServer(): boolean {
  return false
}

/** Зовётся из обработчика клика по тумблеру — то есть внутри жеста. */
export function toggleSound(): void {
  on = !on
  try {
    localStorage.setItem(KEY, on ? '1' : '0')
  } catch {
    // Приватный режим: настройка не переживёт вкладку, но работать будет.
  }
  if (on) void arm()
  notify()
}

/** Тихо не делает ничего, пока звук выключен или контекст ещё не создан. */
export function playCue(voice: 'select' | 'relight' | 'outro', step: 0 | 1 | 2 = 0): void {
  if (!on || !mod) return
  mod.play(voice, step)
}
