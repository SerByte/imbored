import { NextResponse } from 'next/server'
import { dropFeedLink, setFeedLink } from '@/lib/db'
import {
  FEED_LINK_LIMIT,
  FEED_LINK_WINDOW_SEC,
  feedPath,
  feedTokenHash,
  newFeedToken,
} from '@/lib/feedlink'
import { checkRate, rateLimitedResponse } from '@/lib/ratelimit'
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
 * Ключ уходит в ответе один раз и больше не существует нигде, кроме ридера
 * человека: в базе — sha256 (lib/feedlink). Поэтому ответ — private, no-store:
 * ни CDN, ни браузерный кэш, ни «назад» не должны его повторить.
 *
 * Отдаётся путь, а не адрес целиком: адрес собирает страница от того
 * origin, где человек сейчас, — см. feedPath.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store, max-age=0' }

/**
 * Вход в ручку: кто пришёл, вправе ли, и не жмёт ли он слишком часто.
 *
 * Потолок общий на выпуск и отключение и считается по steamid: человек
 * один, а ключ в счётчике тот, по которому forgetUser находит строки
 * rate_limits (USER_ROWS в lib/db).
 */
async function gate(): Promise<{ ok: true; steamid: string } | { ok: false; response: Response }> {
  const writer = await requireWriter()
  if (!writer.ok) return writer
  const verdict = await checkRate(await getDb(), {
    bucket: 'feedlink',
    id: writer.steamid,
    limit: FEED_LINK_LIMIT,
    windowSec: FEED_LINK_WINDOW_SEC,
    nowSec: nowSec(),
  })
  if (!verdict.ok) {
    return { ok: false, response: rateLimitedResponse(verdict.retryAfterSec) }
  }
  return writer
}

export async function POST() {
  const g = await gate()
  if (!g.ok) return g.response
  const token = newFeedToken()
  const now = nowSec()
  // Одной записью на место прежнего отпечатка: перевыпуск и есть отзыв
  await setFeedLink(await getDb(), g.steamid, feedTokenHash(token), now)
  return NextResponse.json({ path: feedPath(token), createdAt: now }, { headers: NO_STORE })
}

export async function DELETE() {
  const g = await gate()
  if (!g.ok) return g.response
  await dropFeedLink(await getDb(), g.steamid)
  return NextResponse.json({ ok: true }, { headers: NO_STORE })
}
