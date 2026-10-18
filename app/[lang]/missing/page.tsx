import { notFound } from 'next/navigation'

/**
 * Статическая 404 для адреса вне всех разделов: /xyz, /wp-admin/setup.php,
 * /xx/quiz, /.well-known/…
 *
 * Сюда такие адреса уводит правило afterFiles из next.config
 * (garbageRewrites в lib/i18nroutes.ts) — все в один и тот же /ru/missing.
 * Страница пререндерится на сборке для обоих языков, и notFound() на сборке
 * даёт готовый ответ с кодом 404: его отдаёт CDN, без функции и без записи
 * ISR, сколько бы разных адресов ни перебрал сканер. Внутри — то же, что у
 * любой 404 сайта: корневой layout со шапкой и подвалом и
 * app/[lang]/not-found.tsx с полкой каталога. Полка освежается вместе с
 * кэшем её выборки — раз в сутки.
 *
 * Адреса под языком и под разделом (/en/xyz, /quiz/xyz) сюда не попадают:
 * их ловит динамическая app/[lang]/[...missing] — правило не знает, найдёт
 * ли такой адрес свой маршрут (/en/game/730 находит).
 *
 * dynamicParams = false — как у других страниц, у которых, кроме языка,
 * параметров нет (см. app/[lang]/layout.tsx).
 */
export const dynamicParams = false

export default function MissingPage(): never {
  notFound()
}
