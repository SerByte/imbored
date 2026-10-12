import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { countUserRows, forgetCardIds, forgetUser, type Db } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { FORGET_IP_LIMIT, FORGET_IP_WINDOW_SEC, forgetCardPaths, forgetSummary } from '@/lib/forget'
import { FORGET_CONFIRM } from '@/lib/forgetreply'
import { portraitTag } from '@/lib/portraitmodel'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { readJsonObject } from '@/lib/reqbody'
import { SESSION_COOKIE, currentSession, getDb, isDemoId, nowSec, sessionCookieOptions } from '@/lib/server'
import { forgetSessionCache } from '@/lib/sessions'

/**
 * «Удалить всё обо мне»: GET — что хранится, POST — удалить. Кнопка живёт на
 * /library рядом с выходом (components/ForgetMe). До неё удалить данные
 * можно было только письмом, и ответа ждать до тридцати дней.
 *
 * УДАЛЯЕТ ТОЛЬКО ВХОД ЧЕРЕЗ STEAM. Сессию по вставленной ссылке выдают на
 * любой публичный профиль (Resolved.verified в lib/sessions): удали она —
 * любой, кто знает чужую ссылку, стёр бы человеку всё. Демо — ничьё, его
 * убирает уборка. Обоим — 403 needsteam, как у пишущих роутов, и список
 * чужих данных им тоже не показывается.
 *
 * POST СВЕРЯЕТ СЕССИЮ С БАЗОЙ МИМО КЭША. Состояние сессии кэшируется на
 * процесс минуту (REVOKE_CACHE_SEC), и «Выйти на всех устройствах», нажатое
 * владельцем на соседнем экземпляре, доходит сюда с опозданием. Любая другая
 * запись в эту минуту поправима, удаление — нет. Сбой этой сверки
 * открывается на «не подтверждена» (lib/sessions) — то есть отказом, а не
 * удалением.
 *
 * Слово подтверждения в теле (FORGET_CONFIRM) — защита от случайного POST, а
 * не от чужого сайта: межсайтовый POST в /api отсекает proxy.ts. Потолок —
 * по адресу, общий на список и удаление (FORGET_IP_LIMIT): по SteamID его не
 * посчитать — счётчик ушёл бы вместе со всем остальным.
 *
 * УДАЛЯЕТ ТО ЖЕ, ЧТО И ПИСЬМО: forgetUser по USER_ROWS, одной пачкой, —
 * своего списка таблиц у роута нет, и сторож полноты в lib/db.test.ts
 * действует и здесь. С signOutFrom: той же пачкой встаёт отметка удаления,
 * и человека выпускает со всех устройств, а не только с этого (почему
 * стёртых сессий для этого мало — у таблицы forget_marks). Кука этого
 * устройства гасится ответом. Минуту соседний экземпляр ещё может пустить
 * другое устройство по кэшу — та же цена, что у «выйти везде».
 *
 * В ЛОГ НЕ ПОПАДАЕТ НИЧЕГО ЛИЧНОГО. Сбой базы пишется строкой без SteamID и
 * без счёта; сбой сброса кэша не пишется вовсе — в тексте его ошибки стоял
 * бы адрес картинки, а в адресе SteamID.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

type Gate = { ok: true; steamid: string } | { ok: false; response: NextResponse }

/** Кто пришёл и вправе ли удалять. fresh — мимо кэша состояния сессий */
async function owner(fresh: boolean): Promise<Gate> {
  if (fresh) forgetSessionCache()
  const session = await currentSession()
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'nosession' }, { status: 401, headers: NO_STORE }) }
  }
  if (!session.verified || isDemoId(session.steamid)) {
    return { ok: false, response: NextResponse.json({ error: 'needsteam' }, { status: 403, headers: NO_STORE }) }
  }
  return { ok: true, steamid: session.steamid }
}

/** Потолок по адресу; null — можно */
async function limited(db: Db, req: Request): Promise<Response | null> {
  const verdict = await checkRate(db, {
    bucket: 'forget-ip',
    id: clientIp(req.headers),
    limit: FORGET_IP_LIMIT,
    windowSec: FORGET_IP_WINDOW_SEC,
    nowSec: nowSec(),
  })
  return verdict.ok ? null : rateLimitedResponse(verdict.retryAfterSec)
}

/** Что хранится — строками для подтверждения (forgetSummary в lib/forget) */
export async function GET(req: Request) {
  const gate = await owner(false)
  if (!gate.ok) return gate.response
  const db = await getDb()
  const deny = await limited(db, req)
  if (deny) return deny
  try {
    return NextResponse.json(forgetSummary(await countUserRows(db, gate.steamid)), { headers: NO_STORE })
  } catch (err) {
    logSwallowed('forget:count', err)
    return NextResponse.json({ error: 'failed' }, { status: 503, headers: NO_STORE })
  }
}

export async function POST(req: Request) {
  const gate = await owner(true)
  if (!gate.ok) return gate.response
  const db = await getDb()
  const deny = await limited(db, req)
  if (deny) return deny
  const { confirm } = await readJsonObject(req)
  if (confirm !== FORGET_CONFIRM) {
    return NextResponse.json({ error: 'badinput' }, { status: 400, headers: NO_STORE })
  }

  const { steamid } = gate
  let cards: string[]
  try {
    // Адреса выборов и комнат — до удаления: после него их не узнать
    const ids = await forgetCardIds(db, steamid)
    await forgetUser(db, steamid, { signOutFrom: nowSec() })
    cards = forgetCardPaths(steamid, ids)
  } catch (err) {
    // Пачка атомарна: не прошла — не удалено ничего, и кука остаётся, чтобы
    // нажать ещё раз
    logSwallowed('forget:erase', err)
    return NextResponse.json({ error: 'failed' }, { status: 503, headers: NO_STORE })
  }

  // Иначе на этом экземпляре удалённый ещё минуту проходил бы по кэшу
  forgetSessionCache()
  // Сброс — лучшим усилием: удаление уже записано, а карточка в худшем
  // случае догонит сама, через свой час (lib/forget, forgetCardPaths)
  for (const path of cards) {
    try {
      revalidatePath(path)
    } catch {
      // в лог — нет: в тексте ошибки был бы адрес, а в нём SteamID
    }
  }
  try {
    // Модель портрета и итогов: без снимка до неё и так не дойти, но в кэше
    // данных ей лежать незачем — немедленно, а не «устаревшее, пока
    // пересобирается»
    revalidateTag(portraitTag(steamid), { expire: 0 })
  } catch {
    // как выше
  }

  const res = NextResponse.json({ ok: true }, { headers: NO_STORE })
  res.cookies.set(SESSION_COOKIE, '', { ...sessionCookieOptions(), maxAge: 0 })
  return res
}
