import type { Metadata } from 'next'
import Link from 'next/link'
import { Cover } from '@/components/whatsnew/Cover'
import { PatchRow } from '@/components/whatsnew/PatchRow'
import { Stage } from '@/components/whatsnew/Stage'
import { artCandidates } from '@/lib/art'
import {
  getFeedForApps,
  getGamesMeta,
  getLatestSnapshot,
  getMajorFeed,
  type StoredNews,
} from '@/lib/db'
import { discountView } from '@/lib/discount'
import { HERO_WINDOW_SEC, splitFeed } from '@/lib/newsfeed'
import { currentSteamId, getDb, nowSec } from '@/lib/server'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Что нового',
  description: 'Крупные обновления игр: что изменилось в твоей библиотеке и в популярных играх.',
  // ?feed=popular — та же лента, что видит гость на /whatsnew, и отдельной
  // страницей она не является
  alternates: { canonical: '/whatsnew' },
}

/** Сколько игр библиотеки берём в личную ленту */
const LIBRARY_CAP = 300
const FEED_LIMIT = 30

/**
 * Ниже этого веса игра в общую ленту не попадает. rank — это MAX(отзывы, онлайн),
 * и без порога лента честно ставит рядом PUBG с весом 639 330 и выживалку на
 * триста онлайна: хронология не различает «вышло только что» и «вышло у кого-то,
 * о ком ты слышал». Порог отсекает длинный хвост и оставляет около сотни игр за
 * месяц — на тридцать строк это примерно десять дней ленты.
 */
const FEED_RANK_FLOOR = 10_000

/**
 * Лента обновлений.
 *
 * Страница остаётся серверной: тянуть на клиент нечего — тела патчей уже
 * приезжают из базы целиком. Клиентских островков ровно три, и у каждого есть
 * причина существовать: Cover (параллакс от скролла), Stage (наблюдатель за
 * активной строкой), PatchRow (раскрытие). Всё остальное — обычная разметка,
 * включая переключатель лент: это две ссылки, а не состояние.
 *
 * Первый элемент уходит в обложку, а не дублируется в ленте: он и так самый
 * свежий, и повторять его строкой значило бы показать одно обновление дважды.
 * Какой именно элемент считается первым, решает splitFeed — в личной ленте это
 * самый свежий патч, в общей самый весомый за неделю.
 */
export default async function WhatsNewPage(props: PageProps<'/whatsnew'>) {
  const wantsPopular = (await props.searchParams).feed === 'popular'
  const steamid = await currentSteamId()
  const db = await getDb()

  let mine: StoredNews[] = []

  if (steamid) {
    const snapshot = await getLatestSnapshot(db, steamid)
    if (snapshot?.games.length) {
      const appids = [...snapshot.games]
        .sort((a, b) => b.playtimeForever - a.playtimeForever)
        .slice(0, LIBRARY_CAP)
        .map((g) => g.appid)
      // На общей вкладке личная лента нужна ради одного ответа — «есть ли она
      // вообще»: от него зависит, показывать ли переключатель. Просить под это
      // тридцать записей значит прочитать сто двадцать строк и выбросить их.
      mine = await getFeedForApps(db, appids, wantsPopular ? 1 : FEED_LIMIT)
    }
  }

  // Гость и тот, по чьим играм ничего не приезжало, видят общую ленту без
  // переключателя: вкладка «в твоих играх», ведущая в пустоту, хуже её отсутствия
  const hasMine = mine.length > 0
  const showPopular = wantsPopular || !hasMine
  const items = showPopular
    ? await getMajorFeed(db, FEED_LIMIT, { minRank: FEED_RANK_FLOOR })
    : mine

  const metas = await getGamesMeta(
    db,
    items.map((i) => i.appid),
  )

  const now = nowSec()
  const { hero, rest } = splitFeed(items, now, showPopular ? HERO_WINDOW_SEC : 0)

  if (!hero) {
    return (
      <div className="whatsnew flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Что нового</h1>
        <p className="max-w-sm text-sm leading-relaxed text-dim">
          Пока пусто. Обновления подтягиваются по расписанию — загляни попозже.
        </p>
        <Link
          href="/quiz"
          className="text-sm font-semibold underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
        >
          А пока подобрать игру →
        </Link>
      </div>
    )
  }

  const heroMeta = metas.get(hero.appid)

  return (
    <div className="whatsnew min-h-screen">
      {/*
        key обязателен. Переключение вкладки — это тот же маршрут с другими
        параметрами, и поддерево не перемонтируется: и useState(initialWash), и
        useEffect со списком строк внутри Stage отработали бы ровно один раз за
        всё пребывание на странице. Наблюдатель остался бы висеть на старых,
        уже оторванных узлах, новые строки никогда не получили бы data-live, и
        заливка застыла бы на арте прошлой вкладки. key возвращает монтирование,
        а вместе с ним и входные анимации новой обложки.
      */}
      <Stage
        key={showPopular ? 'popular' : 'mine'}
        initialWash={
          artCandidates(
            { appid: hero.appid, art: heroMeta?.art, headerImage: heroMeta?.headerImage },
            'hero',
          )[0]
        }
      >
        <Cover
          item={hero}
          meta={heroMeta}
          nowSec={now}
          // Переключатель лежит экраном ниже, а после клика человек оказывается
          // наверху новой обложки — подпись здесь единственное, что говорит ему,
          // куда он попал
          label={hasMine ? (showPopular ? 'в популярных играх' : 'в твоих играх') : undefined}
        />

        <div className="mx-auto w-full max-w-6xl px-5 pb-24">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule py-6">
            {hasMine ? (
              /*
               * Вкладки — обычные ссылки, как чипсы фильтров на /library:
               * страница и так force-dynamic, а ради двух переходов тащить сюда
               * четвёртый клиентский островок не за что. Роль tablist не берём
               * осознанно: она обещает стрелки, roving tabindex и tabpanel,
               * а здесь происходит полноценная навигация.
               */
              <nav
                aria-label="Какую ленту показывать"
                className="flex flex-wrap items-baseline gap-x-6 gap-y-1"
              >
                <FeedTab href="/whatsnew" active={!showPopular}>
                  В твоих играх
                </FeedTab>
                <FeedTab href="/whatsnew?feed=popular" active={showPopular}>
                  В популярных играх
                </FeedTab>
              </nav>
            ) : (
              <h2 className="font-display text-lg font-bold tracking-tight md:text-xl">
                В популярных играх
              </h2>
            )}

            <p className="text-sm text-dim">
              {hasMine ? (
                showPopular ? (
                  'Крупные патчи в играх, где сейчас больше всего народу.'
                ) : (
                  'Только крупные патчи. Мелкие правки — на странице игры.'
                )
              ) : (
                <>
                  Только крупные патчи.{' '}
                  <Link
                    href="/"
                    className="font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
                  >
                    Подключи Steam
                  </Link>{' '}
                  — и лента станет про твои игры.
                </>
              )}
            </p>
          </div>

          {rest.map((item) => {
            const meta = metas.get(item.appid)
            return (
              <PatchRow
                key={`${item.appid}:${item.gid}`}
                item={item}
                meta={meta}
                nowSec={now}
                // Цена и ссылка на игру — только в общей ленте: в своей
                // библиотеке покупать нечего
                discovery={showPopular}
                discount={showPopular && meta ? discountView(meta, now) : null}
              />
            )
          })}
        </div>
      </Stage>
    </div>
  )
}

/**
 * Активная вкладка держится на весе и подчёркивании, а не на цвете: акцента в
 * этой зоне нет по замыслу (--ember здесь белый), и красить выбранную ссылку
 * было бы нечем. Плюс одним цветом состояние и так передавать нельзя.
 */
function FeedTab({
  href,
  active,
  children,
}: {
  href: string
  active: boolean
  children: React.ReactNode
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`font-display text-lg tracking-tight transition-opacity md:text-xl ${
        active
          ? 'font-bold text-ink underline decoration-2 underline-offset-8'
          : 'font-semibold text-dim hover:text-ink'
      }`}
    >
      {children}
    </Link>
  )
}
