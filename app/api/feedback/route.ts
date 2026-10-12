import { revalidateTag } from 'next/cache'
import { NextResponse } from 'next/server'
import { dailyHeroAppids, dayKey, parseDailySelection } from '@/lib/daily'
import { forgetDailyPick, getDailyPick, logFeedback, recordOutcome } from '@/lib/db'
import { parseFeedbackCtx } from '@/lib/feedbackctx'
import { logSwallowed } from '@/lib/errlog'
import { isFeedbackAction, isSkipReason } from '@/lib/feedbackkinds'
import { parseMood } from '@/lib/mood'
import { portraitTag } from '@/lib/portraitmodel'
import { checkRatesInOrder, clientIp, rateLimitedResponse } from '@/lib/ratelimit'
import { getDb, isDemoId, nowSec, requireWriter } from '@/lib/server'
import { readJsonObject } from '@/lib/reqbody'

/*
 * Потолки на запись фидбека.
 *
 * Каждый вызов — строка в Turso, а сессию бесплатно выдаёт демо-вход, так что
 * без лимита ручка превращается в чужой счёт за записи. Сто двадцать за десять
 * минут — это клик каждые пять секунд без остановки: живой человек на /play
 * столько не нажимает даже в рулетке.
 *
 * Но личный потолок держит одну личность, а не скрипт. Демо-вход чеканит
 * пишущие личности даром — новую на каждый /api/connect без куки, сорок восемь
 * в час с адреса (CONNECT_LIMIT), — и живёт каждая, пока пишет (STALE_DEMO в
 * lib/db): с одним личным потолком скрипт, копящий личности, писал бы оценки
 * без края, и через сутки это были бы сотни тысяч строк в час. Поэтому второй
 * гейт — по адресу: он единственная ось против такого скрипта, как у
 * /api/pick. Втрое выше личного — соседям по квартире или мобильному NAT
 * хватит и на троих, кто давит кнопки без остановки. Личный первым
 * (checkRatesInOrder): отказ по нему не съедает потолок адреса соседей.
 *
 * Учебные сигналы (открыл, лайк, запуск) клиент шлёт fire-and-forget:
 * потерянная под флудом оценка — не беда, в отличие от сорванной выдачи. Но
 * бан, «Пройдено», «Не сегодня» на /daily и «Убрать» с полки /explore ждут
 * ответа и на любой не-ok показывают строку отказа (sendFeedback на /play,
 * components/MarkFinished, notToday на /daily, unlike на /explore). Отказ по
 * адресу для них выглядит так же, как личный: выеденный соседями за тем же
 * NAT адрес покажет её и тому, кто нажал раз, — потому и запас втрое (абзац
 * выше).
 */
const FEEDBACK_LIMIT = 120
const FEEDBACK_IP_LIMIT = 360
const FEEDBACK_WINDOW_SEC = 600

export async function POST(req: Request) {
  // Любое действие, включая бан: история оценок и есть профиль вкуса, и
  // писать в неё по вставленной ссылке нельзя (см. isWriter в lib/server)
  const writer = await requireWriter()
  if (!writer.ok) return writer.response
  const { steamid } = writer

  const body = (await readJsonObject(req)) as {
    appid?: number
    action?: string
    reason?: string
    mood?: unknown
    ctx?: unknown
  }
  const appid = Number(body.appid)
  const action = body.action
  // Белые списки действий и причин — lib/feedbackkinds.ts: там же строится
  // CHECK таблицы, и новое действие не разъедется с тем, что пускает роут
  if (!Number.isInteger(appid) || !isFeedbackAction(action)) {
    return NextResponse.json({ error: 'badinput' }, { status: 400 })
  }

  const db = await getDb()
  const now = nowSec()
  const gate = await checkRatesInOrder(
    db,
    [
      { bucket: 'feedback', id: steamid, limit: FEEDBACK_LIMIT, windowSec: FEEDBACK_WINDOW_SEC },
      { bucket: 'feedback-ip', id: clientIp(req.headers), limit: FEEDBACK_IP_LIMIT, windowSec: FEEDBACK_WINDOW_SEC },
    ],
    now,
  )
  if (!gate.ok) return rateLimitedResponse(gate.retryAfterSec)

  // невалидные mood/reason/ctx не роняют фидбек — просто не сохраняются.
  // Снимок выдачи (lib/feedbackctx) — белым списком: слот, движок, части
  // скора и прочее, что нужно отчёту, и ничего сверх
  const mood = parseMood(body.mood)
  const reason = isSkipReason(body.reason) ? body.reason : null
  const ctx = parseFeedbackCtx(body.ctx)
  await logFeedback(
    db,
    {
      steamid,
      appid,
      action,
      ...(reason ? { reason } : {}),
      ...(mood ? { mood } : {}),
      ...(ctx ? { ctx } : {}),
    },
    now,
  )
  /*
   * Исход совета (lib/outcome.ts): запуск или переход в магазин за не
   * купленной — строка, которую следующие снапшоты дополнят реальными
   * минутами. Демо-личностям нет: их библиотека не меняется, и исход у них
   * всегда «ничего не сыграно». Отказ оценку не срывает: она уже записана, а
   * исход — измерение, и потерять одно лучше, чем ответить пятисоткой.
   */
  const launched = action === 'launched'
  if (!isDemoId(steamid) && (launched || (action === 'opened' && ctx?.intent === 'store'))) {
    await recordOutcome(
      db,
      { steamid, appid, source: ctx?.candidate ?? null, launched, ...(ctx ? { ctx } : {}) },
      now,
    ).catch((err: unknown) => {
      logSwallowed('feedback:outcome', err)
    })
  }
  // Игра дня записана на сутки, но бан и «надоела» отбор обязан учесть сразу:
  // иначе убранная игра стояла бы героем до полуночи (см. forgetDailyPick)
  //
  // Вчерашняя запись стирается тоже — но только когда её герой и есть эта
  // игра: по ней /daily пишет «Вчера была: X →», и без сброса ссылка на
  // только что скрытую игру висела бы до полуночи. Потери для отбора нет:
  // avoid у pickDaily охранял вчерашнего героя, а он и так вне кандидатов
  // (бан — exclude, «надоела» — cooldownKinds). Запасную свою вчерашняя
  // запись охраняла тоже — этим жертвуем: повтор своей лучше ссылки на
  // скрытую. Совпадение только с героем: запасная в строку не идёт (см.
  // yesterdayLine), и стирать ради неё незачем.
  const day = dayKey(now)
  if (action === 'banned' || reason === 'tired') {
    const yesterdayDay = dayKey(now - 86_400)
    const [, yesterday] = await Promise.all([
      forgetDailyPick(db, steamid, day),
      getDailyPick(db, steamid, yesterdayDay),
    ])
    if (parseDailySelection(yesterday)?.pick.appid === appid) {
      await forgetDailyPick(db, steamid, yesterdayDay)
    }
  }
  // «Не сегодня» — только если сказано про героя дня или запасную свою: тогда
  // отбор пересчитается без неё (notnowSince в /api/daily). Про любую другую
  // игру запись не трогаем — иначе «не сейчас» на /play перетасовывало бы
  // выбор, обещанный на сутки
  else if (reason === 'notnow') {
    const today = parseDailySelection(await getDailyPick(db, steamid, day))
    if (dailyHeroAppids(today).includes(appid)) await forgetDailyPick(db, steamid, day)
  }
  // Модель портрета кэшируется по снапшоту, а бан снапшот не меняет: без
  // сброса «начни с этой» на портрете указывала бы на скрытую игру до
  // следующего снапшота. 'max' — следующий заход получит старую модель, пока
  // собирается новая: стартовая — не то, ради чего ждать сборку
  if (action === 'banned') revalidateTag(portraitTag(steamid), 'max')
  return NextResponse.json({ ok: true })
}
