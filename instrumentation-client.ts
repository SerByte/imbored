import { clientErrorCode, reportClientError } from '@/lib/clienterr'

/**
 * Клиентские падения перестают быть невидимыми.
 *
 * Пара к instrumentation.ts: тот ловит то, что упало на сервере, этот — то,
 * что упало в браузере вне границ ошибок: обработчик клика, таймер,
 * необработанный промис. Пойманное границей (app/error.tsx,
 * app/global-error.tsx) до window уже не доходит — там отчёт шлёт сама
 * граница, тем же reportClientError.
 *
 * Файл в КОРНЕ проекта и без экспортов — это конвенция
 * (docs/01-app/03-api-reference/03-file-conventions/instrumentation-client.md).
 * Код здесь выполняется до гидратации, поэтому только подписка: сборка,
 * маски, отсев шума и отсечка повторов — в lib/clienterr.ts, под тестами.
 *
 * try/catch вокруг всего: мониторинг, который сам роняет страницу, хуже, чем
 * никакого.
 */
try {
  window.addEventListener('error', (e) => {
    reportClientError({
      kind: 'error',
      error: e.error,
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      href: window.location.href,
      code: clientErrorCode(e.error ?? e.message),
    })
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportClientError({
      kind: 'rejection',
      error: e.reason,
      href: window.location.href,
      code: clientErrorCode(e.reason),
    })
  })
} catch {
  // без отчётов, но с работающей страницей
}
