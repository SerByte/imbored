/**
 * Забыть выдачу /play на этом устройстве — при выходе (components/SignOut).
 *
 * ОТДЕЛЬНО ОТ lib/playcache — ради веса. Кнопка «Выйти» стоит на /library, а
 * lib/playcache — это разбор сохранённой выдачи целиком: lib/playflow,
 * lib/eveningplan, lib/nudge, ~6.5 КБ к первой загрузке /library (замер
 * сборкой), и всё это ехало туда ради одного вызова при выходе. Стереть
 * запись можно и без её разбора: нужен ключ в хранилище — и, если модуль
 * выдачи в этом документе уже загружен, его хранилища. Их он отдаёт сюда сам
 * при загрузке (forgetsWith): set(null) сотрёт и то, что вкладка держит в
 * памяти, и скажет подписчикам. Не загружен — в памяти выдачи нет ничего, и
 * стереть ключ в хранилище — это ровно то же, что сделал бы set(null).
 *
 * Метка прогрева (lib/warmmark) и ответ прогрева квиза (lib/warmup) — лёгкие,
 * их хранилища здесь напрямую.
 */

import { LIKE_ROWS_KEY, PLAY_DEAL_KEY } from './planforget'
import { warmMarkStore } from './warmmark'
import { forgetPrewarm } from './warmup'

/**
 * Ключи записей выдачи — одни на lib/playcache и на стирание здесь. Ключ
 * самой выдачи живёт в lib/planforget: его правят и страницы, которым этот
 * модуль с прогревом за собой не нужен.
 */
export { PLAY_DEAL_KEY }
export const PLAY_BANS_KEY = 'imbored.play.bans'

type Forgettable = { set: (value: null) => void }

let deal: Forgettable | null = null
let bans: Forgettable | null = null

/** lib/playcache при загрузке: вот мои хранилища — выход сотрёт их, а не только ключи */
export function forgetsWith(stores: { deal: Forgettable; bans: Forgettable }): void {
  deal = stores.deal
  bans = stores.bans
}

/** Хранилище модуля — если он загружен, иначе ключ напрямую. Не бросает, как и само хранилище. */
function wipe(store: Forgettable | null, key: string, area: () => Storage): void {
  if (store) {
    store.set(null)
    return
  }
  try {
    area().removeItem(key)
  } catch {
    // приватный режим, выключенные куки — записи нет, и стирать нечего
  }
}

/**
 * Забыть всё про выдачу на этом устройстве — при выходе. Привязка к viewer и
 * так не даст показать её другому, но хранить подборку вышедшего человека
 * до закрытия вкладки незачем.
 */
export function forgetPlay(): void {
  wipe(deal, PLAY_DEAL_KEY, () => sessionStorage)
  // И строки «Зашло», легшие от сердца героя (lib/unlike): по ним видно, что
  // вышедшему понравилось. Модуль читает ключ на каждом снятии, и стереть
  // ключ — достаточно. Его память — лишь когда хранилище не читается, и
  // строк чужого профиля следующему вошедшему всё равно не снять: unlikeGame
  // удаляет по steamid
  wipe(null, LIKE_ROWS_KEY, () => sessionStorage)
  warmMarkStore.set(null)
  wipe(bans, PLAY_BANS_KEY, () => localStorage)
  // И ответ прогрева, начатого квизом (lib/warmup): он про вышедшего, а
  // следующий вход в этом же документе забрал бы его первым кругом
  forgetPrewarm()
}
