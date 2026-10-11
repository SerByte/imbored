import type { Lean } from './mood'
import type { Focus } from './recommend'
import type { Mood } from './types'

/** Вайб-пресеты: состояние одним тапом вместо трёх вопросов (клиент-безопасный модуль) */
export type VibePreset = {
  key: string
  label: string
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
    emoji: '🛋️',
    mood: { time: 'medium', vibe: 'chill', social: 'solo' },
    // «Нет сил» в самом названии — и до сих пор это было только «расслабиться»:
    // хардкор с тегом Relaxing проходил наравне с остальным
    lean: 'lowenergy',
  },
  {
    key: 'sleep',
    label: '30 минут до сна',
    emoji: '🌙',
    mood: { time: 'short', vibe: 'chill', social: 'solo' },
  },
  {
    key: 'friday',
    label: 'Пятница с друзьями',
    emoji: '🎉',
    mood: { time: 'long', vibe: 'engaged', social: 'friends' },
  },
  {
    key: 'weekend',
    label: 'Залипнуть на выходные',
    emoji: '🕳️',
    mood: { time: 'long', vibe: 'engaged', social: 'solo' },
  },
  {
    key: 'quick',
    label: 'Быстрая катка',
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
  label: string
  emoji: string
  /** чем вечер отличается — одной строкой под названием */
  hint: string
  mood: Mood
}

export const ROOM_PRESETS: readonly RoomPreset[] = [
  {
    key: 'evening',
    label: 'Весь вечер вместе',
    emoji: '🎉',
    hint: 'Во что можно уйти с головой на пару часов',
    mood: { time: 'long', vibe: 'engaged', social: 'friends' },
  },
  {
    key: 'quick',
    label: 'Пара быстрых каток',
    emoji: '⚡',
    hint: 'Короткие матчи: зашли, сыграли, разошлись',
    mood: { time: 'short', vibe: 'engaged', social: 'friends' },
  },
  {
    key: 'cozy',
    label: 'Уютно и надолго',
    emoji: '🏡',
    hint: 'Строить, выживать, фармить — без спешки',
    mood: { time: 'long', vibe: 'chill', social: 'friends' },
  },
  {
    key: 'talk',
    label: 'Спокойно, под разговор',
    emoji: '🛋️',
    hint: 'Лёгкое, чтобы болтать и не напрягаться',
    mood: { time: 'medium', vibe: 'chill', social: 'friends' },
  },
]

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

/** Потолок appid: столбец INTEGER и JSON-массив выдержат больше, но у Steam таких нет */
const SEED_MAX = 2_147_483_647

/**
 * Игра, в которую зовут, из адреса /room/new?game= — либо null.
 *
 * «Позвать в эту игру» стоит там, где на экране уже есть конкретная игра для
 * компании: выбор, которым поделились (/pick), общие игры на /compat, карточка
 * игры. Раньше все три вели на голый /room/new, и игра терялась по дороге —
 * друзьям уходила ссылка на «выбрать игру на вечер», а «го в X?» писали в чат
 * отдельно.
 *
 * Разбор строгий — только десятичное положительное целое, без нулей впереди и
 * хвостов: адрес приходит из чата и закладок, а через вход он едет в next
 * (roomQuery в lib/destination). Отрицательных нет намеренно: это кураторские
 * игры других магазинов, у них нет ни страницы /game, ни арта Steam для
 * карточки приглашения. Есть ли игра в каталоге и играют ли в неё вместе,
 * решает сервер (roomSeed в lib/roomseed): здесь — только форма.
 */
export function roomSeedOf(raw: string | null | undefined): number | null {
  if (!raw || !/^[1-9]\d{0,9}$/.test(raw)) return null
  const appid = Number(raw)
  return appid <= SEED_MAX ? appid : null
}

/** Адрес «Позвать в эту игру» — один на все три места, откуда зовут */
export function roomSeedHref(appid: number): string {
  return `/room/new?game=${appid}`
}

/**
 * Адрес выдачи — в одном месте.
 *
 * Собирался в трёх: квиз, карточка главной и /play каждый клеили строку
 * запроса сами, приведением Mood к Record<string, string>. Пока параметров
 * было три, копии совпадали; с осью lean четвёртый параметр добавился бы в
 * одну копию и молча потерялся в другой — пресет «нет сил» с главной вёл бы
 * на выдачу без «нет сил».
 *
 * Порядок параметров — прежний (настроение, roulette, from): адреса, которые
 * уже лежат в истории и закладках, не меняются. lean — в хвост, seed — за ним.
 *
 * seed — «Как «X», но…» с адреса: соседи игры X под это настроение (см.
 * parseSeedParam). Ноль и null в адрес не попадают — это «без затравки».
 */
export function playHref(
  mood: Mood,
  opts: { lean?: Lean | null; focus?: Focus | null; roulette?: boolean; seed?: number | null } = {},
): string {
  const q = new URLSearchParams({ time: mood.time, vibe: mood.vibe, social: mood.social })
  if (opts.roulette) q.set('roulette', '1')
  if (opts.focus) q.set('from', opts.focus)
  if (opts.lean) q.set('lean', opts.lean)
  if (opts.seed) q.set('seed', String(opts.seed))
  return `/play?${q.toString()}`
}

/**
 * «Как «X», но…» из адреса — appid игры, на соседей которой сужается выдача.
 *
 * Раньше у затравки адреса не было вовсе: это был шаг по уже показанной
 * выдаче, и «хочу что-то как Hades» оставалось невыполнимым, пока Hades сам
 * не выпадет героем. Теперь в выдачу «в духе X» ведут страница игры, «Уже
 * прошёл» и «Твои вечера» — адресом /quiz?seed= и дальше /play?…&seed=.
 *
 * Разбор строгий, по тому же правилу, что parseSeed на сервере (lib/recommend):
 * ненулевое безопасное целое, отрицательное тоже — у записей чужих магазинов
 * appid меньше нуля. Только запись без мусора: «12abc», «1e3», «+12», «012» и
 * пробелы — null, а не что-то, что Number() из них вытянет. Модуль без
 * зависимостей: его читают лендинг, proxy.ts (через lib/destination) и квиз,
 * и тянуть ради одной проверки движок рекомендаций туда незачем.
 */
export function parseSeedParam(raw: string | null | undefined): number | null {
  if (!raw || !/^-?[1-9]\d*$/.test(raw)) return null
  const n = Number(raw)
  return Number.isSafeInteger(n) ? n : null
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
 */
export function quizHref(focus: Focus | null, seed?: number | null): string {
  if (focus) return `/quiz?from=${focus}`
  return seed ? `/quiz?seed=${seed}` : '/quiz'
}

/** Пресет — это обычный адрес выдачи, ровно тот же, что строит /quiz. */
export function presetHref(p: VibePreset): string {
  return playHref(p.mood, { lean: p.lean })
}
