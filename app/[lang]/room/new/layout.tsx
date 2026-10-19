import type { Metadata, ResolvingMetadata } from 'next'
import { toLocale, tr } from '@/lib/i18n'
import { rootCard } from '@/lib/site'

/**
 * Экран транзитный — создаёт комнату и уводит в неё, — и заголовок ему нужен
 * ровно по одной причине: у него есть залипающее состояние. Когда комнату
 * создать не удалось, человек остаётся здесь, и вкладка при этом называется
 * именем сайта, будто он никуда и не нажимал.
 *
 * Язык — из params сегмента [lang]; hreflang нет: /room/new закрыта в
 * robots.txt (lib/robots), в выдачу она не идёт.
 */
export async function generateMetadata(props: LayoutProps<'/[lang]/room/new'>, parent?: ResolvingMetadata): Promise<Metadata> {
  const locale = toLocale((await props.params).lang)
  return {
    // карточка корня на /en — с английской подписью (lib/site)
    ...(await rootCard(props, parent)),
    title: tr(locale, { ru: 'Новая комната', en: 'New room' }),
    description: tr(locale, {
      ru: 'Создаём комнату для пати и открываем её по ссылке.',
      en: "We'll create a party room and open it by its link.",
    }),
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
