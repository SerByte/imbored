import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

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
 */
export const OG_BG = '#0b0c10'
export const OG_INK = '#f2f3f5'
export const OG_DIM = '#9ba1ab'
export const OG_EMBER = '#ff9e64'

export function ogNum(n: number): string {
  return n.toLocaleString('ru-RU')
}
