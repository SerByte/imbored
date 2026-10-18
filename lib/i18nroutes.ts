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
 * beforeFiles переписывают ровно LOCALIZED_SECTIONS и корень — и ничего
 * больше: они идут ДО файлов (public/, файлы корня app/), и правило шире
 * разделов отняло бы у них адрес. Всё остальное, чему не нашлось ни файла,
 * ни страницы, подбирает уже afterFiles — см. garbageRewrites.
 */
import { LOCALIZED_SECTIONS } from './i18n'

type Rewrite = { source: string; destination: string }
type Redirect = { source: string; destination: string; permanent: boolean }

/** Разделы одной альтернативой для path-to-regexp: compat|daily|… */
const SECTION_RE = LOCALIZED_SECTIONS.map((s) => s.replace(/[-]/g, '\\-')).join('|')

/**
 * '/' → '/ru' и '/<раздел>…' → '/ru/<раздел>…'. Строка запроса едет сама.
 *
 * Одно правило на все разделы, а не по паре на каждый: rewrites проверяются
 * по очереди на каждом запросе, и тридцать правил вместо одного — это
 * тридцать регулярок на каждую картинку и каждый вызов /api.
 */
export function localeRewrites(): Rewrite[] {
  return [
    { source: '/', destination: '/ru' },
    { source: `/:section(${SECTION_RE})/:path*`, destination: '/ru/:section/:path*' },
  ]
}

/**
 * Адрес вне всех разделов (/xyz, /wp-admin/setup.php, /xx/quiz,
 * /.well-known/…) — в статическую 404 русской ветки, app/[lang]/missing.
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
 * сюда: /wp-login.php, /.env, /xmlrpc.php. Статическая 404 отдаётся с CDN без
 * функции, со шапкой, подвалом и полкой, как до [lang]. Свою динамическую
 * ловушку получают только адреса под языком и под разделом (/en/xyz,
 * /quiz/xyz): их решает маршрут, а не правило.
 *
 * Не трогает: свои языки (/ru/… сюда доходит после beforeFiles — это и
 * разделы, и карточки /ru/…/opengraph-image), /api (там своя JSON-404,
 * app/api/[...missing]) и служебные /_next, /_vercel.
 */
export function garbageRewrites(): Rewrite[] {
  return [{ source: '/:path((?!(?:ru|en|api|_next|_vercel)(?:/|$)).+)', destination: '/ru/missing' }]
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
