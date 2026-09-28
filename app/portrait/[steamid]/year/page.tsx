import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import * as m from 'framer-motion/m'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache, type ReactNode } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { GameArt } from '@/components/GameArt'
import { GameCardBody } from '@/components/GameCard'
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
import { dateLabel } from '@/lib/freshness'
import { playedLine } from '@/lib/outcome'
import { plural } from '@/lib/plural'
import { buildYearModel, portraitTag, type YearModel } from '@/lib/portraitmodel'
import { checkRate, clientIp } from '@/lib/ratelimit'
import { appBaseUrl, currentSteamId, getDb, nowSec } from '@/lib/server'
import { OG_SITE } from '@/lib/site'
import { withRef } from '@/lib/track'
import type { LibraryGame } from '@/lib/types'
import { pickYearWindow, yearCandidates, yearEyebrow, yearsToRead } from '@/lib/wrapped'

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
  params: Promise<{ steamid: string }>
}): Promise<Metadata> {
  const { steamid } = await params
  if (!/^\d{17}$/.test(steamid)) return {}

  const snapshot = await snapshotOf(steamid)
  if (!snapshot) return { title: 'Итоги года', robots: { index: false } }

  const name = (await personaOf(steamid)) ?? `Игрок ${steamid.slice(-4)}`
  const title = `Итоги года — ${name}`
  const description =
    'Сколько наиграно за год, какие игры впервые запущены и какие появились в библиотеке — по снимкам Steam.'
  const url = `/portrait/${steamid}/year`

  // Отметку года здесь не читаем: метаданные рендерятся мимо кэша итогов, а
  // без отметки закрытый год не узнать — описание честное и без чисел
  return {
    title,
    description,
    alternates: { canonical: url },
    // Как у портрета: в переписку по ссылке — да, в поисковую выдачу — нет
    robots: { index: false, follow: true },
    openGraph: { ...OG_SITE, title, description, type: 'profile', url },
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
    ['portrait-year:v1', steamid, String(snapshot.takenAt)],
    { tags: [portraitTag(steamid)], revalidate: YEAR_TTL_SEC },
  )
  try {
    return await build()
  } catch (err) {
    if (!(err instanceof ColdBuildLimited)) throw err
    return 'limited'
  }
}

export default async function YearPage({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params
  if (!/^\d{17}$/.test(steamid)) notFound()

  const snapshot = await snapshotOf(steamid)
  if (!snapshot) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">Этот игрок ещё не подключал библиотеку к imbored.</p>
        <Link href={reconnectHref()} className="tap link-more">
          Подключить свою
          <Icon name="arrow" size={16} />
        </Link>
      </div>
    )
  }

  const ip = clientIp(await headers())
  const loaded = await loadYear(steamid, snapshot, ip, nowSec())
  const name = (await personaOf(steamid)) ?? `Игрок ${steamid.slice(-4)}`
  const isMine = (await currentSteamId()) === steamid

  if (loaded === null || loaded === 'limited') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
        <Eyebrow>Итоги года</Eyebrow>
        <p className="text-lg max-w-md">
          {loaded === 'limited'
            ? 'С этого адреса сейчас открывают слишком много итогов подряд. Загляни через несколько минут.'
            : isMine
              ? 'Итоги начнут считаться со следующего снимка библиотеки: сравнивать пока не с чем.'
              : `У игрока ${name} считать итоги пока не из чего.`}
        </p>
        <Link href={`/portrait/${steamid}`} prefetch={false} className="tap link-more">
          К портрету
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
          <Eyebrow className="mb-3">{yearEyebrow(year)}</Eyebrow>
          <h1 className="font-display text-display-xl">{name}</h1>
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            {year.minutes > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">наиграно</dt>
                <dd className="lib-stat text-ember-text">{playedLine(year.minutes)}</dd>
              </div>
            )}
            {year.unpacked.count > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">
                  {plural(year.unpacked.count, 'впервые запущена', 'впервые запущены', 'впервые запущено')}
                </dt>
                <dd className="lib-stat">{year.unpacked.count.toLocaleString('ru-RU')}</dd>
              </div>
            )}
            {year.added.count > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">
                  {plural(year.added.count, 'появилась', 'появились', 'появилось')} в библиотеке
                </dt>
                <dd className="lib-stat">{year.added.count.toLocaleString('ru-RU')}</dd>
              </div>
            )}
          </dl>
          {/*
            Две честные даты. Steam отдаёт только часы за всё время, поэтому
            год — это разница двух снимков: отметки при первом за год заходе
            и последнего снимка. Чего сервис не видел, того в итогах нет.
          */}
          <p className="mt-6 max-w-md text-dim text-sm">
            По снимкам библиотеки: с {dateLabel(year.from, { year: year.fromPrevYear })} по{' '}
            {dateLabel(year.to, { year: year.closed })}.
          </p>
        </div>
      </section>

      {/* ——— 2. Игры года ——— */}
      {year.top.length > 0 && (
        <section className="relative mx-auto w-full max-w-5xl px-safe py-24 md:py-32">
          <m.p {...inView()} className={`${eyebrow()} mb-3`}>
            Игры года
          </m.p>
          <m.h2 {...inView(1)} className="mb-8 font-display text-display-lg">
            Куда ушёл год
          </m.h2>
          <div className="flex flex-col gap-3">
            {year.top.map((g, i) => (
              <m.div key={g.appid} {...inView(i)} className="flex items-center gap-4">
                <span className="portrait-rank w-7 shrink-0">{i + 1}</span>
                <Link href={`/game/${g.appid}`} aria-label={g.name} className="game-card w-28 shrink-0 md:w-44">
                  <span className="card-thumb">
                    <GameArt
                      appid={g.appid}
                      name={g.name}
                      {...cover(g)}
                      sizes="(min-width: 768px) 176px, 112px"
                      className="w-full aspect-[460/215] object-cover"
                    />
                  </span>
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-extrabold tracking-[-0.01em] md:text-base">
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
                <span className="shrink-0 text-sm font-bold tabular-nums text-dim">+{playedLine(g.minutes)}</span>
              </m.div>
            ))}
          </div>
        </section>
      )}

      {/* ——— 3. Распакованное ——— */}
      {year.unpacked.games.length > 0 && (
        <YearShelf
          eyebrowText="Из бэклога"
          heading={
            <>
              <span className="tabular-nums text-ember-text">{year.unpacked.count}</span>{' '}
              {plural(year.unpacked.count, 'игра впервые запущена', 'игры впервые запущены', 'игр впервые запущено')}
            </>
          }
          note="Лежали с нулём минут на начало окна — и дождались."
          more={year.unpacked.count > year.unpacked.games.length}
          games={year.unpacked.games.map((g) => ({ ...g, meta: `+${playedLine(g.minutes)}` }))}
          cover={cover}
        />
      )}

      {/* ——— 4. Новое в библиотеке ——— */}
      {year.added.games.length > 0 && (
        <YearShelf
          eyebrowText="Новое"
          heading={
            <>
              <span className="tabular-nums text-ember-text">{year.added.count}</span>{' '}
              {plural(year.added.count, 'игра появилась', 'игры появились', 'игр появилось')} в библиотеке
            </>
          }
          // «Появились», а не «куплены»: покупок сервис не видит, а бесплатные
          // Steam отдаёт только после первого запуска
          note="Появились — не значит куплены: сервис видит библиотеку, а не покупки."
          more={year.added.count > year.added.games.length}
          games={year.added.games.map((g) => ({
            appid: g.appid,
            name: g.name,
            meta: g.playtimeForever > 0 ? playedLine(g.playtimeForever) : 'не запускалась',
          }))}
          cover={cover}
        />
      )}

      {/* ——— 5. Финал ——— */}
      <section className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-8 px-safe pb-24 pt-8 text-center">
        {/* Превью — картинка на тот же роут, что и скачивание: лишний рендер
            satori заново тянул бы постеры со Steam */}
        <a
          href={`/portrait/${steamid}/year/card.png`}
          download={`imbored-${steamid}-${year.year}.png`}
          className="game-card block w-56"
        >
          <span className="card-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/portrait/${steamid}/year/card.png`}
              alt="Карточка итогов года"
              loading="lazy"
              className="w-full aspect-[1080/1350] object-cover"
            />
          </span>
          <span className="link-more mt-3">Скачать карточку</span>
        </a>
        <Link href={`/portrait/${steamid}`} prefetch={false} className="tap link-more">
          <Icon name="arrow" size={16} className="rotate-180" />
          {isMine ? 'К своему портрету' : `К портрету игрока ${name}`}
        </Link>
        {isMine && (
          <div className="flex w-full flex-col gap-2.5 text-left">
            <p className="text-xs text-dim">По этой ссылке увидят твои итоги года и смогут открыть портрет.</p>
            <ShareLinkField
              url={withRef(`${appBaseUrl()}/portrait/${steamid}/year`, 'portrait')}
              label="Ссылка на твои итоги года"
              title={`Итоги года ${name} — imbored`}
              text="Мои итоги года по библиотеке Steam"
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
  eyebrowText,
  heading,
  note,
  more,
  games,
  cover,
}: {
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
        {more && ' Здесь — первые двенадцать.'}
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {games.map((g, i) => (
          <m.div key={g.appid} {...inView(i % 6)}>
            <Link href={`/game/${g.appid}`} className="game-card block">
              <GameCardBody
                appid={g.appid}
                name={g.name}
                {...cover(g)}
                sizes="(min-width: 1024px) 17vw, (min-width: 640px) 33vw, 50vw"
                meta={<span className="truncate tabular-nums">{g.meta}</span>}
              />
            </Link>
          </m.div>
        ))}
      </div>
    </section>
  )
}
