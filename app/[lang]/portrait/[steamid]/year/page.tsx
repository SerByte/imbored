import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import * as m from 'framer-motion/m'
import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import { cache, type ReactNode } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { CardDownload } from '@/components/CardDownload'
import { GameArt } from '@/components/GameArt'
import { GameCardBody } from '@/components/GameCard'
import { GameLink } from '@/components/GameLink'
import { Icon } from '@/components/Icon'
import { Eyebrow, eyebrow } from '@/components/Labels'
import { ShareLinkField } from '@/components/ShareLink'
import { Wordmark } from '@/components/Wordmark'
import {
  getGamesMetaLite,
  getLatestSnapshot,
  getLibraryBaselines,
  getPersonaName,
} from '@/lib/db'
import { reconnectHref } from '@/lib/destination'
import { playedLine } from '@/lib/outcome'
import { plural } from '@/lib/plural'
import { buildYearModel, portraitTag, type YearModel } from '@/lib/portraitmodel'
import { checkRate, clientIp } from '@/lib/ratelimit'
import { appBaseUrl, currentSteamId, getDb, nowSec } from '@/lib/server'
import { fmtNumber, lp, pl, toLocale, tr, type Locale } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
import { withRef } from '@/lib/track'
import type { LibraryGame } from '@/lib/types'
import { pickYearWindow, yearCandidates, yearEyebrow, yearsToRead } from '@/lib/wrapped'
import { langOn, ogImageOn, playerName, SnapshotDates } from '../portrait-text'

export const dynamic = 'force-dynamic'

// Предел явно, как у портрета: страница ходит в базу за отметкой года
export const maxDuration = 60

/*
 * Потолок на холодную сборку — общий с портретом ведром 'portrait-build-ip':
 * это та же дверь (публичный адрес с чужим steamid), и скрипт, перебирающий
 * адреса, не должен получить вторую квоту, сменив хвост ссылки.
 */
const YEAR_BUILD_IP_LIMIT = 60
const YEAR_BUILD_WINDOW_SEC = 600

/** Срок итогов в кэше: ключ меняется со снапшотом, сутки — ради метаданных, доехавших позже */
const YEAR_TTL_SEC = 86_400

/** Постеров в стене героя — та же стена, что у портрета */
const YEAR_WALL = 32

/* Снапшот и ник — один раз на запрос, общие для метаданных и страницы */
const snapshotOf = cache(async (steamid: string) => getLatestSnapshot(await getDb(), steamid))
const personaOf = cache(async (steamid: string) => getPersonaName(await getDb(), steamid))

export async function generateMetadata({
  params,
}: {
  params: Promise<{ steamid: string; lang?: string }>
}): Promise<Metadata> {
  const { steamid, lang } = await params
  const locale = toLocale(lang)
  const url = `/portrait/${steamid}/year`
  // Битый адрес — как у портрета: на /en своя картинка ради английского alt
  if (!/^\d{17}$/.test(steamid)) {
    return locale === 'en'
      ? { openGraph: { type: 'website', ...ogSite(locale), ...ogImageOn(locale, url, 'Year in review — imbored') } }
      : {}
  }

  // Ник от снапшота не зависит — читаем вместе; страница возьмёт оба из cache()
  const [snapshot, persona] = await Promise.all([snapshotOf(steamid), personaOf(steamid)])
  if (!snapshot) {
    return {
      title: tr(locale, { ru: 'Итоги года', en: 'Year in review' }),
      robots: { index: false },
      // На /en и у заглушки своя картинка — ради английского alt (ogImageOn);
      // поля — те же, что дал бы корень. Русская заглушка — как была
      ...(locale === 'en'
        ? {
            openGraph: {
              type: 'website' as const,
              ...ogSite(locale),
              url: lp(locale, url),
              ...ogImageOn(locale, url, 'Year in review — imbored'),
            },
          }
        : {}),
    }
  }

  const name = playerName(steamid, persona, locale)
  const title = tr(locale, { ru: `Итоги года — ${name}`, en: `Year in review — ${name}` })
  const description = tr(locale, {
    ru: 'Сколько наиграно за год, какие игры впервые запущены и какие появились в библиотеке — по снимкам Steam.',
    en: 'Hours played this year, games launched for the first time and games added to the library — from Steam snapshots.',
  })

  // Отметку года здесь не читаем: метаданные рендерятся мимо кэша итогов, а
  // без отметки закрытый год не узнать — описание честное и без чисел
  return {
    title,
    description,
    alternates: localeAlternates(locale, url),
    // Как у портрета: в переписку по ссылке — да, в поисковую выдачу — нет
    robots: { index: false, follow: true },
    openGraph: {
      ...ogSite(locale),
      title,
      description,
      type: 'profile',
      url: lp(locale, url),
      ...ogImageOn(locale, url, 'Year in review — imbored'),
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

const EASE = [0.22, 1, 0.36, 1] as const

/** Появление ниже сгиба — те же настройки, что у портрета */
const inView = (i = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.45, ease: EASE, delay: i * 0.05 },
})

/** Адрес исчерпал холодные сборки. Бросается ИЗ кэшируемой функции: такой результат кэшу не достаётся */
class ColdBuildLimited extends Error {}

/**
 * Итоги — из кэша по снапшоту, холодная сборка — под потолком.
 *
 * Своё замыкание и свой ключ, а не модель портрета: странице года нужна мета
 * только игр года (yearCandidates), а не всей библиотеки. Тег тот же —
 * portraitTag: удаление данных и бан сбрасывают и портрет, и итоги.
 * После удаления по запросу запись недостижима: снапшот читается до кэша.
 *
 * null — сравнивать не с чем (первый заход в году) или сказать нечего.
 */
async function loadYear(
  steamid: string,
  snapshot: { takenAt: number; games: LibraryGame[] },
  ip: string,
  now: number,
): Promise<YearModel | null | 'limited'> {
  const build = unstable_cache(
    async (): Promise<YearModel | null> => {
      const db = await getDb()
      const gate = await checkRate(db, {
        bucket: 'portrait-build-ip',
        id: ip,
        limit: YEAR_BUILD_IP_LIMIT,
        windowSec: YEAR_BUILD_WINDOW_SEC,
        nowSec: now,
      })
      if (!gate.ok) throw new ColdBuildLimited()
      // Год — от снапшота, а не от часов сервера: ключ кэша — снапшот
      const [fromYear, toYear] = yearsToRead(snapshot.takenAt)
      const baselines = await getLibraryBaselines(db, steamid, fromYear, toYear)
      const window = pickYearWindow(snapshot, baselines)
      if (!window) return null
      const metas = await getGamesMetaLite(db, yearCandidates(window))
      return buildYearModel(window, (id) => metas.get(id))
    },
    // v2 — признак скрытого времени (year.playtimeHidden): запись v1 без него
    // сутки подписывала бы новые игры «не запускалась»
    ['portrait-year:v2', steamid, String(snapshot.takenAt)],
    { tags: [portraitTag(steamid)], revalidate: YEAR_TTL_SEC },
  )
  try {
    return await build()
  } catch (err) {
    if (!(err instanceof ColdBuildLimited)) throw err
    return 'limited'
  }
}

export default async function YearPage({ params }: { params: Promise<{ steamid: string; lang?: string }> }) {
  const { steamid, lang } = await params
  // Язык — из params, как в generateMetadata: next/root-params и страницы без маршрута (тесты) не дружат
  const locale = toLocale(lang)
  if (!/^\d{17}$/.test(steamid)) notFound()

  const snapshot = await snapshotOf(steamid)
  if (!snapshot) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">
          {tr(locale, {
            ru: 'Этот игрок ещё не подключал библиотеку к imbored.',
            en: "This player hasn't connected their library to imbored yet.",
          })}
        </p>
        <Link href={reconnectHref()} className="tap link-more">
          {tr(locale, { ru: 'Подключить свою', en: 'Connect your library' })}
          <Icon name="arrow" size={16} />
        </Link>
      </div>
    )
  }

  // Ник и сессия от итогов не зависят — ждутся вместе с ними, а не после
  // (тот же довод, что у портрета). После проверки снапшота: без него ответ —
  // заглушка, и заранее начатые чтения были бы оплачены зря
  const ip = clientIp(await headers())
  const [loaded, persona, me] = await Promise.all([
    loadYear(steamid, snapshot, ip, nowSec()),
    personaOf(steamid),
    currentSteamId(),
  ])
  const name = playerName(steamid, persona, locale)
  // Русский ник на /en — с lang="ru" (langOn); на русской странице — без атрибута
  const nameLang = langOn(locale, name)
  const isMine = me === steamid
  // Счёт в заголовках: по-английски — с разрядами, по-русски — как был, голым числом
  const count = (n: number) => (locale === 'en' ? fmtNumber(locale, n) : n)

  if (loaded === null || loaded === 'limited') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
        <Eyebrow>{tr(locale, { ru: 'Итоги года', en: 'Year in review' })}</Eyebrow>
        <p className="text-lg max-w-md">
          {loaded === 'limited'
            ? tr(locale, {
                ru: 'С этого адреса сейчас открывают слишком много итогов подряд. Загляни через несколько минут.',
                en: 'Too many year reviews are being opened from this address right now. Check back in a few minutes.',
              })
            : isMine
              ? tr(locale, {
                  ru: 'Итоги начнут считаться со следующего снимка библиотеки: сравнивать пока не с чем.',
                  en: "Your year in review starts with the next library snapshot: there's nothing to compare yet.",
                })
              : tr<ReactNode>(locale, {
                  ru: `У игрока ${name} считать итоги пока не из чего.`,
                  en: (
                    <>
                      There&apos;s not enough data for <span lang={nameLang}>{name}</span>&apos;s year in review yet.
                    </>
                  ),
                })}
        </p>
        <Link href={`/portrait/${steamid}`} prefetch={false} className="tap link-more">
          {tr(locale, { ru: 'К портрету', en: 'See the portrait' })}
          <Icon name="arrow" size={16} />
        </Link>
      </div>
    )
  }

  const { year, covers } = loaded
  const cover = (g: { appid: number }) => ({
    headerImage: covers[g.appid]?.headerImage ?? null,
    art: covers[g.appid]?.art ?? null,
  })
  // Стена героя — игры года по приросту; мало — добирается повтором
  const wallGames = [...year.top, ...year.unpacked.games, ...year.added.games].filter((g) => g.appid > 0)
  const wall = wallGames.length
    ? Array.from({ length: YEAR_WALL }, (_, i) => wallGames[i % wallGames.length])
    : []

  return (
    <div className="flex-1">
      {/* ——— 1. Год одним экраном ——— */}
      <section className="media-dark relative flex min-h-[80svh] flex-col justify-end overflow-hidden">
        {wall.length > 0 && (
          <div aria-hidden className="portrait-wall">
            {wall.map((g, i) => (
              <span key={i} className="portrait-wall-cell">
                <GameArt
                  appid={g.appid}
                  name={g.name}
                  {...cover(g)}
                  variant="poster"
                  sizes="(min-width: 768px) 12vw, 25vw"
                  eager={i < 8}
                  fallback={null}
                  className="h-full w-full object-cover"
                />
              </span>
            ))}
          </div>
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, #050505 8%, rgba(5,5,5,0.88) 34%, rgba(5,5,5,0.5) 66%, rgba(5,5,5,0.55) 100%)',
          }}
        />
        <BlurBand height="42vh" dir="up" />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto w-full max-w-6xl px-safe pb-16 pt-40">
          <Eyebrow className="mb-3">{yearEyebrow(year, locale)}</Eyebrow>
          <h1 lang={nameLang} className="font-display text-display-xl">
            {name}
          </h1>
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            {/* Подписи под числами — не шире русских: три числа стоят в строку */}
            {year.minutes > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">{tr(locale, { ru: 'наиграно', en: 'played' })}</dt>
                <dd className="lib-stat text-ember-text">{playedLine(year.minutes, locale)}</dd>
              </div>
            )}
            {year.unpacked.count > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">
                  {tr(locale, {
                    ru: plural(year.unpacked.count, 'впервые запущена', 'впервые запущены', 'впервые запущено'),
                    en: 'first launched',
                  })}
                </dt>
                <dd className="lib-stat">{fmtNumber(locale, year.unpacked.count)}</dd>
              </div>
            )}
            {year.added.count > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">
                  {tr<ReactNode>(locale, {
                    ru: <>{plural(year.added.count, 'появилась', 'появились', 'появилось')} в библиотеке</>,
                    en: 'added to library',
                  })}
                </dt>
                <dd className="lib-stat">{fmtNumber(locale, year.added.count)}</dd>
              </div>
            )}
          </dl>
          {/*
            Две честные даты. Steam отдаёт только часы за всё время, поэтому
            год — это разница двух снимков: отметки при первом за год заходе
            и последнего снимка. Чего сервис не видел, того в итогах нет.
          */}
          <p className="mt-6 max-w-md text-dim text-sm">
            <SnapshotDates year={year} locale={locale} />
          </p>
        </div>
      </section>

      {/* ——— 2. Игры года ——— */}
      {year.top.length > 0 && (
        <section className="relative mx-auto w-full max-w-5xl px-safe py-24 md:py-32">
          <m.p {...inView()} className={`${eyebrow()} mb-3`}>
            {tr(locale, { ru: 'Игры года', en: 'Games of the year' })}
          </m.p>
          <m.h2 {...inView(1)} className="mb-8 font-display text-display-lg">
            {tr(locale, { ru: 'Куда ушёл год', en: 'Where the year went' })}
          </m.h2>
          <div className="flex flex-col gap-3">
            {year.top.map((g, i) => (
              <m.div key={g.appid} {...inView(i)} className="flex items-center gap-4">
                <span className="portrait-rank w-7 shrink-0">{i + 1}</span>
                <GameLink
                  appid={g.appid}
                  aria-label={g.name}
                  lang={langOn(locale, g.name)}
                  className="game-card w-28 shrink-0 md:w-44"
                >
                  <span className="card-thumb">
                    <GameArt
                      appid={g.appid}
                      name={g.name}
                      {...cover(g)}
                      sizes="(min-width: 768px) 176px, 112px"
                      className="w-full aspect-[460/215] object-cover"
                    />
                  </span>
                </GameLink>
                <div className="min-w-0 flex-1">
                  <div
                    lang={langOn(locale, g.name)}
                    className="truncate text-[15px] font-extrabold tracking-[-0.01em] md:text-base"
                  >
                    {g.name}
                  </div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-track overflow-hidden">
                    <m.div
                      className="h-full rounded-full bg-ember"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${g.sharePercent}%` }}
                      viewport={{ once: true, margin: '-40px' }}
                      transition={{ duration: 0.9, ease: EASE, delay: i * 0.06 }}
                    />
                  </div>
                </div>
                <span className="shrink-0 text-sm font-bold tabular-nums text-dim">+{playedLine(g.minutes, locale)}</span>
              </m.div>
            ))}
          </div>
        </section>
      )}

      {/* ——— 3. Распакованное ——— */}
      {year.unpacked.games.length > 0 && (
        <YearShelf
          locale={locale}
          eyebrowText={tr(locale, { ru: 'Из бэклога', en: 'From the backlog' })}
          heading={
            <>
              <span className="tabular-nums text-ember-text">{count(year.unpacked.count)}</span>{' '}
              {pl(locale, year.unpacked.count, {
                ru: ['игра впервые запущена', 'игры впервые запущены', 'игр впервые запущено'],
                en: ['game launched for the first time', 'games launched for the first time'],
              })}
            </>
          }
          note={tr(locale, {
            ru: 'Лежали с нулём минут на начало окна — и дождались.',
            en: 'They sat at zero minutes when the window opened, and their turn finally came.',
          })}
          more={year.unpacked.count > year.unpacked.games.length}
          games={year.unpacked.games.map((g) => ({ ...g, meta: `+${playedLine(g.minutes, locale)}` }))}
          cover={cover}
        />
      )}

      {/* ——— 4. Новое в библиотеке ——— */}
      {year.added.games.length > 0 && (
        <YearShelf
          locale={locale}
          eyebrowText={tr(locale, { ru: 'Новое', en: 'New' })}
          heading={
            <>
              <span className="tabular-nums text-ember-text">{count(year.added.count)}</span>{' '}
              {pl(locale, year.added.count, {
                ru: ['игра появилась', 'игры появились', 'игр появилось'],
                en: ['game added', 'games added'],
              })}
              {tr(locale, { ru: ' в библиотеке', en: ' to the library' })}
            </>
          }
          // «Появились», а не «куплены»: покупок сервис не видит, а бесплатные
          // Steam отдаёт только после первого запуска. По-английски — «added»:
          // о покупке оно тоже молчит
          note={tr(locale, {
            ru: 'Появились — не значит куплены: сервис видит библиотеку, а не покупки.',
            en: "Added doesn't mean bought: we see the library, not purchases.",
          })}
          more={year.added.count > year.added.games.length}
          games={year.added.games.map((g) => ({
            appid: g.appid,
            name: g.name,
            // При скрытом времени ноль минут — галочка Steam, и подпись молчит
            meta:
              g.playtimeForever > 0
                ? playedLine(g.playtimeForever, locale)
                : year.playtimeHidden
                  ? ''
                  : tr(locale, { ru: 'не запускалась', en: 'never launched' }),
          }))}
          cover={cover}
        />
      )}

      {/* ——— 5. Финал ——— */}
      <section className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-8 px-safe pb-24 pt-8 text-center">
        {/* Превью — картинка на тот же роут, что и скачивание: лишний рендер
            satori заново тянул бы постеры со Steam. Поэтому скачивание
            считается нажатием (CardDownload), а не на роуте. Адрес — на
            языке страницы: под /en роут рисует английскую карточку */}
        <CardDownload
          what="year"
          href={lp(locale, `/portrait/${steamid}/year/card.png`)}
          download={`imbored-${steamid}-${year.year}.png`}
          className="game-card block w-56"
        >
          <span className="card-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lp(locale, `/portrait/${steamid}/year/card.png`)}
              alt={tr(locale, { ru: 'Карточка итогов года', en: 'Year in review card' })}
              loading="lazy"
              className="w-full aspect-[1080/1350] object-cover"
            />
          </span>
          <span className="link-more mt-3">{tr(locale, { ru: 'Скачать карточку', en: 'Download card' })}</span>
        </CardDownload>
        <Link href={`/portrait/${steamid}`} prefetch={false} className="tap link-more">
          <Icon name="arrow" size={16} className="rotate-180" />
          {isMine
            ? tr(locale, { ru: 'К своему портрету', en: 'Your portrait' })
            : tr<ReactNode>(locale, {
                ru: `К портрету игрока ${name}`,
                // Одним узлом: у .link-more зазор между детьми, и «'s» отъезжал бы от ника
                en: (
                  <span>
                    <span lang={nameLang}>{name}</span>&apos;s portrait
                  </span>
                ),
              })}
        </Link>
        {isMine && (
          <div className="flex w-full flex-col gap-2.5 text-left">
            <p className="text-xs text-dim">
              {tr(locale, {
                ru: 'По этой ссылке увидят твои итоги года и смогут открыть портрет.',
                en: 'Anyone with this link can see your year in review and open your portrait.',
              })}
            </p>
            {/* Адрес — на языке страницы: друг по английской ссылке откроет английскую */}
            <ShareLinkField
              what="year"
              url={withRef(`${appBaseUrl()}${lp(locale, `/portrait/${steamid}/year`)}`, 'portrait')}
              label={tr(locale, { ru: 'Ссылка на твои итоги года', en: 'Link to your year in review' })}
              title={tr(locale, { ru: `Итоги года ${name} — imbored`, en: `${name}'s year in review — imbored` })}
              text={tr(locale, { ru: 'Мои итоги года по библиотеке Steam', en: 'My year in review from my Steam library' })}
            />
          </div>
        )}
        <div className="flex items-center gap-2 text-faint text-xs">
          <Wordmark className="text-sm" /> · imbored.cc
        </div>
      </section>
    </div>
  )
}

/** Полка итогов: заголовок со счётом, сетка обложек, строка «здесь не все» */
function YearShelf({
  locale,
  eyebrowText,
  heading,
  note,
  more,
  games,
  cover,
}: {
  locale: Locale
  eyebrowText: string
  heading: ReactNode
  note: string
  more: boolean
  games: Array<{ appid: number; name: string; meta: string }>
  cover: (g: { appid: number }) => YearModel['covers'][number]
}) {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-safe py-16 md:py-24">
      <m.p {...inView()} className={`${eyebrow()} mb-3`}>
        {eyebrowText}
      </m.p>
      <m.h2 {...inView(1)} className="font-display text-display-md">
        {heading}
      </m.h2>
      <p className="mt-2 mb-8 max-w-md text-dim text-sm">
        {note}
        {more && tr(locale, { ru: ' Здесь — первые двенадцать.', en: ' Showing the first twelve.' })}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {games.map((g, i) => (
          <m.div key={g.appid} {...inView(i % 6)}>
            <GameLink appid={g.appid} lang={langOn(locale, g.name)} className="game-card block">
              <GameCardBody
                appid={g.appid}
                name={g.name}
                {...cover(g)}
                sizes="(min-width: 1024px) 17vw, (min-width: 640px) 33vw, 50vw"
                meta={<span className="truncate tabular-nums">{g.meta}</span>}
              />
            </GameLink>
          </m.div>
        ))}
      </div>
    </section>
  )
}
