import { notFound } from 'next/navigation'

/**
 * Бывшая статическая 404 для адреса вне всех разделов (/xyz, /wp-login.php).
 *
 * Такой адрес правило afterFiles из next.config (garbageRewrites в
 * lib/i18nroutes.ts) больше сюда не уводит: notFound() из страницы в этой
 * версии Next отдаёт вместо HTML пустую оболочку <html id="__next_error__">
 * — без lang, стилей, шапки и текста, — и экран дорисовывал клиент. Теперь
 * цель правила — /_not-found, который сервер рисует целиком
 * (app/global-not-found.tsx).
 *
 * Каталог держат две вещи. bundle-budget.json держит /missing в списке
 * static: без него сторож бюджета считал бы, что 404 перестала
 * пререндериться. И /en/missing — снова цель правила: туда garbageRewrites
 * уводит номер игры или поста не той формы под /en (/en/game/abc,
 * /en/game/730/news/xyz). Без неё такой адрес нашёл бы ISR-маршрут игры, и
 * notFound() оттуда клал бы в кэш свою запись 404 на каждый адрес сканера;
 * здесь — одна пререндеренная запись на все. /_not-found для /en не годится:
 * он русский. Убирать каталог — только вместе с этим правилом и строкой
 * 'missing' в LOCALIZED_SECTIONS.
 *
 * dynamicParams = false — как у других страниц, у которых, кроме языка,
 * параметров нет (см. app/[lang]/layout.tsx).
 */
export const dynamicParams = false

export default function MissingPage(): never {
  notFound()
}
