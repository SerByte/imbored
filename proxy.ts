import { NextResponse, type NextRequest } from 'next/server'
import { guestBounce } from '@/lib/destination'
import { appBaseUrl, isSafeMethod, sameOrigin } from '@/lib/origin'
import { SESSION_COOKIE } from '@/lib/session'

/**
 * Прокси перед роутами (бывший middleware — в этой версии Next файл
 * называется proxy.ts, см. node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md).
 *
 * Правил два.
 *
 * Первое: всё, что меняет состояние в /api, принимается только с нашей же
 * страницы. Сверка Origin у Next встроена лишь в Server Actions, а route
 * handlers открыты для межсайтовой формы, — и одна такая форма разлогинивала
 * посетителя или подсовывала ему чужой профиль. Зачем именно так и почему по
 * двум заголовкам — в докблоке sameOrigin.
 *
 * Одно место на все POST-ручки, а не строка в начале каждой: новая ручка,
 * забывшая эту строку, была бы дырой, и узнать о ней было бы не от чего.
 * Что изменяющих ручек вне /api нет, стережёт lib/origin.test.ts.
 *
 * GET и HEAD эта проверка не трогает: кроны (GET с x-cron-secret) и все
 * чтения идут мимо.
 *
 * Второе: гость без куки сессии на /library, /compat и /portrait получает
 * настоящий 307 на лендинг, а не страницу с мета-обновлением и статусом 200.
 * Почему это нельзя сделать в самой странице — в докблоке GUEST_BOUNCE.
 */
export function proxy(req: NextRequest) {
  if (isSafeMethod(req.method)) {
    // Пустое значение — это кука, которую выход только что погасил
    const bounce = guestBounce(req.nextUrl.pathname, Boolean(req.cookies.get(SESSION_COOKIE)?.value))
    // От адреса запроса, а не от appBaseUrl: на превью гость должен остаться
    // на своём деплое, а не улететь на прод
    if (bounce) return NextResponse.redirect(new URL(bounce, req.url), 307)
    return NextResponse.next()
  }
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

/*
 * Хабы — точными адресами: так matcher и понимает строку без :path*, и
 * личные /compat/<steamid> и /portrait/<steamid> прокси не будят вовсе.
 * Список обязан совпадать с GUEST_BOUNCE — это стережёт lib/origin.test.ts.
 */
export const config = {
  matcher: ['/api/:path*', '/library', '/compat', '/portrait'],
}
