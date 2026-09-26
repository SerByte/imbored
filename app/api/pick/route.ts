import { NextResponse } from 'next/server'
import { createSharedPick, findSharedPick, getGamesMetaLite } from '@/lib/db'
import { newPickId, pickShareOk } from '@/lib/pickshare'
import { checkRatesInOrder, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { readJsonObject } from '@/lib/reqbody'
import { getDb, nowSec, requireWriter, sessionSecret } from '@/lib/server'
import { cleanReason, parseSharePickBody, SHARED_PICK_TTL_SEC } from '@/lib/sharedpick'

/*
 * Потолки: личный — двадцать ссылок в час (героев в выдаче пять, выдач за
 * вечер несколько); по адресу — шестьдесят: демо-вход выдаёт пишущие сессии
 * даром, и адрес — единственная ось против скрипта. Личный первым — отказ по
 * нему не съедает общий (checkRatesInOrder).
 */
const PICK_LIMIT = 20
const PICK_IP_LIMIT = 60
const PICK_WINDOW_SEC = 3600

/** Сколько раз пробовать новый id при совпадении первичного ключа */
const ID_TRIES = 3

/**
 * «Отправить другу» — ссылка на выбор (/pick/<id>).
 *
 * Сохраняется только то, что сервер сам выдал и подписал для ЭТОЙ сессии
 * (lib/pickshare): иначе любой — пишущую сессию даёт и демо — публиковал бы
 * под нашим именем свой текст. Вход по ссылке на профиль не пишет вовсе:
 * это чужая библиотека. steamid наружу не уходит — ответ только id.
 */
export async function POST(req: Request) {
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const { steamid } = writer

  const body = parseSharePickBody(await readJsonObject(req))
  if (!body) return NextResponse.json({ error: 'badinput' }, { status: 400 })
  const { appid, source, kind, text, sig } = body
  // Подпись устарела (сменили секрет) или чужая — страница предложит обновить выдачу
  if (!pickShareOk(sessionSecret(), { steamid, appid, source, text }, sig)) {
    return NextResponse.json({ error: 'badsig' }, { status: 403 })
  }

  const db = await getDb()
  const now = nowSec()
  const gate = await checkRatesInOrder(
    db,
    [
      { bucket: 'pick-share', id: steamid, limit: PICK_LIMIT, windowSec: PICK_WINDOW_SEC },
      { bucket: 'pick-share-ip', id: clientIp(req.headers), limit: PICK_IP_LIMIT, windowSec: PICK_WINDOW_SEC },
    ],
    now,
  )
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  // Страница выбора рисуется по строке игры — без неё ссылка вела бы в пустоту
  if (!(await getGamesMetaLite(db, [appid])).has(appid)) {
    return NextResponse.json({ error: 'nogame' }, { status: 404 })
  }

  const reason = cleanReason(text)
  const same = await findSharedPick(db, steamid, appid, reason, now - SHARED_PICK_TTL_SEC)
  if (same) return NextResponse.json({ id: same })

  for (let i = 0; i < ID_TRIES; i++) {
    const id = newPickId()
    try {
      await createSharedPick(db, { id, createdBy: steamid, appid, source, kind, reason }, now)
      return NextResponse.json({ id })
    } catch (err) {
      // Совпал первичный ключ — редкость 2^-59, но пробуем другой id
      if (!/UNIQUE|PRIMARY/i.test(String(err))) throw err
    }
  }
  return NextResponse.json({ error: 'busy' }, { status: 503 })
}
