import type { Metadata } from 'next'
import Link from 'next/link'
import { Cover } from '@/components/whatsnew/Cover'
import { FeedWatch } from '@/components/whatsnew/FeedWatch'
import { PatchRow } from '@/components/whatsnew/PatchRow'
import { Stage } from '@/components/whatsnew/Stage'
import { artCandidates } from '@/lib/art'
import { getFeedForApps, getGamesMeta, getLatestSnapshot, getMajorFeed } from '@/lib/db'
import { discountView } from '@/lib/discount'
import { HERO_WINDOW_SEC, splitFeed } from '@/lib/newsfeed'
import { plural } from '@/lib/plural'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { resolveWhatsNew } from '@/lib/whatsnewfeed'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Что нового',
  description: 'Крупные обновления игр: что изменилось в твоей библиотеке и в популярных играх.',
  // ?feed=popular — та же лента, что видит гость на /whatsnew, и отдельной
  // страницей она не является
  alternates: { canonical: '/whatsnew' },
}

/*
 * LIBRARY_CAP, FEED_LIMIT и FEED_RANK_FLOOR переехали в lib/whatsnewfeed:
 * теми же числами обязан пользоваться /api/whatsnew/head, иначе плашка
 * «N новых» считает по одному набору игр, а страница рисует по другому.
 */

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

  // Гость и тот, по чьим играм ничего не приезжало, видят общую ленту без
  // переключателя: вкладка «в твоих играх», ведущая в пустоту, хуже её
  // отсутствия. Ветка живёт в lib/, потому что ровно её же обязан повторить
  // опрос головы ленты из /api/whatsnew/head — своими словами он разошёлся бы
  // с ней в первый же день, когда у человека появится личный патч.
  const now = nowSec()
  const { items, showPopular, hasMine, mineCount } = await resolveWhatsNew({
    steamid,
    wantsPopular,
    nowSec: now,
    snapshot: (id) => getLatestSnapshot(db, id),
    forApps: (appids, limit) => getFeedForApps(db, appids, limit),
    major: (limit, minRank) => getMajorFeed(db, limit, { minRank }),
  })

  const metas = await getGamesMeta(
    db,
    items.map((i) => i.appid),
  )

  // Обложка берётся ТОЛЬКО из личного блока: добивка свежее (0–8 дней против
  // 15+ у библиотеки), и на вкладке «в твоих играх» она встала бы обложкой,
  // подсунув чужую игру под заголовок про твои.
  const heroSource = items.slice(0, mineCount)
  const topup = items.slice(mineCount)
  const { hero, rest } = splitFeed(heroSource, now, showPopular ? HERO_WINDOW_SEC : 0)

  if (!hero) {
    return (
      <div className="whatsnew flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">
        <h1 className="font-display text-display-md">Что нового</h1>
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
  // Базовая линия для плашки «N новых»: что именно сейчас нарисовано и докуда
  // достаёт хвост. Порядок тот же, что у /api/whatsnew/head.
  const keys = items.map((i) => `${i.appid}:${i.gid}`)
  const tailAt = items[items.length - 1]!.publishedAt

  return (
    <div className="whatsnew min-h-screen">
      <FeedWatch keys={keys} tailAt={tailAt} showPopular={showPopular} />
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
        // Смена вкладки лечится ключом выше, а вот router.refresh() ключ не
        // меняет: поддерево согласуется, Stage не перемонтируется, и его
        // наблюдатель остаётся висеть на том наборе строк, который был при
        // монтировании. Приехавшие с обновлением строки не получили бы
        // data-live никогда — остались бы обесцвеченными и не двигали заливку.
        rowsKey={keys.join('|')}
        // Часы: без них вкладка, оставленная на ночь, к утру продолжает
        // уверять, что патч вышел «сегодня»
        nowSec={now}
        publishedAts={items.map((i) => i.publishedAt)}
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
              <h2 className="font-display text-display-xs">
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

          {topup.length ? (
            <>
              {/*
                Граница обязана быть видимой. Ниже неё лежат чужие игры, и
                выдать их за твои значило бы соврать ровно там, где страница
                обещает личное. Порядок тут уже не хронологический — добивка
                свежее того, что над ней, — и подпись это тоже объясняет.
              */}
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule pt-10 pb-6">
                <h2 className="font-display text-display-xs">
                  Ещё в популярных играх
                </h2>
                <p className="text-sm text-dim">
                  В твоих играх за три месяца — {mineCount}{' '}
                  {plural(mineCount, 'обновление', 'обновления', 'обновлений')}. Дальше — то, что
                  патчат прямо сейчас.
                </p>
              </div>

              {topup.map((item) => {
                const meta = metas.get(item.appid)
                return (
                  <PatchRow
                    key={`${item.appid}:${item.gid}`}
                    item={item}
                    meta={meta}
                    nowSec={now}
                    // Это чужие игры — цена и ссылка на страницу тут уместны
                    discovery
                    discount={meta ? discountView(meta, now) : null}
                  />
                )
              })}
            </>
          ) : null}
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
      className={`tap tap-tight font-display text-display-xs transition-opacity ${
        active
          ? 'font-bold text-ink underline decoration-2 underline-offset-8'
          : 'font-semibold text-dim hover:text-ink'
      }`}
    >
      {children}
    </Link>
  )
}
