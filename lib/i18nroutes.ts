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
  // Своих карточек у игры и патча больше нет (retiredCardRedirects ниже)
  game: `game/${SEG}(?:/news(?:/${SEG})?)?`,
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
 * с полкой). Пререндерен на сборке, и это единственный 404 этой версии Next,
 * который сервер рисует целиком: со шапкой, подвалом и полкой, как до [lang].
 * Код 404 у него свой только под next start: Vercel отдаёт этот пререндер
 * кодом 200, как обычную статическую страницу (замер прода 19.10.2026,
 * «Cache-Control: public, max-age=0, must-revalidate»), и без noindex Next.
 * Поэтому noindex стоит в метаданных самой 404 — подробно и что с этим
 * делать дальше, в докблоке app/global-not-found.tsx. Стояло /ru/missing — страница с notFound(), и её
 * HTML был пустой оболочкой Next без lang, стилей и текста (почему — в
 * докблоке app/global-not-found.tsx).
 *
 * Кэш. Такой ответ — пререндер /_not-found, то есть страница ISR: полка 404
 * живёт в кэше сутки (cachedTop в app/[lang]/not-found.tsx), и Next под next
 * start отдаёт её с «s-maxage=86400, stale-while-revalidate=…», а не с
 * «private, no-cache, no-store», как 404 ненайденного маршрута до [lang]
 * (Vercel — с «public, max-age=0, must-revalidate», см. выше). Так и
 * задумано: ради этого ответа цель и статическая — CDN отдаёт его без
 * функции. Общий кэш здесь ничего не выдаёт: HTML один на всех (у гостя и у
 * вошедшего он тот же — корневой layout куки не читает), новый адрес
 * появляется только деплоем, а деплой кэш CDN Vercel сбрасывает. Вернуть
 * no-store нечем: headers() из next.config применяются первыми, к адресу ДО
 * rewrites (тот же порядок проверки), и правило по образцу этой ловушки
 * легло бы и на /play, и на файлы public/; динамическая же цель — снова
 * функция на каждый адрес сканера. s-maxage у 404 был и до перевода — у
 * notFound() из ISR-страниц (/game/<нет такой>).
 *
 * Не трогает: свои языки (/ru/… сюда доходит после beforeFiles — это и
 * разделы, и карточки /ru/…/opengraph-image), /api (там своя JSON-404,
 * app/api/[...missing]) и собственные пути Next: /_next/static, /_next/image,
 * /_next/data. Их отдаёт сам Next, а промах /_next/static — CDN Vercel
 * коротким текстовым 404 (маршрут после handle: miss у @vercel/next), и
 * правило здесь отняло бы у него этот ответ. Остальное под /_next и /_vercel
 * (/_next/xyz сканера, /_vercel/insights/script.js на сервере без
 * аналитики) — мусор, как /xyz: исключённое из правила, оно находило
 * /[lang]/[...missing] с языком «_next» — функцией на каждый адрес и пустой
 * оболочкой, а в браузере — стоковой английской 404 Next.
 *
 * Регистр. Next сравнивает адрес с правилами rewrites и redirects без учёта
 * регистра (path-to-regexp с sensitive: false — buildCustomRoute в
 * next/dist/server/lib/router-utils/filesystem.js), и отличить /EN от /en
 * правилом нельзя ничем. Исключение «en» в ловушке поэтому пропускало и
 * /EN, /En/quiz, /eN/game/730 — к корневому layout с языком «EN». Тот
 * отвечал notFound(): пустая оболочка с русской головой (toLocale('EN') —
 * 'ru'), и ISR заводил на неё свою запись по пути /EN. На диске без учёта
 * регистра (Windows) эта запись ложилась поверх записи /en, и /en отдавал
 * 404 всем серверам с общим .next.
 *
 * Первые два правила переписывают любой регистр «en» в /en. Для /en это тот
 * же адрес; /EN/play — английская страница с canonical /en/play и той же
 * записью ISR, что /en/play (ISR кладёт страницу по адресу ПОСЛЕ rewrites).
 * Редиректом это не сделать: правило совпало бы и с самим /en и гоняло бы
 * его по кругу. /RU/… регистром не страдает: localeRedirects без учёта
 * регистра уводят его на адрес без префикса. Группа (en) — безымянная, чтобы
 * Next не дописал её в строку запроса (appendParamsToQuery). Два правила, а
 * не одно с :path*: пустой :path* CDN подставляет в назначение как «/en/», а
 * голый /EN обязан стать ровно /en.
 *
 * experimental.caseSensitiveRoutes этого не решает: beforeFiles сервер Next
 * собирает без флага, а @vercel/next не переносит его в маршруты CDN.
 */
export function garbageRewrites(): Rewrite[] {
  return [
    { source: '/(en)', destination: '/en' },
    { source: '/(en)/:path+', destination: '/en/:path+' },
    {
      source: '/:path((?!(?:ru|en|api)(?:/|$)|_next/(?:static|image|data)(?:/|$)).+)',
      destination: '/_not-found',
    },
  ]
}

/**
 * Бывшие карточки превью игры и патча — постоянным редиректом на корневую
 * карточку своего языка.
 *
 * Своих opengraph-image у /game/<appid> и /game/<appid>/news/<gid> больше нет:
 * превью у них — шапка Steam (shareArt в lib/art). А старые адреса картинок
 * остались в кэше мессенджеров и у ботов превью, и они за ними приходят —
 * /ru/game/730/opengraph-image?<хеш> у русских страниц, /en/…/opengraph-image
 * у английских. Без правила такой адрес доходил бы до динамической ловушки
 * app/[lang]/[...missing], то есть до функции на каждый заход, и отвечал бы
 * 404 HTML вместо картинки. Редирект CDN Vercel отдаёт сам, без функции, а
 * корневая карточка пререндерена на сборке: обновлённое превью покажет знак
 * сайта, а не пустоту. Строка запроса (хеш) уезжает с адресом, картинке она
 * не мешает.
 *
 * Без языка (/game/730/opengraph-image) — тоже: такие адреса когда-то
 * переписывались под /ru, а форм в SECTION_SHAPES у них больше нет.
 */
export function retiredCardRedirects(): Redirect[] {
  const card = (lang: string) => [
    { source: `${lang}/game/:appid${CARD}`, destination: `${lang || '/ru'}${CARD}`, permanent: true },
    { source: `${lang}/game/:appid/news/:gid${CARD}`, destination: `${lang || '/ru'}${CARD}`, permanent: true },
  ]
  return [...card(''), ...card('/ru'), ...card('/en')]
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
