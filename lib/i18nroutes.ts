/**
 * Адреса языков для next.config.ts: rewrites русской ветки и редирект с /ru.
 *
 * Модуль без Next и без базы — его читает next.config.ts ещё до сборки (как
 * lib/csp.ts и lib/robots.ts).
 *
 * Страницы живут в app/[lang]/…, а русский снаружи — без префикса (договор
 * docs/i18n.md). Мост между ними — rewrites в beforeFiles: '/play' → '/ru/play'
 * до поиска маршрута. Не прокси: правило из next.config CDN Vercel выполняет
 * сам, без функции, и статическая главная остаётся статической.
 *
 * Переписывается ровно LOCALIZED_SECTIONS и корень. Всё остальное идёт как
 * есть: /api, /_next, файлы корня, /en/… — и мусорный /xyz-nope, который
 * так и не находит маршрута и получает app/global-not-found.tsx.
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
