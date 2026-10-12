import { revalidatePath, revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { countUserRows, forgetCardIds, forgetUser, type Db } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { FORGET_IP_LIMIT, FORGET_IP_WINDOW_SEC, forgetCardPaths, forgetSummary } from '@/lib/forget'
import { FORGET_CONFIRM } from '@/lib/forgetreply'
import { portraitTag } from '@/lib/portraitmodel'
import { checkRate, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { readJsonObject } from '@/lib/reqbody'
import { clearDeviceCookies, currentSession, getDb, isDemoId, nowSec } from '@/lib/server'
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
 * запись в эту минуту поправима, удаление — нет. Мимо кэша читается только
 * эта сессия (currentSession с fresh), а общий кэш процесса до проверки куки
 * не сбрасывается: иначе любой POST без входа — отбитый 401, но без потолка
 * — стирал бы кэш всем на экземпляре, и каждый их запрос шёл бы в базу.
 *
 * СБОЙ СВЕРКИ СЕССИИ — 503 failed, А НЕ needsteam, и у списка, и у удаления.
 * База не ответила — и вход пущен на веру (fail-open в lib/sessions):
 * verified у него false не потому, что вошли по ссылке, а потому, что
 * неизвестно ничего (Resolved.checked). needsteam позвал бы войти через
 * Steam того, кто уже вошёл, и вход в аварию не помог бы; failed просит
 * нажать ещё раз. И не удаляет — как и любой другой отказ.
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
 * стёртых сессий для этого мало — у таблицы forget_marks). Куки этого
 * устройства гасятся ответом — сессия и «Не предлагать», тем же помощником,
 * что у выхода (clearDeviceCookies в lib/server). И не только удачным: 401
 * гасит их тоже — так приходит повтор после оборванного ответа, когда
 * удаление записалось, а Set-Cookie потерялся. Остальные устройства —
 * отметкой, но не мгновенно: до минуты (REVOKE_CACHE_SEC) соседний
 * экземпляр ещё может пустить другое устройство по своему кэшу. Отметку оно
 * этим не переживёт: продление куки решается только свежим чтением из базы
 * (resolveSession), иначе продлённая кука прожила бы с новым iat ещё год.
 * Библиотеку заново оно тоже не разберёт: снимка нет, /library и /play
 * отправляют подключаться, а /api/prepare без снимка ничего не
 * перезапрашивает. Прогрев, начатый ещё до удаления и ждущий Steam, свежий
 * снимок поверх стёртого не положит (replaces в saveLibrarySnapshot).
 * Вечного следа оно не оставит и записью: ссылку на RSS такой сессии не
 * выпустят (issueFeedLink), «Выйти на всех устройствах» не заведёт строку
 * users заново (revokeAllSessions) — оба сверяют отметку в самой записи, —
 * а текст портрета, дописанный рендером, начатым до удаления, без своего
 * снимка не ляжет (setUserPortrait) — как и список желаемого, который полка
 * /library дочитывает из Steam уже после ответа страницы (saveWishlist).
 * Остаётся одно: оценка или план, нажатые на том устройстве в эту самую
 * минуту, запишутся уже после удаления.
 *
 * В ЛОГ НЕ ПОПАДАЕТ НИЧЕГО ЛИЧНОГО. Сбой базы пишется строкой без SteamID и
 * без счёта; сбой сброса кэша не пишется вовсе — в тексте его ошибки стоял
 * бы адрес картинки, а в адресе SteamID.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

type Gate = { ok: true; steamid: string } | { ok: false; response: NextResponse }

/** Кто пришёл и вправе ли удалять. fresh — мимо кэша состояния сессий */
async function owner(fresh: boolean): Promise<Gate> {
  const session = await currentSession({ fresh })
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'nosession' }, { status: 401, headers: NO_STORE }) }
  }
  // Демо узнаётся по самому SteamID — база для этого не нужна
  if (isDemoId(session.steamid)) {
    return { ok: false, response: NextResponse.json({ error: 'needsteam' }, { status: 403, headers: NO_STORE }) }
  }
  // База не ответила на сверке: подтверждён ли вход — неизвестно (см. шапку)
  if (!session.checked) {
    return { ok: false, response: NextResponse.json({ error: 'failed' }, { status: 503, headers: NO_STORE }) }
  }
  if (!session.verified) {
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
  if (!gate.ok) {
    // Входа на этом устройстве нет — и «Не предлагать» здесь больше ничья.
    // Сюда приходит повтор после оборванного ответа (lib/forgetreply):
    // удаление записалось, а ответ с погашенными куками потерялся, и без
    // этой строки «хорроры, VR» удалённого ещё год резали бы подбор
    // следующему на этом браузере. Гасить можно смело — как у выхода,
    // «даже если сессии уже нет». Остальные отказы (403, 503) — при живой
    // сессии, и удалено там ничего не было: куки остаются
    if (gate.response.status === 401) clearDeviceCookies(gate.response)
    return gate.response
  }
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

  // Иначе на этом экземпляре удалённый ещё минуту проходил бы по кэшу. Весь
  // кэш, а не одна сессия: другие устройства человека лежат в нём под
  // своими sid, а их строк уже нет. Сюда доходит только вход через Steam под
  // потолком попыток — ручкой для чужих этот сброс не станет
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
  // Тот же помощник, что у выхода: удаление — выход везде, и «Не предлагать»
  // удалённого не должна год резать подбор следующему на этом браузере.
  // Здесь, после записанного удаления, — и у 401 выше, где входа уже нет.
  // Прочие отказы не удалили ничего, и обе куки остаются, чтобы нажать ещё раз
  clearDeviceCookies(res)
  return res
}
