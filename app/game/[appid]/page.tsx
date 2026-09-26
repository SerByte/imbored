import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { GameArt } from '@/components/GameArt'
import { GameNews } from '@/components/GameNews'
import { GameShots } from '@/components/GameShots'
import { DiscountEnds, PriceTag } from '@/components/PriceTag'
import { Eyebrow, MetaLine } from '@/components/Labels'
import { PlayersNow } from '@/components/PlayersNow'
import { ProgressRing } from '@/components/ProgressRing'
import { RefundNote } from '@/components/RefundNote'
import { OwnedLaunch } from '@/components/OwnedLaunch'
import { sitemapGames } from '@/lib/db'
import { discountView, trustedPrice } from '@/lib/discount'
import { byline } from '@/lib/byline'
import {
  deadVerdict,
  gameDescription,
  gameTraits,
  isRussianText,
  loadGamePage,
  reviewFacts,
} from '@/lib/gamepage'
import { currencyOf, gameBreadcrumbLd, gameJsonLd, ldScript } from '@/lib/jsonld'
import { OG_SITE } from '@/lib/site'
import { plural } from '@/lib/plural'
import { refundEligible } from '@/lib/refund'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { STORE_LABEL } from '@/lib/stores'
import { tagRu } from '@/lib/tagsru'
import { SectionLabel } from '@/components/Labels'
import { TrailerPreview } from '@/components/TrailerPreview'
import { GameCardBody } from '@/components/GameCard'
import { Icon } from '@/components/Icon'

/**
 * Страница кэшируется на сутки вместо force-dynamic.
 *
 * Это стало возможным ровно потому, что loadGamePage больше не ходит в сеть:
 * пока карточка собиралась из appdetails, appreviews и Claude прямо на рендере,
 * кэшировать было нечего — каждый заход и был той самой работой. Теперь всё
 * тяжёлое наполняет крон (lib/pagejob.ts), а страница только читает базу,
 * поэтому сутки жизни кэша ничего не устаревают заметно.
 */
export const revalidate = 86_400

/**
 * Обязателен, и не ради предрендера.
 *
 * Без generateStaticParams динамический сегмент не попадает в dynamicRoutes
 * манифеста вовсе — то есть `revalidate` выше не значит ничего, и каждый заход
 * рендерится заново (проверено: Cache-Control приходил no-store). Отдаём топ
 * каталога, остальные appid досоздаются по требованию и кэшируются на те же
 * сутки: dynamicParams по умолчанию true.
 *
 * Сборка не должна падать из-за базы: локально и в превью TURSO_DATABASE_URL
 * может быть не задан, и тогда предрендерить просто нечего.
 */
const PRERENDER_TOP = 500

export async function generateStaticParams(): Promise<Array<{ appid: string }>> {
  try {
    const games = await sitemapGames(await getDb(), PRERENDER_TOP)
    return games.map((g) => ({ appid: String(g.appid) }))
  } catch {
    return []
  }
}

/** generateMetadata и сам компонент рендерят один запрос — читаем базу однажды. */
const loadOnce = cache(loadGamePage)

export async function generateMetadata({
  params,
}: {
  params: Promise<{ appid: string }>
}): Promise<Metadata> {
  const { appid: raw } = await params
  const appid = Number(raw)
  if (!Number.isInteger(appid) || appid === 0) return {}

  const data = await loadOnce(appid)
  if (!data) return {}
  const { meta, reviewsSummary, prosCons } = data

  // Описание собираем из того, что на странице и так есть, а не из шаблона:
  // в выдаче должно стоять то, ради чего на неё имеет смысл заходить.
  // Правила длины и языка — в gameDescription, там же почему.
  const description = gameDescription({
    meta,
    facts: reviewFacts(meta, reviewsSummary),
    prosCons,
    verdict: deadVerdict(meta),
  })

  const canonical = `/game/${appid}`

  /*
   * Картинки здесь больше нет, и это не потеря, а переезд. Раньше в openGraph
   * подставлялся сырой header-файл из Steam 920×430: чужая пропорция, которую
   * мессенджеры режут по краям, без названия поверх и без единого следа
   * imbored. Теперь карточку рисует opengraph-image.tsx рядом — арт во всю
   * карточку, скрим и текст, как на самой странице.
   *
   * Оставлять здесь images было нельзя даже «на всякий случай»: файловая
   * метадата приоритетнее объекта metadata, так что эти строки всё равно
   * никогда бы не применились — они бы только врали читающему код.
   */
  /*
   * Записи, которые каталог сам считает мёртвыми, не идут в индекс.
   *
   * Замер по проду 20 августа: 181 карточка с alive = 0, шесть с
   * superseded_by и четыре без тегов — 191 адрес, отдающий 200. В карте сайта
   * их нет (ALIVE_POOL), в блоке «Похожие» тоже (тот же предикат) — то есть
   * это страницы-сироты, живущие только по прямой ссылке. Соседний lib/junk
   * прячет ровно эти записи от выдачи, а поиск про них ничего не знал.
   *
   * Шесть замещённых опаснее прочих: это дубликаты страницы-преемника
   * (/game/10 против /game/730) с self-canonical. Им canonical переставляется
   * на преемника — тогда вес ссылки достаётся живой странице, а не близнецу.
   *
   * Безтеговые сюда же, и раньше их не было: докблок считал их частью тех же
   * 191, а условие ловило 187. Разница видна на самой странице. Замер на
   * развёрнутой ветке: /game/43160 и /game/623990 отдают 397 и 427 видимых
   * символов при 2342 у обычной карточки, ноль разделов, ноль похожих — а в
   * сниппете при этом стоит «отзывы, теги и патчноуты», то есть страница
   * обещает поиску ровно то, чего у неё нет. Тег — это то, из чего собраны и
   * похожие, и половина текста; без него карточки нет.
   *
   * Условие пересчитывается на каждый рендер, а страница живёт на ISR: игра,
   * у которой теги появятся, вернётся в индекс сама.
   */
  const мёртвая =
    meta.alive === false ||
    meta.supersededBy !== undefined ||
    Object.keys(meta.tags).length === 0
  const canonicalUrl = meta.supersededBy !== undefined ? `/game/${meta.supersededBy}` : canonical

  return {
    title: `${meta.name} — стоит ли играть`,
    description,
    alternates: { canonical: canonicalUrl },
    ...(мёртвая ? { robots: { index: false, follow: true } } : {}),
    openGraph: {
      ...OG_SITE,
      title: `${meta.name} — стоит ли играть`,
      description,
      url: canonicalUrl,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${meta.name} — стоит ли играть`,
      description,
    },
  }
}

const SCORE_RU: Record<string, string> = {
  'Overwhelmingly Positive': 'Крайне положительные',
  'Very Positive': 'Очень положительные',
  Positive: 'Положительные',
  'Mostly Positive': 'В основном положительные',
  Mixed: 'Смешанные',
  'Mostly Negative': 'В основном отрицательные',
  Negative: 'Отрицательные',
  'Very Negative': 'Очень отрицательные',
  'Overwhelmingly Negative': 'Крайне отрицательные',
}

export default async function GamePage({ params }: { params: Promise<{ appid: string }> }) {
  const { appid: raw } = await params
  const appid = Number(raw)
  /*
   * Оба notFound() дают настоящий 404 только потому, что над страницей нет
   * границы Suspense: ни корневого loading.tsx, ни своего. С ними сервер
   * успевал отдать каркас со статусом 200, и /game/abc уходил в поиск мягким
   * 404. Каркас сюда не возвращать — см. lib/firstpaint.test.ts.
   */
  // отрицательные appid — кураторский пул других магазинов
  if (!Number.isInteger(appid) || appid === 0) notFound()

  const data = await loadOnce(appid)
  if (!data) notFound()

  const { meta, reviewsSummary, prosCons } = data
  const now = nowSec()
  const deal = discountView(meta, now)
  // null — цене верить нечему (сгоревшая распродажа), см. trustedPrice. Плашку
  // тогда не рисуем вовсе: пустое стекло в герое хуже отсутствия цены.
  const price = trustedPrice(meta, now)
  // Страница публичная и не знает, куплена ли игра у читающего, — поэтому
  // строка про возврат здесь нейтральная, без «не зайдёт»
  const refund = refundEligible(meta, now)
  const studio = byline(meta.developer, meta.releaseYear)
  const facts = reviewFacts(meta, reviewsSummary)
  // Ответ мёртвой игре — он же прячет «Запустить»: звать в пустой матчмейкинг
  // кнопкой запуска значит спорить с собственным вердиктом
  const verdict = deadVerdict(meta)
  const topTags = Object.entries(meta.tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t)
  const traits = gameTraits(meta, data.hook)

  return (
    <div className="flex-1">
      {/*
        Микроразметка карточки — в разметке страницы, а не в generateMetadata:
        Metadata API умеет только те теги, которые знает сам, а ld+json — это
        произвольный <script>. Рекомендация Next ровно такая, см.
        node_modules/next/dist/docs/01-app/02-guides/json-ld.md.

        Собирается из тех же data, что и всё ниже: loadOnce кэширован на запрос,
        второго чтения базы здесь нет.

        Массив в одном теге, а не два тега: у каждой сущности свой @context,
        и JSON-LD такой список разбирает так же, как два отдельных скрипта.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldScript([
            gameJsonLd({
              meta,
              // Та же оценка, что рисует кольцо ниже: у сводки она есть не у
              // всех карточек, и без запасного источника (reviewFacts)
              // aggregateRating доставался лишь малой доле страниц
              rating: facts,
              baseUrl: appBaseUrl(),
              currency: currencyOf(process.env.STEAM_STORE_CC),
              now,
            }),
            gameBreadcrumbLd({ meta, baseUrl: appBaseUrl() }),
          ]),
        }}
      />
      {/* hero */}
      <section className="game-hero relative overflow-hidden">
        {/*
          Подложка берёт ТУ ЖЕ картинку, что и обложка ниже, и это не
          небрежность, а расчёт.

          Здесь стоял variant="hero", то есть library_hero: 231 КБ у Dota 2
          против 38 КБ у header. Изображение при этом проходит blur-3xl
          (радиус 64 пикселя) и opacity-30 — разрешение в нём не значит
          ничего. Правило уже было записано в components/ArtWash.tsx
          («растянутая на весь экран и размытая в кисель»), просто не
          применено здесь.

          sizes повторяет обложку дословно, чтобы браузер выбрал тот же
          файл и взял его из кэша. Не «поменьше», а «тот же самый»: любой
          другой размер — это вторая загрузка вместо нуля байт.

          И eager, как у обложки, — по той же причине. Подложка шире
          обложки, поэтому LCP страницы — она (замер на /game/730: IMG
          blur-3xl, а не обложка 380×178). Ленивая, она ждала раскладки,
          хотя её файл к тому моменту уже лежал в кэше: браузер откладывал
          не загрузку, а показ. Тот же URL делает eager бесплатным — байт
          это не добавляет ни одного.

          fetchPriority="high" — у обеих картинок героя, и не для красоты.
          React выносит неленивые картинки в <link rel="preload"> и склеивает
          одинаковые по srcSet и sizes в один, а приоритет берёт у ПЕРВОЙ
          встреченной. Первой в разметке стоит подложка: без приоритета у неё
          preload уходил бы в общую очередь, сколько ни ставь его обложке.
          Сторожит lib/herolcp.test.ts.
        */}
        <GameArt
          appid={meta.appid}
          name=""
          headerImage={meta.headerImage ?? null}
          art={meta.art}
          sizes="(min-width: 1024px) 380px, 100vw"
          eager
          fetchPriority="high"
          fallback={null}
          className="absolute inset-0 h-full w-full object-cover blur-3xl opacity-60 scale-125"
        />
        {/* Скрим «Премьеры»: подложка — цветной свет игры, а не пятно; текст
            слева и низ стоят на ровном тёмном, как у героя выдачи */}
        <div aria-hidden className="game-hero-scrim" />
        {/*
          Разрез на две колонки с lg, а не с md: раньше он включался там, где
          ещё вредил.

          Замер на 768px: контейнер 728, из него 380 забирает арт и 32 зазор —
          правой колонке остаётся 316. Это УЖЕ, чем одна колонка на телефоне
          (335 на 375px). В неё восемь тегов ложились в три ряда, описание в
          шесть строк, четыре кнопки в три ряда, а слева под коротким артом
          зияла пустота почти на 470×400.

          Одной колонкой на той же ширине: арт баннером 727×340, все восемь
          тегов в ряд, описание в три строки, все кнопки в ряд, пустоты нет.

          Десктоп не тронут: max-w-5xl держит контейнер на 984, и с 1024 разрез
          даёт те же 380 и 572, что и до правки.

          Порог в sizes у обеих картинок героя сдвинут вместе с разрезом: между
          768 и 1024 арт теперь во всю ширину, и подсказка «380px» дала бы
          браузеру выбрать файл вдвое мельче слота.

          Приоритет у обложки тот же, что у подложки выше, и должен
          совпадать: запрос у них один, и ни одна из двух не имеет права
          сказать браузеру «можно позже».
        */}
        <div className="relative mx-auto max-w-5xl px-5 pt-28 pb-12 lg:pt-32 lg:pb-16 grid lg:grid-cols-[380px_1fr] gap-8 lg:gap-12 items-start">
          <GameArt
            appid={meta.appid}
            name={meta.name}
            headerImage={meta.headerImage ?? null}
            art={meta.art}
            sizes="(min-width: 1024px) 380px, 100vw"
            eager
            fetchPriority="high"
            className="game-cover w-full aspect-[460/215] object-cover anim-reveal"
          />
          <div className="flex flex-col gap-4 anim-rise">
            <h1 className="font-display text-display-lg">{meta.name}</h1>
            {/*
              Студия и год. Оба поля заполнены у ВСЕХ игр каталога (1000 из
              1000, проверено запросом), а страница не показывала ни одного из
              них — при том что лента «Что нового» показывает эту же подпись
              под каждым патчем. То есть продукт знал, как это сказать, и
              говорил везде, кроме главной публичной страницы.

              Для вопроса «стоит ли играть» это самый быстрый опознавательный
              знак: «Gearbox Software · 1999» сразу говорит, что за вещь перед
              тобой, — быстрее тегов и раньше процента.

              MetaLine, а не свои классы: роль ровно её — строка фактов через
              разделитель.
            */}
            {(studio || meta.ccu) && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {studio && <MetaLine>{studio}</MetaLine>}
                {/*
                  Живой онлайн есть у 563 игр из тысячи, и показывали его четыре
                  экрана — выдача, игра дня, колода пати и лента, — но не эта
                  страница. А «стоит ли играть» для мультиплеера решается именно
                  им: у игры 2011 года бывает и двести тысяч человек, и двести.

                  Часы — не момент рендера, а последний момент, когда этот
                  рендер ещё могут показать: страница живёт в кэше сутки
                  (revalidate выше), и «сейчас», верное при сборке, к вечеру
                  было бы тем же неправдивым утверждением, ради которого
                  PlayersNow и спрашивает возраст замера.
                */}
                <PlayersNow ccu={meta.ccu ?? null} ccuAt={meta.ccuAt} nowSec={now + revalidate} />
              </p>
            )}
            {/*
              Оценка собирается из того, что есть: сводка точнее, но её нет у
              278 игр из тысячи — там числа берутся из колонок, заполненных у
              всех. Раньше блок целиком висел на сводке, и почти треть страниц
              не отвечала на вопрос из собственного заголовка.

              Слово — только из сводки. Проценты и количество мы пересказываем,
              а словесную шкалу Steam придумывать за неё нельзя; без сводки
              рядом с кольцом остаётся «из N отзывов — за», и этого хватает —
              процент уже стоит внутри кольца.
            */}
            {facts && (
              <div className="flex items-center gap-3.5 text-sm">
                <ProgressRing
                  percent={facts.percent}
                  size={56}
                  stroke={4}
                  duration={800}
                  ariaLabel={`${facts.percent}% из ${facts.total.toLocaleString('ru-RU')} ${plural(facts.total, 'отзыва', 'отзывов', 'отзывов')} — положительные`}
                />
                <div className="flex flex-col gap-0.5">
                  {facts.label && (
                    <span className="text-ember-text font-medium">
                      {SCORE_RU[facts.label] ?? facts.label}
                    </span>
                  )}
                  <span className="tabular-nums text-dim text-xs">
                    из {facts.total.toLocaleString('ru-RU')} {plural(facts.total, 'отзыва', 'отзывов', 'отзывов')} — за
                  </span>
                </div>
              </div>
            )}
            {/*
              Вердикт мёртвой игре — сразу под оценкой, выше тегов: это и есть
              ответ на вопрос из заголовка, а теги и описание — справка к нему.
              role="note": скринридер объявит его как примечание к карточке, а
              не как очередной абзац описания.
            */}
            {verdict && (
              <div role="note" className="panel-lift px-4 py-3 flex flex-col gap-1">
                <Eyebrow>Сейчас не советуем</Eyebrow>
                <p className="text-sm leading-relaxed">{verdict}</p>
              </div>
            )}
            {/* Жанры строкой через точку, как под названием у стриминга */}
            {topTags.length > 0 && (
              <p className="text-sm font-semibold text-ink/80">{topTags.map((t) => tagRu(t)).join(' · ')}</p>
            )}
            {/*
              Чем игра выделяется и сколько длится заход — без модели: первое
              из редких тегов Steam (lib/hook), второе из семантики по тегам и
              отзывам (lib/semantics). Под тегами, потому что первая строка их
              и объясняет: из восьми чипсов — вот эти два про неё.

              Строки нет, когда сказать честно нечего: общие теги, непрогретая
              карта тегов, семантика по одним тегам (см. SESSION_MIN_CONFIDENCE).
              dl, а не абзацы: это пары «подпись — значение», и скринридер
              читает их парами.
            */}
            {traits.length > 0 && (
              <dl className="flex flex-col gap-1 text-sm">
                {traits.map((t) => (
                  <div key={t.label} className="flex flex-wrap gap-x-2">
                    <dt className="text-dim">{t.label}:</dt>
                    <dd>{t.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {/* Описание у трёх карточек из четырёх английское (каталог берёт
                его у магазина по-английски, см. isRussianText). Без lang его
                читали русским голосом — латиницу по-русски. */}
            {meta.shortDescription && (
              <p
                lang={isRussianText(meta.shortDescription) ? undefined : 'en'}
                className="text-dim leading-relaxed"
              >
                {meta.shortDescription}
              </p>
            )}
            <div className="flex flex-wrap gap-3 mt-1">
              {meta.storeUrl ? (
                <a
                  href={meta.storeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-ember px-6 py-3"
                >
                  Открыть в {STORE_LABEL[meta.store ?? ''] ?? 'магазине'}
                </a>
              ) : (
                <>
                  {/*
                    Главная кнопка — страница магазина, а не запуск.

                    «Запустить» (steam://run) стояла здесь у каждого: у гостя из
                    поиска и у вошедшего, у которого игры нет. Страница общая и
                    живёт на ISR, про сессию не знает — вот и предлагала запуск
                    всем. Теперь запуск дорисовывает OwnedLaunch и только
                    владельцу, а общая часть разметки говорит то, что верно для
                    любого читателя.

                    Мёртвой игре и магазин — справка, а не призыв: без заливки
                    и без запуска, спорить с собственным вердиктом кнопкой
                    незачем.
                  */}
                  <a
                    href={`https://store.steampowered.com/app/${appid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className={verdict ? 'btn-glass' : 'btn-ember px-6 py-3'}
                  >
                    Страница в Steam
                  </a>
                  {!verdict && (
                    <OwnedLaunch appid={appid} className="btn-glass" />
                  )}
                </>
              )}
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${meta.name} обзор`)}`}
                target="_blank"
                rel="noreferrer"
                className="btn-glass"
              >
                <Icon name="play" size={16} />
                Обзоры на YouTube
              </a>
              {/* Бесплатная игра тоже получает плашку. Условие было «цена больше
                  нуля», и у free-to-play — а это Dota, CS2, Warframe, то есть
                  верх каталога по онлайну — в герое не оказывалось ни цены, ни
                  слова «бесплатно». Читалось это не как «платить не надо», а
                  как «про цену мы ничего не знаем» — то есть ровно тот вопрос,
                  на который страница с заголовком «стоит ли играть» и должна
                  отвечать. PriceTag такой случай умел с самого начала. */}
              {(meta.isFree || (price !== null && price > 0)) && (
                <span className="glass rounded-[11px] px-5 py-3 text-sm flex items-center gap-2">
                  <PriceTag
                    priceFinal={price}
                    isFree={meta.isFree}
                    discount={deal}
                    size="hero"
                  />
                  <DiscountEnds discount={deal} />
                </span>
              )}
            </div>
            {refund && <RefundNote tone="neutral" />}
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5 pb-16 flex flex-col gap-10">
        {/*
          Как игра выглядит в движении — первым под героем, раньше мнений о
          ней: «стоит ли играть» начинается с того, что это вообще такое, а
          единственным способом увидеть это была ссылка на YouTube в герое.

          Микротрейлер Steam, несколько секунд без звука. Ничего не качается,
          пока не нажали, и постер ленивый — см. TrailerPreview. Страница живёт
          на ISR, а островок клиентский и про кэш ничего не знает.
        */}
        {meta.trailer && (
          <section>
            <SectionLabel className="mb-4">В движении</SectionLabel>
            <TrailerPreview trailer={meta.trailer} name={meta.name} className="max-w-3xl" />
          </section>
        )}

        {/* pros / cons из реальных отзывов */}
        {/* Сюда доходит только собранное моделью — эвристику отсекает
            loadGamePage, там же объяснено почему. */}
        {/*
          ХВАЛА И КРИТИКА ОДНОГО ВЕСА.
          Панели стояли парой, а набраны были по-разному: у «любят»
          надзаголовок акцентом, текст --ink/90 и плюс акцентом, у «ругают» —
          всё в --dim. Замерено в браузере: 16.73:1 против 6.00:1, то есть
          критика читалась втрое тише похвалы. На странице, которая называется
          «стоит ли играть» и рядом с кнопкой покупки и скидкой −67%.
          Это оформление, спорящее с обещанием продукта: «рекомендация — это
          доверие, а доверие не продаётся».
          Различают панели теперь заголовок и знак, а не громкость. Цветовой
          валентности нет ни у одной: зелёного и красного в палитре нет
          намеренно — то же правило записано в колоде пати. Заодно ember у
          «любят» был единственным акцентным надзаголовком на странице, где
          все остальные разделы набраны обычным SectionLabel.
        */}
        {prosCons && (prosCons.pros.length > 0 || prosCons.cons.length > 0) && (
          <section className="grid md:grid-cols-2 gap-4">
            {prosCons.pros.length > 0 && (
              <div className="panel-lift p-6 anim-rise">
                <SectionLabel className="mb-3">За что любят</SectionLabel>
                <ul className="space-y-2 text-sm text-ink/90">
                  {prosCons.pros.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <span className="text-faint">+</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {prosCons.cons.length > 0 && (
              <div className="panel-lift p-6 anim-rise" style={{ animationDelay: '80ms' }}>
                <SectionLabel className="mb-3">За что ругают</SectionLabel>
                <ul className="space-y-2 text-sm text-ink/90">
                  {prosCons.cons.map((c) => (
                    <li key={c} className="flex gap-2.5">
                      <span className="text-faint">−</span>
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* Ветка «Цитаты из отзывов» ушла вместе с показом эвристики:
                сюда доходит только собранное моделью. */}
            <p className="md:col-span-2 text-[11px] text-faint">
              Собрано ИИ из самых полезных отзывов Steam
            </p>
          </section>
        )}

        {/* что нового — здесь показываем и мелкие патчи тоже,
            фильтр «только крупные» действует лишь в общей ленте */}
        {data.news.length > 0 && (
          <section>
            <SectionLabel className="mb-4">Что нового</SectionLabel>
            <GameNews items={data.news} name={meta.name} />
          </section>
        )}

        {/* скриншоты */}
        {meta.screenshots && meta.screenshots.length > 0 && (
          <section>
            <SectionLabel className="mb-4">Скриншоты</SectionLabel>
            {/* сколько кадров показывать, решает сам блок: это упирается в
                бюджет видеопамяти слайдера, а не в вёрстку страницы */}
            <GameShots images={meta.screenshots} name={meta.name} />
          </section>
        )}

        {/* Похожие: единственная перелинковка между пятью тысячами карточек.
            До неё страница была тупиком — из поиска сюда приходили и упирались
            в ссылку на /play, которая гостя разворачивала на лендинг. */}
        {data.similar.length > 0 && (
          <section>
            <SectionLabel className="mb-4">
              Похожие{data.similarTag ? <> · {tagRu(data.similarTag)}</> : null}
            </SectionLabel>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-6">
              {data.similar.map((g) => (
                <Link key={g.appid} href={`/game/${g.appid}`} className="game-card block">
                  <GameCardBody
                    appid={g.appid}
                    name={g.name}
                    headerImage={g.headerImage}
                    art={g.art}
                    sizes="(min-width: 768px) 33vw, 50vw"
                    /* Чем похожи — у готовых соседей: заголовок блока у них без
                       тега, и без этой строки «похожие» было бы голословным */
                    meta={
                      g.shared && g.shared.length > 0 ? (
                        <span className="truncate">общее: {g.shared.slice(0, 2).map(tagRu).join(', ')}</span>
                      ) : undefined
                    }
                  />
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* /quiz, а не /play: страница кэшируется на сутки и пререндерится, то
            есть про сессию тут знать нечего. Гостя /play разворачивал на
            лендинг через экран прогрева, а квиз работает обоим — участник
            выбирает настроение и попадает в ту же выдачу. */}
        {/*
          Настоящая кнопка, а не подпись.

          Замер на проде, Cyberpunk 2077: из двенадцати ссылок страницы пять
          уводят наружу — в Steam и на YouTube, — шесть ведут на соседние
          карточки, и РОВНО ОДНА ведёт в продукт. Она же была единственной без
          подложки, цветом --dim и видимой высотой 18px (зону пальца ей
          добавлял .tap, но не вид), то есть самой тихой на странице. Две
          заметные кнопки уводили со страницы, самая тихая — внутрь.

          Это точка конверсии всей поисковой воронки: пять тысяч карточек
          существуют затем, чтобы человек, спросивший «стоит ли играть»,
          получил ответ и остался. Соседняя правка (свёрнутые патчи) подняла
          её с 96% глубины страницы примерно до половины; вес — вторая
          половина того же вопроса.

          Ember тут не спорит с «Страница в Steam»: та кнопка лежит пятью
          экранами выше, и на своём месте каждая единственная.
        */}
        <div>
          {/* btn-ember — тот же класс и размер, что у «Страница в Steam» выше:
              вид парадной кнопки на сайте один, и своя заливка здесь
              разъехалась бы с ним на первой же правке. */}
          <Link href="/quiz" className="btn-ember px-6 py-3">
            Подобрать игру под настроение <Icon name="arrow" className="ml-1.5 inline-block align-[-0.125em]" />
          </Link>
        </div>
      </div>
    </div>
  )
}
