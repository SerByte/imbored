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

import { COOP_IDS, isMultiplayerCategories, ONLINE_IDS, SINGLE_PLAYER } from './steamcats'
import type { Mood } from './types'

export type LivenessSignals = {
  /** id режимов Steam: 1 сетевая, 2 одиночная, 9/24/38/39 кооп, 36/49 PvP (lib/steamcats) */
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

const DEAD_REASONS: ReadonlySet<string> = new Set<DeadReason>([
  'dead-multiplayer',
  'asset-flip',
  'panned',
  'solo-only',
])

/**
 * Причина из колонки dead_reason — строка из базы, а не из этого модуля.
 * Незнакомое значение (руками поправленная строка, причина из будущей версии
 * курации) не должно стать вердиктом, для которого у страницы нет слов.
 */
export function isDeadReason(v: unknown): v is DeadReason {
  return typeof v === 'string' && DEAD_REASONS.has(v)
}

/**
 * Во что играем.
 *
 *   solo  — один или как получится. Мягкий вердикт по умолчанию: на нём
 *           офлайн-курация пишет games.alive (scripts/promote-catalog) и
 *           карточка игры называет «неактуальна» (lib/gamepage). Кооп здесь
 *           не гейтится: в него садятся со своими, и строже он выкинул бы из
 *           каталога диванный кооп, нужный колодам пати.
 *   alone — человек сам сказал, что играет один, прямо сейчас («Один» на
 *           /play). Друзей сегодня нет, и кооп без одиночного режима ему
 *           доступен, только если напарника найдёт матчмейкинг — то есть
 *           судится толпой, как сетевая игра. Только рантайм: офлайн-вердикт
 *           каталога этим контекстом не считается.
 *   party — вечер с друзьями: годится только то, во что вместе сесть.
 */
export type PlayContext = 'solo' | 'alone' | 'party'

/**
 * Контекст живости для выдачи по ответу «с кем играешь» — одно правило на
 * /play, «Игру дня», колоду «Полистать» и демо главной.
 *
 * «Один» — это 'alone', а не мягкий 'solo': раньше сюда шёл 'solo', и кооп без
 * одиночного режима проходил к тому, кто сказал «Один», каким бы мёртвым он
 * ни был. «Игра дня» спрашивает без настроения (NEUTRAL_MOOD, social 'solo')
 * и тоже получает 'alone': это одна игра на сегодня, и компании к ней никто
 * не обещал.
 *
 * moodless — колода «Полистать»: там не «во что сесть сейчас», а находки на
 * потом, и кооп в ней — вечер с друзьями, о котором просто не спрашивали.
 * Ей — мягкий 'solo', как и прежде.
 */
export function playContextOf(mood: Pick<Mood, 'social'>, moodless = false): PlayContext {
  if (mood.social === 'friends') return 'party'
  return moodless ? 'solo' : 'alone'
}

/** Как в эту игру вообще играют */
export type PlayMode = 'online' | 'coop' | 'solo-capable'

/**
 * Режим важнее тегов. Прежняя проверка угадывала по тегам («Battle Royale»,
 * «MOBA») и не ловила HL2:DM: у неё теги Action, FPS, Shooter, Competitive —
 * ни один не выдаёт зависимость от людных серверов. А режимы выдают: там
 * стоит только «сетевая игра», без одиночной и без коопа.
 */
export function playMode(categories: number[]): PlayMode {
  const has = (ids: readonly number[]) => categories.some((c) => ids.includes(c))
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
  metaOf: (
    appid: number,
  ) =>
    | {
        categories: number[]
        ccu?: number
        reviews30d?: number
        reviewsTotal?: number
        reviewsPercent?: number
      }
    | undefined,
  context: PlayContext = 'solo',
): T[] {
  const kept = candidates.filter((c) => {
    const meta = metaOf(c.appid)
    // нет метаданных — не выбрасываем: судить не на чем
    if (!meta) return true
    // Отзывы передаются с недавних пор: без них проверки «мусорный хвост» и
    // «разгромленная» в judgeLiveness были недостижимы из библиотеки и жили
    // только в офлайн-курации каталога. Библиотека через тот проход не идёт.
    return judgeLiveness(
      {
        categories: meta.categories,
        ccu: meta.ccu,
        reviews30d: meta.reviews30d,
        reviewsTotal: meta.reviewsTotal,
        reviewsPercent: meta.reviewsPercent,
      },
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
  if (context !== 'party' && mode === 'solo-capable') return alive

  // В компанию не годится то, во что вместе не играют вовсе
  if (context === 'party' && !isMultiplayerCategories(s.categories)) {
    return { alive: false, reason: 'solo-only' }
  }

  // Кооп онлайном не гейтим вообще: играть в него садятся со своими друзьями,
  // а не с незнакомцами из матчмейкинга. У The Jackbox Party Pack 4 пятнадцать
  // игроков на весь мир — и это ничего не говорит о том, можно ли в неё
  // сыграть вечером вчетвером в одной комнате.
  //
  // По категориям, а не по mode === 'coop': playMode ставит одиночный режим
  // первым — он нужен соло-контексту выше, — и кооп с одиночной кампанией
  // ([2, 1, 9, 38], Deep Rock, Overcooked) получал 'solo-capable'. Довод про
  // своих друзей к нему относится ровно так же, а падал он на порог мирового
  // онлайна ниже: диванный кооп с сотней игроков на весь мир пропадал из
  // колоды комнаты, где он есть у всех. playMode не трогаем — на нём стоят
  // серии (soloCapable) и черты игры.
  //
  // Кроме 'alone': довод «друзей приводишь своих» не к тому, кто сам сказал,
  // что играет один. Гость, ответивший «Один», получал героем Never Split the
  // Party — кооп и PvP на четверых без одиночного режима, шесть игроков на
  // весь мир: «Смотреть в Steam» вело в игру, которую одному не начать. Кооп
  // с одиночной кампанией сюда не доходит — его пропустила строка выше.
  if (context !== 'alone' && s.categories.some((c) => COOP_IDS.includes(c))) return alive

  // Дальше — сетевая игра без коопа: её мультиплеер — только публичные
  // серверы, и судим её по их здоровью. Сюда же в компании приходит игра с
  // одиночным режимом: Condition Zero ([2, 1]) с её 348 игроками против ботов
  // сойдёт, а компанию не собрать. И кооп без одиночного режима у того, кто
  // играет один: напарника ему найдёт только толпа — Dota 2 ([1, 9]) с её
  // сотнями тысяч проходит, мёртвый кооп нет.
  //
  // Известная дыра: толпа ещё не матчмейкинг. У It Takes Two публичного
  // поиска нет вовсе, а онлайн — тысячи, и этот порог её пропустит. По одним
  // категориям Steam её не отличить от Dota 2 — у обеих кооп без одиночного
  // режима и без PvP-категории, — а правило
  // «одному — только с одиночным режимом» убрало бы из одиночной выдачи и
  // CS2 с Dota 2. Это решение владельца, а не побочный эффект фильтра
  if (s.ccu !== undefined) {
    return s.ccu >= MIN_CCU_ONLINE ? alive : { alive: false, reason: 'dead-multiplayer' }
  }

  // Онлайн неизвестен: падение источника не должно опустошать выдачу,
  // поэтому без сигнала игра считается живой
  if (s.reviews30d === undefined) return alive
  return s.reviews30d >= MIN_RECENT_MP ? alive : { alive: false, reason: 'dead-multiplayer' }
}
