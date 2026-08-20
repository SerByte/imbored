import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BG, DIM, EMBER, INK, PLATE } from './palette'

/**
 * Общая начинка картинок, которые рисует next/og: шрифты и палитра.
 *
 * ВНИМАНИЕ: модуль читает файлы при загрузке. Импортировать его можно только из
 * серверного кода — из клиентского компонента он утащит за собой node:fs.
 *
 * Почему шрифты лежат в assets/ как woff, а не берутся из next/font: ImageResponse
 * принимает только ttf/otf/woff, а next/font/google отдаёт woff2 и доступа к
 * бинарнику не даёт. Без буфера с кириллицей satori рисует пустоту вместо ника.
 *
 * Жило внутри app/portrait/[steamid]/share-card.tsx, пока карточка была одна.
 * Со второй (совместимость) выбор был: импортировать из чужого сегмента
 * маршрута или продублировать чтение файлов. Первое связывает /compat с
 * внутренностями /portrait, второе держит в памяти две копии одних и тех же
 * восьмидесяти килобайт.
 */

const FONT_DIR = join(process.cwd(), 'assets')

/** Ассеты не зависят от запроса — читаем один раз на модуль. */
export const ogFonts = Promise.all([
  readFile(join(FONT_DIR, 'Onest-ExtraBold.woff')),
  readFile(join(FONT_DIR, 'JetBrainsMono-Bold.woff')),
]).then(([sans, mono]) => [
  { name: 'Onest', data: sans, style: 'normal' as const, weight: 800 as const },
  { name: 'JetBrains Mono', data: mono, style: 'normal' as const, weight: 700 as const },
])

/**
 * Цвета заданы литералами, а не токенами из globals.css: satori не исполняет
 * CSS-переменные, и var(--bg) там превращается в пустую строку.
 *
 * Сами числа живут в lib/palette.ts: кроме карточек их ждёт ещё
 * app/global-error.tsx, а туда этот модуль не импортируется — он читает
 * файлы шрифтов через node:fs прямо при загрузке.
 */
export const OG_BG = BG
export const OG_INK = INK
export const OG_DIM = DIM
export const OG_EMBER = EMBER
export const OG_PLATE = PLATE

export function ogNum(n: number): string {
  return n.toLocaleString('ru-RU')
}

/** Полупрозрачная версия цвета карточки: satori не понимает ни color-mix, ни #rrggbbaa. */
function alpha(hex: string, a: number): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `rgba(${r},${g},${b},${a})`
}

/**
 * Скрим кино-героя для карточек с артом — тот же жест, что и на страницах:
 * арт гаснет к низу, текст ложится на погашенное. Здесь функцией, а не
 * строкой, чтобы числа фона не появлялись литералом в самих карточках: цвет
 * бренда в чате обязан меняться там же, где цвет бренда на сайте.
 */
export function ogScrim(): string {
  return (
    `linear-gradient(to top, ${OG_BG} 16%, ${alpha(OG_BG, 0.88)} 42%, ` +
    `${alpha(OG_BG, 0.35)} 72%, ${alpha(OG_BG, 0.55)} 100%)`
  )
}

/** Тёплое пятно из нижнего левого угла — тот же ember, что и во всём приложении. */
export function ogGlow(): string {
  return `radial-gradient(900px 520px at 8% 118%, ${alpha(OG_EMBER, 0.16)}, ${alpha(OG_BG, 0)} 70%)`
}

/**
 * Общая часть openGraph для страниц, у которых он свой.
 *
 * Объект metadata сливается ПОЛЕМ, а не насквозь: страница, объявившая свой
 * openGraph, заменяет корневой целиком, а не дополняет его. Именно так три
 * самые пересылаемые страницы — игра, совместимость и портрет — молча
 * теряли siteName и locale, то есть в чате вместо «imbored» показывался голый
 * домен. Ровно там, где имя продукта и нужно.
 *
 * Держится здесь, а не копией в трёх generateMetadata: копия и была бы тем
 * механизмом, которым это разъедется в следующий раз. Наличие спреда во всех
 * openGraph сторожит lib/social.test.ts.
 */
export const OG_SITE = {
  siteName: 'imbored',
  locale: 'ru_RU',
} as const
