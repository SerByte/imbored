import { notFound } from 'next/navigation'

/**
 * Ловушка неизвестных адресов под языком: /en/xyz-nope, /quiz/xyz-nope.
 *
 * Без неё такой адрес не находит маршрута, и Next отдаёт
 * app/global-not-found.tsx — голую двуязычную страницу без шапки и подвала.
 * С ней адрес попадает под корневой layout своего языка, и notFound() рисует
 * app/[lang]/not-found.tsx на нужном языке, со всей обвязкой и настоящим 404.
 *
 * force-dynamic — чтобы ISR не заводил запись на каждый мусорный адрес:
 * страница кэшировалась бы по пути, а путей у ловушки бесконечно много.
 * Цена — рендер функцией на каждый такой адрес, и поэтому сюда доходят
 * только опечатки под языком и под разделом. Адрес вне всех разделов, куда
 * и ходят сканеры (/wp-login.php, /wp-admin/x), next.config уводит в
 * статическую app/[lang]/missing — без функции (lib/i18nroutes.ts).
 */
export const dynamic = 'force-dynamic'

export default function Missing(): never {
  notFound()
}
