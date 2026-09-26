import type { Metadata } from 'next'
import * as m from 'framer-motion/m'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { GameArt } from '@/components/GameArt'
import { GameCardBody } from '@/components/GameCard'
import { Icon } from '@/components/Icon'
import { Magnet } from '@/components/Magnet'
import { DiscountCorner, PriceTag } from '@/components/PriceTag'
import { SplitHeading } from '@/components/SplitHeading'
import { verdict } from '@/lib/compat'
import { tagRu } from '@/lib/tagsru'
import { OG_SITE } from '@/lib/site'
import {
  COMMON_SHOWN,
  type CompatGame,
  type CompatPick,
  loadCompat,
  loadCompatInvite,
} from '@/lib/compatpage'
import { reconnectHref } from '@/lib/destination'
import { plural } from '@/lib/plural'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { STORE_LABEL } from '@/lib/stores'
import { CopyCompatLink } from '../CopyCompatLink'
import { CompatNotice } from './CompatNotice'
import { CoverWall } from './CoverStrip'
import { Eyebrow, SectionTitle } from '@/components/Labels'
import type { ArtRef } from '@/lib/compatpage'

export const dynamic = 'force-dynamic'

const STEAMID = /^\d{17}$/

/**
 * Приглашение читают и generateMetadata, и сама страница. cache() на время
 * запроса — тот же приём, что на карточке игры (app/game/[appid]/page.tsx).
 */
const inviteOnce = cache(loadCompatInvite)

/**
 * Без этого ссылка на совместимость разворачивалась в мессенджерах общим
 * заголовком сайта и вообще без картинки — при том что весь смысл страницы в
 * том, чтобы её кинуть другому.
 *
 * Описываем ВЛАДЕЛЬЦА ссылки, а не того, кто её открыл: процента до входа не
 * существует, а сессия у краулера чужая. Картинку подставляет opengraph-image.tsx —
 * файловая метадата приоритетнее, поэтому openGraph.images здесь не нужен.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ steamid: string }>
}): Promise<Metadata> {
  const { steamid } = await params
  if (!STEAMID.test(steamid)) return {}

  const invite = await inviteOnce(await getDb(), steamid)
  if (!invite) return { title: 'Совместимость', robots: { index: false } }

  const title = `${invite.name} зовёт сравнить библиотеки`
  const description =
    `Сравни свою библиотеку Steam с библиотекой ${invite.name}: ` +
    `${invite.gamesCount} ${plural(invite.gamesCount, 'игра', 'игры', 'игр')}, ` +
    `${invite.totalHours.toLocaleString('ru-RU')} ${plural(invite.totalHours, 'час', 'часа', 'часов')}. ` +
    'Процент совпадения вкусов, общие игры и во что вам зайти вместе.'

  // Свой адрес, а не корневой: og:url из layout был '/', и VK с Facebook
  // склеивали ссылку на совместимость с главной
  const url = `/compat/${steamid}`

  return {
    title,
    description,
    alternates: { canonical: url },
    // Из индекса убираем, из шеринга — нет: страница личная и строится по
    // чужому снапшоту. На превью по прямой ссылке флаг не влияет. В robots.txt
    // страница открыта намеренно — иначе краулер этого флага не увидит
    // (lib/robots.ts).
    robots: { index: false, follow: true },
    openGraph: { ...OG_SITE, title, description, type: 'website', url },
    twitter: { card: 'summary_large_image', title, description },
  }
}

const EASE = [0.22, 1, 0.36, 1] as const

/** Появление ниже сгиба — канонические настройки проекта (см. /portrait, /play) */
const inView = (i = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.45, ease: EASE, delay: i * 0.05 },
})

const ru = (n: number) => n.toLocaleString('ru-RU')

/** Без повторов: одна игра дважды в одной ленте читается сбоем, а не узором */
function uniq(games: ArtRef[]): ArtRef[] {
  const seen = new Set<number>()
  return games.filter((g) => !seen.has(g.appid) && seen.add(g.appid))
}

/**
 * Двусторонний счёт часов — главная мысль страницы.
 *
 * «2046 ч · 10 ч» серым моноширинным без подписи было самым интересным на
 * странице и одновременно самым нечитаемым: чьё какое число, можно было понять
 * только по порядку слов в строке «Ник × Ник» этажом выше. А ведь именно
 * асимметрия и есть история: один налетал две тысячи часов, другой заглянул на
 * десять.
 *
 * Масштаб — ПО СТРОКЕ, а не по всему списку. По списку CS с её двумя тысячами
 * часов расплющила бы Stardew 58/50 в две невидимые чёрточки, а вопрос строки
 * не «насколько эта игра больше остальных» (на это отвечает порядок сортировки),
 * а «кто из вас двоих здесь ветеран».
 */
function HoursSplit({ hoursA, hoursB }: { hoursA: number; hoursB: number }) {
  const max = Math.max(hoursA, hoursB)
  const share = (h: number) => (max ? `${(h / max) * 100}%` : '0%')

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-right tabular-nums text-[11px] text-dim">
        {ru(hoursA)} ч
      </span>
      <div aria-hidden className="flex h-1.5 flex-1 items-center">
        <div className="flex flex-1 justify-end">
          <div className="h-1.5 rounded-l-full bg-ember" style={{ width: share(hoursA) }} />
        </div>
        <div className="flex-1">
          <div className="h-1.5 rounded-r-full bg-info" style={{ width: share(hoursB) }} />
        </div>
      </div>
      <span className="w-14 shrink-0 tabular-nums text-[11px] text-dim">
        {ru(hoursB)} ч
      </span>
    </div>
  )
}

function CommonRow({ game }: { game: CompatGame }) {
  return (
    <Link href={`/game/${game.appid}`} className="common-row game-card">
      <span className="card-thumb aspect-[460/215] w-[112px] shrink-0 md:w-[136px]">
        <GameArt
          appid={game.appid}
          name={game.name}
          headerImage={game.headerImage}
          art={game.art}
          // Слот шириной 136px: без подсказки браузер тянул сюда 920px-ассет
          sizes="136px"
          className="h-full w-full object-cover"
        />
      </span>
      {/* min-w-0 обязателен: без него flex-1 не даёт ужаться ниже содержимого
          и truncate не срабатывает вовсе */}
      <span className="flex min-w-0 flex-1 flex-col gap-2">
        <span className="truncate text-[15px] font-extrabold tracking-[-0.01em]">{game.name}</span>
        <HoursSplit hoursA={game.hoursA} hoursB={game.hoursB} />
      </span>
    </Link>
  )
}

function PickCard({ pick }: { pick: CompatPick }) {
  return (
    <Link href={`/game/${pick.appid}`} className="game-card block">
      <GameCardBody
        appid={pick.appid}
        name={pick.name}
        headerImage={pick.headerImage}
        art={pick.art}
        sizes="(min-width: 768px) 33vw, 50vw"
        corner={<DiscountCorner discount={pick.discount} />}
        meta={
          // Ряд независимых элементов, а не склеенная строка: висячему « · »
          // неоткуда взяться, когда разделителя нет вовсе
          pick.ownedByAll ? (
            <span className="inline-flex items-center gap-1.5 text-ok">
              <Icon name="check" size={14} />
              Есть у обоих
            </span>
          ) : (
            <>
              <span className="min-w-0 truncate">Нет у: {pick.missingFor.join(', ')}</span>
              <span className="flex shrink-0 items-center gap-2">
                <PriceTag
                  priceFinal={pick.priceFinal ?? null}
                  isFree={pick.isFree}
                  discount={pick.discount}
                  showPercent={false}
                />
                {pick.store && <span>{STORE_LABEL[pick.store] ?? pick.store}</span>}
              </span>
            </>
          )
        }
      />
    </Link>
  )
}

function Shelf({
  kicker,
  hint,
  picks,
  index,
}: {
  kicker: string
  hint: string
  picks: CompatPick[]
  index: number
}) {
  if (!picks.length) return null
  return (
    <m.section {...inView(index)}>
      <SectionTitle sub={hint} className="mb-5">
        {kicker}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3">
        {picks.map((p) => (
          <PickCard key={p.appid} pick={p} />
        ))}
      </div>
    </m.section>
  )
}

export default async function CompatPage({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid: other } = await params
  if (!STEAMID.test(other)) notFound()

  const db = await getDb()
  const me = await currentSteamId()
  const state = await loadCompat(db, { other, me, now: nowSec() })

  if (state.kind === 'self') {
    // Фон — свои же игры: приглашение уже посчитано для метаданных (cache)
    const own = await inviteOnce(db, other)
    return (
      <CompatNotice
        title="Это твоя собственная ссылка"
        body="Кинь её кому-нибудь другому — сервис сравнит ваши библиотеки и покажет, во что вам зайти вместе."
        games={own?.topGames}
      >
        <CopyCompatLink steamid={other} className="btn-ember px-6 py-3" label="Моя ссылка совместимости" />
        <Link href={`/portrait/${other}`} className="tap link-more">
          Посмотреть свой портрет
          <Icon name="arrow" size={16} />
        </Link>
      </CompatNotice>
    )
  }

  if (state.kind === 'noprofile') {
    return (
      <CompatNotice
        title={`${state.otherName ?? 'Этот игрок'} ещё не подключал библиотеку`}
        body="Сравнивать пока не с чем. Можно кинуть ему свою ссылку — тогда сравнение соберётся с его стороны."
      >
        {me && <CopyCompatLink steamid={me} className="btn-ember px-6 py-3" label="Моя ссылка совместимости" />}
        <Link href="/compat" className="tap link-more">
          <Icon name="arrow" size={16} className="rotate-180" />
          К своей ссылке
        </Link>
      </CompatNotice>
    )
  }

  // Гость и человек без своей библиотеки видят одно и то же приглашение —
  // разными остаются только действие и объяснение, почему процента ещё нет
  if (state.kind === 'noauth' || state.kind === 'nolibrary') {
    const { invite } = state
    return (
      <div className="flex-1">
        <InviteHero invite={invite} />
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-5 pb-24 text-center">
          {state.kind === 'noauth' ? (
            <>
              <p className="text-sm leading-relaxed text-dim">
                Подключи свою библиотеку — и увидите общий процент, общие игры и во что вам зайти
                вместе. Прочитаем только список игр и часы, ничего не публикуем.
              </p>
              <a
                href={`/api/auth/steam?compat=${other}`}
                className="btn-ember is-block py-3"
              >
                Войти через Steam
              </a>
              <Link href={`/?compat=${other}`} className="btn-glass flex w-full">
                Вставить ссылку на профиль / демо
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-dim">
                Твоя библиотека ещё не подключена — сравнивать пока не с чем.
              </p>
              <Link
                href={reconnectHref({ compat: other })}
                className="btn-ember is-block py-3"
              >
                Подключить библиотеку
              </Link>
            </>
          )}
        </div>
      </div>
    )
  }

  const d = state.data
  const hidden = d.commonTotal - d.commonGames.length

  return (
    <div className="flex-1">
      <section className="media-dark anim-reveal relative flex min-h-[88svh] flex-col justify-end overflow-hidden">
        {/* Верхняя лента — общее, нижняя — во что зайти дальше */}
        <CoverWall
          rows={[
            uniq([...d.heroGames, ...d.commonGames]),
            uniq([...d.playNow, ...d.playLater, ...d.heroGames].reverse()),
          ]}
        />
        <div aria-hidden className="cwall-scrim" />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto w-full max-w-6xl px-safe pb-16 pt-40">
          <Eyebrow className="mb-3">Совместимость</Eyebrow>
          <SplitHeading className="font-display text-display-lg" delay={0.18}>
            {`${d.myName} × ${d.otherName}`}
          </SplitHeading>
          <p className="mt-4 max-w-xl font-display text-display-md text-dim">{verdict(d.percent)}</p>
          {/*
            Процент — главное число страницы, и он стоит крупно, как счёт, а не
            в кольце на 200 px: кольцо читалось приборной панелью. Рядом — то,
            из чего он сложился.
          */}
          <dl className="mt-10 flex flex-wrap items-end gap-x-10 gap-y-6 md:gap-x-12">
            {/* На телефоне процент — отдельной строкой, два числа под ним рядом */}
            <div className="flex basis-full flex-col-reverse md:basis-auto">
              <dt className="lib-stat-label">совместимость вкусов</dt>
              <dd className="lib-stat compat-percent text-ember-text">
                {d.percent}
                <span className="compat-percent-sign">%</span>
              </dd>
            </div>
            <div className="flex flex-col-reverse">
              <dt className="lib-stat-label">
                {plural(d.commonTotal, 'общая игра', 'общие игры', 'общих игр')}
              </dt>
              <dd className="lib-stat">{ru(d.commonTotal)}</dd>
            </div>
            {d.sharedTags.length > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">
                  {plural(d.sharedTags.length, 'общая тема', 'общие темы', 'общих тем')}
                </dt>
                <dd className="lib-stat">{d.sharedTags.length}</dd>
              </div>
            )}
          </dl>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-safe py-16">
        {d.sharedTags.length > 0 && (
          <m.section {...inView(0)}>
            <SectionTitle
              sub="Эти темы совпадают у вас чаще, чем у случайной пары — считаем по редкости тега в каталоге, а не по популярности."
              className="mb-5"
            >
              Что вас роднит
            </SectionTitle>
            <ul className="flex flex-wrap gap-2">
              {d.sharedTags.map((tag, i) => (
                <li key={tag} className={`compat-tag ${i === 0 ? 'is-top' : ''}`}>
                  {tagRu(tag)}
                </li>
              ))}
            </ul>
          </m.section>
        )}

        <m.section {...inView(1)}>
          {d.commonTotal > 0 ? (
            <>
              <SectionTitle
                sub={`Вместе в них — ${ru(d.commonHours)} ${plural(d.commonHours, 'час', 'часа', 'часов')}.`}
                className="mb-4"
              >
                Общие игры
              </SectionTitle>
              {/* Легенда заодно подписывает колонки: какое число чьё, иначе
                  видно только по порядку слов в заголовке страницы */}
              <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px] font-semibold text-dim">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-ember" />
                  {d.myName}
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-info" />
                  {d.otherName}
                </span>
              </div>
              <div className="flex flex-col gap-1">
                {d.commonGames.map((g) => (
                  <CommonRow key={g.appid} game={g} />
                ))}
              </div>
              {hidden > 0 && (
                <p className="mt-3 text-xs text-faint">
                  Показаны {COMMON_SHOWN} самых наигранных из {d.commonTotal}.
                </p>
              )}
            </>
          ) : (
            <SectionTitle sub="Общих игр нет — вы играете в разное. Тем интереснее собрать пати.">
              Общие игры
            </SectionTitle>
          )}
        </m.section>

        <Shelf
          kicker="Заходите прямо сейчас"
          hint="Есть у обоих, живое и рассчитано на компанию."
          picks={d.playNow}
          index={2}
        />
        <Shelf
          kicker="Нет ни у кого — на будущее"
          hint="Мультиплеер, подобранный по суммарному вкусу двоих."
          picks={d.playLater}
          index={3}
        />

        <m.div
          {...inView(4)}
          className="panel-lift flex flex-wrap items-center justify-center gap-3 p-6 md:p-8"
        >
          <Magnet>
            <Link
              href="/room/new"
              className="btn-ember px-6 py-3"
            >
              Собрать пати вместе
            </Link>
          </Magnet>
          <CopyOwn steamid={d.me} inline />
          <Link href={`/portrait/${d.other}`} className="tap link-more p-2">
            Портрет {d.otherName}
            <Icon name="arrow" size={16} />
          </Link>
        </m.div>
      </div>
    </div>
  )
}

/** Шапка приглашения: то же лицо, что и на карточке для мессенджера */
function InviteHero({ invite }: { invite: { name: string; gamesCount: number; totalHours: number; topGames: ArtRef[] } }) {
  return (
    <section className="media-dark anim-reveal relative flex min-h-[62svh] flex-col justify-end overflow-hidden">
      <CoverWall rows={[invite.topGames, [...invite.topGames].reverse()]} />
      <div aria-hidden className="cwall-scrim" />
      <div aria-hidden className="grain" />
      <div className="relative mx-auto w-full max-w-2xl px-5 pb-10 pt-32 text-center">
        <Eyebrow className="mb-3">Совместимость</Eyebrow>
        <h1 className="font-display text-display-lg">
          {invite.name} зовёт сравнить библиотеки
        </h1>
        <p className="mt-4 text-sm text-dim">
          {invite.gamesCount} {plural(invite.gamesCount, 'игра', 'игры', 'игр')} ·{' '}
          {ru(invite.totalHours)} {plural(invite.totalHours, 'час', 'часа', 'часов')}
        </p>
      </div>
    </section>
  )
}

/**
 * «Моя ссылка» раньше уводила на хаб /compat, хотя steamid зрителя страница уже
 * знала — поле приезжало на клиент и не читалось вообще. Копируем на месте:
 * открыл чужую ссылку, увидел свой процент, забрал свою.
 */
function CopyOwn({ steamid, inline = false }: { steamid: string; inline?: boolean }) {
  return (
    <CopyCompatLink
      steamid={steamid}
      className={
        inline
          ? 'btn-glass px-6'
          : 'btn-ember is-block py-3'
      }
      label="Моя ссылка совместимости"
    />
  )
}
