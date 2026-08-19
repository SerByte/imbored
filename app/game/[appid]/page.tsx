import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { GameArt } from '@/components/GameArt'
import { GameNews } from '@/components/GameNews'
import { GameShots } from '@/components/GameShots'
import { DiscountEnds, PriceTag } from '@/components/PriceTag'
import { ProgressRing } from '@/components/ProgressRing'
import { SteamLaunch } from '@/components/SteamLaunch'
import { sitemapGames } from '@/lib/db'
import { discountView } from '@/lib/discount'
import { loadGamePage } from '@/lib/gamepage'
import { currencyOf, gameJsonLd, ldScript } from '@/lib/jsonld'
import { ratingOf } from '@/lib/rating'
import { appBaseUrl, getDb, nowSec } from '@/lib/server'
import { STORE_LABEL } from '@/lib/stores'

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
  const { meta, reviewsSummary } = data

  // Описание собираем из того, что на странице и так есть, а не из шаблона:
  // в выдаче должно стоять то, ради чего на неё имеет смысл заходить.
  //
  // Процент — через ratingOf, а не напрямую из сводки: она есть у 14,5 %
  // карточек, и без запасного источника четыре тысячи описаний в выдаче
  // начинались не с оценки, а сразу с тегов.
  const percent = ratingOf(meta, reviewsSummary)?.percent ?? null
  const topTags = Object.entries(meta.tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t]) => t)

  const parts = [
    percent !== null ? `${percent}% положительных отзывов` : null,
    topTags.length ? topTags.join(', ') : null,
    meta.shortDescription?.slice(0, 120),
  ].filter(Boolean)

  const description = parts.length
    ? `${meta.name}: ${parts.join(' · ')}`
    : `${meta.name} — отзывы, теги и патчноуты на русском.`

  const image = meta.art?.header2x ?? meta.art?.header ?? meta.headerImage
  const canonical = `/game/${appid}`

  return {
    title: `${meta.name} — стоит ли играть`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${meta.name} — стоит ли играть`,
      description,
      url: canonical,
      type: 'article',
      ...(image ? { images: [{ url: image, width: 920, height: 430, alt: meta.name }] } : {}),
    },
    twitter: {
      card: image ? 'summary_large_image' : 'summary',
      title: `${meta.name} — стоит ли играть`,
      description,
      ...(image ? { images: [image] } : {}),
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
  // отрицательные appid — кураторский пул других магазинов
  if (!Number.isInteger(appid) || appid === 0) notFound()

  const data = await loadOnce(appid)
  if (!data) notFound()

  const { meta, reviewsSummary, prosCons } = data
  const now = nowSec()
  const deal = discountView(meta, now)
  const rating = ratingOf(meta, reviewsSummary)
  const topTags = Object.entries(meta.tags)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([t]) => t)

  return (
    <div className="flex-1">
      {/*
        Микроразметка карточки — в разметке страницы, а не в generateMetadata:
        Metadata API умеет только те теги, которые знает сам, а ld+json — это
        произвольный <script>. Рекомендация Next ровно такая, см.
        node_modules/next/dist/docs/01-app/02-guides/json-ld.md.

        Собирается из тех же data, что и всё ниже: loadOnce кэширован на запрос,
        второго чтения базы здесь нет.
      */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: ldScript(
            gameJsonLd({
              meta,
              rating,
              baseUrl: appBaseUrl(),
              currency: currencyOf(process.env.STEAM_STORE_CC),
              now,
            }),
          ),
        }}
      />
      {/* hero */}
      <section className="relative overflow-hidden">
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
        */}
        <GameArt
          appid={meta.appid}
          name=""
          headerImage={meta.headerImage ?? null}
          art={meta.art}
          sizes="(min-width: 768px) 380px, 100vw"
          fallback={null}
          className="absolute inset-0 h-full w-full object-cover blur-3xl opacity-30 scale-110"
        />
        <div className="relative mx-auto max-w-5xl px-5 pt-28 pb-10 grid md:grid-cols-[380px_1fr] gap-8 items-start">
          <GameArt
            appid={meta.appid}
            name={meta.name}
            headerImage={meta.headerImage ?? null}
            art={meta.art}
            sizes="(min-width: 768px) 380px, 100vw"
            eager
            className="w-full aspect-[460/215] object-cover rounded-[20px] border border-edge anim-reveal"
          />
          <div className="flex flex-col gap-4 anim-rise">
            <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight">{meta.name}</h1>
            {/*
              Оценка приходит из ratingOf, а не из сводки напрямую.

              Замер по проду: reviews_summary_json есть у 726 карточек из 5000,
              а reviews_percent с reviews_total — у всех 5000, в той же строке
              и тем же запросом. То есть кольцо не рисовалось на 85 % страниц
              не потому, что оценки нет, а потому что её искали в одном месте
              из двух.

              Словесная подпись остаётся привязанной к сводке и появляется
              только с ней: пороги Steam зависят ещё и от числа отзывов, и
              вычислять их за него значило бы показать оценку, которой на
              странице игры в самом магазине может не быть. Без подписи строка
              читается ничуть не хуже — кольцо и есть её подлежащее:
              «86 % · из 2 593 099 отзывов — за».
            */}
            {rating && (
              <div className="flex items-center gap-3.5 text-sm">
                {/* Процент — это и есть содержание строки, а рисовался обычным
                    текстом, хотя кольцо у приложения уже есть (на /compat). */}
                <ProgressRing percent={rating.percent} size={56} stroke={4} duration={800} />
                <div className="flex flex-col gap-0.5">
                  {rating.label && (
                    <span className="text-ember-text font-medium">
                      {SCORE_RU[rating.label] ?? rating.label}
                    </span>
                  )}
                  <span className="font-mono text-dim text-xs">
                    из {rating.total.toLocaleString('ru-RU')} отзывов — за
                  </span>
                </div>
              </div>
            )}
            {topTags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {topTags.map((t) => (
                  <span key={t} className="glass rounded-full px-3 py-1 text-xs text-dim">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {meta.shortDescription && (
              <p className="text-dim leading-relaxed">{meta.shortDescription}</p>
            )}
            <div className="flex flex-wrap gap-3 mt-1">
              {meta.storeUrl ? (
                <a
                  href={meta.storeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[14px] bg-ember text-on-ember font-semibold px-5 py-2.5 hover:brightness-110 transition text-sm"
                >
                  Открыть в {STORE_LABEL[meta.store ?? ''] ?? 'магазине'}
                </a>
              ) : (
                <>
                  <SteamLaunch
                    appid={appid}
                    label="Запустить"
                    mobileLabel="Открыть в Steam"
                    className="rounded-[14px] bg-ember text-on-ember font-semibold px-5 py-2.5 hover:brightness-110 transition text-sm"
                  />
                  {/* на телефоне кнопка выше и так ведёт в магазин — дублировать незачем */}
                  <a
                    href={`https://store.steampowered.com/app/${appid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="hidden md:inline-block rounded-[14px] glass glass-hover px-5 py-2.5 text-sm"
                  >
                    Страница в Steam
                  </a>
                </>
              )}
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${meta.name} обзор`)}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-[14px] glass glass-hover px-5 py-2.5 text-sm text-dim"
              >
                Обзоры на YouTube
              </a>
              {/* Бесплатная игра тоже получает плашку. Условие было «цена больше
                  нуля», и у free-to-play — а это Dota, CS2, Warframe, то есть
                  верх каталога по онлайну — в герое не оказывалось ни цены, ни
                  слова «бесплатно». Читалось это не как «платить не надо», а
                  как «про цену мы ничего не знаем» — то есть ровно тот вопрос,
                  на который страница с заголовком «стоит ли играть» и должна
                  отвечать. PriceTag такой случай умел с самого начала. */}
              {(meta.isFree || (meta.priceFinal !== undefined && meta.priceFinal > 0)) && (
                <span className="rounded-[14px] glass px-5 py-2.5 text-sm flex items-center gap-2">
                  <PriceTag
                    priceFinal={meta.priceFinal ?? null}
                    isFree={meta.isFree}
                    discount={deal}
                    size="hero"
                  />
                  <DiscountEnds discount={deal} />
                </span>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-5xl px-5 pb-16 flex flex-col gap-10">
        {/* pros / cons из реальных отзывов */}
        {/* Сюда доходит только собранное моделью — эвристику отсекает
            loadGamePage, там же объяснено почему. */}
        {prosCons && (prosCons.pros.length > 0 || prosCons.cons.length > 0) && (
          <section className="grid md:grid-cols-2 gap-4">
            {prosCons.pros.length > 0 && (
              <div className="glass rounded-[20px] p-6 anim-rise">
                <h2 className="text-sm font-semibold text-ember-text mb-3">За что любят</h2>
                <ul className="space-y-2 text-sm text-ink/90">
                  {prosCons.pros.map((p) => (
                    <li key={p} className="flex gap-2.5">
                      <span className="text-ember-text">+</span>
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {prosCons.cons.length > 0 && (
              <div className="glass rounded-[20px] p-6 anim-rise" style={{ animationDelay: '80ms' }}>
                <h2 className="text-sm font-semibold text-dim mb-3">За что ругают</h2>
                <ul className="space-y-2 text-sm text-dim">
                  {prosCons.cons.map((c) => (
                    <li key={c} className="flex gap-2.5">
                      <span>−</span>
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
            <h2 className="text-sm font-medium text-dim mb-4">Что нового</h2>
            <GameNews items={data.news} />
          </section>
        )}

        {/* скриншоты */}
        {meta.screenshots && meta.screenshots.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-dim mb-4">Скриншоты</h2>
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
            <h2 className="text-sm font-medium text-dim mb-4">
              Похожие{data.similarTag ? <> · {data.similarTag}</> : null}
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {data.similar.map((g) => (
                <Link
                  key={g.appid}
                  href={`/game/${g.appid}`}
                  className="library-tile glass glass-hover rounded-[14px] overflow-hidden"
                >
                  <GameArt
                    appid={g.appid}
                    name={g.name}
                    headerImage={g.headerImage}
                    art={g.art}
                    sizes="(min-width: 768px) 33vw, 50vw"
                    className="w-full aspect-[460/215] object-cover"
                  />
                  <div className="p-3 text-sm font-semibold leading-tight truncate">{g.name}</div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* /quiz, а не /play: страница кэшируется на сутки и пререндерится, то
            есть про сессию тут знать нечего. Гостя /play разворачивал на
            лендинг через экран прогрева, а квиз работает обоим — участник
            выбирает настроение и попадает в ту же выдачу. */}
        <div>
          <Link href="/quiz" className="text-sm text-dim hover:text-ink transition-colors">
            Подобрать игру под настроение →
          </Link>
        </div>
      </div>
    </div>
  )
}
