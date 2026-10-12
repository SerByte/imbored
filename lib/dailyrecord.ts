import { mutedDayKey, parseDailySelection, type DailySelection } from './daily'
import { getDailyPick, getGamesMetaLite, type Db } from './db'
import type { MutePreset } from './mutetags'
import { mutedHit, namesMutedTaste } from './recommend'

/**
 * Запись игры дня глазами этого браузера — с его «Не предлагать».
 *
 * Сутки держат до двух записей: общую на профиль и выбранную под фильтром
 * (mutedDayKey в lib/daily.ts — почему рядом, а не поверх). Читают их двое:
 * /api/daily — чтобы показать выбранное без отбора, и живая строка главной
 * (/api/session/touch) — чтобы «Игра дня уже выбрана — «X»» называла ту же
 * игру, что откроется на /daily. Разойдись они, строка обещала бы игру,
 * которую этот браузер просил не предлагать, и прогрев, которого не будет.
 *
 * Порядок — общая первой. Пока она годится фильтру, она и есть игра дня
 * этого браузера: одна игра на всех его устройствах. Своя — только когда
 * общая не годится. Наоборот нельзя: запись под фильтром делят все браузеры
 * с фильтром, и браузер, которому годилась общая, получил бы чужой выбор,
 * стоило соседу с другим фильтром его завести.
 *
 * Годится — это двое. Герой не под фильтром (mutedHit), и причина не
 * называет запретный тег вкусом (namesMutedTaste в lib/recommend): её
 * написала сессия, которая выбирала, по своему профилю, и под годным
 * героем — запретное шестым тегом — стояло бы «По тегам (Соревновательная)
 * это очень твоё» у того, кто соревновательные запретил. Судится сам текст,
 * а не одни отметки тегов: причина с якорем («ближе всего она к «Y»…»)
 * тегов не называет, и запись с ней годится: запретного на экране нет, и
 * отбор заново отнял бы у браузера ту же игру, что у телефона. Отбор
 * заново под фильтром пишет причину из профиля без запретного (mutedTaste),
 * так что его запись годится сразу и по кругу не ходит. Цена — та, что в
 * mutedDayKey: браузер с фильтром получает свою игру дня чуть чаще.
 *
 * Без фильтра — ровно прежнее: одно чтение общей, своя не читается. С
 * фильтром — обе записи разом и мета их героев одним запросом: всё по
 * первичным ключам и только у того, кто фильтр поставил. Своя судится тоже:
 * её мог выбрать браузер с другим фильтром.
 */
export type DailyRecord = {
  /** Выбор, который этому браузеру можно показать; null — отбирать заново */
  selection: DailySelection | null
  /**
   * Куда ляжет новый отбор. В общую — когда её нет: выбор под фильтром любой
   * сессии без фильтра просто одна из годных игр дня. Рядом, под фильтр, —
   * когда общая есть, но её герой под ним: переписать её значило бы сменить
   * игру другим устройствам посреди дня.
   */
  key: string
}

export async function dailyRecord(
  db: Db,
  steamid: string,
  day: string,
  mutes: readonly MutePreset[],
): Promise<DailyRecord> {
  if (!mutes.length) return { selection: parseDailySelection(await getDailyPick(db, steamid, day)), key: day }
  const ownKey = mutedDayKey(day)
  const [shared, own] = (
    await Promise.all([getDailyPick(db, steamid, day), getDailyPick(db, steamid, ownKey)])
  ).map(parseDailySelection)
  const heroes = [shared, own].flatMap((s) => (s ? [s.pick.appid] : []))
  if (!heroes.length) return { selection: null, key: day }
  const metas = await getGamesMetaLite(db, [...new Set(heroes)])
  const fits = (s: DailySelection | null): s is DailySelection =>
    s !== null && !mutedHit(metas.get(s.pick.appid), mutes) && !namesMutedTaste(s, mutes)
  if (fits(shared)) return { selection: shared, key: day }
  if (fits(own)) return { selection: own, key: ownKey }
  return { selection: null, key: shared ? ownKey : day }
}
