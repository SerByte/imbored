import type { Metadata, Viewport } from 'next'
import { ogSite, siteTitle } from '@/lib/site'
import RootLayout, { generateMetadata as rootMetadata, viewport as rootViewport } from './[lang]/layout'
import { NotFoundView } from './[lang]/not-found'
import Template from './[lang]/template'

/**
 * 404 адреса вне всех разделов (/xyz, /wp-login.php, /.env, /xx/quiz) и
 * опечатки под русским разделом (/quiz/xyz, /games/<нет такого жанра>,
 * /game/730/xyz).
 *
 * Сюда такой адрес уводит правило afterFiles из next.config (garbageRewrites
 * в lib/i18nroutes.ts) — в /_not-found, единственный маршрут, чей 404 Next
 * рисует сервером целиком. Опечатка под разделом доходит до него потому, что
 * beforeFiles переписывают в /ru/… только формы настоящих маршрутов
 * (SECTION_SHAPES там же), — иначе её ловила бы динамическая
 * app/[lang]/[...missing] пустой оболочкой. Он же отвечает за всё, что не
 * нашло маршрута вовсе (/_next, /_vercel без файла). А вот промах
 * dynamicParams = false под /en (/en/games/<нет такого жанра>) сюда не
 * приходит, и отвечает ему пустая оболочка <html id="__next_error__">: на
 * next dev адрес достаётся app/[lang]/[...missing] (pagePath в RSC-части), а
 * на собранном сайте, по замеру ревью (тогда — у /games/<нет такого жанра>,
 * до SECTION_SHAPES), — notFound() самого [tag], под layout его сегмента:
 * 404 жанра вставала там с головой хаба, пока его подпись жила в
 * app/[lang]/games/layout.tsx. Теперь она у страницы хаба.
 *
 * ПОЧЕМУ НЕ СТРАНИЦА С notFound(). Так было: правило уводило мусор в
 * пререндеренную app/[lang]/missing, а она звала notFound(). В этой версии
 * Next notFound() из страницы роняет серверный рендер целиком: граница
 * not-found — клиентский error boundary (HTTPAccessFallbackBoundary), а
 * серверный рендер React error boundary не исполняет. Next ловит отказ и
 * отдаёт пустую оболочку <html id="__next_error__"> без lang, стилей, шапки
 * и текста — экран дорисовывает клиент. Без скрипта страница была пустой,
 * у всех — пустой первый кадр и без скрипта темы. До [lang] такой адрес
 * отдавал встроенный /_not-found, собранный из корневого layout и
 * not-found, — сервером, со шапкой, подвалом и полкой. Это возвращает его.
 *
 * Корневой layout здесь — тот же app/[lang]/layout.tsx с языком 'ru', а не
 * копия: шапка, подвал, шрифты, скрипт темы и замок от тёмных читалок те же,
 * что у любой страницы. Обёртка перехода — та же app/[lang]/template.tsx:
 * граница not-found рисуется внутри неё, и экран 404 стоит в той же
 * раскладке. Язык — русский: адрес без префикса — русский сайт, а /en/… сюда
 * не приходит (его ловит app/[lang]/[...missing] своим языком).
 *
 * Метаданные и viewport — корневые русские: у /_not-found нет сегмента
 * [lang], и generateMetadata корня здесь сам не вызывается. Код 404 и
 * robots noindex Next ставит этому маршруту сам.
 *
 * Плюс корневая карточка превью (RU_ROOT_CARD ниже): файловую
 * app/[lang]/opengraph-image.tsx Next ставит только под сегментом [lang], а
 * корневой layout на ru images намеренно не объявляет — его карточка и есть
 * файл. Без этой строки русская 404 была без og:image и twitter:image вовсе,
 * а до [lang] корневая карточка стояла и на ней.
 */
export async function generateMetadata(): Promise<Metadata> {
  const root = await rootMetadata({ params: Promise.resolve({ lang: 'ru' }), children: null })
  // openGraph заменяет корневой целиком — тип, имя и язык те же, что у корня
  return { ...root, openGraph: { ...ogSite('ru'), type: 'website', images: [RU_ROOT_CARD] } }
}

/**
 * Та же карточка, что у русских страниц (/ru/opengraph-image), и та же
 * подпись — alt файла, «imbored — во что поиграть» (docs/i18n.md, п. 10). Без
 * хеша в адресе: его ставит только файловая метадата, как и у английской
 * карточки корня. Размеры и тип — копия size и contentType карточки, а не
 * импорт, по той же причине, что у EN_ROOT_CARD в app/[lang]/layout.tsx:
 * модуль карточки тянет next/og и шрифты. Совпадение сторожит
 * lib/notfound.test.ts. twitter:image Next достраивает из openGraph сам.
 */
const RU_ROOT_CARD = { url: '/ru/opengraph-image', width: 1200, height: 630, type: 'image/png', alt: siteTitle('ru') }

export const viewport: Viewport = rootViewport

export default function GlobalNotFound() {
  return (
    <RootLayout params={Promise.resolve({ lang: 'ru' })}>
      <Template>
        <NotFoundView locale="ru" />
      </Template>
    </RootLayout>
  )
}
