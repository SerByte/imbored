import { PLAY_DEAL_KEY } from './planforget'

/**
 * «НЕ ПРЕДЛАГАТЬ» — ЖЁСТКИЕ ИСКЛЮЧЕНИЯ ПО ТЕГАМ.
 *
 * «Не тот жанр» на /play — мягкий ответ: он сдвигает профиль вкуса на шаг
 * (GENRE_PENALTY × FEEDBACK_STEP_SHARE в lib/recommend.ts), и хоррор и после
 * трёх таких ответов вернётся, стоит ему хорошо лечь под настроение. А у кого
 * нет VR-шлема, тому VR-игра не «чуть хуже», а невыполнимый совет; кто не
 * играет в хорроры, не хочет их видеть вовсе. Здесь — то, чего подбор не
 * предлагает никогда.
 *
 * НАБОРЫ, А НЕ ПРОИЗВОЛЬНЫЕ ТЕГИ. У Steam почти пятьсот тегов, и «хорроры» —
 * это три из них (Horror, Psychological Horror, Survival Horror): выбирать
 * поштучно человеку пришлось бы то, что за него знает словарь. Набор — это
 * ещё и граница: в куку и в разбор на сервере попадает только известный
 * ключ, а не строка из чужих рук.
 *
 * ГДЕ ЖИВЁТ. В cookie этого браузера, а не в базе. Это удобство одного
 * устройства, как прошлое настроение (lib/lastmood), и знать о нелюбви к
 * аниме серверу незачем дольше одного запроса. Кука, а не localStorage, —
 * ради веса и охвата: её сам браузер приносит в /api/recommend, /api/daily и
 * /api/explore, и /play, /daily и /explore, стоящие у потолка бюджета первой
 * загрузки (bundle-budget.json), не везут ради её доставки ни байта — только
 * свой экран отказа «Всё под «Не предлагать»» (FAIL.muted). Работает у
 * любой сессии — и у демо, и у входа по ссылке: писать в чужой профиль тут
 * нечего. Выход её стирает (app/api/auth/logout): фильтр — про человека, и
 * следующий на этом устройстве молча получал бы чужие запреты. В базу
 * попадает только выбранное с ним: игра дня под фильтром ложится рядом с
 * общей записью, ключом без наборов (mutedDayKey в lib/daily), и уходит с
 * уборкой дня, как и общая.
 *
 * ПО ГЛАВНЫМ ТЕГАМ, А НЕ ПО ЛЮБЫМ. Теги ставят игроки, и хвост списка — шум:
 * у головоломки Kairo «Horror» стоит тринадцатым, у гонки Distance —
 * пятнадцатым, у Subnautica «VR» — восемнадцатым. Игра уходит, если тег среди
 * её top главных (mutedHit в lib/recommend.ts; замеры по копии каталога — в
 * докблоках порогов ниже). Предупреждения о контенте судятся глубже: их ставят, когда
 * такое в игре есть, а не когда это её суть.
 *
 * Модуль лёгкий — его везёт квиз (components/MuteTags), а сервер берёт
 * отсюда разбор куки (currentMutes в lib/server). Сам суд — в
 * lib/recommend.ts, рядом с topTags: квизу словарь предупреждений о контенте
 * (lib/hook) не нужен.
 */

export type MuteKey = 'horror' | 'vr' | 'early' | 'lewd' | 'gore' | 'anime' | 'hard' | 'pvp' | 'mmo'

export type MutePreset = {
  key: MuteKey
  /** Подпись чипа на квизе; в сводке «Не предлагать: …» — со строчной (muteSummary) */
  label: string
  /** Теги Steam, по которым игра уходит */
  tags: readonly string[]
  /**
   * Среди скольких главных тегов искать. Главные — как у ряда чипсов карточки
   * (topTags: по голосам, предупреждения о контенте пропущены), а для самих
   * предупреждений — среди всех тегов по голосам. Не меньше CARD_TAGS: тег,
   * который карточка покажет чипсом, обязан и исключать.
   */
  top: number
  /**
   * Жанры Steam (appdetails, на русском), по которым игра уходит. Только у
   * раннего доступа: жанр «Ранний доступ» Steam снимает с выходом игры, а тег
   * Early Access остаётся висеть у вышедших — у Rust и Satisfactory он есть
   * до сих пор. Жанр знают не все: каталог из GetItems его не несёт, — там
   * судит тег.
   */
  genres?: readonly string[]
  /** Улика по названию: VR-версии несут слово VR в имени — «Skyrim VR», «Zero Caliber VR» */
  name?: RegExp
}

/** Сколько тегов показывает чипсами карточка выдачи (topTags в lib/recommend.ts) */
export const CARD_TAGS = 4

/**
 * Главные теги — пять: четыре видимых чипса и один в запас.
 *
 * Замер по копии каталога (шесть тысяч игр): «Horror» пятым стоит у Prey,
 * INSIDE, Inscryption, Metro 2033, Killing Floor — для того, кто не играет в
 * хорроры, всё это хорроры. Шестым — уже Subnautica: Below Zero, Barotrauma и
 * The Forever Winter, то есть ложные. «Souls-like» и «Difficult» пятыми — у
 * Hollow Knight: Silksong, Enter the Gungeon и Binding of Isaac: им и место
 * под «хардкором».
 */
const MAIN_TOP = 5

/**
 * VR — строже, по числу чипсов. «VR» пятым-шестым стоит у плоских игр с
 * поддержкой шлема — Resident Evil 7, DiRT Rally 2.0, Phasmophobia, Assetto
 * Corsa, F1 25, — и у того, кто шлема не имеет, отнимать их не за что.
 * VR-игры, где тег ушёл ниже (Sairento VR и Hellblade: Senua's Sacrifice VR
 * Edition — пятый), ловит имя.
 *
 * Плоские игры, где «VR» третий-четвёртый, уходят, — и это принятая цена, а
 * не недосмотр. По копии каталога это HITMAN World of Assassination, STAR
 * WARS: Squadrons, Assetto Corsa Competizione, Microsoft Flight Simulator
 * 2024, MX Bikes и Hand Simulator: шлем у них по желанию, но карточка
 * покажет «VR» чипсом, а видимый чипс обязан исключать (CARD_TAGS). Обойти
 * это можно было бы, только спрятав «VR» из чипсов ниже второго места и
 * судя по двум, — но тогда мимо фильтра шли бы мелкие игры только для шлема,
 * у которых в полном каталоге «VR» запросто стоит третьим после Indie и
 * Action, а имени со словом VR нет. Потерять плоскую игру с необязательным
 * шлемом дешевле, чем посоветовать невыполнимое.
 */
const VR_TOP = CARD_TAGS

/**
 * Предупреждения о контенте — до десятого. «Nudity» у The Witcher 3 восьмой,
 * «Sexual Content» у Baldur's Gate 3 шестой: кто просил без откровенного,
 * имел в виду и их. Глубже — уже шум единичных голосов.
 */
const WARN_TOP = 10

export const MUTES: readonly MutePreset[] = [
  { key: 'horror', label: 'Хорроры', tags: ['Horror', 'Psychological Horror', 'Survival Horror'], top: MAIN_TOP },
  { key: 'vr', label: 'VR', tags: ['VR'], top: VR_TOP, name: /\bVR\b/ },
  {
    key: 'early',
    label: 'Ранний доступ',
    tags: ['Early Access'],
    top: MAIN_TOP,
    genres: ['Ранний доступ', 'Early Access'],
  },
  {
    key: 'lewd',
    label: 'Откровенное',
    tags: ['Nudity', 'Sexual Content', 'Hentai', 'NSFW', 'Mature'],
    top: WARN_TOP,
  },
  { key: 'gore', label: 'Кровь и жестокость', tags: ['Gore', 'Violent'], top: WARN_TOP },
  { key: 'anime', label: 'Аниме', tags: ['Anime'], top: MAIN_TOP },
  { key: 'hard', label: 'Хардкор', tags: ['Souls-like', 'Difficult'], top: MAIN_TOP },
  {
    key: 'pvp',
    label: 'Соревновательные',
    tags: ['PvP', 'Competitive', 'eSports', 'Battle Royale'],
    top: MAIN_TOP,
  },
  { key: 'mmo', label: 'MMO', tags: ['Massively Multiplayer', 'MMORPG'], top: MAIN_TOP },
]

/** Имя куки. Значение — ключи через точку: «horror.vr» */
export const MUTE_COOKIE = 'imbored_mute'

/**
 * Год — и продлевается каждым заходом на квиз (components/MuteTags). Дольше
 * четырёхсот дней браузеры куку и не держат.
 */
const MUTE_MAX_AGE_SEC = 365 * 86_400

/** Пустой выбор — одна ссылка на все чтения: useSyncExternalStore сравнивает снимки по ссылке */
const NONE: readonly MutePreset[] = Object.freeze([])

/**
 * Разбор значения куки. Пишет её кто угодно — консоль, расширение, прошлая
 * версия сайта, — поэтому только известные ключи, без повторов и в порядке
 * MUTES: один и тот же выбор — одна и та же строка, сколько ни переключай.
 * Длинное — мусор целиком: настоящий выбор из девяти ключей короче сотни.
 */
export function parseMutes(raw: string | null | undefined): readonly MutePreset[] {
  if (!raw || raw.length > 200) return NONE
  const keys = new Set(raw.split('.'))
  const out = MUTES.filter((p) => keys.has(p.key))
  return out.length ? out : NONE
}

/**
 * Строка для document.cookie. Пустой выбор — стирание: max-age=0 по тому же
 * пути. Путь — весь сайт, а не /api: кука на /api не видна document.cookie
 * квиза, и показать, что выбрано, было бы не из чего, кроме второй копии в
 * localStorage, которая разъезжалась бы с первой. Lax — та же, что у сессии:
 * чужой сайт межсайтовым запросом её не принесёт.
 */
export function muteCookie(keys: readonly MuteKey[], secure: boolean): string {
  const value = MUTES.filter((p) => keys.includes(p.key))
    .map((p) => p.key)
    .join('.')
  const age = value ? MUTE_MAX_AGE_SEC : 0
  return `${MUTE_COOKIE}=${value}; path=/; max-age=${age}; samesite=lax${secure ? '; secure' : ''}`
}

/** Значение куки из строки document.cookie; нет куки — null */
export function cookieValue(cookies: string, name: string): string | null {
  for (const part of cookies.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

/**
 * Сводка для свёрнутой строки квиза: «хорроры, VR, ранний доступ». Подписи
 * чипов — с прописной; в середине фразы — со строчной, кроме аббревиатур.
 */
export function muteSummary(mutes: readonly MutePreset[]): string {
  return mutes
    .map((p) => (/^\p{Lu}{2}/u.test(p.label) ? p.label : p.label[0].toLowerCase() + p.label.slice(1)))
    .join(', ')
}

/*
 * Хранилище для useSyncExternalStore — кука как единственный источник правды.
 *
 * Снимок пересобирается, только когда сменилась сама строка куки: get зовут
 * на каждом рендере, и новый массив на каждый вызов увёл бы React в
 * бесконечный рендер. Серверный снимок — пустой выбор: на сервере кука есть,
 * но квиз — клиентский экран, и разметка гидратации обязана совпасть с
 * первым кадром, а не угадывать. Подписка — только на свою запись: соседняя
 * вкладка куку меняет молча, события storage у неё нет, и квиз увидит
 * чужую правку на следующем рендере.
 */
const listeners = new Set<() => void>()
let seenRaw: string | null = null
let seen: readonly MutePreset[] = NONE

function readCookies(): string {
  try {
    return document.cookie
  } catch {
    return ''
  }
}

export const muteStore = {
  get(): readonly MutePreset[] {
    const raw = cookieValue(readCookies(), MUTE_COOKIE) ?? ''
    if (raw !== seenRaw) {
      seenRaw = raw
      seen = parseMutes(raw)
    }
    return seen
  },
  server: (): readonly MutePreset[] => NONE,
  subscribe(onChange: () => void): () => void {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  },
  /** Записать выбор (пустой — стереть) и оповестить. Не бросает: куки бывают выключены */
  set(keys: readonly MuteKey[]): void {
    try {
      document.cookie = muteCookie(keys, location.protocol === 'https:')
    } catch {
      // Куки выключены — выбор не сохранится, и снимок честно останется прежним
    }
    for (const cb of [...listeners]) cb()
  },
}

/**
 * «Не предлагать» сменился (components/MuteTags на квизе): выдача /play на
 * устройстве собрана без нового фильтра, и «Изменить настроение» → то же
 * настроение вернуло бы её из записи «Назад» (lib/playcache) — с тем самым
 * хоррором, который только что запретили. Сервер такую выдачу больше не
 * соберёт, а запись помнила бы её ещё пятнадцать минут.
 *
 * Стирается только ключ запроса: restoreDeal её больше не узнает (ключ
 * playCacheKey пустым не бывает), а отложенные на вечер едут к первой новой
 * выдаче, как при смене настроения (heldPlanned ключа не сверяет), — план,
 * поставленный минуту назад, фильтр не отменяет. Вся запись целиком стёрла
 * бы и их.
 *
 * Здесь, а не в lib/planforget рядом с соседкой: тот модуль везут страница
 * игры, /library, /daily и /play, а эта правка нужна одному квизу. Запись
 * правится по ключу, мимо модуля выдачи, — как и там. Только эта вкладка: у
 * соседней своя запись, и она доживёт до своих пятнадцати минут. Не бросает.
 */
export function unkeyDeal(): void {
  try {
    const raw = sessionStorage.getItem(PLAY_DEAL_KEY)
    const rec: unknown = raw === null ? null : JSON.parse(raw)
    if (!rec || typeof rec !== 'object' || (rec as { key?: unknown }).key === '') return
    sessionStorage.setItem(PLAY_DEAL_KEY, JSON.stringify({ ...rec, key: '' }))
  } catch {
    // приватный режим, битая запись — узнавать и так нечего
  }
}
