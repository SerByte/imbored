import type { Metadata, ResolvingMetadata } from 'next'
import Link from '@/components/Link'
import { Icon } from '@/components/Icon'
import { LinkPending } from '@/components/LinkPending'
import { Cover } from '@/components/whatsnew/Cover'
import { FeedLink } from '@/components/whatsnew/FeedLink'
import { FeedWatch } from '@/components/whatsnew/FeedWatch'
import { PatchRow } from '@/components/whatsnew/PatchRow'
import { Stage } from '@/components/whatsnew/Stage'
import { artCandidates, artSrcSet } from '@/lib/art'
import {
  getFeedForApps,
  getFeedLink,
  getGamesMetaLite,
  getLatestSnapshot,
  withoutBody,
  type FeedItem,
  type StoredNews,
} from '@/lib/db'
import { steamLoginFor } from '@/lib/destination'
import { discountView, trustedPrice } from '@/lib/discount'
import { lp, pl, toLocale, tr, type Locale } from '@/lib/i18n'
import { HERO_WINDOW_SEC, splitFeed } from '@/lib/newsfeed'
import { newsTitleOn } from '@/lib/newspage'
import { currentSession, getDb, isWriter, nowSec } from '@/lib/server'
import { ownAddress } from '@/lib/site'
import { countChanges } from '@/lib/steamhtml'
import { cachedMajorFeed } from '@/lib/whatsnewcache'
import { feedMeta, resolveWhatsNew } from '@/lib/whatsnewfeed'

export const dynamic = 'force-dynamic'

/*
 * ?feed=popular — та же лента, что видит гость на /whatsnew, и отдельной
 * страницей она не является: canonical у обеих один.
 *
 * Функция, а не ownAddress(…) константой, как у соседей: заголовок, описание
 * и адрес RSS-ленты — на языке страницы, а own у ownAddress один на все
 * языки. Адрес и картинку по-прежнему решает ownAddress.
 */
export async function generateMetadata(
  props: PageProps<'/[lang]/whatsnew'>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const locale = toLocale((await props.params).lang)
  return ownAddress('/whatsnew', {
    title: tr(locale, { ru: 'Что нового', en: "What's new" }),
    description: tr(locale, {
      ru: 'Крупные обновления игр: что изменилось в твоей библиотеке и в популярных играх.',
      en: 'Major game updates: what changed in your library and in popular games.',
    }),
    // <link rel="alternate" type="application/rss+xml"> — по нему ридеры и
    // браузерные расширения находят ленту сами (app/whatsnew/feed.xml); у
    // /en — своя, английская
    alternates: { types: { 'application/rss+xml': lp(locale, '/whatsnew/feed.xml') } },
  })(props, parent)
}

/*
 * LIBRARY_CAP, FEED_LIMIT и FEED_RANK_FLOOR переехали в lib/whatsnewfeed:
 * теми же числами обязан пользоваться /api/whatsnew/head, иначе плашка
 * «N новых» считает по одному набору игр, а страница рисует по другому.
 */

/**
 * Строка ленты для островка — с заголовком и пересказом на языке страницы в
 * полях title и tldr, как cardNews у карточки игры (lib/gamepage).
 *
 * Здесь, на сервере, а не в островках: PatchRow и Cover рисуют title и tldr
 * как есть, а indexedNewsPath судит по tldr, давать ли ссылку на страницу
 * патча, — на /en она идёт в индекс только с английским пересказом. Правило
 * заголовка (newsTitleOn: titleEn → английский заголовок → «{Game} update») и
 * его словари в бандл ленты так не едут. Русского пересказа на /en нет вовсе
 * (docs/i18n.md, п. 8): нет английского — нет и строки пересказа. Русская
 * строка — withoutBody как была.
 */
function rowOn(item: StoredNews, gameName: string | undefined, locale: Locale): FeedItem {
  const row = withoutBody(item)
  if (locale !== 'en') return row
  const en: FeedItem = { ...row, title: newsTitleOn(item, gameName, locale) }
  delete en.tldr
  delete en.tldrEn
  delete en.titleEn
  if (item.tldrEn) en.tldr = item.tldrEn
  return en
}

/**
 * Лента обновлений.
 *
 * Страница остаётся серверной: тянуть на клиент нечего — тела патчей уже
 * приезжают из базы целиком. У каждого клиентского островка есть причина
 * существовать: Cover (параллакс от скролла), Stage (наблюдатель за активной
 * строкой), PatchRow (раскрытие), FeedWatch (плашка «N новых»). Всё остальное
 * — обычная разметка, включая переключатель лент: это две ссылки, а не
 * состояние; клиентская у них только подпись с признаком «нажато».
 *
 * Первый элемент уходит в обложку, а не дублируется в ленте: он и так самый
 * свежий, и повторять его строкой значило бы показать одно обновление дважды.
 * Какой именно элемент считается первым, решает splitFeed — в личной ленте это
 * самый свежий патч, в общей самый весомый за неделю.
 *
 * Границы загрузки у страницы НЕТ — ни loading.tsx, ни Suspense вокруг
 * ленты, — и это решение, а не недосмотр. Каркас отдавался раньше страницы, и
 * всё содержимое, включая h1, уезжало в <div hidden>: без JS страницы не было,
 * хотя она в карте сайта и открыта в robots. Разделить «обложку сразу, ленту
 * потом» здесь нечем: обложка — это первый элемент той же ленты, из того же
 * запроса, так что граница вокруг ленты спрятала бы строки, не ускорив
 * обложку. Паузу при переключении вкладок закрывает мерцание самой вкладки
 * (FeedTab → LinkPending), а старая страница стоит до прихода новой — без
 * белого кадра между двумя тёмными экранами, из-за которого у ветки и был
 * свой фолбэк.
 *
 * Язык — из params (у страницы есть тест, а next/root-params в vitest бросает
 * при импорте): тексты строк ленты собирает rowOn, срок скидки — discountView
 * здесь же, клиенту уезжают готовые строки.
 */
export default async function WhatsNewPage(props: PageProps<'/[lang]/whatsnew'>) {
  const locale = toLocale((await props.params).lang)
  const wantsPopular = (await props.searchParams).feed === 'popular'
  const session = await currentSession()
  const steamid = session?.steamid ?? null
  const db = await getDb()

  // Гость и тот, по чьим играм ничего не приезжало, видят общую ленту без
  // переключателя: вкладка «в твоих играх», ведущая в пустоту, хуже её
  // отсутствия. Ветка живёт в lib/, потому что ровно её же обязан повторить
  // опрос головы ленты из /api/whatsnew/head — своими словами он разошёлся бы
  // с ней в первый же день, когда у человека появится личный патч.
  const now = nowSec()
  const { items, showPopular, hasMine, mineCount, owned } = await resolveWhatsNew({
    steamid,
    wantsPopular,
    nowSec: now,
    snapshot: (id) => getLatestSnapshot(db, id),
    forApps: (appids, limit, since) => getFeedForApps(db, appids, limit, undefined, since),
    // Общая лента — из кэша: она одна на всех и переживает посетителя.
    // Личная ветка выше остаётся живой, разрез идёт ровно по этому шву.
    major: (limit, minRank) => cachedMajorFeed(limit, minRank),
  })

  const metas = await getGamesMetaLite(
    db,
    items.map((i) => i.appid),
  )

  /*
   * Секретная ссылка на личную RSS-ленту — только у пишущей сессии: ключ
   * даёт постоянный доступ к ленте патчей твоих игр, и выпускать его тому,
   * кто владения профилем не доказал, нельзя (app/api/whatsnew/feedlink).
   * Сессии по ссылке на профиль — строка о том, что для этого нужно.
   *
   * Стоит на обеих вкладках и даже на пустой странице: включённую ссылку
   * обязано быть где отключить, что бы ни показывала лента сегодня. Самой
   * ссылки сервер не знает — только есть ли она и с какого дня.
   *
   * verified — обещать «Выйти на всех устройствах» как второй выключатель
   * можно только тому, у кого эта кнопка есть: демо пишет, но выхода везде у
   * него нет (components/SignOut), и ссылку его выход не трогает.
   *
   * «Войти через Steam» — со steamLoginFor: после входа человек обязан
   * вернуться сюда, к ссылке, ради которой входил, а не попасть на квиз. Путь
   * — на языке страницы: с /en вход везёт lang=en и возвращает на /en/whatsnew.
   */
  const writer = session !== null && isWriter(session)
  const feedLink = writer ? await getFeedLink(db, session.steamid) : null
  const rss = !session ? null : writer ? (
    <FeedLink since={feedLink?.createdAt ?? null} verified={session.verified} />
  ) : (
    <p className="border-t border-rule pt-8 text-sm text-dim">
      {tr(locale, {
        ru: 'Получать патчи своих игр в ридер по секретной ссылке может вошедший через Steam: ссылка на профиль не доказывает, что профиль твой.',
        en: "The private RSS link for your games' patches needs a Steam sign-in: a profile link doesn't prove the profile is yours.",
      })}{' '}
      <a
        href={steamLoginFor(lp(locale, '/whatsnew'))}
        className="tap tap-tight font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
      >
        {tr(locale, { ru: 'Войти через Steam', en: 'Sign in with Steam' })}
      </a>
    </p>
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
        <span aria-hidden className="mb-2 grid size-16 place-items-center rounded-full bg-ink/10 text-dim">
          <Icon name="news" size={28} />
        </span>
        <h1 className="font-display text-display-md">{tr(locale, { ru: 'Что нового', en: "What's new" })}</h1>
        <p className="max-w-sm text-sm leading-relaxed text-dim">
          {tr(locale, {
            ru: 'Пока пусто. Обновления подтягиваются по расписанию — загляни попозже.',
            en: 'Nothing here yet. Updates come in on a schedule — check back later.',
          })}
        </p>
        <Link href="/quiz" className="btn-ember mt-2 px-6 py-3">
          {tr(locale, { ru: 'А пока подобрать игру', en: 'Find a game in the meantime' })}{' '}
          <Icon name="arrow" className="ml-1.5 inline-block align-[-0.125em]" />
        </Link>
        {rss ? <div className="mt-12 w-full max-w-2xl text-left">{rss}</div> : null}
      </div>
    )
  }

  const heroMeta = metas.get(hero.appid)
  const heroArt = { appid: hero.appid, art: heroMeta?.art, headerImage: heroMeta?.headerImage }
  // Базовая линия для плашки «N новых»: что именно сейчас нарисовано и докуда
  // достаёт хвост. Порядок тот же, что у /api/whatsnew/head.
  const keys = items.map((i) => `${i.appid}:${i.gid}`)
  const tailAt = items[items.length - 1]!.publishedAt
  const yourGames = tr(locale, { ru: 'В твоих играх', en: 'In your games' })
  const popularGames = tr(locale, { ru: 'В популярных играх', en: 'In popular games' })

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
        // Заливка начинается с арта обложки — тем же srcSet, что у неё
        // самой: тогда браузер берёт тот же файл из кэша, а не качает
        // второй (см. initialWashSrcSet в Stage)
        initialWash={artCandidates(heroArt, 'hero')[0]}
        initialWashSrcSet={artSrcSet(heroArt, 'hero')}
      >
        <Cover
          item={rowOn(hero, heroMeta?.name, locale)}
          // вариант hero: обложка рисует арт во весь экран — см. feedMeta
          meta={feedMeta(heroMeta, 'hero')}
          nowSec={now}
          changes={countChanges(hero.blocks)}
          // Переключатель лежит экраном ниже, а после клика человек оказывается
          // наверху новой обложки — подпись здесь единственное, что говорит ему,
          // куда он попал
          label={
            hasMine
              ? showPopular
                ? tr(locale, { ru: 'в популярных играх', en: 'in popular games' })
                : tr(locale, { ru: 'в твоих играх', en: 'in your games' })
              : undefined
          }
        />

        <div className="mx-auto w-full max-w-6xl px-5 pb-24">
          {/* Вкладки и подпись — одна строка на одной базовой линии: английские
              подписи не длиннее русских, и строка не переносится раньше */}
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-rule py-6">
            {hasMine ? (
              /*
               * Вкладки — обычные ссылки, как чипсы фильтров на /library:
               * страница и так force-dynamic, а ради двух переходов тащить сюда
               * состояние не за что — клиентской у вкладки осталась одна
               * подпись с признаком «нажато» (см. FeedTab). Роль tablist не берём
               * осознанно: она обещает стрелки, roving tabindex и tabpanel,
               * а здесь происходит полноценная навигация.
               */
              <nav
                aria-label={tr(locale, { ru: 'Какую ленту показывать', en: 'Which feed to show' })}
                className="flex flex-wrap items-baseline gap-x-6 gap-y-1"
              >
                <FeedTab href="/whatsnew" active={!showPopular}>
                  {yourGames}
                </FeedTab>
                <FeedTab href="/whatsnew?feed=popular" active={showPopular}>
                  {popularGames}
                </FeedTab>
              </nav>
            ) : (
              <h2 className="font-display text-display-xs">
                {popularGames}
              </h2>
            )}

            <p className="text-sm text-dim">
              {hasMine ? (
                showPopular ? (
                  tr(locale, {
                    ru: 'Крупные патчи в играх, где сейчас больше всего народу.',
                    en: "Major patches in today's most-played games.",
                  })
                ) : (
                  tr(locale, {
                    ru: 'Только крупные патчи. Мелкие правки — на странице игры.',
                    en: 'Only major patches. Smaller changes are on game pages.',
                  })
                )
              ) : (
                <>
                  {tr(locale, { ru: 'Только крупные патчи.', en: 'Only major patches.' })}{' '}
                  <Link
                    href="/"
                    className="tap tap-tight font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
                  >
                    {tr(locale, { ru: 'Подключи Steam', en: 'Connect Steam' })}
                  </Link>{' '}
                  {tr(locale, { ru: '— и лента станет про твои игры.', en: 'to make the feed about your games.' })}
                </>
              )}
            </p>
          </div>

          {rest.map((item) => {
            const meta = metas.get(item.appid)
            // Цена и ссылка на игру — только чужим играм общей ленты: в своей
            // библиотеке покупать нечего. Вкладка «популярное» сама по себе
            // не значит «не твоё» — на ней стоят и твои игры, если их патчат
            // (Deep Rock Galactic на 60 часов шёл с ценой 29,99 $). Правило
            // то же, что у полок /explore: своё — без цены.
            const buying = showPopular && !owned.has(item.appid)
            return (
              <PatchRow
                key={`${item.appid}:${item.gid}`}
                item={rowOn(item, meta?.name, locale)}
                meta={feedMeta(meta)}
                nowSec={now}
                changes={countChanges(item.blocks)}
                discovery={buying}
                discount={buying && meta ? discountView(meta, now, { locale }) : null}
                price={buying && meta ? trustedPrice(meta, now) : null}
                priceCc={buying ? (meta?.priceCc ?? null) : null}
                unsold={buying && meta?.storeHidden === true}
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
                  {tr(locale, { ru: 'Ещё в популярных играх', en: 'More in popular games' })}
                </h2>
                <p className="text-sm text-dim">
                  {topupLine(mineCount, locale)}
                </p>
              </div>

              {topup.map((item) => {
                const meta = metas.get(item.appid)
                // Это чужие игры — цена и ссылка на страницу тут уместны.
                // Свои resolveWhatsNew в добивку уже не пускает; проверка здесь
                // — страховка, чтобы цена на своё не держалась на одном месте.
                const buying = !owned.has(item.appid)
                return (
                  <PatchRow
                    key={`${item.appid}:${item.gid}`}
                    item={rowOn(item, meta?.name, locale)}
                    meta={feedMeta(meta)}
                    nowSec={now}
                    changes={countChanges(item.blocks)}
                    discovery={buying}
                    discount={buying && meta ? discountView(meta, now, { locale }) : null}
                    price={buying && meta ? trustedPrice(meta, now) : null}
                    priceCc={buying ? (meta?.priceCc ?? null) : null}
                    unsold={buying && meta?.storeHidden === true}
                  />
                )
              })}
            </>
          ) : null}

          {rss ? <div className="mt-16">{rss}</div> : null}
        </div>
      </Stage>
    </div>
  )
}

/**
 * Подпись над добивкой: сколько было в твоих играх и что ниже. Целой фразой
 * на каждый язык — число стоит в них на разных местах.
 */
function topupLine(mineCount: number, locale: Locale): string {
  const updates = `${mineCount} ${pl(locale, mineCount, {
    ru: ['обновление', 'обновления', 'обновлений'],
    en: ['update', 'updates'],
  })}`
  return tr(locale, {
    ru: `В твоих играх за три месяца — ${updates}. Дальше — то, что патчат прямо сейчас.`,
    en: `${updates} in your games over the last three months. Below is what's being patched right now.`,
  })
}

/**
 * Активная вкладка держится на весе и подчёркивании, а не на цвете: акцента в
 * этой зоне нет по замыслу (--ember здесь белый), и красить выбранную ссылку
 * было бы нечем. Плюс одним цветом состояние и так передавать нельзя.
 *
 * Подпись — в LinkPending: страница force-dynamic и без loading.tsx, переход
 * ждёт сервер, и нажатая вкладка обязана сама показать, что нажата.
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
      <LinkPending>{children}</LinkPending>
    </Link>
  )
}
