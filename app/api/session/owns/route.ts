import { NextResponse } from 'next/server'
import { latestEveningPlan, snapshotOwns } from '@/lib/db'
import { currentSession, getDb, isDemoId, isWriter, nowSec } from '@/lib/server'

/**
 * Есть ли эта игра у того, кто смотрит. Ответ — один бит: { owned }.
 *
 * Зачем отдельный роут. Страница игры одна на всех и живёт на ISR сутки: про
 * сессию она не знает и знать не должна, иначе пять тысяч карточек стали бы
 * динамическими. А «Запустить» стояла на ней у каждого — и у того, у кого игры
 * нет: steam://run у него открывал пустой клиент или окно покупки. Теперь
 * кнопку дорисовывает клиентский островок (components/OwnedLaunch) по этому
 * ответу, а разметка страницы остаётся общей.
 *
 * Кэш — private и пять минут: ответ личный, но между переходами по карточкам
 * одной сессии меняется только новым снапшотом библиотеки, то есть редко.
 * Vary: Cookie — чтобы браузер не отдал ответ прошлого входа следующему.
 * Гостю — no-store: иначе «нет» до входа пережило бы сам вход.
 *
 * Лимита частоты нет намеренно: одна строка по индексу и один бит наружу —
 * дешевле, чем сама проверка лимита, которая пишет в базу.
 *
 * Второй бит — plan: у этой игры живой план на вечер (lib/eveningplan.ts).
 * Живая строка главной ведёт на страницу игры, и запуск отсюда обязан
 * закрыть план — иначе «Ставил на загрузку — ждёт тебя» висела бы и после
 * сыгранного вечера. OwnedLaunch по этому биту пишет запуск, как /play.
 * Только своей пишущей сессии не из демо — как и сам план. Ответ с планом —
 * без кэша: после запуска он перестаёт быть правдой. Чтение плана — только у
 * своей игры: «есть ли план» у чужой ничего не значит. Ответ без плана живёт
 * те же пять минут: план, поставленный в эти минуты, страница игры узнает
 * следующим ответом, а строка плана на /play закрывает его и сама.
 */
const OWNED_MAX_AGE = 300

export async function GET(req: Request) {
  const appid = Number(new URL(req.url).searchParams.get('appid'))
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
  const planned =
    owned &&
    isWriter(session) &&
    !isDemoId(steamid) &&
    (await latestEveningPlan(db, steamid, nowSec(), appid).catch(() => null)) !== null
  if (planned) {
    return NextResponse.json({ owned, plan: true }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  return NextResponse.json(
    { owned },
    {
      headers: {
        'Cache-Control': `private, max-age=${OWNED_MAX_AGE}`,
        Vary: 'Cookie',
      },
    },
  )
}
