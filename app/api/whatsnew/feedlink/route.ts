import { NextResponse } from 'next/server'
import { dropFeedLink, issueFeedLink } from '@/lib/db'
import {
  FEED_LINK_LIMIT,
  FEED_LINK_WINDOW_SEC,
  feedPath,
  feedTokenHash,
  newFeedToken,
} from '@/lib/feedlink'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
import { readJsonObject } from '@/lib/reqbody'
import { getDb, nowSec, requireWriter } from '@/lib/server'

/**
 * Секретная ссылка на личную RSS-ленту: POST выпускает (и перевыпускает),
 * DELETE отключает. Сама лента — app/whatsnew/feed/[token].
 *
 * ТОЛЬКО ПИШУЩАЯ СЕССИЯ (requireWriter): вход через Steam или демо. Сессия
 * по вставленной ссылке на профиль владение не доказала, и ключ, выпущенный
 * ею, был бы постоянным доступом к чужой ленте мимо всякого входа, — а
 * отключение дало бы ей гасить владельцу его подписку. Межсайтовую форму
 * отсекает proxy.ts: POST и DELETE в /api принимаются только с нашей страницы.
 *
 * И ТОЛЬКО НЕ ОТОЗВАННАЯ. requireWriter верит кэшу состояния сессии, а он
 * после «Выйти на всех устройствах» на другом экземпляре живёт ещё минуту.
 * Выпуск — постоянный доступ, поэтому отзыв сверяется в самой записи
 * (issueFeedLink в lib/db), и отозванной сессии ответ — 401, как вышедшей.
 *
 * Ключ уходит в ответе один раз и больше не существует нигде, кроме ридера
 * человека: в базе — sha256 (lib/feedlink). Поэтому ответ — private, no-store:
 * ни CDN, ни браузерный кэш, ни «назад» не должны его повторить.
 *
 * Отдаётся путь, а не адрес целиком: адрес собирает страница от того
 * origin, где человек сейчас, — см. feedPath.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

/**
 * Выпуск. Тело — { replace: true }, когда человек подтвердил замену.
 *
 * Без него существующая ссылка не трогается: 409 exists с её датой
 * (lib/feedlinkreply). Подтверждение решает сервер, а не страница: страница
 * знает о ссылке по своему первому кадру, а тот бывает старым — «назад» из
 * роутерного кэша, вторая вкладка, — и одно нажатие «Получить ссылку» на нём
 * молча гасило бы ссылку, которую человек только что положил в ридер.
 *
 * Потолок — на выпуск, и считается по steamid: человек один, а ключ в
 * счётчике тот, по которому forgetUser находит строки rate_limits (USER_ROWS
 * в lib/db). Отказ «уже есть» его тоже тратит: запрос дошёл до записи.
 */
export async function POST(req: Request) {
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const db = await getDb()
  const verdict = await checkRate(db, {
    bucket: 'feedlink',
    id: writer.steamid,
    limit: FEED_LINK_LIMIT,
    windowSec: FEED_LINK_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!verdict.ok) return rateLimitedResponse(verdict.retryAfterSec)

  const { replace } = await readJsonObject(req)
  const token = newFeedToken()
  const now = nowSec()
  // Одной записью на место прежнего отпечатка: перевыпуск и есть отзыв
  const issued = await issueFeedLink(db, {
    steamid: writer.steamid,
    sid: writer.sid,
    tokenHash: feedTokenHash(token),
    nowSec: now,
    replace: replace === true,
  })
  if (issued.kind === 'revoked') {
    return NextResponse.json({ error: 'nosession' }, { status: 401, headers: NO_STORE })
  }
  if (issued.kind === 'exists') {
    return NextResponse.json({ error: 'exists', since: issued.createdAt }, { status: 409, headers: NO_STORE })
  }
  return NextResponse.json({ path: feedPath(token), createdAt: now }, { headers: NO_STORE })
}

/**
 * Отключение — без потолка частоты. Это и есть защита: ссылка утекла, и
 * владелец гасит её сейчас, а не через час. Общий с выпуском потолок давал
 * тому, кто сидит в чужой сессии, запереть владельцу «Отключить» десятком
 * выпусков. Беречь здесь нечего: удаление идемпотентно и стоит одной строки
 * по первичному ключу.
 */
export async function DELETE() {
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  await dropFeedLink(await getDb(), writer.steamid)
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
