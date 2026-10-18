import type { Metadata } from 'next'
import { MotionLazy } from '@/components/motion/MotionLazy'
import { toLocale, type Locale } from '@/lib/i18n'

/** Заголовок вкладки и описание — на языке страницы (глоссарий: Полистать — Browse) */
const COPY = {
  ru: {
    title: 'Полистать',
    description:
      'Колода из твоей библиотеки и магазина без вопросов о настроении: «Интересно» или «Мимо», а приглянувшееся ложится на полку.',
  },
  en: {
    title: 'Browse',
    description:
      'A deck from your library and the store, with no mood questions: “Into it” or “Skip”, and whatever catches your eye goes on a shelf.',
  },
} satisfies Record<Locale, Metadata>

/**
 * См. app/rooms/layout.tsx: страница клиентская, а metadata экспортируется
 * только из серверных модулей — отсюда отдельный layout. /explore закрыт в
 * robots.txt (lib/robots.ts), как и /play: без куки индексировать нечего.
 * Заголовок — для вкладки, истории и закладки, на языке страницы: язык — из
 * params, сборка знает оба (dynamicParams ниже).
 */
export async function generateMetadata({ params }: LayoutProps<'/[lang]/explore'>): Promise<Metadata> {
  return { ...COPY[toLocale((await params).lang)] }
}

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default function ExploreLayout({ children }: LayoutProps<'/[lang]/explore'>) {
  return <MotionLazy>{children}</MotionLazy>
}
