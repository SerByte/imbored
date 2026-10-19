import type { Metadata, ResolvingMetadata } from 'next'
import { toLocale, type Locale } from '@/lib/i18n'
import { ownAddress } from '@/lib/site'
import { MotionLazy } from '@/components/motion/MotionLazy'

/** Заголовок вкладки и описание — на языке страницы */
const COPY = {
  ru: {
    title: 'Игра дня',
    description:
      'Одна игра из твоей библиотеки на сегодня — та же самая до завтра, без бесконечной ленты и без выбора из десяти вариантов.',
  },
  en: {
    title: 'Game of the day',
    description:
      'One game from your library for today — the same one until tomorrow, with no endless feed and no choosing from ten options.',
  },
} satisfies Record<Locale, Metadata>

/**
 * См. app/rooms/layout.tsx: страница клиентская, metadata — только серверная.
 *
 * Свой адрес — ownAddress, как раньше; тексты — свои на язык. Язык — из
 * params, тем же путём, каким его берёт сам ownAddress.
 */
export async function generateMetadata(
  props: LayoutProps<'/[lang]/daily'>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const locale = toLocale((await props.params).lang)
  return ownAddress('/daily', COPY[locale])(props, parent)
}

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default function DailyLayout({ children }: LayoutProps<'/[lang]/daily'>) {
  return <MotionLazy>{children}</MotionLazy>
}
