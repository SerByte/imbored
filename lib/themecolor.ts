/**
 * Цвет браузерной обвязки: адресная строка Chrome на Android и статус-бар
 * установленного приложения (meta theme-color).
 *
 * Стоял двумя значениями по prefers-color-scheme — тёмный у тёмной ОС,
 * молочный у светлой. Но тема сайта от ОС не зависит: по умолчанию он тёмный
 * всегда, а светлым его делает только кнопка темы (localStorage). У человека
 * со светлой системной темой молочная полоса висела над чёрной страницей, у
 * выбравшего светлую тему на тёмной ОС — наоборот. И даже тема сайта не
 * ответ: на главной, выдаче, игре дня, совместимости и портрете сверху стоит
 * кино-зона, тёмная в любой теме, а на /whatsnew тёмная вся страница.
 *
 * Ответ уже посчитан — это --bg шапки. Шапка стоит ровно под обвязкой
 * браузера, и правила globals.css красят её токенами того, что под ней
 * СЕЙЧАС: зона сверху, «уехали с зоны на контент» (data-chrome от
 * ChromeZone), «Что нового», тема. Читаем итог, а не повторяем правила здесь:
 * копия разъехалась бы с CSS при первой новой зоне.
 *
 * В разметке одно значение — THEME_COLOR, тёмный фон: сервер про localStorage
 * не знает, а тёмная тема базовая. Дальше цвет правят ChromeZone (сменилось
 * то, что под шапкой) и ThemeToggle (сменилась тема). До гидратации у
 * светлой темы над обычной страницей полоса остаётся тёмной — встроенный
 * скрипт темы стоит в <body> раньше самой страницы и узнать, что окажется
 * под шапкой, не может.
 */

/** meta theme-color в разметке и theme_color манифеста — одно значение */
export const THEME_COLOR = '#050505'

type StyleOf = (el: Element) => Pick<CSSStyleDeclaration, 'getPropertyValue'>

/**
 * Перекрашивает meta theme-color в --bg шапки. Без шапки, без meta или без
 * значения — ничего не трогает: лучше прежний цвет, чем пустой.
 *
 * Документ и чтение стиля — параметрами ради тестов: DOM в них нет.
 */
export function syncThemeColor(
  doc: Pick<Document, 'querySelector'> = document,
  styleOf: StyleOf = (el) => getComputedStyle(el),
): void {
  const header = doc.querySelector('body > header')
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!header || !meta) return
  const bg = styleOf(header).getPropertyValue('--bg').trim()
  if (bg && meta.content !== bg) meta.content = bg
}
