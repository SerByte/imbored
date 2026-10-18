import type { Metadata, ResolvingMetadata } from 'next'
import { MotionLazy } from '@/components/motion/MotionLazy'
import { toLocale, type Locale } from '@/lib/i18n'
import { ownAddress } from '@/lib/site'

/** Заголовок вкладки и описание — на языке страницы («Подобрать игру» — Find a game по глоссарию) */
const COPY = {
  ru: {
    title: 'Подобрать игру',
    description:
      'Три вопроса — сколько времени, какой вайб, один или с друзьями — и одна игра из твоей библиотеки, а если своего не хватит — пара находок из магазина. С объяснением, почему именно она.',
  },
  en: {
    title: 'Find a game',
    description:
      "Three questions — how much time, what vibe, solo or with friends — and one game from your library, plus a couple of store finds if yours run short. With an explanation of why it's the one.",
  },
} satisfies Record<Locale, Metadata>

/**
 * См. app/rooms/layout.tsx: страница клиентская, metadata — только серверная.
 *
 * Свой адрес (ownAddress), потому что квиз открыт краулеру и идёт в выдачу
 * (lib/robots): гость видит первый вопрос целиком. canonical сворачивает в
 * /quiz хвосты вроде ?from=untouched из библиотеки, а og:url не даёт VK и
 * Facebook склеить ссылку на квиз с главной. Тексты — свои на язык; язык —
 * из params, тем же путём, каким его берёт сам ownAddress.
 */
export async function generateMetadata(
  props: LayoutProps<'/[lang]/quiz'>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const locale = toLocale((await props.params).lang)
  return ownAddress('/quiz', COPY[locale])(props, parent)
}

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default function QuizLayout({ children }: LayoutProps<'/[lang]/quiz'>) {
  return <MotionLazy>{children}</MotionLazy>
}
