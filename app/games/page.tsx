import { PHASE_PRODUCTION_BUILD } from 'next/constants'
import Link from 'next/link'
import { GameCardBody } from '@/components/GameCard'
import { Icon } from '@/components/Icon'
import { Eyebrow } from '@/components/Labels'
import { topGamesByTags } from '@/lib/db'
import {
  assembleHub,
  HUB_FETCH,
  HUB_MIN_WEIGHT,
  HUB_TAGS,
  hubPath,
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
          <div className="flex flex-col gap-10">
            {shelves.map((s, i) => (
              // Первая полка грузится сразу: это обложки над сгибом, и
              // ленивая загрузка только отложила бы их показ
              <Shelf key={s.tag} shelf={s} eager={i === 0} />
            ))}
          </div>
        ) : (
          <div className="panel-lift flex items-center gap-4 p-6">
            <span aria-hidden className="grid size-12 shrink-0 place-items-center rounded-full bg-ink/10 text-dim">
              <Icon name="grid" size={22} />
            </span>
            <p className="text-dim">Полки собираются — загляни чуть позже.</p>
          </div>
        )}

        <div>
          {/* Тот же выход, что внизу карточки игры: гостю /play не откроется,
              а квиз работает любому */}
          <Link href="/quiz" className="btn-ember px-6 py-3">
            Подобрать игру под настроение <Icon name="arrow" className="ml-1.5 inline-block align-[-0.125em]" />
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
/*
 * ПОЛКА ЖАНРА — РЯД КАПСУЛ, КАК У СТРИМИНГА.
 *
 * Была карточка: одна обложка и под ней столбик из двенадцати названий. То
 * есть одиннадцать игр из двенадцати страница показывала буквами — на сайте
 * про игры, где у каждой есть арт. Теперь у каждой своя капсула, а полка
 * листается вбок (.shelf-rail): двенадцать обложек в ряд на экран не лезут,
 * и видимый обрез последней — это и есть подсказка «дальше есть ещё».
 *
 * Картинки ленивые, кроме первой полки: остальные грузятся по мере того, как
 * до них доходят, — и вниз, и вбок.
 */
function Shelf({ shelf, eager }: { shelf: HubShelf; eager: boolean }) {
  const headingId = `shelf-${shelf.tag.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const path = hubPath(shelf.tag)
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-4">
      {/* У жанра своя страница (/games/<slug>): там он весь, без правила
          «одна игра — одна полка», с отзывами и тем, за что любят */}
      <div className="flex items-baseline justify-between gap-4">
        <h2 id={headingId} className="section-title">
          {tagRu(shelf.tag)}
        </h2>
        {path && (
          <Link href={path} prefetch={false} className="tap link-more shrink-0">
            Весь жанр
            <Icon name="arrow" size={16} />
            <span className="sr-only">: {tagRu(shelf.tag)}</span>
          </Link>
        )}
      </div>
      <ol className="shelf-rail">
        {shelf.games.map((g, i) => (
          <li key={g.appid}>
            {/* Без префетча, и это про деньги. Next префетчит каждую ссылку,
                попавшую в экран, а здесь их три с половиной сотни. Карточки
                вне предрендеренной пятисотки при первом заходе рендерятся
                функцией и читают базу — прокрутка хаба будила бы её на каждую
                капсулу, по которой никто не пойдёт. */}
            <Link href={`/game/${g.appid}`} prefetch={false} className="game-card block">
              <GameCardBody
                appid={g.appid}
                name={g.name}
                headerImage={g.headerImage}
                art={g.art}
                sizes="260px"
                eager={eager && i < 5}
              />
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
