import { NextResponse, type NextRequest } from 'next/server'
import { appBaseUrl, isSafeMethod, sameOrigin } from '@/lib/origin'

/**
 * Прокси перед роутами (бывший middleware — в этой версии Next файл
 * называется proxy.ts, см. node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md).
 *
 * Пока здесь одно правило: всё, что меняет состояние в /api, принимается
 * только с нашей же страницы. Сверка Origin у Next встроена лишь в Server
 * Actions, а route handlers открыты для межсайтовой формы, — и одна такая
 * форма разлогинивала посетителя или подсовывала ему чужой профиль. Зачем
 * именно так и почему по двум заголовкам — в докблоке sameOrigin.
 *
 * Одно место на все POST-ручки, а не строка в начале каждой: новая ручка,
 * забывшая эту строку, была бы дырой, и узнать о ней было бы не от чего.
 * Что изменяющих ручек вне /api нет, стережёт lib/origin.test.ts.
 *
 * GET и HEAD не трогаются: кроны (GET с x-cron-secret) и все чтения идут мимо.
 */
export function proxy(req: NextRequest) {
  if (isSafeMethod(req.method)) return NextResponse.next()
  /*
   * Два разрешённых адреса: канонический и тот, на который пришёл сам запрос.
   * Второй нужен превью: там appBaseUrl указывает на прод-домен, а человек
   * сидит на адресе деплоя. Чужой сайт своим Origin'ом ни с одним из них не
   * совпадёт — Host ставит браузер, а не страница.
   */
  const allowed = [new URL(appBaseUrl()).origin, req.nextUrl.origin]
  if (sameOrigin(req.headers, allowed)) return NextResponse.next()
  return NextResponse.json({ error: 'origin' }, { status: 403 })
}

export const config = {
  matcher: '/api/:path*',
}
