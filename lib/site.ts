import type { Metadata, ResolvingMetadata } from 'next'

/**
 * Паспорт сайта для метаданных: то, что обязано совпадать на всех страницах.
 *
 * Отдельно от lib/og.ts намеренно: тот читает файлы шрифтов прямо при
 * загрузке, и корневой layout, лендинг и /privacy тянули бы за собой node:fs и
 * восемьдесят килобайт шрифтов ради двух строк. Здесь зависимостей нет вовсе —
 * только типы Next.
 */

/** Имя сайта во вкладке и в окне установки. */
export const SITE_TITLE = 'imbored — во что поиграть'

/**
 * Обещание продукта одной фразой — одно на корень и на манифест.
 *
 * Их было две копии, и они разошлись. Когда главная сменила позиционирование
 * на «одна игра под твоё состояние», manifest остался со старым слоганом
 * («подберём игру… из бэклога, заброшенного или нового») — и его видел каждый,
 * кто ставил приложение на домашний экран: в окне установки Android и в «О
 * приложении». Равенство сторожит lib/pwa.test.ts.
 */
export const SITE_DESCRIPTION =
  'Скажи, сколько у тебя времени и сил, — imbored выберет одну игру из твоей библиотеки Steam и объяснит почему.'

/**
 * Общая часть openGraph для страниц, у которых он свой.
 *
 * Объект metadata сливается ПОЛЕМ, а не насквозь: страница, объявившая свой
 * openGraph, заменяет корневой целиком, а не дополняет его. Именно так три
 * самые пересылаемые страницы — игра, совместимость и портрет — молча
 * теряли siteName и locale, то есть в чате вместо «imbored» показывался голый
 * домен. Ровно там, где имя продукта и нужно.
 *
 * Держится здесь, а не копией в трёх generateMetadata: копия и была бы тем
 * механизмом, которым это разъедется в следующий раз. Наличие спреда во всех
 * openGraph сторожит lib/social.test.ts.
 */
export const OG_SITE = {
  siteName: 'imbored',
  locale: 'ru_RU',
} as const

/**
 * generateMetadata для страницы без своей карточки: свой canonical и свой
 * og:url, а картинка — корневая.
 *
 * Раньше og:url стоял в корне, '/', и его наследовали все, у кого не было
 * своего openGraph. Ссылка на /privacy или /whatsnew в VK и Facebook
 * склеивалась с главной: они берут адрес из og:url, а не из того, что им
 * прислали, — и лайки, и счётчик, и сама карточка уезжали на лендинг.
 *
 * Почему функция с parent, а не объект. Свой og:url можно задать только
 * своим openGraph, а он заменяет корневой ЦЕЛИКОМ — вместе с картинкой из
 * app/opengraph-image.tsx. Файловая метадата корня применяется на уровне
 * корня и дальше просто наследуется; страница, объявившая openGraph без
 * images, остаётся без og:image и twitter:image. Проверено на
 * accumulateMetadata установленного Next. Поэтому картинку берём у родителя
 * как есть — это приём из docs/generate-metadata («extend parent metadata»).
 *
 * title и description в openGraph не пишем: Next подставляет туда
 * страничные, уже с шаблоном «%s · imbored».
 */
export function ownAddress(path: string, own: Metadata = {}) {
  return async (_props: unknown, parent: ResolvingMetadata): Promise<Metadata> => {
    const images = (await parent).openGraph?.images
    return {
      ...own,
      alternates: { ...own.alternates, canonical: path },
      openGraph: { ...OG_SITE, type: 'website', url: path, ...(images?.length ? { images } : {}) },
    }
  }
}
