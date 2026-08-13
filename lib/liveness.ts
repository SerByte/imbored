/**
 * Фильтр живости: отсекает то, во что физически не получится поиграть.
 *
 * Работает как ФИЛЬТР, а не как слагаемое в скоринге — ранжирование остаётся
 * за личным вкусом. Иначе всем выпадали бы одни и те же вечные хиты.
 *
 * Главный сигнал — число отзывов за последние 30 дней: Steam отдаёт его
 * бесплатно, без ключа, для любого appid, и он честно отражает, играет ли
 * кто-то сейчас. Онлайн (CCU) официально доступен только по одной игре за
 * запрос, на каталог в сотню тысяч это неприменимо.
 */

export type LivenessSignals = {
  isMultiplayer: boolean
  /** отзывов за последние 30 дней — «во что играют сейчас» */
  reviews30d?: number
  /** всего отзывов за всё время — размер аудитории */
  reviewsTotal?: number
  /** доля положительных, 0..100 */
  reviewsPercent?: number
  releaseYear?: number
  /** режимам вроде батл-рояля нужна полная катка, коопу на двоих — нет */
  needsLobby?: boolean
}

export type DeadReason = 'dead-multiplayer' | 'asset-flip' | 'panned'

export type LivenessVerdict = { alive: boolean; reason: DeadReason | null }

/** Ниже этого игра — мусорный хвост каталога, а не игра */
export const MIN_REVIEWS_TAIL = 30
/** Мультиплеер без свежих отзывов считается заброшенным */
export const MIN_RECENT_MP = 5
/** Режимам с полным лобби нужен заметный поток игроков */
export const MIN_RECENT_LOBBY = 100
export const PANNED_RATIO = 40
export const PANNED_MIN_SAMPLE = 200

/** Теги режимов, которым нужна полная катка, а не пара человек */
const LOBBY_TAGS = new Set([
  'Battle Royale',
  'MOBA',
  'Team-Based',
  'Arena Shooter',
  'MMORPG',
  'Massively Multiplayer',
])

export function needsFullLobby(tags: Record<string, number>): boolean {
  return Object.keys(tags).some((t) => LOBBY_TAGS.has(t))
}

export function judgeLiveness(s: LivenessSignals): LivenessVerdict {
  const alive: LivenessVerdict = { alive: true, reason: null }

  // Мусорный хвост: на каталоге в сотню тысяч это самый результативный фильтр.
  // Порог применяется, только когда число отзывов вообще известно.
  if (s.reviewsTotal !== undefined && s.reviewsTotal < MIN_REVIEWS_TAIL) {
    return { alive: false, reason: 'asset-flip' }
  }

  // Разгромленные — но процент считаем сигналом только на заметной выборке
  if (
    s.reviewsPercent !== undefined &&
    s.reviewsPercent < PANNED_RATIO &&
    (s.reviewsTotal ?? 0) >= PANNED_MIN_SAMPLE
  ) {
    return { alive: false, reason: 'panned' }
  }

  // Дальше — только про совместную игру. Одиночная игра 2004 года прекрасна,
  // и «мало кто играет сейчас» для неё не приговор, а норма.
  if (!s.isMultiplayer) return alive

  // Нет сигнала — считаем живой: источник мог не ответить, и опустошать
  // выдачу из-за этого нельзя
  if (s.reviews30d === undefined) return alive

  const threshold = s.needsLobby ? MIN_RECENT_LOBBY : MIN_RECENT_MP
  if (s.reviews30d < threshold) return { alive: false, reason: 'dead-multiplayer' }

  return alive
}
