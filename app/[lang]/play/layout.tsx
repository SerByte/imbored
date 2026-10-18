import type { Metadata } from 'next'
import { MotionLazy } from '@/components/motion/MotionLazy'
import { toLocale, tr } from '@/lib/i18n'

/**
 * См. app/rooms/layout.tsx: страница клиентская, а metadata экспортируется
 * только из серверных модулей — отсюда отдельный layout.
 *
 * Здесь это не про выдачу: /play закрыт в robots.txt (lib/robots.ts), потому
 * что без куки он всё равно выбрасывает на лендинг. Заголовок нужен
 * человеку — вкладке, истории и закладке. Главный экран продукта звался в
 * браузере ровно так же, как сам сайт, и среди нескольких открытых вкладок
 * imbored его нельзя было отличить ни от лендинга, ни от портрета.
 *
 * Язык — из params маршрута, а не из next/root-params: так же, как у
 * ownAddress (lib/site), и layout годится вызвать без сборки.
 */
export async function generateMetadata({ params }: LayoutProps<'/[lang]/play'>): Promise<Metadata> {
  const locale = toLocale((await params).lang)
  return {
    // Не «Подборка»: на экране одна игра, и вкладка обязана говорить то же
    title: tr(locale, { ru: 'Одна игра', en: 'One game' }),
    description: tr(locale, {
      ru: 'Одна игра на сегодня из твоей библиотеки, а если своего не хватит — пара находок из магазина. С объяснением, почему именно она, и с числом тех, кто играет в неё прямо сейчас.',
      en: "One game for tonight from your library, and if that's not enough, a couple of finds from the store. With why it's the one, and how many people are playing it right now.",
    }),
  }
}

/**
 * Других параметров, кроме языка, у страницы нет: чужой язык (/xx/…) — сразу
 * 404 без рендера и без записи ISR. Почему не один раз в корне — в
 * app/[lang]/layout.tsx, у generateStaticParams.
 */
export const dynamicParams = false

export default function PlayLayout({ children }: LayoutProps<'/[lang]/play'>) {
  return <MotionLazy>{children}</MotionLazy>
}
