import type { Metadata, ResolvingMetadata } from 'next'
import { MotionLazy } from '@/components/motion/MotionLazy'
import { lp, toLocale, tr } from '@/lib/i18n'
import { ogSite, siteTitle } from '@/lib/site'

/**
 * Страница клиентская, а metadata экспортируется только из серверных модулей —
 * поэтому отдельный layout. Без него раздел наследовал заголовок сайта и в
 * выдаче выглядел его дублем.
 *
 * Язык — из params сегмента [lang]: заголовок вкладки и описание превью на
 * языке страницы. hreflang здесь нет намеренно: /rooms закрыта noindex
 * (NOINDEX_PAGES в lib/robots), и связывать в выдаче нечего.
 *
 * Картинка превью — корневая карточка (app/[lang]/opengraph-image.tsx), и её
 * alt — константа модуля, русская: на /en в превью уезжала кириллица. Поэтому
 * на /en — свой openGraph с той же карточкой, взятой у родителя (адрес с
 * хешем, размеры и тип — от файла), но с подписью siteTitle('en') — тот же
 * приём, что ownAddress в lib/site (docs/i18n.md, п. 10). Свой openGraph
 * заменяет корневой целиком — отсюда ogSite и тип, а с ним и свой og:url с
 * canonical (lib/social.test.ts): иначе страница делилась бы чужим адресом.
 * Русская страница openGraph не объявляет и получает голову до байта
 * прежнюю.
 */
export async function generateMetadata(
  { params }: LayoutProps<'/[lang]/rooms'>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const locale = toLocale((await params).lang)
  const meta: Metadata = {
    title: tr(locale, { ru: 'Пати', en: 'Party' }),
    description: tr(locale, {
      ru: 'Комната на вечер: подключаете библиотеки, свайпаете колоду из общих игр — совпадут голоса всех, будет матч.',
      en: "A room for tonight: connect your libraries and swipe a deck of shared games — when everyone's votes line up, it's a match.",
    }),
  }
  if (locale !== 'en') return meta
  const alt = siteTitle(locale)
  const images = (await parent).openGraph?.images?.map((img) =>
    typeof img === 'object' && !(img instanceof URL) ? { ...img, alt } : { url: img, alt },
  )
  return {
    ...meta,
    alternates: { canonical: lp(locale, '/rooms') },
    openGraph: { ...ogSite(locale), type: 'website', url: lp(locale, '/rooms'), ...(images?.length ? { images } : {}) },
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
