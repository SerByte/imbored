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
/*
 * Manrope — тот же голос, что на сайте (app/layout.tsx), ОДНИМ файлом.
 *
 * Были два — латиница и кириллица из @fontsource под одним именем. satori
 * так не умеет: из двух шрифтов одного имени и веса он берёт первый, и
 * кириллица уходила в следующий зарегистрированный шрифт — JetBrains Mono.
 * Замерено на карточке совместимости: «Демо-игрок зовёт сравнить» рисовалось
 * моноширинным и без пробела — «Демо-игрокзовёт».
 *
 * Файл собран из вариативного Manrope[wght].ttf (google/fonts, OFL): начертание
 * зафиксировано на 800 (вариативный satori читает только первым начертанием),
 * оставлены латиница, кириллица и знаки препинания — 28 КБ.
 */
export const ogFonts = Promise.all([
  readFile(join(FONT_DIR, 'manrope-800.woff')),
  readFile(join(FONT_DIR, 'JetBrainsMono-Bold.woff')),
]).then(([manrope, mono]) => [
  { name: 'Manrope', data: manrope, style: 'normal' as const, weight: 800 as const },
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
 * Постер для карточки — заранее, data-URI, а не адресом для satori.
 *
 * satori тянет картинки сам и без таймаута: один подвисший ответ CDN держит
 * всю карточку, а неудачную загрузку он запоминает пустым местом. WebP он не
 * читает вовсе. Поэтому здесь: свой таймаут на попытку, только JPEG и PNG, и
 * следующий кандидат (artCandidates), если этот не вышел. null — не вышел ни
 * один: стена просто обойдётся без этой клетки.
 */
export async function ogPoster(
  candidates: readonly string[],
  opts: { timeoutMs?: number; fetchFn?: typeof fetch } = {},
): Promise<string | null> {
  const fetchFn = opts.fetchFn ?? fetch
  for (const url of candidates) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(opts.timeoutMs ?? 2500) })
      if (!res.ok) continue
      const type = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase()
      if (type !== 'image/jpeg' && type !== 'image/png') continue
      const body = Buffer.from(await res.arrayBuffer())
      if (!body.length) continue
      return `data:${type};base64,${body.toString('base64')}`
    } catch {
      // таймаут или сеть — следующий кандидат
    }
  }
  return null
}
