import type { Instrumentation } from 'next'

/**
 * Серверные ошибки в одну строку структурированного лога.
 *
 * До этого файла продовые падения были не видны никому: app/error.tsx делает
 * console.error уже в браузере, а серверная половина — та, где живут отказы
 * Turso, Steam и Claude, — не оставляла ничего, кроме стектрейса в общем
 * потоке. Код, который страница показывает человеку (error.digest), ни с чем
 * не сопоставлялся, поэтому «пришлите код ошибки» было бесполезной просьбой.
 *
 * Вендора здесь намеренно нет. onRequestError — нативный хук Next, а один
 * JSON-объект на строку уже полноценно ищется и фильтруется в логах Vercel.
 * Sentry сюда добавляется одной строкой позже, если понадобится группировка и
 * алерты; блокировать видимость ошибок ожиданием этого решения незачем.
 *
 * Что НЕ логируется: заголовки запроса целиком (там кука сессии), query-строка
 * с чужими steamid и тело. Пишем путь без query, метод и то, была ли сессия, —
 * этого хватает, чтобы отличить «падает у всех» от «падает у залогиненных».
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  const digest =
    typeof err === 'object' && err !== null && 'digest' in err ? String(err.digest) : undefined

  const cookie = request.headers.cookie
  const cookieStr = Array.isArray(cookie) ? cookie.join(';') : (cookie ?? '')

  console.error(
    JSON.stringify({
      tag: 'request-error',
      digest,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      // path приходит вместе с query — режем, там бывают чужие steamid
      path: request.path.split('?')[0],
      method: request.method,
      routePath: context.routePath,
      routeType: context.routeType,
      renderSource: context.renderSource,
      revalidateReason: context.revalidateReason,
      authed: cookieStr.includes('imbored_session='),
    }),
  )
}
