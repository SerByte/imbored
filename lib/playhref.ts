import type { Lean } from './mood'
import type { Focus } from './recommend'
import type { Mood } from './types'

/**
 * Адреса и разбор параметров выдачи и новой комнаты — без таблиц пресетов.
 *
 * Жили в lib/presets.ts, и ради одного playHref шапка каждой страницы
 * («Подобрать», components/PickLink → lib/lastmood) везла в первую загрузку
 * все пресеты с их русскими и английскими подписями (3.7 КБ), а lib/destination
 * — ради разбора затравки, жанра и ключа комнаты. Здесь только функции и
 * импорты типов: модуль читают шапка, лендинг, proxy.ts (через
 * lib/destination) и клиентские страницы. lib/presets реэкспортирует всё
 * отсюда, его API не изменился.
 *
 * Сторожа: lib/sharedchunk.test.ts (пресетов нет в общем фундаменте) и
 * lib/presets.test.ts (ROOM_PRESET_KEYS совпадает с ключами ROOM_PRESETS).
 */

/**
 * Ключи пресетов комнаты (ROOM_PRESETS в lib/presets) — без самих пресетов.
 * Для того, кому нужно только узнать ключ в адресе (roomQuery в
 * lib/destination), а не название и настроение. Порядок и состав — те же,
 * что у ROOM_PRESETS: это сторожит lib/presets.test.ts.
 */
export const ROOM_PRESET_KEYS = ['evening', 'quick', 'cozy', 'talk'] as const

export type RoomPresetKey = (typeof ROOM_PRESET_KEYS)[number]

/**
 * Ключ пресета комнаты из адреса — тот же ответ, что roomPresetByKey(raw) !== null.
 * includes, а не ключ объекта: у списка нет наследованных toString и __proto__.
 */
export function isRoomPresetKey(raw: string | null | undefined): raw is RoomPresetKey {
  return typeof raw === 'string' && (ROOM_PRESET_KEYS as readonly string[]).includes(raw)
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
 *
 * genre — жанр со страницы /games/<slug> (см. parseGenreParam): выдача из
 * игр этого жанра, сначала своих. Последним — за seed, по тому же правилу,
 * что lean: прежние адреса не меняются.
 */
export function playHref(
  mood: Mood,
  opts: {
    lean?: Lean | null
    focus?: Focus | null
    roulette?: boolean
    seed?: number | null
    genre?: string | null
  } = {},
): string {
  const q = new URLSearchParams({ time: mood.time, vibe: mood.vibe, social: mood.social })
  if (opts.roulette) q.set('roulette', '1')
  if (opts.focus) q.set('from', opts.focus)
  if (opts.lean) q.set('lean', opts.lean)
  if (opts.seed) q.set('seed', String(opts.seed))
  if (opts.genre) q.set('genre', opts.genre)
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
 * Жанр из адреса — адрес страницы жанра (HUB_GENRES в lib/gamehub: «roguelike»,
 * «point-and-click»), а не ключ тега Steam: адреса страниц не меняются
 * никогда, и с ними в адресе нет ни пробелов, ни амперсанда «Point & Click».
 *
 * Здесь — только форма: латиница, цифры и дефисы, не длиннее сорока. Есть
 * ли такая страница, решают те, кому нужен сам жанр, — сервер подбора и
 * квиз (hubTagOf в lib/gamehub). Модуль без зависимостей не тянет ради
 * проверки словарь тридцати жанров в лендинг, proxy.ts и /play — последний
 * стоит у потолка бюджета первой загрузки. Незнакомый адрес доедет до
 * сервера и будет там молча «без жанра», как опечатка в lean.
 */
export function parseGenreParam(raw: string | null | undefined): string | null {
  return raw && raw.length <= 40 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(raw) ? raw : null
}
