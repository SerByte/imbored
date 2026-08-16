import type { Metadata } from 'next'
import { Oswald } from 'next/font/google'

/** См. app/rooms/layout.tsx: страница клиентская, metadata — только серверная. */
export const metadata: Metadata = {
  title: 'Подобрать игру',
  description:
    'Три вопроса — сколько времени, какой вайб, один или с друзьями — и подборка из твоей же библиотеки с объяснением, почему именно это.',
}

/**
 * Дисплейное начертание квиза — здесь, а не в корневом layout, ровно по той же
 * причине, что Unbounded в app/whatsnew/layout.tsx: объявленный в корне шрифт
 * предзагружается на ВСЕХ маршрутах, а этот нужен на одном экране.
 *
 * Почему третья гарнитура, а не уже подключённый Unbounded: он подпись
 * «Что нового», отдельного визуального мира со своей палитрой без акцента.
 * Одолжить его сюда — размыть эту границу.
 *
 * Oswald узкий, и это не вкусовщина, а метрика: вопросы здесь русские и
 * длинные («Сколько у тебя времени?»), а набраны они кеглем во весь экран.
 * Обычный гротеск ушёл бы на четыре строки там, где узкий укладывается в две.
 *
 * Кириллица проверена по манифесту next/font: у Oswald есть cyrillic и
 * cyrillic-ext, иначе он был бы здесь бесполезен.
 */
const oswald = Oswald({
  variable: '--font-oswald',
  subsets: ['latin', 'cyrillic'],
})

/**
 * flex-1 flex flex-col повторяет обёртку из app/template.tsx: без них между
 * <main> и страницей появляется звено, которое рвёт flex-цепочку.
 */
export default function QuizLayout({ children }: LayoutProps<'/quiz'>) {
  return <div className={`${oswald.variable} flex-1 flex flex-col`}>{children}</div>
}
