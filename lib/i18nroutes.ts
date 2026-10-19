/**
 * Адреса языков для next.config.ts: rewrites русской ветки, ловушка мусорных
 * адресов и редирект с /ru.
 *
 * Модуль без Next и без базы — его читает next.config.ts ещё до сборки (как
 * lib/csp.ts и lib/robots.ts).
 *
 * Страницы живут в app/[lang]/…, а русский снаружи — без префикса (договор
 * docs/i18n.md). Мост между ними — rewrites в beforeFiles: '/play' → '/ru/play'
 * до поиска маршрута. Не прокси: правило из next.config CDN Vercel выполняет
 * сам, без функции, и статическая главная остаётся статической.
 *
 * beforeFiles переписывают ровно корень и адреса маршрутов LOCALIZED_SECTIONS
 * — и ничего больше: они идут ДО файлов (public/, файлы корня app/), и
 * правило шире разделов отняло бы у них адрес. Всё остальное, чему не
 * нашлось ни файла, ни страницы, подбирает уже afterFiles — см.
 * garbageRewrites.
 */
import { HUB_FACETS, HUB_GENRES, HUB_TAGS } from './gamehub'
import type { LOCALIZED_SECTIONS } from './i18n'

type Rewrite = { source: string; destination: string }
type Redirect = { source: string; destination: string; permanent: boolean }

/** Один сегмент-параметр маршрута: appid, steamid, id выбора или комнаты, gid поста, токен ленты */
const SEG = '[^/]+'

/** Файловая карточка маршрута (…/opengraph-image): по ней старые ссылки без /ru ходят за картинкой */
const CARD = '/opengraph-image'

/** Адреса страниц жанров — ровно generateStaticParams из app/[lang]/games/[tag]/page.tsx */
const GENRE_SLUGS = [...HUB_TAGS.map((tag) => HUB_GENRES[tag].slug), ...HUB_FACETS.map((f) => f.slug)]

/**
 * Формы адресов каждого раздела — дерево маршрутов app/[lang]/<раздел>
 * регуляркой, без языка. Что каждая страница, обработчик и карточка под
 * app/[lang] здесь есть, а лишнего нет, — сторож в lib/i18nroutes.test.ts:
 * он обходит каталог сам, новый маршрут без строки здесь валит тест.
 *
 * Почему формы, а не «раздел и всё под ним». Опечатка под разделом
 * (/quiz/xyz, /games/<нет такого жанра>, /game/730/xyz) под правилом
 * «раздел/:path*» уезжала в /ru/…, где её ловила динамическая
 * app/[lang]/[...missing], — а notFound() из страницы в этой версии Next
 * отдаёт пустую оболочку <html id="__next_error__"> без lang, стилей,
 * шапки и текста (докблок app/global-not-found.tsx), да ещё функцией на
 * каждый адрес. До [lang] такой адрес отдавала статическая 404 сервером
 * целиком. Адрес, которого нет среди форм, здесь не переписывается и
 * доходит до garbageRewrites — в ту же статическую /_not-found, что /xyz.
 *
 * Параметр — любой сегмент: есть ли такая игра, комната или выбор, решает
 * страница (её notFound() — та же оболочка, так было и до перевода у
 * /game/<нет такой>). Исключение — жанры: их список известен заранее, и
 * страница стоит под dynamicParams = false; чужой жанр здесь не
 * переписывается, иначе промах сборки упал бы в ту же [...missing].
 */
const SECTION_SHAPES: Record<(typeof LOCALIZED_SECTIONS)[number], string> = {
  compat: `compat(?:/${SEG}(?:${CARD})?)?`,
  daily: 'daily',
  explore: 'explore',
  game: `game/${SEG}(?:${CARD}|/news(?:/${SEG}(?:${CARD})?)?)?`,
  games: `games(?:/(?:${GENRE_SLUGS.join('|')})(?:${CARD})?)?`,
  library: 'library',
  missing: 'missing',
  'opengraph-image': 'opengraph-image',
  pick: `pick/${SEG}(?:${CARD})?`,
  play: 'play',
  portrait: `portrait(?:/${SEG}(?:/card\\.png|${CARD}|/year(?:/card\\.png|${CARD})?)?)?`,
  privacy: 'privacy',
  quiz: 'quiz',
  // /room/new — тоже под этой формой: new — сегмент, как код комнаты
  room: `room/${SEG}(?:${CARD})?`,
  rooms: 'rooms',
  support: 'support',
  whatsnew: `whatsnew(?:/feed\\.xml|/feed/${SEG})?`,
}

/** Все формы одной альтернативой для path-to-regexp: только незахватывающие группы */
const ROUTE_RE = Object.values(SECTION_SHAPES).join('|')

/**
 * '/' → '/ru' и адрес маршрута раздела → '/ru/<адрес>'. Строка запроса едет
 * сама.
 *
 * Одно правило на все разделы, а не по паре на каждый: rewrites проверяются
 * по очереди на каждом запросе, и тридцать правил вместо одного — это
 * тридцать регулярок на каждую картинку и каждый вызов /api.
 */
export function localeRewrites(): Rewrite[] {
  return [
    { source: '/', destination: '/ru' },
    { source: `/:path(${ROUTE_RE})`, destination: '/ru/:path' },
  ]
}

/**
 * Адрес вне всех разделов (/xyz, /wp-admin/setup.php, /xx/quiz,
 * /.well-known/…) и опечатка под русским разделом (/quiz/xyz — её
 * localeRewrites не переписывают) — в статическую 404 русской ветки,
 * /_not-found.
 *
 * afterFiles, а не beforeFiles. afterFiles идут ПОСЛЕ файлов и статических
 * маршрутов, но ДО динамических (docs: rewrites.md, порядок проверки). Файлы
 * public/ (/screenshots/narrow.jpg из манифеста PWA) и корня app/
 * (/favicon.ico, /sitemap.xml, /search-index.json) к этому шагу уже отданы,
 * и правило их не видит. Стояло в beforeFiles — и переписывало в 404
 * скриншоты манифеста.
 *
 * А до динамических — потому что иначе мусор находил бы маршрут сам:
 * /wp-admin/x — это /[lang]/[...missing] с языком «wp-admin», а /xx/quiz —
 * /[lang]/quiz с языком «xx». Корневой layout отвечает на чужой язык
 * notFound(), но 404 рисовать уже не в чем, и Next отдавал голую стоковую
 * страницу; /portrait/<id>/card.png под чужим языком и вовсе доходил до
 * обработчика.
 *
 * Цель — один и тот же пререндеренный адрес, а не /ru/<адрес>. Ловушка
 * /[lang]/[...missing] — динамическая (кэшировать её по пути — значит
 * завести запись ISR на каждый адрес сканера), а сканеры приходят именно
 * сюда: /wp-login.php, /.env, /xmlrpc.php. Свою динамическую ловушку
 * получают только адреса под /en (/en/xyz, /en/quiz/xyz): у английской 404
 * свой язык, и /_not-found, русский, её не заменит.
 *
 * Цель — /_not-found: встроенный маршрут 404, который Next собирает из
 * app/global-not-found.tsx (там — корневой layout с языком 'ru' и экран 404
 * с полкой). Пререндерен на сборке, код 404 у него свой, и это единственный
 * 404 этой версии Next, который сервер рисует целиком: со шапкой, подвалом
 * и полкой, как до [lang]. Стояло /ru/missing — страница с notFound(), и её
 * HTML был пустой оболочкой Next без lang, стилей и текста (почему — в
 * докблоке app/global-not-found.tsx).
 *
 * Не трогает: свои языки (/ru/… сюда доходит после beforeFiles — это и
 * разделы, и карточки /ru/…/opengraph-image), /api (там своя JSON-404,
 * app/api/[...missing]) и служебные /_next, /_vercel.
 */
export function garbageRewrites(): Rewrite[] {
  return [{ source: '/:path((?!(?:ru|en|api|_next|_vercel)(?:/|$)).+)', destination: '/_not-found' }]
}

/**
 * /ru снаружи не живёт: постоянный редирект на адрес без префикса.
 *
 * Кроме файловых карточек (opengraph-image). Их адрес Next собирает из пути
 * маршрута, и у русской страницы og:image — /ru/…/opengraph-image. Редирект
 * здесь дал бы каждому краулеру лишний круг, а часть из них за картинкой по
 * редиректу не ходит — карточка в чате осталась бы пустой. Отдаются как
 * есть, 200, без круга.
 */
export function localeRedirects(): Redirect[] {
  return [
    { source: '/ru', destination: '/', permanent: true },
    {
      source: '/ru/:path((?!(?:.*/)?(?:opengraph|twitter)-image(?:[-./]|$)).+)',
      destination: '/:path',
      permanent: true,
    },
  ]
}
