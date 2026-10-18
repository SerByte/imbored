import type { GameArtUrls } from './art'
import { lp, pl, tr, type Locale } from './i18n'
import { ROOM_PRESETS } from './presets'

/**
 * Что известно о комнате тому, кто ещё в неё не вошёл, — и что из этого
 * сказать в превью.
 *
 * Тексты живут здесь, а не в layout и opengraph-image комнаты: заголовок
 * страницы и карточка в чате обязаны говорить одно и то же, а по отдельности
 * они разъезжались уже на второй правке. Заодно здесь их можно проверить
 * тестом — роуты тянут базу и next/og. Здесь же — экран приглашения
 * (inviteDoor): человек, нажавший карточку, читает на нём те же слова.
 */

export type RoomInvite = {
  id: string
  /** сколько человек уже в комнате */
  members: number
  /** ник создателя, если Steam его отдал */
  host: string | null
  /** матч уже случился — приглашать больше некуда */
  matched: boolean
  /** на чём сошлись; null — матча нет или игры нет в каталоге */
  matchedName: string | null
  /**
   * Арт сошедшейся игры — фон карточки после матча. Необязательное поле:
   * заголовку страницы оно не нужно, только картинке.
   */
  matchedArt?: { appid: number; art: GameArtUrls | null; headerImage: string | null } | null
  /**
   * Настроение комнаты — название пресета (ROOM_PRESETS в lib/presets),
   * русское: английское превью переводит его само (presetName). null —
   * комната старше выбора настроения или его ось не совпала ни с одним
   * пресетом: тогда текст прежний, без настроения.
   */
  preset: string | null
  /**
   * Игра, в которую звали, — первая карта колоды («Позвать в эту игру»,
   * rooms.seed_appid). null — комнату создали без неё или игры уже нет в
   * каталоге.
   */
  seedName: string | null
  /** Арт предложенной игры — фон карточки, пока матча нет. Только картинке, как matchedArt */
  seedArt?: { appid: number; art: GameArtUrls | null; headerImage: string | null } | null
}

export type InviteCopy = {
  /** <title>, og:title и twitter:title */
  title: string
  /** meta и og:description */
  description: string
  /** надзаголовок карточки, моноширинным */
  eyebrow: string
  /** крупная строка карточки под кодом */
  headline: string
  /** подвал карточки */
  foot: string
}

/**
 * Куда звать того, кому ссылка досталась после матча. Адрес — на языке
 * превью: англоязычного друга /room/new встретил бы русским экраном выбора.
 */
export function newRoomHint(locale: Locale = 'ru'): string {
  const where = `imbored.cc${lp(locale, '/room/new')}`
  return tr(locale, { ru: `Собери свою комнату — ${where}`, en: `Start your own room — ${where}` })
}

/** Русская подсказка — для тех, кто звал её константой до перевода */
export const NEW_ROOM_HINT = newRoomHint('ru')

/** Потолок имени игры в карточке: строка стоит кеглем 44 в ширину 900. */
const CARD_NAME_MAX = 38

/**
 * Тот же потолок у английского приглашения в игру — на пять знаков короче.
 * «invites you to “”» шире «зовёт в «»» на 123 px в том же кегле, «You're
 * invited to “”» шире «Тебя зовут в «»» на 74 px (замер по advance width
 * assets/manrope-800.woff — тем, чем рисует next/og), а пять знаков названия
 * — около 120 px. Так самая длинная английская строка карточки не длиннее
 * самой длинной русской и не уходит лишней строкой вниз. «Matched on “”»
 * уже «Сошлись на «»», и после матча потолок общий.
 */
const CARD_SEED_MAX_EN = CARD_NAME_MAX - 5

/**
 * Английские названия настроений комнаты — по ключу пресета.
 *
 * invite.preset — РУССКОЕ название (loadRoomInvite кладёт label пресета), а
 * его английская пара живёт здесь, пока у lib/presets нет своей подписи по
 * языку; появится — названия берутся оттуда, а таблица уходит. Неизвестное
 * название (пресет добавили, а пару забыли) на английском — как комната без
 * настроения: прежний текст, а не русское слово посреди английской фразы.
 */
const PRESET_EN = new Map<string, string>([
  ['evening', 'All evening together'],
  ['quick', 'A few quick rounds'],
  ['cozy', 'Cozy and long'],
  ['talk', 'Chill, while we talk'],
])

/** Название настроения на языке превью; для ru — как пришло, до буквы */
function presetName(label: string | null, locale: Locale): string | null {
  if (label === null || locale !== 'en') return label
  const key = ROOM_PRESETS.find((p) => p.label === label)?.key
  return (key !== undefined && PRESET_EN.get(key)) || null
}

/**
 * Первые n символов — кодовыми точками, а не единицами UTF-16.
 *
 * Пока резались только названия игр, разницы не было. Ники Steam — другое
 * дело: эмодзи в них обычны, а эмодзи за пределами BMP — это пара
 * суррогатов, и s.slice рвал её пополам. Ник «xXx_Sn1per_King_xX🔥🔥» (20
 * знаков, 22 единицы UTF-16) выходил из обрезки с одинокой половиной огня, и
 * «Уже здесь» показывал «�» — а резать его было не за что вовсе.
 */
function head(s: string, n: number): string {
  return Array.from(s).slice(0, n).join('')
}

/** Обрезка с многоточием; длина и срез — кодовыми точками (head) */
function clip(s: string, max: number): string {
  return Array.from(s).length > max ? `${head(s, max - 1).trimEnd()}…` : s
}

/**
 * Три состояния, и у каждого свой текст.
 *
 * МАТЧ. Статус 'matched' ставится навсегда, а ссылку продолжают пересылать —
 * в другой чат или из истории. Превью звало «подключи библиотеку и свайпай»,
 * хотя свайпать там уже нечего: человек входил и попадал на чужой экран
 * матча. Теперь превью называет игру, на которой сошлись, и зовёт собрать
 * свою комнату.
 *
 * КОМНАТА ЖДЁТ. Кто зовёт, сколько уже внутри, что делать — и на какой вечер.
 * Крупная строка карточки одна, и отдаётся самому сильному факту:
 *   • есть предложенная игра — ей: «Серёга зовёт в «Valheim»». Это ровно то
 *     сообщение, которое иначе ушло бы в чат текстом («го в Valheim?»), только
 *     с артом и кнопкой. Описание честно говорит, что игра — предложение:
 *     не зайдёт — дальше обычная колода. Настроение при этом поднимается в
 *     надзаголовок, а не теряется;
 *   • нет игры, есть настроение — ему: «Серёга зовёт: пара быстрых каток».
 *     Колода собрана под него, и «пара каток» и «весь вечер» — разные
 *     приглашения: раньше превью у них было одно, и друг узнавал, на что его
 *     зовут, только войдя;
 *   • нет ни того, ни другого (комната старше выбора) — прежний текст до буквы.
 * Эмодзи пресета сюда не идёт: у next/og нет шрифта с эмодзи, и на карточке
 * встал бы пустой квадрат, а заголовок обязан говорить то же, что карточка.
 *
 * НИЧЕГО НЕ ИЗВЕСТНО. Комнаты с таким кодом нет — или база молчит, и
 * loadRoomInvite отдал null. Различить эти случаи здесь нечем, поэтому текст
 * нейтральный: что такое пати, без призыва подключаться и свайпать в
 * комнату, которой, возможно, нет.
 *
 * АНГЛИЙСКИЙ — целыми фразами на каждое состояние, а не теми же кусками.
 * Русский клеит «Серёга зовёт» с « в «X»», «: настроение» и « выбрать игру на
 * вечер», а английский так не склеивается: «Sergey invites you» и «You're
 * invited» требуют разного продолжения, и безличный случай — своя фраза.
 * Настроение приходит русским названием и переводится по пресету
 * (presetName).
 */
export function inviteCopy(code: string, invite: RoomInvite | null, locale: Locale = 'ru'): InviteCopy {
  if (!invite) {
    return {
      title: tr(locale, { ru: `Пати ${code}`, en: `Party ${code}` }),
      description: tr(locale, {
        ru: 'Пати на imbored: компания выбирает одну игру на вечер из своих библиотек Steam — голосами, без споров в чате.',
        en: 'Party on imbored: your group picks one game for tonight from your Steam libraries — by vote, no arguing in chat.',
      }),
      eyebrow: tr(locale, { ru: 'ПАТИ', en: 'PARTY' }),
      headline: tr(locale, { ru: 'Компания выбирает игру на вечер', en: 'Friends pick a game for tonight' }),
      foot: tr(locale, {
        ru: 'Одна игра на всех — из ваших библиотек Steam',
        en: 'One game for all — from your Steam libraries',
      }),
    }
  }

  if (invite.matched) {
    const game = invite.matchedName
    const hint = newRoomHint(locale)
    return {
      title: tr(locale, {
        ru: game ? `Пати ${code} сошлась на «${game}»` : `Пати ${code} уже выбрала игру`,
        en: game ? `Party ${code} matched on “${game}”` : `Party ${code} already picked a game`,
      }),
      // Без точки в конце: часть мессенджеров приклеивает её к адресу
      description: tr(locale, {
        ru: `Голоса сошлись${game ? ` на «${game}»` : ''} — в этой комнате игра уже выбрана. ${hint}`,
        en: game
          ? `The votes landed on “${game}” — this room already has its game. ${hint}`
          : `The votes are in — this room already has its game. ${hint}`,
      }),
      eyebrow: tr(locale, { ru: 'ПАТИ · МАТЧ', en: 'PARTY · MATCH' }),
      headline: game
        ? tr(locale, {
            ru: `Сошлись на «${clip(game, CARD_NAME_MAX)}»`,
            en: `Matched on “${clip(game, CARD_NAME_MAX)}”`,
          })
        : tr(locale, { ru: 'Игра уже выбрана', en: 'Game already picked' }),
      foot: hint,
    }
  }

  const { members } = invite
  const inRoom = pl(locale, members, {
    ru: ['человек уже в комнате', 'человека уже в комнате', 'человек уже в комнате'],
    en: ['person is already in the room', 'people are already in the room'],
  })
  const inRoomShort = pl(locale, members, {
    ru: ['человек в комнате', 'человека в комнате', 'человек в комнате'],
    en: ['person in the room', 'people in the room'],
  })
  const seed = invite.seedName
  const preset = presetName(invite.preset, locale)
  // «Серёга зовёт» / «Тебя зовут» — в заголовке ник целиком (ширину держит
  // браузер), в карточке — восемнадцать знаков: строка стоит кеглем 44.
  // Знаков, а не единиц UTF-16 (head): срез посреди эмодзи давал на
  // карточке пустой квадрат
  const host = invite.host
  const hostCard = host === null ? null : head(host, 18)
  const calls = callsOf(host)
  const callsCard = callsOf(hostCard)

  return {
    title: seed
      ? tr(locale, {
          ru: `${calls} в «${seed}» · пати ${code}`,
          en: `${invitesTo(host, `“${seed}”`)} · party ${code}`,
        })
      : tr(locale, { ru: `${calls} в пати ${code}`, en: invitesTo(host, `party ${code}`) }) +
        (preset ? ` · ${preset}` : ''),
    description:
      (seed ? `${seedOffer(seed, locale)} ` : '') +
      `${members} ${inRoom}. ` +
      tr(locale, {
        ru: 'Подключи свою библиотеку Steam и свайпай, во что не против сыграть: совпадут голоса всех — будет матч.',
        en: "Connect your Steam library and swipe on what you'd play. When everyone's votes line up, it's a match.",
      }),
    eyebrow:
      seed && preset
        ? `${tr(locale, { ru: 'ПАТИ', en: 'PARTY' })} · ${preset.toUpperCase()}`
        : tr(locale, { ru: 'ПАТИ · ПРИГЛАШЕНИЕ', en: 'PARTY · INVITE' }),
    headline: seed
      ? tr(locale, {
          ru: `${callsCard} в «${clip(seed, CARD_NAME_MAX)}»`,
          en: invitesTo(hostCard, `“${clip(seed, CARD_SEED_MAX_EN)}”`),
        })
      : preset
        ? tr(locale, {
            ru: `${callsCard}: ${preset.toLowerCase()}`,
            en: `${hostCard ?? "You're invited"}: ${preset.toLowerCase()}`,
          })
        : pickTonight(hostCard, locale),
    foot: `${members} ${inRoomShort} · ${tr(locale, { ru: 'подключи библиотеку и свайпай', en: 'connect your library and swipe' })}`,
  }
}

/** «Серёга зовёт» или безличное «Тебя зовут» — одно на превью и на экран приглашения */
function callsOf(host: string | null): string {
  return host ? `${host} зовёт` : 'Тебя зовут'
}

/**
 * «Серёга зовёт в …» по-английски — целой фразой: у безличного «You're
 * invited» другой порядок слов, и к «зовёт» его не приставить.
 */
function invitesTo(host: string | null, what: string): string {
  return host ? `${host} invites you to ${what}` : `You're invited to ${what}`
}

/**
 * «Серёга зовёт выбрать игру на вечер» — крупная строка карточки без игры и
 * настроения и заголовок экрана приглашения: одна фраза на оба, как
 * callsOf. Английская — своя на каждый случай: «You're invited» без ника и
 * «… wants to pick» с ником.
 */
function pickTonight(host: string | null, locale: Locale): string {
  return tr(locale, {
    ru: `${callsOf(host)} выбрать игру на вечер`,
    en: host ? `${host} wants to pick a game for tonight` : "You're invited to pick a game for tonight",
  })
}

/**
 * Игра, в которую звали, — как предложение, а не решение. Одной строкой на
 * описание превью и экран приглашения: человек, нажавший карточку в чате,
 * обязан прочесть на экране ту же фразу, что в превью.
 */
function seedOffer(name: string, locale: Locale): string {
  return tr(locale, {
    ru: `Первой картой — «${name}»; не зайдёт — дальше колода из ваших библиотек.`,
    en: `First card: “${name}”. Not into it? Next up is a deck from your libraries.`,
  })
}

/** Сколько имён назвать в «Уже здесь»: это строка, а не ростер */
export const DOOR_NAMES = 3

/**
 * Потолок ника на экране приглашения — в «Уже здесь» и в заголовке. Ник
 * Steam бывает и в 32 знака, а места мало в обоих.
 *
 * «Уже здесь» — одна строка на всех. Заголовок — h1 кеглем display-sm (около
 * 22 px Manrope 800 на телефоне), и ник в нём — одно слово без пробелов:
 * перенести его браузеру негде. На телефоне в 390 px у панели остаётся 286 px
 * ширины, а «xXx_DarkLordOfTheNight_2009» — замер по шрифту — 336 px: ник
 * уезжал за рамку панели и обрезался краем экрана ровно там, где друг решает,
 * войти ли. Двадцать знаков с многоточием у обычного ника — 230–280 px.
 * Двадцать самых широких букв подряд (ШШШ…, WWW…) не влезли бы и так, но
 * такой ник — редкость, а класс переноса на h1 стоил бы байтов странице,
 * которая стоит у потолка первой загрузки.
 */
const DOOR_NAME_MAX = 20

/** Игра, в которую звали, — с артом: на экране приглашения она стоит картинкой */
export type DoorSeed = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

/**
 * Экран приглашения — то, что видит открывший ссылку, пока не вошёл.
 * Готовыми строками: страница комнаты стоит у потолка первой загрузки
 * (bundle-budget.json), и слова собирает сервер, а не её скрипт.
 */
export type InviteDoor = {
  /**
   * «Серёга зовёт выбрать игру на вечер»; без ника хоста — «Тебя зовут…».
   * Ник длиннее DOOR_NAME_MAX — с многоточием, как в «Уже здесь»
   */
  title: string
  /** «Уже здесь: Серёга, Аня и ещё 2»; null — в комнате один хост, и заголовок его уже назвал */
  here: string | null
  /** Игра, в которую звали, и та же фраза о ней, что в превью; null — без неё */
  seed: (DoorSeed & { line: string }) | null
}

/**
 * Экран приглашения говорит то же, что карточка в чате.
 *
 * Друг жал карточку «Серёга зовёт в «Valheim»» с «3 человека в комнате» — и
 * попадал на «Тебя зовут выбрать игру на вечер» и код комнаты: кто зовёт, во
 * что и кто уже внутри, экран забывал ровно в ту минуту, когда решается,
 * войдёт ли человек. Теперь он называет то же самое теми же словами (callsOf,
 * seedOffer) — и больше ничего: ни steamid, ни счёта голосов. Имена — метки
 * ростера (memberLabel), их API и так отдаёт не участнику, а настроение
 * страница рисует сама, тем же чипом, что в шапке комнаты.
 *
 * Хост в «Уже здесь» — первым, и только если рядом есть кто-то ещё: один
 * хост — это заголовок, повторять его строкой ниже незачем. Без ника хоста
 * (host null: Steam ника не отдал или хост ушёл) зовут безлично, как и
 * превью, а здесь перечислены все, кто в комнате, — метками ростера. Имён —
 * не больше трёх, остальные — числом: «и ещё 2» без существительного, рода и
 * склонения ника.
 *
 * Ник режется здесь, на сервере, и в заголовке, и в «Уже здесь» — одним
 * потолком (DOOR_NAME_MAX): так странице не нужно ни байта на перенос.
 * Превью в чате режет по-своему — у карточки свой кегль и своя ширина.
 *
 * Английский — те же правила и те же фразы, что у превью (pickTonight,
 * seedOffer): «Already here: A, B and 2 more». Заголовок с ником длиннее
 * русского на пару знаков, но в 286 px он переносится на то же число строк
 * (замер по шрифту): ширину держит ник, а не фраза.
 */
export function inviteDoor(
  args: {
    /** ник хоста — personaName, как у превью; null — хост ушёл или Steam ника не отдал */
    host: string | null
    /** метки всех, кто в комнате, хост первым */
    names: readonly string[]
    seed: DoorSeed | null
  },
  locale: Locale = 'ru',
): InviteDoor {
  const { host, names, seed } = args
  const shown = names.slice(0, DOOR_NAMES).map((n) => clip(n, DOOR_NAME_MAX))
  const rest = names.length - shown.length
  const and = tr(locale, { ru: 'и', en: 'and' })
  const list =
    rest > 0
      ? tr(locale, {
          ru: `${shown.join(', ')} и ещё ${rest}`,
          en: `${shown.join(', ')} and ${rest} more`,
        })
      : shown.length > 1
        ? `${shown.slice(0, -1).join(', ')} ${and} ${shown[shown.length - 1]}`
        : shown[0]
  const onlyHost = host !== null && names.length === 1
  return {
    title: pickTonight(host === null ? null : clip(host, DOOR_NAME_MAX), locale),
    here: list && !onlyHost ? `${tr(locale, { ru: 'Уже здесь', en: 'Already here' })}: ${list}` : null,
    seed: seed ? { ...seed, line: seedOffer(seed.name, locale) } : null,
  }
}
