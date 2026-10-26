import { NextResponse } from 'next/server'
import {
  bannedAppids,
  getNeighbors,
  isFinished,
  latestEveningPlan,
  snapshotOwns,
  snapshotOwnsMany,
  type Db,
} from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { NEAR_SHOWN, type OwnedNearGame } from '@/lib/ownednear'
import { currentSession, getDb, isDemoId, isWriter, nowSec } from '@/lib/server'

/**
 * Есть ли эта игра у того, кто смотрит. Ответ — { owned } и, у своей игры
 * пишущей сессии, необязательные plan и done (о них ниже).
 *
 * Зачем отдельный роут. Страница игры одна на всех и живёт на ISR месяц: про
 * сессию она не знает и знать не должна, иначе пять тысяч карточек стали бы
 * динамическими. А «Запустить» стояла на ней у каждого — и у того, у кого игры
 * нет: steam://run у него открывал пустой клиент или окно покупки. Теперь
 * кнопку дорисовывает клиентский островок (components/OwnedLaunch) по этому
 * ответу, а разметка страницы остаётся общей.
 *
 * Кэш — private и пять минут, но только у «нет» и у «да» сессии по
 * вставленной ссылке: их между переходами по карточкам меняет лишь новый
 * снапшот библиотеки, то есть редко. «Да» пишущей сессии — no-store: plan и
 * done в нём человек меняет сам (почему — в конце). Vary: Cookie — чтобы
 * браузер не отдал ответ прошлого входа следующему. Гостю — no-store: иначе
 * «нет» до входа пережило бы сам вход.
 *
 * Лимита частоты нет намеренно: каждое чтение — поиск по индексу на
 * несколько строк одного человека (снапшот, план за полтора дня, баны одной
 * игры — idx_feedback_banned), наружу — несколько бит. Это дешевле, чем
 * сама проверка лимита, которая пишет в базу.
 *
 * С near (ниже) это верно уже наполовину, и цена названа прямо. «Нет»
 * пишущей сессии с near=1 добавляет дюжину строк соседей по первичному
 * ключу, все баны человека (по индексу) и — главное — один полный проход
 * json_each по блобу его библиотеки (snapshotOwnsMany), у большой
 * библиотеки — сотни килобайт. Отсева instr, как у snapshotOwns, там нет:
 * у дюжины id подстрока у большой библиотеки находится почти всегда, а
 * маленькую и разбирать дёшево. Наружу — уже не биты, а до NEAR_SHOWN имён
 * с минутами, но своих и себе (private, Vary: Cookie). Лимита нет и тут:
 * платит только вошедший через Steam не из демо и только на карточке чужой
 * игры с готовыми соседями; браузер держит ответ пять минут на игру (кэш
 * ниже), так что «Назад» и перезагрузки базу не трогают; сам проход — тот же
 * разбор той же одной строки, что /library делает на каждом заходе, только в
 * базе, и в функцию едут лишь совпавшие строки. А проверка лимита писала бы
 * в базу на каждом заходе каждого вошедшего — дороже чтения, которое она
 * бережёт. Сбой этого чтения не роняет ответ: «нет» уходит без near, а
 * строка лога (owns:near) говорит, что строка «Похожее» погасла не сама.
 *
 * Второй бит — plan: у этой игры живой план на вечер (lib/eveningplan.ts).
 * Живая строка главной ведёт на страницу игры, и запуск отсюда обязан
 * закрыть план — иначе «Ставил на загрузку — ждёт тебя» висела бы и после
 * сыгранного вечера. OwnedLaunch по этому биту пишет запуск, как /play.
 * Только своей пишущей сессии не из демо — как и сам план. Чтение плана —
 * только у своей игры: «есть ли план» у чужой ничего не значит.
 *
 * Третий бит — done: игра уже отмечена «Уже прошёл» (isFinished — то же
 * правило, что у полки «Пройдено»). Без него кнопка возвращалась на каждой
 * перезагрузке, хотя игра лежит на полке: не понять, сохранилась ли отметка,
 * а каждое повторное нажатие писало ещё одну строку бана. Только пишущей
 * сессии, демо тоже: кнопка — её, и в «Твоих вечерах» у неё то же слово.
 *
 * Поэтому «да» пишущей сессии — без кэша: оба бита она меняет сама —
 * запуском, отметкой здесь или на /library, «Снова предлагать» на полке, —
 * и ответ пятиминутной давности вернул бы кнопку, только что нажатую, или
 * план, только что закрытый. Ценой — функция на каждый заход своей игры.
 * «Нет» и «да» сессии по ссылке живут прежние пять минут: их меняет только
 * снапшот.
 *
 * Четвёртое — near, «Похожее уже есть у тебя» (lib/ownednear): с near=1 «нет»
 * пишущей сессии не из демо несёт до NEAR_SHOWN своих игр из соседей этой
 * (getNeighbors — та же таблица, что у «Похожих» ниже на странице), в их
 * порядке и с наигранным. Тем же запросом, что «Запустить», а не вторым: у
 * не своей игры его и так задаёт каждый заход вошедшего. Сессии по ссылке и
 * демо — ничего (почему — в lib/ownednear). Кэш у такого «нет» прежний, пять
 * минут: свою полку человек меняет баном, а бан, увиденный строкой ещё пять
 * минут на уже открытой однажды карточке, — цена, которая дешевле функции на
 * каждый «Назад».
 */
const OWNED_MAX_AGE = 300

/**
 * Свои из соседей: в порядке соседей, без забаненного (пройденное — тоже
 * бан, reason 'done'), не больше NEAR_SHOWN. Сбой любого чтения — пустой
 * список: строка — подсказка, и без неё страница та же, что у гостя. Но
 * молча — нельзя: сломанный запрос погасил бы строку у всех навсегда, и в
 * проде это выглядело бы как «своих похожих ни у кого нет».
 */
async function ownedNear(db: Db, steamid: string, appid: number): Promise<OwnedNearGame[]> {
  try {
    const [near, banned] = await Promise.all([getNeighbors(db, appid), bannedAppids(db, steamid)])
    const ids = near.map((g) => g.appid).filter((id) => id !== appid && !banned.has(id))
    if (!ids.length) return []
    const minutes = await snapshotOwnsMany(db, steamid, ids)
    return near
      .filter((g) => ids.includes(g.appid) && minutes.has(g.appid))
      .slice(0, NEAR_SHOWN)
      .map((g) => ({ appid: g.appid, name: g.name, minutes: minutes.get(g.appid) ?? null }))
  } catch (err) {
    logSwallowed('owns:near', err)
    return []
  }
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams
  const appid = Number(params.get('appid'))
  const wantNear = params.get('near') === '1'
  if (!Number.isInteger(appid) || appid === 0) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  const session = await currentSession()
  if (!session) {
    return NextResponse.json({ owned: false }, { headers: { 'Cache-Control': 'private, no-store' } })
  }
  const { steamid } = session
  const db = await getDb()

  // Отрицательные appid — кураторский пул других магазинов: в библиотеке
  // Steam их не бывает, и спрашивать базу не о чем
  const owned = appid > 0 ? (await snapshotOwns(db, steamid, appid)) === true : false
  if (owned && isWriter(session)) {
    // Сбой чтения — просто без бита, как и без плана: кнопка на месте
    const [planned, done] = await Promise.all([
      !isDemoId(steamid) &&
        latestEveningPlan(db, steamid, nowSec(), appid).then(
          (p) => p !== null,
          () => false,
        ),
      isFinished(db, steamid, appid).catch(() => false),
    ])
    return NextResponse.json(
      { owned, ...(planned ? { plan: true } : {}), ...(done ? { done: true } : {}) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    )
  }

  const near =
    wantNear && !owned && appid > 0 && isWriter(session) && !isDemoId(steamid)
      ? await ownedNear(db, steamid, appid)
      : []

  return NextResponse.json(
    { owned, ...(near.length ? { near } : {}) },
    {
      headers: {
        'Cache-Control': `private, max-age=${OWNED_MAX_AGE}`,
        Vary: 'Cookie',
      },
    },
  )
}
