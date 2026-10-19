import type { ForgetReport } from './db'
import { fmtNumber, tr, type Locale } from './i18n'
import { roomCardPath } from './roomcard'

/**
 * «Удалить всё обо мне» (app/api/forget, components/ForgetMe): что показать
 * человеку до удаления и что сбросить в кэше после.
 *
 * Список «что хранится» собирается из счёта countUserRows — того же списка
 * таблиц, по которому идёт удаление (USER_ROWS в lib/db). Своего перечня
 * таблиц здесь нет, есть только подписи к ним: показать одно, а удалить
 * другое этот модуль не может. Новая таблица без подписи уронит
 * lib/forget.test.ts.
 */

/**
 * Подпись таблицы в списке «что хранится».
 *   counted — число строк что-то говорит человеку («Снимки библиотеки — 3»);
 *   без него строка стоит без числа: профиль один, список желаемого один.
 * null — удаляется, но в списке не показывается (почему — у каждой).
 */
type Label = { text: string; counted: boolean } | null

/** Голоса и участие — в счёте и чужие, из его комнат: число соврало бы */
const ROOMS_PART: Label = { text: 'Участие и голоса в комнатах', counted: false }

/**
 * Порядок ключей — порядок строк в подтверждении: сначала профиль и
 * библиотека, потом то, что человек делал сам, потом входы.
 */
export const FORGET_LABELS: Readonly<Record<string, Label>> = {
  users: { text: 'Профиль Steam: имя, аватар и портрет', counted: false },
  library_snapshots: { text: 'Снимки библиотеки', counted: true },
  library_baselines: { text: 'Годовые отметки библиотеки', counted: true },
  wishlists: { text: 'Список желаемого', counted: false },
  feedback: { text: 'Оценки, скрытые игры, свайпы и планы на вечер', counted: true },
  outcomes: { text: 'Записи о том, сколько ты сыграл после совета', counted: true },
  daily_picks: { text: 'Игры дня', counted: true },
  shared_picks: { text: 'Ссылки на выбор, отправленные друзьям', counted: true },
  compat_views: { text: 'Отметки о сравнениях', counted: true },
  feed_links: { text: 'Ссылка на RSS', counted: false },
  rooms: { text: 'Комнаты, где ты хост', counted: true },
  room_members: ROOMS_PART,
  room_votes: ROOMS_PART,
  room_kicks: ROOMS_PART,
  // Колода — часть комнаты, людей в ней нет: уходит вместе с комнатами выше
  room_deck: null,
  sessions: { text: 'Записи о входах', counted: true },
  // Отметка прошлого удаления: на её место встанет новая (forget_marks в lib/db)
  forget_marks: null,
  // Счётчики частоты живут от минуты до часа: в списке они только путали бы
  rate_limits: null,
}

/**
 * Английские подписи тех же таблиц — близнец FORGET_LABELS: те же ключи и
 * то же «не показывать» (null). Число и порядок строк решает русский список,
 * здесь — только слова; расхождение ключей роняет lib/forget.test.ts.
 */
const ROOMS_PART_EN = 'Room memberships and votes'
export const FORGET_LABELS_EN: Readonly<Record<string, string | null>> = {
  users: 'Steam profile: name, avatar and portrait',
  library_snapshots: 'Library snapshots',
  library_baselines: 'Yearly library checkpoints',
  wishlists: 'Wishlist',
  feedback: "Ratings, hidden games, swipes and tonight's plans",
  outcomes: 'Records of how much you played after a pick',
  daily_picks: 'Games of the day',
  shared_picks: 'Pick links you sent to friends',
  compat_views: 'Compatibility checks',
  feed_links: 'Private RSS link',
  rooms: 'Rooms you host',
  room_members: ROOMS_PART_EN,
  room_votes: ROOMS_PART_EN,
  room_kicks: ROOMS_PART_EN,
  room_deck: null,
  sessions: 'Sign-in records',
  forget_marks: null,
  rate_limits: null,
}

export type ForgetSummary = {
  /** Что хранится — строка на вид данных, только непустые */
  items: string[]
  /** Что случится вместе с удалением — только про то, что у человека есть */
  effects: string[]
}

/**
 * locale — язык, на котором человек читает вопрос «Удалить всё?» (роут берёт
 * его из ?lang=). Что показать и в каком порядке, решает счёт и русский
 * список; язык решает только слова.
 */
export function forgetSummary(report: ForgetReport, locale: Locale = 'ru'): ForgetSummary {
  const rows = new Map(report.map((r) => [r.table, r.rows]))
  const n = (table: string) => rows.get(table) ?? 0

  const items: string[] = []
  for (const [table, label] of Object.entries(FORGET_LABELS)) {
    if (!label || n(table) === 0) continue
    const text = tr(locale, { ru: label.text, en: FORGET_LABELS_EN[table] ?? label.text })
    // По-русски число как было, без разрядов; по-английски — «1,240»
    const count = tr(locale, { ru: String(n(table)), en: fmtNumber(locale, n(table)) })
    const line = label.counted ? `${text} — ${count}` : text
    if (!items.includes(line)) items.push(line)
  }

  // Последствия для других людей и для ссылок, которые уже разошлись, —
  // ровно то, о чём /privacy, раздел 06, предупреждает словами. И то, что
  // остаётся после удаления: без этой строки «Удалить всё?» обещало больше,
  // чем делает, — SteamID в отметке удаления жил ещё год и месяц, а человек
  // узнавал о нём разве что из запроса данных
  const effects: string[] = []
  const say = (v: { ru: string; en: string }) => effects.push(tr(locale, v))
  if (n('library_snapshots') > 0) {
    say({
      ru: 'Портрет и итоги года по твоей ссылке перестанут открываться.',
      en: 'Links to your portrait and year in review will stop working.',
    })
  }
  if (n('shared_picks') > 0) {
    say({
      ru: 'Ссылки на выбор, которые ты отправлял, перестанут открываться.',
      en: 'Pick links you sent will stop working.',
    })
  }
  if (n('library_snapshots') > 0 || n('shared_picks') > 0) {
    say({
      ru: 'Превью этих ссылок, которые уже сохранили мессенджеры, отозвать мы не можем.',
      en: "We can't take back previews of these links that messaging apps have already saved.",
    })
  }
  if (n('rooms') > 0) {
    say({ ru: 'Комнаты, где ты хост, закроются для всех, кто в них.', en: 'Rooms you host will close for everyone in them.' })
  }
  if (n('compat_views') > 0) {
    say({
      ru: 'Сравнения пропадут и у тех, с кем ты сравнивался.',
      en: 'Comparisons will disappear for the people you compared with, too.',
    })
  }
  if (n('feed_links') > 0) say({ ru: 'Ссылка на RSS перестанет работать.', en: 'Your RSS link will stop working.' })
  say({ ru: 'Ты выйдешь на всех устройствах.', en: "You'll be signed out on all devices." })
  // Отметка удаления (forget_marks в lib/db) встаёт всегда — те же три факта,
  // что на главной (HeroNotice) и в /privacy: что, зачем, на сколько. На обоих
  // языках: английская строка говорит то же самое, и её сторожит тот же тест
  say({
    ru: 'Останется только отметка — SteamID и время удаления: по ней старые входы на других устройствах больше не пускают. Через год и месяц она сотрётся сама.',
    en: "Only a marker will remain: your SteamID and the time of deletion. It keeps old sign-ins on other devices from getting back in, and it erases itself after a year and a month.",
  })
  return { items, effects }
}

/**
 * Картинки, которые после удаления надо выбросить из кэша.
 *
 * Страницы портрета, итогов и сравнения собираются на каждый запрос и без
 * снимка библиотеки до кэша модели не доходят. А картинки к ним — карточки
 * для мессенджеров и «Скачать карточку» — живут в кэше час (revalidate в
 * их файлах): без сброса удалённый человек ещё час разворачивался бы в чатах
 * своей карточкой. Так же — выборы, которыми он делился, и комнаты, где он
 * хост: их строк уже нет, а картинки ещё звали бы в них.
 *
 * Пути — без хеш-хвоста: групп и параллельных сегментов в них нет (как у
 * roomCardPath). Сторож — lib/forget.test.ts: каждый кэшируемый маршрут под
 * портретом, сравнением, выбором и комнатой обязан стоять в этом списке.
 */
export function forgetCardPaths(steamid: string, ids: { picks: string[]; rooms: string[] }): string[] {
  return [
    `/portrait/${steamid}/opengraph-image`,
    `/portrait/${steamid}/card.png`,
    `/portrait/${steamid}/year/opengraph-image`,
    `/portrait/${steamid}/year/card.png`,
    `/compat/${steamid}/opengraph-image`,
    ...ids.picks.map((id) => `/pick/${id}/opengraph-image`),
    ...ids.rooms.map(roomCardPath),
  ]
}

/**
 * Потолок по адресу на предпросмотр и удаление вместе. Человеку хватит с
 * запасом: открыть вопрос, передумать, открыть снова и нажать. Скрипту —
 * нет: счёт проходит по всем таблицам с людьми, включая полный проход по
 * счётчикам частоты (instr в USER_ROWS), и бесплатным он быть не должен.
 */
export const FORGET_IP_LIMIT = 10
export const FORGET_IP_WINDOW_SEC = 3600
