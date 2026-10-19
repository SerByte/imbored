import { notFound } from 'next/navigation'

/**
 * Ловушка неизвестных адресов под языком: /en/xyz-nope, /quiz/xyz-nope.
 *
 * Без неё такой адрес не находит маршрута, и Next отдаёт
 * app/global-not-found.tsx — русскую 404 и для /en/… тоже: языка адреса
 * у /_not-found нет.
 * С ней адрес попадает под корневой layout своего языка, и notFound() рисует
 * app/[lang]/not-found.tsx на нужном языке, со всей обвязкой и настоящим 404.
 * Рисует — клиентом: HTML от сервера здесь пустая оболочка Next (почему — в
 * app/global-not-found.tsx); у адресов под языком другого способа нет.
 *
 * force-dynamic — чтобы ISR не заводил запись на каждый мусорный адрес:
 * страница кэшировалась бы по пути, а путей у ловушки бесконечно много.
 * Цена — рендер функцией на каждый такой адрес, и поэтому сюда доходят
 * только опечатки под языком и под разделом. Адрес вне всех разделов, куда
 * и ходят сканеры (/wp-login.php, /wp-admin/x), next.config уводит в
 * статическую /_not-found — без функции (lib/i18nroutes.ts).
 */
export const dynamic = 'force-dynamic'

export default function Missing(): never {
  notFound()
}
