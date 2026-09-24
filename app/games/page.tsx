import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import Link from 'next/link'
import { GameArt } from '@/components/GameArt'
import { Eyebrow } from '@/components/Labels'
import { topGamesByTags } from '@/lib/db'
import {
  assembleHub,
  HUB_FETCH,
  HUB_MIN_WEIGHT,
  HUB_TAGS,
  type HubShelf,
} from '@/lib/gamehub'
import { getDb } from '@/lib/server'
import { ownAddress } from '@/lib/site'
import { tagRu } from '@/lib/tagsru'

/**
 * Хаб игр: тридцать жанров, по двенадцать игр в каждом.
 *
 * Единственная страница, которая ссылается на карточки игр пачкой. До неё
 * путь краулера к пяти тысячам /game/<appid> шёл через карту сайта и полку
 * «Похожие», а у человека с карточки не было выхода «посмотреть ещё», кроме
 * квиза. Что на какой полке и почему — в lib/gamehub.
 *
 * Сутки на ISR, как у карточек: выборка читает все игры тридцати тегов выше
 * порога (тысячи строк, см. topGamesByTags), и платить за неё на каждый заход
 * нельзя. Жанры тем временем не меняются вовсе, а верх по отзывам — неделями.
 */
export const revalidate = 86_400

export const generateMetadata = ownAddress('/games', {
  title: 'Игры по жанрам',
  description:
    'Открытый мир, соулслайки, рогалики, градостроение и ещё два десятка жанров — по двенадцать игр, для которых жанр главный, с отзывами и патчами на русском.',
})

/**
 * Полки или пустой список — но пустой только на сборке.
 *
 * Страница статическая и пререндерится при next build, а сборка превью может
 * идти без базы: getDb бросает, когда в продакшен-окружении не задан
 * TURSO_DATABASE_URL (тот же довод, что у app/sitemap.ts). Там пустой хаб
 * лучше упавшей сборки.
 *
 * А вот при перегенерации на проде исключение пропускается наружу намеренно:
 * упавший рендер ISR оставляет в кэше прошлую версию страницы, а пойманный
 * закэшировал бы пустой хаб на сутки из-за одной осечки базы.
 */
async function loadHub(): Promise<HubShelf[]> {
  try {
    const rows = await topGamesByTags(await getDb(), HUB_TAGS, {
      minWeight: HUB_MIN_WEIGHT,
      perTag: HUB_FETCH,
    })
    return assembleHub(HUB_TAGS, rows)
  } catch (err) {
    if (process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) throw err
    console.error('games: каталог недоступен на сборке, хаб собран пустым', err)
    return []
  }
}

export default async function GamesHubPage() {
  const shelves = await loadHub()

  return (
    <div className="flex-1">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-safe pt-28 pb-16">
        <header className="flex max-w-2xl flex-col gap-4 anim-rise">
          <Eyebrow>Каталог</Eyebrow>
          <h1 className="font-display text-display-lg">Игры по жанрам</h1>
          <p className="leading-relaxed text-dim">
            По двенадцать игр на жанр — из тех, для кого он главный, а не метка в хвосте
            списка тегов. Порядок — по числу отзывов в Steam, и каждая игра стоит только на
            одной полке: под каждым жанром свои находки, а не одни и те же хиты.
          </p>
        </header>

        {shelves.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shelves.map((s, i) => (
              // Первый ряд грузится сразу: на десктопе это три обложки над
              // сгибом, и ленивая загрузка только отложила бы их показ
              <Shelf key={s.tag} shelf={s} eager={i < 3} />
            ))}
          </div>
        ) : (
          <p className="text-dim">Полки собираются — загляни чуть позже.</p>
        )}

        <div>
          {/* Тот же выход, что внизу карточки игры: гостю /play не откроется,
              а квиз работает любому */}
          <Link href="/quiz" className="btn-ember px-5 py-3 text-sm">
            Подобрать игру под настроение →
          </Link>
        </div>
      </div>
    </div>
  )
}

/**
 * Полка жанра: обложка первой игры и список из двенадцати названий.
 *
 * Обложка одна на полку, а не у каждой игры, и это про вес. Двенадцать
 * картинок на тридцать полок — это триста шестьдесят клиентских GameArt, и
 * у каждого в полезной нагрузке страницы едет свой набор ссылок на арт.
 * Названия — обычный текст ссылок: их и читают, и краулер по ним ходит.
 *
 * Обложка декоративная (alt у GameArt пустой, ссылки на ней нет): её игра
 * и так стоит в списке первой строкой, и вторая ссылка туда же была бы для
 * скринридера повтором.
 */
function Shelf({ shelf, eager }: { shelf: HubShelf; eager: boolean }) {
  const cover = shelf.games[0]
  const headingId = `shelf-${shelf.tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  return (
    <section
      aria-labelledby={headingId}
      className="glass flex flex-col overflow-hidden rounded-[20px]"
    >
      {cover && (
        <GameArt
          appid={cover.appid}
          name=""
          headerImage={cover.headerImage}
          art={cover.art}
          sizes="(min-width: 1024px) 360px, (min-width: 640px) 50vw, 100vw"
          eager={eager}
          className="aspect-[460/215] w-full object-cover"
        />
      )}
      <div className="flex flex-col gap-3 p-5">
        <h2 id={headingId} className="font-display text-display-xs">
          {tagRu(shelf.tag)}
        </h2>
        <ol className="flex flex-col text-sm">
          {shelf.games.map((g) => (
            <li key={g.appid} className="min-w-0">
              {/* py-1 даёт строке 28 px — выше порога 24 px, а соседние
                  строки списка не налезают друг на друга зонами .tap.

                  Без префетча, и это про деньги. Next префетчит каждую
                  ссылку, попавшую в экран, а здесь их три с половиной сотни,
                  по три десятка на экран. Карточки вне предрендеренной
                  пятисотки при первом заходе рендерятся функцией и читают
                  базу — прокрутка хаба будила бы её на каждую строку, по
                  которой никто не пойдёт. Без префетча переход стоит один
                  рендер по клику, а не сотню на прокрутку. */}
              <Link
                href={`/game/${g.appid}`}
                prefetch={false}
                className="block truncate py-1 text-dim transition-colors hover:text-ink"
              >
                {g.name}
              </Link>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
