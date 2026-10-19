import type { Locale } from './i18n'
import { playedShort } from './playtime'

/**
 * «ПОХОЖЕЕ УЖЕ ЕСТЬ У ТЕБЯ» — НА СТРАНИЦЕ ИГРЫ, ДО ПОКУПКИ.
 *
 * Страница игры отвечает на «стоит ли брать», и самый честный ответ продукта
 * на него — со своей полки: «почти такая же у тебя уже лежит». Правило
 * README «своё идёт первым» на странице игры не работало вовсе: про сессию
 * она не знает (ISR на сутки, одна на всех), а единственный личный бит —
 * /api/session/owns — говорил только про саму игру.
 *
 * Как устроено. Разметка ISR не меняется: соседей-своих спрашивает тот же
 * островок OwnedLaunch тем же запросом владения (near=1), а не второй
 * запрос, — и кладёт ответ сюда, в ownedNearStore. Рисует строку
 * components/OwnedNear над «Похожими», где страница её поставила. Отдельный
 * островок, а не ветка OwnedLaunch: тот стоит у кнопок героя, строка — пятью
 * экранами ниже, у соседей, к которым она относится.
 *
 * Кому. Только пишущей сессии не из демо и только когда своей игры нет
 * (решает роут): у сессии по вставленной ссылке «у тебя» говорилось бы про
 * чужой профиль, демо-библиотека выдумана, а у владельца вопрос «брать ли»
 * не стоит. Своё — из соседей игры (lib/neighbors), в их порядке, без
 * забаненного и пройденного (бан — «не предлагать», пройденное — не замена
 * покупке), не больше NEAR_SHOWN.
 *
 * Модуль без серверных импортов: его читают и роут (тип и потолок), и
 * клиентские островки.
 */

/** Сколько своих похожих называет строка: дальше это уже полка, а не подсказка */
export const NEAR_SHOWN = 3

export type OwnedNearGame = {
  appid: number
  name: string
  /** Минуты по снимку библиотеки; null — время скрыто настройками Steam */
  minutes: number | null
}

/**
 * Разбор поля near из ответа владения. Строго: чужое или битое — пустой
 * список, а не строка с «undefined» вместо имени. Потолок — и здесь: строка
 * не должна вырасти от ответа старого сервера.
 */
export function parseOwnedNear(raw: unknown): OwnedNearGame[] {
  if (!Array.isArray(raw)) return []
  const out: OwnedNearGame[] = []
  for (const x of raw) {
    if (!x || typeof x !== 'object') continue
    const { appid, name, minutes } = x as Record<string, unknown>
    if (typeof appid !== 'number' || !Number.isSafeInteger(appid) || appid <= 0) continue
    if (typeof name !== 'string' || !name.trim()) continue
    const m = typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0 ? minutes : null
    out.push({ appid, name, minutes: m })
    if (out.length >= NEAR_SHOWN) break
  }
  return out
}

/**
 * Сколько в ней наиграно — подписью после имени. Ноль — «не запускал»: это
 * и есть довод «сначала её». Скрытое время — без подписи вовсе: «не
 * запускал» про игру, где у человека пятьсот часов, было бы неправдой.
 *
 * По-английски — «25 min played» и «never launched» (глоссарий: «часов
 * наиграно» → «hours played», «ни разу не запускал» → «never launched»);
 * время — тем же playedShort своего языка.
 */
export function nearPlayedLabel(minutes: number | null, locale: Locale = 'ru'): string | null {
  if (minutes === null) return null
  if (locale === 'en') return minutes > 0 ? `${playedShort(minutes, locale)} played` : 'never launched'
  return minutes > 0 ? `наиграно ${playedShort(minutes)}` : 'не запускал'
}

type NearState = { appid: number; games: OwnedNearGame[] } | null

let state: NearState = null
const listeners = new Set<() => void>()

/**
 * Последний ответ near — для useSyncExternalStore, та же форма, что у
 * writerStore. appid рядом со списком: при переходе на соседнюю карточку
 * строка прежней игры не должна мелькнуть у новой, пока едет её ответ.
 */
export const ownedNearStore = {
  get: (): NearState => state,
  /** На сервере сессии нет — строки нет */
  server: (): NearState => null,
  set(next: NearState): void {
    state = next
    for (const l of listeners) l()
  },
  subscribe(onChange: () => void): () => void {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  },
}
