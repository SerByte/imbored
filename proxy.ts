import { NextResponse, type NextRequest, type ProxyConfig } from 'next/server'
import { guestBounce } from '@/lib/destination'
import { homeLocaleFor } from '@/lib/homelocale'
import { appBaseUrl, isSafeMethod, sameOrigin } from '@/lib/origin'
import { SESSION_COOKIE } from '@/lib/session'

/**
 * Прокси перед роутами (бывший middleware — в этой версии Next файл
 * называется proxy.ts, см. node_modules/next/dist/docs/01-app/03-api-reference/
 * 03-file-conventions/proxy.md).
 *
 * Правил три.
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
 * Второе: гость без куки сессии на /library, /compat и /portrait (и их
 * /en-двойниках) получает настоящий 307 на лендинг своего языка, а не
 * страницу с мета-обновлением и статусом 200. Почему это нельзя сделать в
 * самой странице — в докблоке GUEST_BOUNCE.
 *
 * Третье: язык главной при первом входе. Гостя без выбора языка «/»
 * уводит на /en, если он не из СНГ и его браузер не ставит русский выше
 * английского; краулер остаётся на русской главной. Решает homeLocaleFor
 * (lib/homelocale.ts), там же весь порядок. Куку lang=en проверяет не
 * прокси, а правило redirects из next.config — оно и с сессией, и без
 * функции.
 *
 * Почему в прокси, а не правилом next.config, как было: страна. Её Vercel
 * определяет по IP и кладёт в заголовок x-vercel-ip-country, и этот
 * заголовок документирован для функций и middleware (прокси — бывший
 * middleware). Что CDN подставит его и в условия has правила, до функции,
 * документация не обещает, а правило, которое молча не сработает, увело бы
 * на /en весь СНГ с английским браузером. И порядок — краулер, страна,
 * браузер — читается функцией с тестом, а не тремя регулярками в has и
 * missing.
 *
 * Почему matcher с has/missing (config ниже), а не просто «/». Главная —
 * статика с CDN (bundle-budget.json, static), и «/» просят все, кто входит
 * на сайт, и префетч ссылки-логотипа в шапке на каждой странице. Прокси на
 * голом «/» будил бы функцию на каждом таком запросе ради ответа
 * «оставайся». Условия has и missing CDN Vercel проверяет сам, до функции,
 * и прокси просыпается только на первом входе: документ (Sec-Fetch-Dest:
 * document — без него ходят краулеры и скрипты), без куки lang (выбор уже
 * сделан: lang=en увело правило конфига, lang=ru — остаться), без сессии
 * (вошедшие до английской версии входили на русском — докблок
 * lib/homelocale.ts), не запрос роутера (RSC, префетч) и не переход со своей
 * страницы (Sec-Fetch-Site: same-origin). Остальные просмотры «/» идут мимо
 * функции, как и шли.
 */
export function proxy(req: NextRequest) {
  if (isSafeMethod(req.method)) {
    if (req.nextUrl.pathname === '/') {
      const to = homeLocaleFor({
        acceptLanguage: req.headers.get('accept-language'),
        country: req.headers.get('x-vercel-ip-country'),
        userAgent: req.headers.get('user-agent'),
      })
      // 307 и строка запроса с собой: /?next=%2Fplay → /en?next=%2Fplay.
      // От адреса запроса, а не от appBaseUrl — как у гостя ниже
      if (to === 'en') return NextResponse.redirect(new URL('/en' + req.nextUrl.search, req.url), 307)
    }
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
 *
 * «/» — только первым входом (почему — в докблоке proxy выше). Значения
 * matcher Next читает статическим разбором на сборке, и константа из модуля
 * там проигнорировалась бы молча — поэтому 'lang' и 'imbored_session'
 * записаны строками. Что они равны LANG_COOKIE и SESSION_COOKIE, стережёт
 * lib/homelocale.test.ts.
 */
export const config = {
  matcher: [
    '/api/:path*',
    '/library',
    '/compat',
    '/portrait',
    '/en/library',
    '/en/compat',
    '/en/portrait',
    {
      source: '/',
      has: [{ type: 'header', key: 'sec-fetch-dest', value: 'document' }],
      missing: [
        { type: 'cookie', key: 'lang' },
        { type: 'cookie', key: 'imbored_session' },
        { type: 'header', key: 'rsc' },
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'sec-fetch-site', value: 'same-origin' },
      ],
    },
  ],
} satisfies ProxyConfig
