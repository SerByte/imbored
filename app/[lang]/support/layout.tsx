import type { Metadata } from 'next'
import { toLocale, tr } from '@/lib/i18n'

/**
 * Заголовок и описание /support — на языке страницы.
 *
 * Своё описание у страницы есть затем, чтобы /support не наследовал
 * описание главной: иначе поиск получал из карты сайта две страницы с
 * одинаковым сниппетом.
 *
 * Здесь, а не в самой странице, и это не вкус. Адрес страницы (canonical,
 * og:url и корневую карточку) ставит ownAddress из lib/site.ts, а свои title
 * и description он принимает одним объектом, без языка; сторож
 * lib/social.test.ts держит у страницы ровно ownAddress('/support'). Сегмент
 * выше отдаёт ей то, чего ownAddress не пишет: title и description страница
 * наследует отсюда, а шаблон «%s · imbored» корня применяется к ним так же,
 * как применялся к странице.
 */
export async function generateMetadata({ params }: LayoutProps<'/[lang]/support'>): Promise<Metadata> {
  const locale = toLocale((await params).lang)
  return {
    title: tr(locale, { ru: 'Поддержать', en: 'Support' }),
    description: tr(locale, {
      ru: 'imbored бесплатен и без рекламы в выдаче: рекомендации не продаются. Здесь можно поддержать проект, если он попадает в твои вечера.',
      en: 'imbored is free, with no ads in the picks: recommendations aren’t for sale. You can support the project here if it has become part of your evenings.',
    }),
  }
}

export default function SupportLayout({ children }: LayoutProps<'/[lang]/support'>) {
  return children
}
