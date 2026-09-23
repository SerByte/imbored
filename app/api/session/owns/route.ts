import { NextResponse } from 'next/server'
import { snapshotOwns } from '@/lib/db'
import { currentSteamId, getDb } from '@/lib/server'

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
 */
const OWNED_MAX_AGE = 300

export async function GET(req: Request) {
  const appid = Number(new URL(req.url).searchParams.get('appid'))
  if (!Number.isInteger(appid) || appid === 0) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  const steamid = await currentSteamId()
  if (!steamid) {
    return NextResponse.json({ owned: false }, { headers: { 'Cache-Control': 'private, no-store' } })
  }

  // Отрицательные appid — кураторский пул других магазинов: в библиотеке
  // Steam их не бывает, и спрашивать базу не о чем
  const owned = appid > 0 ? await snapshotOwns(await getDb(), steamid, appid) : false

  return NextResponse.json(
    { owned: owned === true },
    {
      headers: {
        'Cache-Control': `private, max-age=${OWNED_MAX_AGE}`,
        Vary: 'Cookie',
      },
    },
  )
}
