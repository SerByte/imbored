import type { Metadata, ResolvingMetadata } from 'next'
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

/** Картинки openGraph в том виде, в каком их отдаёт разобранная метадата родителя */
type ParentImages = NonNullable<NonNullable<Awaited<ResolvingMetadata>['openGraph']>['images']>

/**
 * Корневая карточка (app/[lang]/opengraph-image.tsx), перенесённая в метадату
 * страницы, — с подписью на её языке.
 *
 * alt файловой карточки Next читает константой модуля, без params, и она
 * русская: это и есть русская подпись (docs/i18n.md, п. 10). На en адрес,
 * размеры и тип остаются от файла (с его хэшем в адресе), а подпись —
 * siteTitle('en'): иначе каждая английская страница отдавала в og:image:alt
 * и twitter:image:alt «imbored — во что поиграть». twitter:image Next
 * достраивает из openGraph, раз своего у страницы нет, — с этой же подписью.
 * На ru — те же объекты как есть: русская голова не меняется ни на байт.
 *
 * Строку (так картинку можно задать вручную; разобранная метадата отдаёт
 * адреса строками) оборачиваем в объект: подписи без объекта не бывает.
 */
function rootCardOn(locale: Locale, images: ParentImages | undefined): ParentImages | undefined {
  if (locale !== 'en' || !images?.length) return images
  const alt = siteTitle(locale)
  return images.map((img) => (typeof img === 'string' ? { url: img, alt } : { ...img, alt }))
}

/**
 * Английская подпись корневой карточки для страницы без своего адреса — той,
 * что ownAddress не зовёт (закрытые от индекса /play, /explore, /rooms,
 * /room/new, личные /library и /compat): её openGraph — корневой, и подпись
 * в нём — русская подпись файла. Отдаёт кусок метадаты, который страница
 * вливает в свою: на en — openGraph корня (siteName, locale, type) с той же
 * карточкой и английским alt (rootCardOn); на ru — пусто, и голова остаётся
 * прежней до байта. Своего og:url здесь нет намеренно, как и у корня:
 * адрес — дело ownAddress, а этим страницам он в выдаче не нужен.
 *
 * parent бывает не передан (тест зовёт generateMetadata одним props) —
 * тогда и карточки нет.
 */
export async function rootCard(props: unknown, parent?: ResolvingMetadata): Promise<Metadata> {
  const locale = await localeOf(props)
  if (locale !== 'en' || !parent) return {}
  const images = rootCardOn(locale, (await parent)?.openGraph?.images)
  return images?.length ? { openGraph: { ...ogSite(locale), type: 'website', images } } : {}
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
 * русский адрес без префикса, как раньше. Карточка на en — с английской
 * подписью (rootCardOn), на ru — как есть.
 */
export function ownAddress(path: string, own: Metadata = {}) {
  return async (props: unknown, parent: ResolvingMetadata): Promise<Metadata> => {
    const locale = await localeOf(props)
    const images = rootCardOn(locale, (await parent).openGraph?.images)
    return {
      ...own,
      alternates: { ...own.alternates, ...localeAlternates(locale, path) },
      openGraph: { ...ogSite(locale), type: 'website', url: lp(locale, path), ...(images?.length ? { images } : {}) },
    }
  }
}
