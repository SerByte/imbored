import type { Metadata, ResolvedMetadata, ResolvingMetadata } from 'next'
import { alternates, lp, ogLocale, toLocale, tr, type Locale } from './i18n'

/**
 * Паспорт сайта для метаданных: то, что обязано совпадать на всех страницах.
 *
 * Отдельно от lib/og.ts намеренно: тот читает файлы шрифтов прямо при
 * загрузке, и корневой layout, лендинг и /privacy тянули бы за собой node:fs и
 * восемьдесят килобайт шрифтов ради двух строк. Здесь зависимостей нет вовсе —
 * только типы Next и чистый lib/i18n.
 *
 * Русские константы (SITE_TITLE, SITE_DESCRIPTION, OG_SITE) остаются как
 * были: их читают манифест и JSON-LD, у которых языка нет. Страницы берут
 * функции с языком — siteTitle, siteDescription, ogSite.
 */

/** Имя сайта во вкладке и в окне установки. */
export const SITE_TITLE = 'imbored — во что поиграть'

/** Имя сайта на языке страницы (глоссарий docs/i18n.md) */
export function siteTitle(locale: Locale): string {
  return tr(locale, { ru: SITE_TITLE, en: 'imbored — what to play' })
}

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

/** Обещание продукта на языке страницы */
export function siteDescription(locale: Locale): string {
  return tr(locale, {
    ru: SITE_DESCRIPTION,
    en: 'Tell us how much time and energy you have — imbored picks one game from your Steam library and explains why.',
  })
}

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

/** Общая часть openGraph на языке страницы: тот же OG_SITE, но og:locale — свой */
export function ogSite(locale: Locale): { siteName: 'imbored'; locale: 'ru_RU' | 'en_US' } {
  return { siteName: OG_SITE.siteName, locale: ogLocale(locale) }
}

/**
 * canonical и hreflang страницы на её языке — одно место на все
 * generateMetadata, которые собирают метаданные сами (игра, жанр, патч,
 * портрет, совместимость, выбор, комната).
 *
 * path — русский адрес без префикса. canonical — адрес на языке страницы
 * (/en/game/730 у английской), languages — обе версии и x-default на
 * русскую: без них Google считал бы /en/game/730 дублем /game/730 и
 * склеивал бы их, показывая англоязычным русскую.
 */
export function localeAlternates(locale: Locale, path: string): { canonical: string; languages: Record<string, string> } {
  return alternates(path, locale)
}

/** Язык из params страницы или layout под app/[lang]; без params (тесты, вызов вне маршрута) — русский */
async function localeOf(props: unknown): Promise<Locale> {
  const params = (props as { params?: Promise<{ lang?: string }> } | null | undefined)?.params
  return toLocale(params ? (await params)?.lang : undefined)
}

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
 *
 * Язык — из params маршрута (сегмент [lang]): canonical и og:url — адрес на
 * языке страницы, hreflang — обе версии (localeAlternates). path — всегда
 * русский адрес без префикса, как раньше.
 */
export function ownAddress(path: string, own: Metadata = {}) {
  return async (props: unknown, parent: ResolvingMetadata): Promise<Metadata> => {
    const locale = await localeOf(props)
    const images = cardSignedOn(locale, (await parent).openGraph?.images)
    return {
      ...own,
      alternates: { ...own.alternates, ...localeAlternates(locale, path) },
      openGraph: { ...ogSite(locale), type: 'website', url: lp(locale, path), ...(images?.length ? { images } : {}) },
    }
  }
}

type CardImages = NonNullable<NonNullable<ResolvedMetadata['openGraph']>['images']>

/**
 * Унаследованная корневая карточка с подписью на языке страницы
 * (docs/i18n.md, п. 10). alt файловой карточки app/[lang]/opengraph-image.tsx
 * — константа модуля, русская: без переподписи каждое английское превью
 * страницы на ownAddress уезжало с ней. Адрес (с хэшем файловой метадаты) и
 * размеры — те же; twitter:image Next дозаполняет из openGraph сам. На ru —
 * как есть, до байта.
 */
function cardSignedOn(locale: Locale, images: CardImages | undefined): CardImages | undefined {
  if (locale !== 'en' || !images) return images
  const alt = siteTitle(locale)
  return images.map((img) => (typeof img === 'string' ? { url: img, alt } : { ...img, alt }))
}
