import { tr, type Locale } from './i18n'
import type { Lean } from './mood'
import { playHref } from './playhref'
import type { Focus } from './recommend'
import type { Mood } from './types'

/*
 * Адреса и разбор параметров (playHref, parseSeedParam, parseGenreParam,
 * roomSeedOf, ключи комнат) — в lib/playhref: им таблицы пресетов не нужны,
 * а шапка каждой страницы и lib/destination везли их ради одной функции.
 * Реэкспорт — чтобы прежние импорты из lib/presets работали как были.
 */
export {
  isRoomPresetKey,
  parseGenreParam,
  parseSeedParam,
  playHref,
  ROOM_PRESET_KEYS,
  roomSeedOf,
  type RoomPresetKey,
} from './playhref'

/** Вайб-пресеты: состояние одним тапом вместо трёх вопросов (клиент-безопасный модуль) */
export type VibePreset = {
  key: string
  /**
   * Русская подпись — как была: её читают и сторожа, и всё, что пресет
   * называет по-русски. Подпись на языке страницы — presetLabel.
   */
  label: string
  /** Английская подпись — рядом с русской, а не отдельным словарём: так они не разъедутся */
  en: { label: string }
  emoji: string
  mood: Mood
  /**
   * Ось состояния рядом с настроением (lib/mood.ts). У большинства пресетов
   * её нет: «пятница с друзьями» ничего не говорит о том, есть ли силы.
   */
  lean?: Lean
}

export const VIBE_PRESETS: VibePreset[] = [
  {
    key: 'after-work',
    label: 'После работы, нет сил',
    en: { label: 'After work, no energy' },
    emoji: '🛋️',
    mood: { time: 'medium', vibe: 'chill', social: 'solo' },
    // «Нет сил» в самом названии — и до сих пор это было только «расслабиться»:
    // хардкор с тегом Relaxing проходил наравне с остальным
    lean: 'lowenergy',
  },
  {
    key: 'sleep',
    label: '30 минут до сна',
    en: { label: '30 min before bed' },
    emoji: '🌙',
    mood: { time: 'short', vibe: 'chill', social: 'solo' },
  },
  {
    key: 'friday',
    label: 'Пятница с друзьями',
    en: { label: 'Friday with friends' },
    emoji: '🎉',
    mood: { time: 'long', vibe: 'engaged', social: 'friends' },
  },
  {
    key: 'weekend',
    label: 'Залипнуть на выходные',
    en: { label: 'Lose the weekend' },
    emoji: '🕳️',
    mood: { time: 'long', vibe: 'engaged', social: 'solo' },
  },
  {
    key: 'quick',
    label: 'Быстрая катка',
    en: { label: 'Quick round' },
    emoji: '⚡',
    mood: { time: 'short', vibe: 'engaged', social: 'solo' },
  },
]

/**
 * Настроение комнаты: хост выбирает его до создания, и колода пати
 * взвешивается под него (buildGroupDeck в lib/group).
 *
 * Своим списком, а не VIBE_PRESETS. Из пяти вайб-пресетов компанию
 * подразумевает один — «Пятница с друзьями»; остальные сказаны про одного
 * человека («Залипнуть на выходные», «30 минут до сна»), и выбирать хосту
 * было бы не из чего. Оси те же: time и vibe взвешивают колоду ровно той же
 * мерой, что и выдачу /play. social у всех 'friends' — комната и есть
 * компания.
 *
 * Первый — прежнее зашитое настроение (весь вечер, с вызовом): так комнаты,
 * созданные до выбора, называются тем, чем они и были.
 */
export type RoomPreset = {
  key: string
  /**
   * Русское название — как было: оно же уходит в приглашение
   * (app/room/[id]/invite.ts) и на доску пати (/api/rooms/public), и по нему
   * пресет находится обратно (roomPresetByLabel). На языке страницы —
   * presetLabel и presetHint.
   */
  label: string
  emoji: string
  /** чем вечер отличается — одной строкой под названием */
  hint: string
  /** Английские название и подсказка — рядом с русскими (глоссарий: катка — round, не match) */
  en: { label: string; hint: string }
  mood: Mood
}

export const ROOM_PRESETS: readonly RoomPreset[] = [
  {
    key: 'evening',
    label: 'Весь вечер вместе',
    emoji: '🎉',
    hint: 'Во что можно уйти с головой на пару часов',
    en: { label: 'All evening together', hint: 'Something to get lost in for a couple of hours' },
    mood: { time: 'long', vibe: 'engaged', social: 'friends' },
  },
  {
    key: 'quick',
    label: 'Пара быстрых каток',
    emoji: '⚡',
    hint: 'Короткие матчи: зашли, сыграли, разошлись',
    en: { label: 'A few quick rounds', hint: 'Short rounds: hop in, play, head out' },
    mood: { time: 'short', vibe: 'engaged', social: 'friends' },
  },
  {
    key: 'cozy',
    label: 'Уютно и надолго',
    emoji: '🏡',
    hint: 'Строить, выживать, фармить — без спешки',
    en: { label: 'Cozy and long', hint: 'Build, survive, farm — no rush' },
    mood: { time: 'long', vibe: 'chill', social: 'friends' },
  },
  {
    key: 'talk',
    label: 'Спокойно, под разговор',
    emoji: '🛋️',
    hint: 'Лёгкое, чтобы болтать и не напрягаться',
    en: { label: 'Chill, while we talk', hint: 'Something light to play while you chat' },
    mood: { time: 'medium', vibe: 'chill', social: 'friends' },
  },
]

/**
 * Название пресета на языке страницы — и вайб-пресета, и пресета комнаты.
 * Русское — то же поле label, что было.
 */
export function presetLabel(p: Pick<VibePreset | RoomPreset, 'label' | 'en'>, locale: Locale = 'ru'): string {
  return tr(locale, { ru: p.label, en: p.en.label })
}

/** Подсказка пресета комнаты на языке страницы */
export function presetHint(p: Pick<RoomPreset, 'hint' | 'en'>, locale: Locale = 'ru'): string {
  return tr(locale, { ru: p.hint, en: p.en.hint })
}

/**
 * Пресет комнаты по русскому названию — обратный путь для тех, кто получил
 * только название: приглашение (lib/roominvite) и доска пати
 * (/api/rooms/public) отдают label как есть, а показать его надо на языке
 * страницы. Чужое — null: строка из чужих рук пресетом не становится.
 */
export function roomPresetByLabel(label: string | null | undefined): RoomPreset | null {
  return ROOM_PRESETS.find((p) => p.label === label) ?? null
}

/** Пресет комнаты по ключу из адреса; чужое и пустое — null */
export function roomPresetByKey(raw: string | null | undefined): RoomPreset | null {
  return ROOM_PRESETS.find((p) => p.key === raw) ?? null
}

/**
 * Пресет, которым названо настроение комнаты, либо null. Сверяются оси,
 * которые двигают колоду (time и vibe): social у комнаты всегда компания.
 */
export function roomPresetOf(mood: Mood | null | undefined): RoomPreset | null {
  if (!mood) return null
  return ROOM_PRESETS.find((p) => p.mood.time === mood.time && p.mood.vibe === mood.vibe) ?? null
}

/** Порядок длительности: «ближе» по времени — на меньшее число шагов */
const TIME_RANK: Record<string, number> = { short: 0, medium: 1, long: 2 }

/**
 * Пресет комнаты, ближайший к настроению, — только для ПОДСКАЗКИ, не для
 * создания комнаты.
 *
 * Пресетов четыре, сочетаний time×vibe шесть: «коротко и спокойно» и «около
 * часа, с вызовом» своей комнаты не имеют. Молча подменить их ближайшим
 * нельзя — /room/new?preset= создаёт комнату сразу, и человек получил бы
 * вечер, которого не выбирал, без способа поправить. Поэтому ближайший
 * только отмечается на экране выбора (?hint=), а решает сам хост.
 *
 * Мера: вайб дороже любой разницы во времени (3 против максимум 2 шагов).
 * «Спокойно» и «с вызовом» — разные вечера, а на полчаса дольше или короче —
 * тот же вечер: спокойной компании предлагать соревновательные катки — промах,
 * а лишние полчаса — нет. Оба вайба в пресетах есть, так что вайб
 * сохраняется всегда.
 *
 * Ничья по времени — в пользу более короткого: на час с вызовом «пара быстрых
 * каток» укладывается в то, что есть, а «весь вечер» обещал бы больше, чем у
 * компании времени. Точное совпадение стоит ноль — у четырёх сочетаний
 * ответ тот же, что у roomPresetOf. Чужие значения осей — null.
 */
export function nearestRoomPreset(mood: Pick<Mood, 'time' | 'vibe'> | null | undefined): RoomPreset | null {
  if (!mood || !Object.hasOwn(TIME_RANK, mood.time) || (mood.vibe !== 'chill' && mood.vibe !== 'engaged')) {
    return null
  }
  const cost = (p: RoomPreset) =>
    (p.mood.vibe === mood.vibe ? 0 : 3) + Math.abs(TIME_RANK[p.mood.time] - TIME_RANK[mood.time])
  let best: RoomPreset | null = null
  for (const p of ROOM_PRESETS) {
    if (
      !best ||
      cost(p) < cost(best) ||
      (cost(p) === cost(best) && TIME_RANK[p.mood.time] < TIME_RANK[best.mood.time])
    ) {
      best = p
    }
  }
  return best
}

/**
 * Мост из выдачи в пати: адрес «позвать друзей выбрать вместе» либо null.
 *
 * Только для social='friends' — человек сам сказал, что играет компанией, а
 * выдача /play собрана из ОДНОЙ его библиотеки. Пати — ровно тот инструмент,
 * который учитывает библиотеки друзей. Соло-настроению мост не предлагается:
 * звать в компанию того, кто хотел один, — давление, а не помощь.
 *
 * Точный пресет — ?preset=: комната создаётся в один тап с тем же настроением,
 * вопрос, на который человек уже ответил, второй раз не задаётся. Точного нет —
 * ?hint=: экран выбора открывается с отмеченным похожим (nearestRoomPreset), и
 * комнату создаёт только тап хоста. Оба ключа едут через вход (roomQuery в
 * lib/destination).
 */
export function roomBridgeHref(mood: Mood | null | undefined): string | null {
  if (mood?.social !== 'friends') return null
  const exact = roomPresetOf(mood)
  if (exact) return `/room/new?preset=${exact.key}`
  const near = nearestRoomPreset(mood)
  return near ? `/room/new?hint=${near.key}` : null
}

/**
 * Что /room/new делает с адресом, по которому пришли: create — пресет, с
 * которым комната создаётся сразу, без вопроса; hint — плитка, которая только
 * отмечается «похоже на твоё».
 *
 * Разбор вынесен сюда, а не оставлен в странице, чтобы главное обещание моста
 * стерёг тест: ?hint= НИКОГДА не создаёт комнату сам. Правка вида «preset ??
 * hint» в странице молча выдала бы хосту вечер, которого он не выбирал, — а
 * здесь её поймает lib/presets.test.ts. Выбранное важнее похожего: при годном
 * preset подсказка не читается вовсе. Чужие ключи — null, как у
 * roomPresetByKey.
 */
export function roomArrival(query: URLSearchParams): { create: RoomPreset | null; hint: RoomPreset | null } {
  const create = roomPresetByKey(query.get('preset'))
  return { create, hint: create ? null : roomPresetByKey(query.get('hint')) }
}

/** Адрес «Позвать в эту игру» — один на все три места, откуда зовут */
export function roomSeedHref(appid: number): string {
  return `/room/new?game=${appid}`
}

/**
 * Адрес квиза — «Изменить настроение» с выдачи и вход в «Как «X», но…» извне.
 *
 * Фокус «нераспакованное» живёт только в адресе, и голый /quiz снимал его
 * молча: человек просил сменить настроение, а получал выдачу с магазином и
 * наигранным, и ничто не говорило, что фильтр пропал. Квиз читает фокус из
 * своего адреса (from) и несёт его в playHref. Шапка и PickLink ведут на голый
 * /quiz намеренно: это и есть выход из фокуса.
 *
 * seed — так же: «похожие на X» переживают смену настроения, а страница игры
 * и полки библиотеки зовут сюда с одной затравкой — настроение спросит квиз,
 * а гость пройдёт через него и вход как обычно. Вместе с фокусом затравка не
 * едет: «нераспакованное» уже задало вопрос, и соседи X его бы не услышали
 * (та же развилка, что у кнопки «Как «X», но…» на /play).
 *
 * genre — вход со страницы жанра («Подобрать рогалики из своей библиотеки»):
 * квиз спросит настроение и понесёт жанр в playHref. С затравкой вместе не
 * едет: «как Hades» уже сказало, из чего выбирать, и сервер всё равно взял
 * бы затравку (см. buildCandidates). «Изменить настроение» с выдачи жанр не
 * несёт намеренно — как шапка не несёт фокус: это выход из узкого вопроса.
 */
export function quizHref(focus: Focus | null, seed?: number | null, genre?: string | null): string {
  if (focus) return `/quiz?from=${focus}`
  if (seed) return `/quiz?seed=${seed}`
  return genre ? `/quiz?genre=${genre}` : '/quiz'
}

/** Пресет — это обычный адрес выдачи, ровно тот же, что строит /quiz. */
export function presetHref(p: VibePreset): string {
  return playHref(p.mood, { lean: p.lean })
}
