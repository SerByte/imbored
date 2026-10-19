import { notFound } from 'next/navigation'

/**
 * Бывшая статическая 404 для адреса вне всех разделов (/xyz, /wp-login.php).
 *
 * Мусорный адрес правило afterFiles из next.config (garbageRewrites в
 * lib/i18nroutes.ts) больше сюда не уводит: notFound() из страницы в этой
 * версии Next отдаёт вместо HTML пустую оболочку <html id="__next_error__">
 * — без lang, стилей, шапки и текста, — и экран дорисовывал клиент. Теперь
 * цель правила — /_not-found, который сервер рисует целиком
 * (app/global-not-found.tsx).
 *
 * Каталог остаётся, пока bundle-budget.json держит /missing в списке static:
 * без него сторож бюджета считал бы, что 404 перестала пререндериться. Это
 * по-прежнему пререндеренная 404 — по своим адресам /missing и /en/missing.
 * Когда список поправят (сторожить там надо /_not-found), каталог и строку
 * 'missing' в LOCALIZED_SECTIONS можно убрать вместе.
 *
 * dynamicParams = false — как у других страниц, у которых, кроме языка,
 * параметров нет (см. app/[lang]/layout.tsx).
 */
export const dynamicParams = false

export default function MissingPage(): never {
  notFound()
}
