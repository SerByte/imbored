import { createLocalStore } from './localstore'
import { plural } from './plural'
import type { Mood } from './types'

/**
 * Правило остановки: «не зацепило за двадцать минут — вернись за другой».
 *
 * Выдача обещала одну игру, но молчала о том, что делать, если она не пошла.
 * А без разрешения уйти человек либо терпит вечер в том, что не нравится, либо
 * бросает и закрывает Steam совсем — и оба исхода хуже, чем «вернуться за
 * другой». Правило снимает цену ошибки выбора: попробовать не страшно, потому
 * что выход назван заранее.
 *
 * Две половины. Строка под кнопками называет срок до запуска, а запомненный
 * запуск задаёт вопрос после: вернулся на /play спустя десять минут — значит,
 * самое время спросить «не зацепило?», не дожидаясь, пока он сам найдёт
 * кнопку «Не то — дальше».
 *
 * Хранится в sessionStorage, а не в localStorage: запуск — событие одной
 * вкладки и одного вечера. Завтрашний вопрос про вчерашний запуск был бы
 * не заботой, а слежкой.
 */

export type LaunchMemo = { appid: number; name: string; at: number }

/** Раньше спрашивать рано: игра ещё грузится, а человек ещё в меню настроек */
export const ASK_AFTER_SEC = 10 * 60

/** Позже — вопрос опоздал: либо зацепило, либо вечер уже кончился */
export const ASK_UNTIL_SEC = 2 * 3600

/**
 * Разбор записи из хранилища. Пишет туда кто угодно, поэтому без целого appid,
 * имени и числового `at` записи нет — вопрос про «игру undefined» хуже
 * отсутствия вопроса.
 */
export function parseLaunchMemo(raw: unknown): LaunchMemo | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as { appid?: unknown; name?: unknown; at?: unknown }
  if (typeof r.appid !== 'number' || !Number.isInteger(r.appid) || r.appid === 0) return null
  if (typeof r.name !== 'string' || !r.name.trim()) return null
  if (typeof r.at !== 'number' || !Number.isFinite(r.at)) return null
  return { appid: r.appid, name: r.name, at: r.at }
}

export const launchMemoStore = createLocalStore('imbored.play.launch', parseLaunchMemo, 'session')

export function rememberLaunch(appid: number, name: string, nowSec: number): void {
  launchMemoStore.set({ appid, name, at: nowSec })
}

/** Пора ли спросить: запуск был от десяти минут до двух часов назад */
export function dueLaunch(memo: LaunchMemo | null, nowSec: number): LaunchMemo | null {
  if (!memo) return null
  const age = nowSec - memo.at
  return age >= ASK_AFTER_SEC && age < ASK_UNTIL_SEC ? memo : null
}

/**
 * Снимок для useSyncExternalStore: сам запуск (та же ссылка, что в кэше
 * хранилища) или null. Часы читаются здесь, а не в рендере — рендер обязан
 * быть чистым, а снимок и есть место, где страница спрашивает внешний мир.
 */
export function dueLaunchNow(): LaunchMemo | null {
  return dueLaunch(launchMemoStore.get(), Math.floor(Date.now() / 1000))
}

/**
 * Когда перечитывать снимок: своя запись и возвращение на вкладку.
 *
 * Возвращение — это и visibilitychange (вкладку свернули и развернули), и
 * focus окна: игра на весь экран поверх браузера вкладку не прячет, и
 * вернувшийся alt-tab'ом человек видимости не менял вовсе — только фокус.
 */
export function subscribeDueLaunch(onChange: () => void): () => void {
  const off = launchMemoStore.subscribe(onChange)
  if (typeof window === 'undefined' || typeof document === 'undefined') return off
  const onVisible = () => {
    if (document.visibilityState === 'visible') onChange()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('focus', onChange)
  return () => {
    off()
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('focus', onChange)
  }
}

/**
 * Сколько минут дать игре — по длине вечера из настроения. Короткому вечеру
 * короткий срок: из получаса нельзя отдать двадцать минут на пробу.
 */
export const STOP_MINUTES: Record<Mood['time'], number> = { short: 15, medium: 20, long: 30 }

/**
 * Строка под кнопками. Разрешение, а не таймер: «возвращайся», а не «у тебя
 * осталось», — счётчик на экране превратил бы отдых в задачу на время.
 */
export function stopRuleLine(time: Mood['time']): string {
  const m = STOP_MINUTES[time] ?? STOP_MINUTES.medium
  return `Не зацепит за ${m} ${plural(m, 'минуту', 'минуты', 'минут')} — возвращайся, дадим другую.`
}
