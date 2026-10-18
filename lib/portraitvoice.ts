import { archetypeLabelOf } from './archetypes'
import { fmtNumber, pl, tr, type Locale } from './i18n'
import { plural } from './plural'

/**
 * КТО ЧИТАЕТ ПОРТРЕТ — ОТ ЭТОГО ЗАВИСИТ, КАК ОН ГОВОРИТ.
 *
 * Портрет — страница, которую отправляют: её открывает не только владелец, но
 * и друг по ссылке из чата. А говорила она со всеми одинаково, на «ты»: над
 * ником «Аня» друг читал «80% твоей игровой жизни — это 3 игры», «ты однолюб»
 * и «Если решишься — начни с этой» с игрой из Аниной библиотеки, которой у
 * него нет. Было непонятно, про кого страница.
 *
 * Поэтому у каждой фразы два голоса. 'you' — владельцу, как было. 'them' —
 * гостю: нейтрально или в третьем лице. Нейтрально, а не «Аня провела»: пол
 * по нику не узнать, а «провёл(а)» на странице, которой хвастаются, хуже
 * безличного «сыграно».
 *
 * Модуль без зависимостей, кроме чистых lib/i18n и lib/archetypes: страница
 * серверная, а формы здесь — чтобы их можно было проверить тестом на всех
 * числах, а не на одном из демо-библиотеки.
 *
 * ЯЗЫК — ПОСЛЕДНИМ ДОВОДОМ, ПО УМОЛЧАНИЮ РУССКИЙ. По-английски голоса те же:
 * 'you' — на «you», 'them' — в третьем лице, с singular they («their gaming
 * life»): пол по нику не узнать и по-английски. Фрагменты встают в разметку
 * страницы в том же порядке, что русские: «{paretoLead} N games out of M»,
 * «Concentration N out of 100: {verdict}.», «N% {socialTail}»,
 * «N {unplayedHeading}», «{eraLead} 2016, …» — склейку вокруг них переводит
 * страница.
 */
export type PortraitVoice = 'you' | 'them'

export type PortraitFacts = {
  gamesCount: number
  totalHours: number
  unplayedCount: number
  topGame: { name: string; sharePercent: number } | null
  /**
   * Время скрыто настройками Steam (lib/playtime.ts): «за плечами 0 часов»
   * — не факт, а галочка. Необязательно — без него всё как было.
   */
  playtimeHidden?: boolean
}

/**
 * Версия текста портрета, который пишет модель (users.portrait_json, см.
 * app/[lang]/portrait/[steamid]/page.tsx). Текст привязан к снапшоту и живёт, пока
 * снапшот не сменится, — у того, кто больше не заходит, сколько угодно.
 *
 * 2 — промпт узнал о скрытом времени (lib/playtime.ts). Текст, написанный
 * раньше по библиотеке из нулей, обыгрывал «0 часов, 200 игр так и не
 * запущены» и висел бы на расшаренной ссылке до следующего захода владельца.
 * Записи без версии — первая.
 */
export const PORTRAIT_TEXT_V = 2

/**
 * Записанный текст одного языка: снапшот, по которому он написан, и версия
 * промпта (PORTRAIT_TEXT_V).
 */
export type PortraitTextSlot = { takenAt: number; v?: number }

/**
 * Что из users.portrait_json нужно, чтобы судить о тексте: русский текст —
 * в корне записи, как было, английский — в слоте en.
 *
 * У английского свой takenAt, а не общий с русским: тексты пишутся на заходы
 * разных людей в разные снапшоты (русский — на /portrait, английский — на
 * /en/portrait), и английский, написанный по прошлому снапшоту, не должен
 * сойти за свежий оттого, что русский уже переписан по новому.
 */
export type PortraitTextCache = PortraitTextSlot & { en?: PortraitTextSlot | null }

/**
 * Годится ли записанный текст: снапшот тот же, и текст написан тем промптом,
 * который знает о скрытом времени, — если оно скрыто. При открытом времени
 * промпт не менялся, и старый текст годится: пересобрать разом все портреты
 * значило бы звать модель на каждый первый заход по каждой ссылке.
 *
 * locale — язык страницы: по-английски судится слот en, а русский текст
 * рядом с ним не в счёт — на /en он не показывается (docs/i18n.md, «Тексты
 * модели»). Слота нет — текста нет.
 */
export function portraitTextFresh(
  cached: PortraitTextCache,
  snapshotAt: number,
  playtimeHidden: boolean,
  locale: Locale = 'ru',
): boolean {
  const slot = locale === 'en' ? cached.en : cached
  if (!slot) return false
  if (slot.takenAt !== snapshotAt) return false
  return !playtimeHidden || (slot.v ?? 1) >= PORTRAIT_TEXT_V
}

/** Слот с самим текстом — то, что лежит в users.portrait_json */
type WrittenSlot = PortraitTextSlot & { text: string }

/**
 * Записанный текст на языке страницы, если он годится (portraitTextFresh),
 * иначе null — тогда страница зовёт модель или собирает шаблон.
 *
 * Одной функцией, чтобы страница не выбирала слот сама: проверить свежесть
 * английского, а показать русский — ровно та ошибка, которую так не сделать.
 */
export function freshPortraitText(
  cached: (WrittenSlot & { en?: WrittenSlot | null }) | null,
  snapshotAt: number,
  playtimeHidden: boolean,
  locale: Locale = 'ru',
): string | null {
  if (!cached || !portraitTextFresh(cached, snapshotAt, playtimeHidden, locale)) return null
  const text = locale === 'en' ? cached.en?.text : cached.text
  return typeof text === 'string' ? text : null
}

/** Начало фразы про 80% времени: «… — это N игр из M» / «… is N games out of M» */
export function paretoLead(voice: PortraitVoice, locale: Locale = 'ru'): string {
  return voice === 'you'
    ? tr(locale, { ru: '80% твоей игровой жизни — это', en: '80% of your gaming life is' })
    : tr(locale, { ru: '80% игровой жизни — это', en: '80% of their gaming life is' })
}

/**
 * Вывод после «Концентрация N из 100:» — три ступени, как и раньше. Со
 * строчной буквы и без точки: двоеточие и точку ставит страница.
 */
export function concentrationVerdict(
  concentration: number,
  voice: PortraitVoice,
  locale: Locale = 'ru',
): string {
  const you = voice === 'you'
  if (concentration >= 50) {
    return you
      ? tr(locale, { ru: 'ты однолюб и не скрываешь этого', en: "you're a one-game loyalist and you don't hide it" })
      : tr(locale, { ru: 'однолюб и не скрывает этого', en: "they're a one-game loyalist and don't hide it" })
  }
  if (concentration >= 20) {
    return you
      ? tr(locale, {
          ru: 'есть любимцы, но ты не заперт в одной игре',
          en: "you have favorites, but you're not locked into one game",
        })
      : tr(locale, {
          ru: 'есть любимцы, но без привязки к одной игре',
          en: "they have favorites, but aren't locked into one game",
        })
  }
  return you
    ? tr(locale, {
        ru: 'ты размазан ровным слоем по всей библиотеке',
        en: "you're spread evenly across your whole library",
      })
    : tr(locale, {
        ru: 'время размазано ровным слоем по всей библиотеке',
        en: 'their time is spread evenly across the whole library',
      })
}

/** Хвост после «N%»: доля часов не в одиночку. С точкой: после него страница не ставит ничего */
export function socialTail(voice: PortraitVoice, locale: Locale = 'ru'): string {
  return voice === 'you'
    ? tr(locale, { ru: 'часов ты провёл не один.', en: 'of your playtime was with other people.' })
    : tr(locale, { ru: 'часов сыграно не в одиночку.', en: 'of their playtime was with other people.' })
}

/**
 * Заголовок полки нераспакованного после числа: «12 игр ты почти не трогал».
 *
 * Было «так и не запустил», но полка собрана по isUnplayed — меньше двух
 * часов, — и в ней лежат игры, где наиграно по часу. Библиотека тем же
 * людям пишет «ни разу не запускал» только про ноль минут (isUntouched),
 * и одна и та же демо-библиотека получала «4 ни разу не запускал» на /library
 * и «8 ты так и не запустил» на портрете. «Почти не трогал» верно для обоих
 * случаев сразу.
 *
 * «Игру», а не «игра»: число здесь — дополнение к «трогал», винительный.
 * Прежнее «21 игра ты так и не запустил» было ошибкой на каждом числе,
 * оканчивающемся на единицу.
 *
 * По-английски — «12 games you've barely touched» / «12 games barely
 * touched»: «barely touched» из глоссария, по той же причине, что «почти не
 * трогал», — в полке и игры, где наиграно по часу.
 */
export function unplayedHeading(n: number, voice: PortraitVoice, locale: Locale = 'ru'): string {
  // Винительный по-русски, а по-английски у «game» падежа нет
  const games = pl(locale, n, { ru: ['игру', 'игры', 'игр'], en: ['game', 'games'] })
  return voice === 'you'
    ? tr(locale, { ru: `${games} ты почти не трогал`, en: `${games} you've barely touched` })
    : pl(locale, n, {
        ru: ['игра почти не тронута', 'игры почти не тронуты', 'игр почти не тронуто'],
        en: ['game barely touched', 'games barely touched'],
      })
}

/**
 * Начало фразы про эпоху библиотеки: «… — 2016, а самая старая…» /
 * «… 2016, and the oldest…»
 */
export function eraLead(voice: PortraitVoice, locale: Locale = 'ru'): string {
  return voice === 'you'
    ? tr(locale, { ru: 'Медиана твоей библиотеки —', en: "Your library's median year is" })
    : tr(locale, { ru: 'Медиана библиотеки —', en: "The library's median year is" })
}

/**
 * Запасной текст портрета — когда модель недоступна или потолок исчерпан.
 *
 * Текст модели пишется владельцу и кэшируется на снапшот, его голос не
 * выбрать; гостю страница показывает его цитатой «imbored о {name}». Этот же
 * собирается на каждый заход, и у него голос есть: гостю — о владельце, а не
 * к нему.
 *
 * По-английски каждое предложение — целым шаблоном на голос, а не русская
 * склейка с переведёнными кусками: падежи («в 22 играх», «5 игр почти не
 * тронуто») по-английски не склеиваются, и порядок слов там свой.
 *
 * Подпись архетипа по-английски — по его ключу (archetypeLabelOf): label у
 * архетипа из buildPortrait русский. Ключ необязателен, потому что русские
 * тесты зовут функцию с одной подписью, — но без ключа английский текст не
 * берёт русский label, а узнаёт ключ по нему («стратег» → strategist,
 * «фанат X» → X fan). Записи кэша модели, собранные до ключей, страница
 * читать не должна вовсе: ключ кэша модели на странице поднимается вместе с
 * появлением ключей, а узнавание по подписи — страховка, а не путь.
 */
export function portraitFallbackText(
  name: string,
  archetypes: Array<{ key?: string; label: string; percent: number }>,
  facts: PortraitFacts,
  voice: PortraitVoice,
  locale: Locale = 'ru',
): string {
  const you = voice === 'you'
  const en = locale === 'en'
  const parts: string[] = []
  if (archetypes.length >= 2) {
    const [a, b] = archetypes
    const [la, lb] = [archetypeLabelOf(a, locale), archetypeLabelOf(b, locale)]
    parts.push(
      you
        ? tr(locale, {
            ru: `${name}, ты на ${a.percent}% ${la} и на ${b.percent}% ${lb}.`,
            en: `${name}, you're ${a.percent}% ${la} and ${b.percent}% ${lb}.`,
          })
        : tr(locale, {
            ru: `${name} на ${a.percent}% ${la} и на ${b.percent}% ${lb}.`,
            en: `${name} is ${a.percent}% ${la} and ${b.percent}% ${lb}.`,
          }),
    )
  }
  // Русские числа игр — как были, без разрядов; английские — с запятой
  // разрядов, как везде на /en
  const count = (n: number) => (en ? fmtNumber(locale, n) : String(n))
  if (facts.playtimeHidden) {
    // Ни часов, ни нераспакованного, ни любимой игры по доле — только то, что
    // известно: сколько игр и почему про время молчим. «Похоже» — признак
    // угадан по нулям (lib/playtime.ts) и бывает ложным: десять подаренных и
    // ни разу не запущенных игр выглядят так же, а текст публичный.
    // По-английски — «hidden by … privacy settings»: «скрыто настройками»
    // значит «настройки скрыли», а «hidden in settings» читалось бы как «время
    // лежит где-то в настройках». Privacy — потому что в английском Steam эта
    // галочка («Game details», docs/i18n.md) живёт на странице Privacy Settings.
    // Гостю — «Their library»: тот же singular they, что в «They've logged»
    const n = facts.gamesCount
    const games = `${count(n)} ${pl(locale, n, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })}`
    parts.push(
      tr(locale, {
        ru: `В библиотеке ${games}, а время в них, похоже, скрыто настройками Steam.`,
        en: you
          ? `Your library has ${games}, but your playtime seems to be hidden by your Steam privacy settings.`
          : `Their library has ${games}, but their playtime seems to be hidden by Steam privacy settings.`,
      }),
    )
    return parts.join(' ')
  }
  const h = facts.totalHours
  const g = facts.gamesCount
  const u = facts.unplayedCount
  const hours = `${fmtNumber(locale, h)} ${pl(locale, h, { ru: ['час', 'часа', 'часов'], en: ['hour', 'hours'] })}`
  // «в 22 играх» / «across 22 games» — слово после числа в обоих шаблонах
  const games = `${count(g)} ${pl(locale, g, { ru: ['игре', 'играх', 'играх'], en: ['game', 'games'] })}`
  // Хвост про нераспакованное: по-русски со своим числом и падежом, по-английски
  // «of them» — игры уже названы
  const touched = u ? ` and barely touched ${count(u)} of them` : ''
  const unplayed = !u
    ? ''
    : you
      ? `, а ${u} ${plural(u, 'игру', 'игры', 'игр')} ты почти не трогал`
      : `, а ${u} ${plural(u, 'игра почти не тронута', 'игры почти не тронуты', 'игр почти не тронуто')}`
  parts.push(
    tr(locale, {
      ru: `За плечами ${hours} в ${games}${unplayed}.`,
      // «They've»: у гостя тот же singular they, что во фрагментах выше
      en: `${you ? "You've" : "They've"} logged ${hours} across ${games}${touched}.`,
    }),
  )
  if (facts.topGame && facts.topGame.sharePercent >= 30) {
    const { name: top, sharePercent: share } = facts.topGame
    parts.push(
      you
        ? tr(locale, {
            ru: `«${top}» забрала ${share}% всей твоей игровой жизни — и, кажется, не собирается отдавать.`,
            en: `“${top}” has claimed ${share}% of your gaming life, and it doesn't seem to be giving it back.`,
          })
        : tr(locale, {
            ru: `«${top}» забрала ${share}% всей игровой жизни — и, кажется, не собирается отдавать.`,
            en: `“${top}” has claimed ${share}% of their gaming life, and it doesn't seem to be giving it back.`,
          }),
    )
  }
  return parts.join(' ')
}
