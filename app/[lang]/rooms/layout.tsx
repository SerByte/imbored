import type { Metadata } from 'next'
import { MotionLazy } from '@/components/motion/MotionLazy'
import { toLocale, tr } from '@/lib/i18n'

/**
 * Страница клиентская, а metadata экспортируется только из серверных модулей —
 * поэтому отдельный layout. Без него раздел наследовал заголовок сайта и в
 * выдаче выглядел его дублем.
 *
 * Язык — из params сегмента [lang]: заголовок вкладки и описание превью на
 * языке страницы. hreflang здесь нет намеренно: /rooms закрыта noindex
 * (NOINDEX_PAGES в lib/robots), и связывать в выдаче нечего.
 */
export async function generateMetadata({ params }: LayoutProps<'/[lang]/rooms'>): Promise<Metadata> {
  const locale = toLocale((await params).lang)
  return {
    title: tr(locale, { ru: 'Пати', en: 'Party' }),
    description: tr(locale, {
      ru: 'Комната на вечер: подключаете библиотеки, свайпаете колоду из общих игр — совпадут голоса всех, будет матч.',
      en: "A room for tonight: connect your libraries and swipe a deck of shared games — when everyone's votes line up, it's a match.",
    }),
  }
}

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default function RoomsLayout({ children }: LayoutProps<'/[lang]/rooms'>) {
  return <MotionLazy>{children}</MotionLazy>
}
