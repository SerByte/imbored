/**
 * Факты об игре короткой строкой — из семантики (lib/semantics), без модели.
 *
 * Отдельный модуль, а не часть lib/gamepage, потому что строку сессии теперь
 * показывают три экрана: карточка игры, герой выдачи /play и колода пати. Два
 * последних — клиентские, а gamepage тянет за собой базу. Модуль чистый: из
 * других модулей только правило режима игры (lib/liveness) и порог уверенности.
 */
import { playMode } from './liveness'
import { SEMANTICS_MIN_CONFIDENCE } from './semantics'
import type { GameMeta } from './types'

/** Строка фактов: подпись и значение */
export type GameTrait = { label: string; value: string }

/**
 * С какой уверенности семантики карточка называет длину сессии.
 *
 * По одним тегам уверенность не выше 0.4 (TAGS_MAX_CONFIDENCE в
 * lib/semantics), поэтому строку получают только игры, у которых оси
 * уточнили отзывы. Приор по тегам годится подбору — там он один голос из
 * многих, — а на публичной карточке это было бы утверждение, выданное за
 * факт: «Сессия: ~40 мин» у игры, про которую мы знаем только теги. Порог тот
 * же, по которому семантике верит подбор, — одно число на всех.
 */
export const SESSION_MIN_CONFIDENCE = SEMANTICS_MIN_CONFIDENCE

/**
 * Минуты захода словами. Четыре корзины, а не число: минуты — оценка по
 * тегам и отзывам, и «~35 мин» обещало бы точность, которой нет. Границы —
 * между соседними подписями по середине в разах (20 и 40 → 30, 40 и 90 →
 * 60), тильда у каждой: заход в 10 и в 25 минут одинаково «~20».
 */
function sessionWords(minutes: number): string {
  if (minutes < 30) return '~20 мин'
  if (minutes < 60) return '~40 мин'
  if (minutes < 120) return '~1,5 ч'
  return 'на вечер'
}

/**
 * «Сессия» или «Матч» — из семантики игры (lib/semantics), без модели.
 *
 * Матч — у сетевой игры без одиночного режима (playMode не solo-capable),
 * которую посреди не бросить (canStopAnytime false) и у которой заход не на
 * вечер. Все три условия нужны: у Rust нет одиночного режима, но «матча» там
 * нет — вайп на недели, и строка остаётся «Сессия: на вечер»; у асинхронной
 * партии можно выйти в любой момент — это тоже не матч. У матча минуты
 * называются числом: для него длина и есть главный вопрос («успею до ужина?»),
 * а оценка по отзывам про матчи обычно и говорит конкретно.
 *
 * null — семантики нет или она недостаточно уверена (SESSION_MIN_CONFIDENCE).
 */
export function sessionTrait(meta: Pick<GameMeta, 'semantics' | 'categories'>): GameTrait | null {
  const s = meta.semantics
  if (!s || s.confidence < SESSION_MIN_CONFIDENCE) return null
  const { minutes, bucket, canStopAnytime } = s.session
  const match =
    playMode(meta.categories ?? []) !== 'solo-capable' && !canStopAnytime && bucket !== 'long'
  return match
    ? { label: 'Матч', value: `~${minutes} мин` }
    : { label: 'Сессия', value: sessionWords(minutes) }
}
