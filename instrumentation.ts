import type { Instrumentation } from 'next'
import { formatServerError, serverErrorLine } from '@/lib/errlog'

/**
 * Серверные ошибки перестают быть невидимыми.
 *
 * До этого файла падение у живого человека не видел никто. Обе границы ошибок
 * — app/error.tsx и app/global-error.tsx — показывают ему digest («код:
 * a1b2c3») и предлагают попробовать снова; это половина моста. Второй половины
 * не было: на стороне сервиса тот же код нигде не появлялся, и жалобу
 * «показало код a1b2c3» связать было не с чем.
 *
 * Тонкая прослойка НАМЕРЕННО. Всё, что можно проверить тестом — разбор
 * брошенного значения, белый список заголовков, сериализация, — живёт в
 * lib/errlog.ts: vitest собирает только lib. Здесь остаётся ровно то, что
 * тестом не покрыть, — сам вызов платформы.
 *
 * Файл лежит в КОРНЕ проекта, а не в app: это требование конвенции
 * (docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
 *
 * register() нет: он нужен под OTel, а это внешний сборщик с аккаунтом и
 * счётом — решение не техническое и не наше. Числа сбоев по часам — своя
 * таблица, см. ниже.
 */

/** Сколько ответ с ошибкой может ждать записи счётчика — дальше не ждём */
const TELEMETRY_WAIT_MS = 1500

export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  /*
   * Сначала — строка в лог, синхронно и безусловно.
   *
   * База падает ровно тогда же, когда падает всё остальное, — а логгер,
   * которому нужна работающая система, бесполезен именно в тот момент, ради
   * которого заводился. stderr Vercel собирает в Runtime Logs сам, без
   * зависимостей и без ключей.
   */
  console.error(serverErrorLine(formatServerError(err, request, context)))

  /*
   * Потом — почасовой счётчик (lib/telemetry.ts), по нему смотрит
   * /api/cron/health. Лучшим усилием и с потолком ожидания: Next ждёт этот
   * промис до отправки 500 (иначе на Vercel запись оборвалась бы вместе с
   * функцией), и лёгшая база не должна держать ответ дольше полутора секунд.
   *
   * Только в Node и не во время сборки: пререндер тоже зовёт onRequestError,
   * и счётчик сборки писал бы в ту базу, что окажется в её окружении. Модуль
   * грузится динамически — Edge-сборка его не видит вовсе.
   *
   * В ключе — шаблон маршрута ('/game/[appid]'), не путь: ни SteamID, ни
   * кода комнаты в счётчик не попадает.
   */
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.NEXT_PHASE === 'phase-production-build') return
  const key = `${context.routeType}:${context.routePath}`
  // recordTelemetry не бросает сам; catch — на случай, если не загрузится модуль
  const write = import('@/lib/telemetry')
    .then((m) => m.recordTelemetry('server-error', key))
    .catch(() => {})
  await Promise.race([write, new Promise((r) => setTimeout(r, TELEMETRY_WAIT_MS))])
}
