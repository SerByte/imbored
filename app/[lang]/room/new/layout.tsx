import type { Metadata, ResolvingMetadata } from 'next'
import { lp, toLocale, tr } from '@/lib/i18n'
import { ogSite, siteTitle } from '@/lib/site'

/**
 * Экран транзитный — создаёт комнату и уводит в неё, — и заголовок ему нужен
 * ровно по одной причине: у него есть залипающее состояние. Когда комнату
 * создать не удалось, человек остаётся здесь, и вкладка при этом называется
 * именем сайта, будто он никуда и не нажимал.
 *
 * Язык — из params сегмента [lang]; hreflang нет: /room/new закрыта в
 * robots.txt (lib/robots), в выдачу она не идёт.
 *
 * Картинка превью — корневая карточка, и на /en её подпись — английская:
 * alt файловой карточки — русская константа модуля. Тот же приём, что у
 * /rooms (app/[lang]/rooms/layout.tsx, там — почему так): свой openGraph
 * только на /en, русская голова — до байта прежняя. og:url и canonical — без
 * запроса: layout его не видит, и ?game= в превью VK и Facebook (они ведут
 * по og:url) теряется — экран транзитный, ссылку на него в чат кидают редко.
 */
export async function generateMetadata(
  { params }: LayoutProps<'/[lang]/room/new'>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const locale = toLocale((await params).lang)
  const meta: Metadata = {
    title: tr(locale, { ru: 'Новая комната', en: 'New room' }),
    description: tr(locale, {
      ru: 'Создаём комнату для пати и открываем её по ссылке.',
      en: "We'll create a party room and take you to it.",
    }),
  }
  if (locale !== 'en') return meta
  const alt = siteTitle(locale)
  const images = (await parent).openGraph?.images?.map((img) =>
    typeof img === 'object' && !(img instanceof URL) ? { ...img, alt } : { url: img, alt },
  )
  return {
    ...meta,
    alternates: { canonical: lp(locale, '/room/new') },
    openGraph: { ...ogSite(locale), type: 'website', url: lp(locale, '/room/new'), ...(images?.length ? { images } : {}) },
  }
}

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default function NewRoomLayout({ children }: LayoutProps<'/[lang]/room/new'>) {
  return children
}
