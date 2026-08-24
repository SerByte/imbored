import type { Metadata } from 'next'
import * as motion from 'motion/react-client'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { GameArt } from '@/components/GameArt'
import { Magnet } from '@/components/Magnet'
import { DiscountCorner, PriceTag } from '@/components/PriceTag'
import { ProgressRing } from '@/components/ProgressRing'
import { SplitHeading } from '@/components/SplitHeading'
import { verdict } from '@/lib/compat'
import { OG_SITE } from '@/lib/og'
import {
  COMMON_SHOWN,
  type CompatGame,
  type CompatPick,
  loadCompat,
  loadCompatInvite,
} from '@/lib/compatpage'
import { plural } from '@/lib/plural'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { STORE_LABEL } from '@/lib/stores'
import { CopyCompatLink } from '../CopyCompatLink'
import { CompatNotice } from './CompatNotice'
import { CoverStrip } from './CoverStrip'
import { Eyebrow } from '@/components/Labels'

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

  return {
    title,
    description,
    // Из индекса убираем, из шеринга — нет: страница личная и строится по
    // чужому снапшоту. На превью по прямой ссылке флаг не влияет.
    robots: { index: false, follow: true },
    openGraph: { ...OG_SITE, title, description, type: 'website' },
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

function Kicker({ children }: { children: React.ReactNode }) {
  return (
    <Eyebrow as="h2" className="mb-1">
      {children}
    </Eyebrow>
  )
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
      <span className="w-14 shrink-0 text-right font-mono text-[11px] tabular-nums text-dim">
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
      <span className="w-14 shrink-0 font-mono text-[11px] tabular-nums text-dim">
        {ru(hoursB)} ч
      </span>
    </div>
  )
}

function CommonRow({ game }: { game: CompatGame }) {
  return (
    <Link
      href={`/game/${game.appid}`}
      className="glass glass-hover flex items-center gap-3 rounded-[14px] p-2 pr-3"
    >
      <GameArt
        appid={game.appid}
        name={game.name}
        headerImage={game.headerImage}
        art={game.art}
        // Слот шириной 104px: без подсказки браузер тянул сюда 920px-ассет
        sizes="104px"
        className="h-12 w-[104px] shrink-0 rounded-[8px] border border-edge object-cover"
      />
      {/* min-w-0 обязателен: без него flex-1 не даёт ужаться ниже содержимого
          и truncate не срабатывает вовсе */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="truncate text-sm font-semibold">{game.name}</span>
        <HoursSplit hoursA={game.hoursA} hoursB={game.hoursB} />
      </div>
    </Link>
  )
}

function PickCard({ pick }: { pick: CompatPick }) {
  return (
    <Link
      href={`/game/${pick.appid}`}
      className="glass glass-hover overflow-hidden rounded-[14px]"
    >
      <div className="relative">
        <GameArt
          appid={pick.appid}
          name={pick.name}
          headerImage={pick.headerImage}
          art={pick.art}
          sizes="(min-width: 768px) 33vw, 50vw"
          className="aspect-[460/215] w-full object-cover"
        />
        <DiscountCorner discount={pick.discount} />
      </div>
      <div className="p-3">
        <div className="line-clamp-2 text-sm font-semibold leading-tight">{pick.name}</div>
        {/* Ряд независимых элементов, а не склеенная строка: висячему « · »
            неоткуда взяться, когда разделителя нет вовсе */}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          {pick.ownedByAll ? (
            <span className="rounded-full bg-ok/15 px-2.5 py-1 font-medium text-ok">
              ✓ есть у обоих
            </span>
          ) : (
            <>
              <span className="rounded-full bg-info/10 px-2.5 py-1 text-info">
                нет у: {pick.missingFor.join(', ')}
              </span>
              <PriceTag
                priceFinal={pick.priceFinal ?? null}
                discount={pick.discount}
                showPercent={false}
                className="text-[11px]"
              />
              {pick.store && (
                <span className="text-dim">{STORE_LABEL[pick.store] ?? pick.store}</span>
              )}
            </>
          )}
        </div>
      </div>
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
    <motion.section {...inView(index)}>
      <Kicker>{kicker}</Kicker>
      <p className="mb-4 text-xs text-faint">{hint}</p>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {picks.map((p) => (
          <PickCard key={p.appid} pick={p} />
        ))}
      </div>
    </motion.section>
  )
}

export default async function CompatPage({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid: other } = await params
  if (!STEAMID.test(other)) notFound()

  const db = await getDb()
  const me = await currentSteamId()
  const state = await loadCompat(db, { other, me, now: nowSec() })

  if (state.kind === 'self') {
    return (
      <CompatNotice
        title="Это твоя собственная ссылка"
        body="Кинь её кому-нибудь другому — сервис сравнит ваши библиотеки и покажет, во что вам зайти вместе."
      >
        <CopyOwn steamid={other} />
        <Link href={`/portrait/${other}`} className="tap text-sm text-dim transition-colors hover:text-ink">
          Посмотреть свой портрет →
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
        {me && <CopyOwn steamid={me} />}
        <Link href="/compat" className="tap text-sm text-dim transition-colors hover:text-ink">
          ← К своей ссылке
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
        <div className="mx-auto flex w-full max-w-md flex-col gap-4 px-5 pb-24 text-center">
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
              <Link
                href={`/?compat=${other}`}
                className="glass glass-hover rounded-[14px] py-3 text-sm"
              >
                Вставить ссылку на профиль / демо
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-dim">
                Твоя библиотека ещё не подключена — сравнивать пока не с чем.
              </p>
              <Link
                href="/"
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
        <CoverStrip games={d.heroGames} />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, color-mix(in srgb, var(--bg) 25%, transparent) 0%, var(--bg) 52%)',
          }}
        />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto flex w-full max-w-6xl flex-col items-start gap-8 px-5 pb-16 pt-40 md:flex-row md:items-end md:gap-12">
          <ProgressRing
            percent={d.percent}
            ariaLabel={`Совместимость вкусов: ${d.percent} процентов`}
            className="origin-left shrink-0 scale-[0.8] md:scale-100"
          />
          <div className="min-w-0">
            <Eyebrow className="mb-3">Совместимость</Eyebrow>
            <SplitHeading
              className="font-display text-display-lg"
              delay={0.18}
            >
              {`${d.myName} × ${d.otherName}`}
            </SplitHeading>
            <p className="mt-5 max-w-xl font-display text-display-md">
              {verdict(d.percent)}
            </p>
            <p className="mt-3 text-sm text-dim md:text-base">
              {d.commonTotal} {plural(d.commonTotal, 'общая игра', 'общие игры', 'общих игр')}
              {d.sharedTags.length > 0 &&
                ` · ${d.sharedTags.length} ${plural(d.sharedTags.length, 'общая тема', 'общие темы', 'общих тем')}`}
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-5 py-16">
        {d.sharedTags.length > 0 && (
          <motion.section {...inView(0)}>
            <Kicker>Что вас роднит</Kicker>
            <p className="mb-4 text-xs text-faint">
              Эти темы совпадают у вас чаще, чем у случайной пары — считаем по редкости тега в
              каталоге, а не по популярности.
            </p>
            <ul className="flex flex-wrap gap-2">
              {d.sharedTags.map((tag, i) => (
                <li
                  key={tag}
                  className={
                    i === 0
                      ? 'rounded-full bg-ember/15 px-3.5 py-1.5 text-sm text-ember-text'
                      : 'glass rounded-full px-3 py-1 text-xs text-dim'
                  }
                >
                  {tag}
                </li>
              ))}
            </ul>
          </motion.section>
        )}

        <motion.section {...inView(1)}>
          <Kicker>Общие игры</Kicker>
          {d.commonTotal > 0 ? (
            <>
              <p className="mb-4 text-xs text-faint">
                Вместе в них — {ru(d.commonHours)}{' '}
                {plural(d.commonHours, 'час', 'часа', 'часов')}.
              </p>
              {/* Легенда заодно подписывает колонки: какое число чьё, иначе
                  видно только по порядку слов в заголовке страницы */}
              <div className="mb-3 flex flex-wrap items-center gap-4 text-[11px] text-faint">
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-ember" />
                  {d.myName}
                </span>
                <span className="flex items-center gap-1.5">
                  <span aria-hidden className="h-2 w-2 rounded-full bg-info" />
                  {d.otherName}
                </span>
              </div>
              <div className="flex flex-col gap-2">
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
            <p className="text-sm text-dim">
              Общих игр нет — вы играете в разное. Тем интереснее собрать пати.
            </p>
          )}
        </motion.section>

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

        <motion.div
          {...inView(4)}
          className="glass flex flex-wrap items-center justify-center gap-3 rounded-[20px] p-6 md:p-8"
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
          <Link
            href={`/portrait/${d.other}`}
            className="p-2 text-sm text-dim transition-colors hover:text-ink"
          >
            Портрет {d.otherName} →
          </Link>
        </motion.div>
      </div>
    </div>
  )
}

/** Шапка приглашения: то же лицо, что и на карточке для мессенджера */
function InviteHero({ invite }: { invite: { name: string; gamesCount: number; totalHours: number; topGames: React.ComponentProps<typeof CoverStrip>['games'] } }) {
  return (
    <section className="media-dark anim-reveal relative flex min-h-[62svh] flex-col justify-end overflow-hidden">
      <CoverStrip games={invite.topGames} />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in srgb, var(--bg) 25%, transparent) 0%, var(--bg) 58%)',
        }}
      />
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
          ? 'glass glass-hover cursor-pointer rounded-[14px] px-6 py-3 text-sm'
          : 'btn-ember is-block py-3'
      }
      label="Моя ссылка совместимости"
    />
  )
}
