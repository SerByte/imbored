import { NextResponse } from 'next/server'
import { isFinished, latestEveningPlan, snapshotOwns } from '@/lib/db'
import { currentSession, getDb, isDemoId, isWriter, nowSec } from '@/lib/server'

/**
 * Есть ли эта игра у того, кто смотрит. Ответ — { owned } и, у своей игры
 * пишущей сессии, необязательные plan и done (о них ниже).
 *
 * Зачем отдельный роут. Страница игры одна на всех и живёт на ISR сутки: про
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
