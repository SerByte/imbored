import type { Metadata, ResolvingMetadata } from 'next'
import { toLocale, type Locale } from '@/lib/i18n'

/**
 * Подпись хаба жанров на языке страницы — здесь, а не в page.tsx.
 *
 * Хаб объявляет свой адрес через ownAddress (lib/site): тот ставит
 * canonical, hreflang и og:url на языке страницы и переносит корневую
 * картинку, которую свой openGraph иначе стёр бы. А вот title и description
 * у ownAddress одни на оба языка — объект own задаётся один раз, при
 * загрузке модуля, когда языка ещё нет. Поэтому пару по языку ставит этот
 * layout, а страница её наследует: своего title у неё нет, og:title и
 * og:description Next достраивает из унаследованных (как и раньше — из
 * страничных), а шаблон «%s · imbored» корня применяется к нему так же.
 *
 * ШАБЛОН — ДАЛЬШЕ ВНИЗ, И ЭТО ОБЯЗАТЕЛЬНО. Next передаёт детям шаблон title
 * ближайшего сегмента, у которого он есть, и строка без шаблона здесь его
 * обрывала: страницы жанров теряли « · imbored» во вкладке и в выдаче
 * (замер на /games/roguelike: «Рогалики — лучшие в Steam по отзывам» без
 * хвоста). Поэтому title — объектом с шаблоном родителя, взятым у него же
 * (parent), а не копией строки корня: копия разошлась бы с ним при первой
 * правке. Сверка русского вывода «до» и «после» по всем тегам головы —
 * совпадение у хаба и у жанров.
 *
 * Страницы жанров (/games/<slug>) ставят свои title и description и этого
 * не видят. Если ownAddress научится брать подпись по языку, пара вернётся в
 * page.tsx, а этот файл уйдёт.
 */
const META = {
  ru: {
    title: 'Игры по жанрам',
    description:
      'Открытый мир, соулслайки, рогалики, градостроение и ещё два десятка жанров — по двенадцать игр, для которых жанр главный, с отзывами и патчами на русском.',
  },
  en: {
    title: 'Games by genre',
    description:
      'Open world, soulslikes, roguelikes, city builders and two dozen more genres — twelve games each where the genre is the main one, with reviews and patch notes.',
  },
} satisfies Record<Locale, { title: string; description: string }>

export async function generateMetadata(
  { params }: Pick<LayoutProps<'/[lang]/games'>, 'params'>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const { title, description } = META[toLocale((await params).lang)]
  const template = (await parent).title?.template
  return { title: template ? { default: title, template } : title, description }
}

export default function GamesLayout({ children }: LayoutProps<'/[lang]/games'>) {
  return children
}
