import { Unbounded } from 'next/font/google'

/**
 * Дисплейное начертание живёт здесь, а не в корневом layout.
 *
 * Причина ровно одна и она измеримая: шрифт, объявленный в корне,
 * предзагружается на ВСЕХ маршрутах (docs/01-app/03-api-reference/02-components/font.md),
 * а `font-display` встречается только на этой странице и в трёх её
 * компонентах. Лендинг из-за этого тащил в критическом пути два лишних файла
 * шрифта, которыми ни разу не пользовался.
 *
 * Начертания в next/font скоупятся по месту использования, поэтому достаточно
 * объявить его в сегменте — переменная --font-unbounded окажется на обёртке и
 * будет видна всему поддереву.
 *
 * Кириллица проверена по манифесту next/font: у Unbounded есть cyrillic и
 * cyrillic-ext, иначе он был бы здесь бесполезен.
 */
const unbounded = Unbounded({
  variable: '--font-unbounded',
  subsets: ['latin', 'cyrillic'],
})

/**
 * flex-1 flex flex-col повторяет обёртку из app/template.tsx: без них между
 * <main> и страницей появляется звено, которое рвёт flex-цепочку.
 */
export default function WhatsNewLayout({ children }: LayoutProps<'/whatsnew'>) {
  return <div className={`${unbounded.variable} flex-1 flex flex-col`}>{children}</div>
}
