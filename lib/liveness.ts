/**
 * Фильтр живости: отсекает то, во что физически не получится поиграть.
 *
 * Работает как ФИЛЬТР, а не как слагаемое в скоринге — ранжирование остаётся
 * за личным вкусом. Иначе всем выпадали бы одни и те же вечные хиты.
 *
 * Главный сигнал — текущий онлайн: он отличает живое от мёртвого куда резче,
 * чем отзывы. У Half-Life 2: Deathmatch 86 отзывов за 30 дней (выглядит живой),
 * но 99 игроков на весь мир — играть не с кем. Отзывы остаются запасным
 * сигналом там, где онлайн неизвестен.
 */

export type LivenessSignals = {
  /** id режимов Steam: 1 сетевая, 2 одиночная, 9/24/38/39 кооп, 36/49 PvP */
  categories: number[]
  /** игроков прямо сейчас */
  ccu?: number
  /** отзывов за последние 30 дней — запасной сигнал */
  reviews30d?: number
  reviewsTotal?: number
  /** доля положительных, 0..100 */
  reviewsPercent?: number
}

export type DeadReason = 'dead-multiplayer' | 'asset-flip' | 'panned' | 'solo-only'
export type LivenessVerdict = { alive: boolean; reason: DeadReason | null }

/** Во что играем: один, с друзьями или как получится */
export type PlayContext = 'solo' | 'party'

/** Как в эту игру вообще играют */
export type PlayMode = 'online' | 'coop' | 'solo-capable'

const SINGLE_PLAYER = 2
const COOP_IDS = [9, 24, 38, 39]
const ONLINE_IDS = [1, 36, 49]

/**
 * Режим важнее тегов. Прежняя проверка угадывала по тегам («Battle Royale»,
 * «MOBA») и не ловила HL2:DM: у неё теги Action, FPS, Shooter, Competitive —
 * ни один не выдаёт зависимость от людных серверов. А режимы выдают: там
 * стоит только «сетевая игра», без одиночной и без коопа.
 */
export function playMode(categories: number[]): PlayMode {
  const has = (ids: number[]) => categories.some((c) => ids.includes(c))
  if (categories.includes(SINGLE_PLAYER)) return 'solo-capable'
  if (has(COOP_IDS)) return 'coop'
  if (has(ONLINE_IDS)) return 'online'
  return 'solo-capable'
}

/** Публичным серверам и матчмейкингу нужна заметная толпа */
export const MIN_CCU_ONLINE = 500
/** Ниже этого игра — мусорный хвост каталога, а не игра */
export const MIN_REVIEWS_TAIL = 30
/** Запасной порог, когда онлайн неизвестен */
export const MIN_RECENT_MP = 5
export const PANNED_RATIO = 40
export const PANNED_MIN_SAMPLE = 200

/**
 * Убирает из списка то, во что сегодня не поиграть.
 *
 * Нужен для игр ИЗ БИБЛИОТЕКИ: у каталога допустимость решается офлайн при
 * наполнении, а библиотека у каждого своя и через тот проход не идёт — из-за
 * чего «Игра дня» и предлагала мёртвый мультиплеер.
 *
 * Если фильтр не оставил ничего, возвращает исходный список: пустой экран
 * хуже неудачной рекомендации.
 */
export function filterPlayable<T extends { appid: number }>(
  candidates: T[],
  metaOf: (appid: number) => { categories: number[]; ccu?: number; reviews30d?: number } | undefined,
  context: PlayContext = 'solo',
): T[] {
  const kept = candidates.filter((c) => {
    const meta = metaOf(c.appid)
    // нет метаданных — не выбрасываем: судить не на чем
    if (!meta) return true
    return judgeLiveness(
      { categories: meta.categories, ccu: meta.ccu, reviews30d: meta.reviews30d },
      context,
    ).alive
  })
  return kept.length ? kept : candidates
}

export function judgeLiveness(s: LivenessSignals, context: PlayContext = 'solo'): LivenessVerdict {
  const alive: LivenessVerdict = { alive: true, reason: null }

  // Мусорный хвост: на каталоге в сотню тысяч это самый результативный фильтр
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

  const mode = playMode(s.categories)

  // Один играешь — совместная жизнь игры не важна: одиночная игра 2004 года
  // совершенно валидная рекомендация
  if (context === 'solo' && mode === 'solo-capable') return alive

  // В компанию не годится то, во что вместе не играют вовсе
  if (context === 'party' && !s.categories.some((c) => [...ONLINE_IDS, ...COOP_IDS].includes(c))) {
    return { alive: false, reason: 'solo-only' }
  }

  // Кооп онлайном не гейтим вообще: играть в него садятся со своими друзьями,
  // а не с незнакомцами из матчмейкинга. У The Jackbox Party Pack 4 пятнадцать
  // игроков на весь мир — и это ничего не говорит о том, можно ли в неё
  // сыграть вечером вчетвером в одной комнате.
  if (mode === 'coop') return alive

  // Игру с одиночным режимом в компании судим по здоровью мультиплеера:
  // Condition Zero с её 348 игроками против ботов сойдёт, а компанию не собрать
  if (s.ccu !== undefined) {
    return s.ccu >= MIN_CCU_ONLINE ? alive : { alive: false, reason: 'dead-multiplayer' }
  }

  // Онлайн неизвестен: падение источника не должно опустошать выдачу,
  // поэтому без сигнала игра считается живой
  if (s.reviews30d === undefined) return alive
  return s.reviews30d >= MIN_RECENT_MP ? alive : { alive: false, reason: 'dead-multiplayer' }
}
