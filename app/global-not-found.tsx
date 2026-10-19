import type { Metadata, Viewport } from 'next'
import RootLayout, { generateMetadata as rootMetadata, viewport as rootViewport } from './[lang]/layout'
import { NotFoundView } from './[lang]/not-found'
import Template from './[lang]/template'

/**
 * 404 адреса вне всех разделов: /xyz, /wp-login.php, /.env, /xx/quiz.
 *
 * Сюда такой адрес уводит правило afterFiles из next.config (garbageRewrites
 * в lib/i18nroutes.ts) — в /_not-found, единственный маршрут, чей 404 Next
 * рисует сервером целиком. Он же отвечает за всё, что не нашло маршрута
 * вовсе (/_next, /_vercel без файла). А вот dynamicParams = false мимо
 * списка (/games/<нет такого жанра>) сюда не приходит, и отвечает ему
 * пустая оболочка <html id="__next_error__">: на next dev адрес достаётся
 * app/[lang]/[...missing] (pagePath в RSC-части), а на собранном сайте, по
 * замеру ревью, — notFound() самого [tag], под layout его сегмента: 404 жанра
 * вставала там с головой хаба, пока его подпись жила в
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
 */
export async function generateMetadata(): Promise<Metadata> {
  return rootMetadata({ params: Promise.resolve({ lang: 'ru' }), children: null })
}

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
