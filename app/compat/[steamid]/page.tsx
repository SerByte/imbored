import type { Metadata } from 'next'
import * as m from 'framer-motion/m'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { after } from 'next/server'
import { GameArt } from '@/components/GameArt'
import { GameCardBody } from '@/components/GameCard'
import { GameLink } from '@/components/GameLink'
import { Icon } from '@/components/Icon'
import { Magnet } from '@/components/Magnet'
import { DiscountCorner, PriceTag } from '@/components/PriceTag'
import { SplitHeading } from '@/components/SplitHeading'
import { commonTimeLine, verdict } from '@/lib/compat'
import { tagRu } from '@/lib/tagsru'
import { OG_SITE } from '@/lib/site'
import {
  COMMON_SHOWN,
  type CompatGame,
  type CompatInvite,
  type CompatInviteHead,
  type CompatPick,
  loadCompat,
  loadCompatInvite,
  loadInviteHead,
} from '@/lib/compatpage'
import { reconnectHref } from '@/lib/destination'
import { roomSeedHref } from '@/lib/presets'
import { plural } from '@/lib/plural'
import { playedShort } from '@/lib/playtime'
import { recordCompatView } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { currentSession, getDb, isDemoId, isWriter, nowSec } from '@/lib/server'
import { STORE_LABEL } from '@/lib/stores'
import { CopyCompatLink } from '../CopyCompatLink'
import { CompatNotice } from './CompatNotice'
import { CoverWall } from './CoverStrip'
import { Eyebrow, SectionTitle } from '@/components/Labels'
import type { ArtRef } from '@/lib/compatpage'

export const dynamic = 'force-dynamic'

const STEAMID = /^\d{17}$/

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

  // Только голова приглашения: обложек превью не показывает. Снапшот и ник
  // владельца — общие с телом страницы на любом пути (память запроса в
  // lib/compatpage), обложки же метаданным не нужны, и вошедший за них не платит
  const invite = await loadInviteHead(await getDb(), steamid)
  if (!invite) return { title: 'Совместимость', robots: { index: false } }

  const title = `${invite.name} зовёт сравнить библиотеки`
  const description =
    `Сравни свою библиотеку Steam с библиотекой ${invite.name}: ` +
    `${invite.gamesCount} ${plural(invite.gamesCount, 'игра', 'игры', 'игр')}, ${inviteHours(invite)}. ` +
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

/**
 * Часы владельца ссылки — в превью и в герое приглашения одной строкой. Время
 * скрыто настройками Steam (lib/playtime.ts) — слово вместо числа: «0 часов»
 * было бы сказано про галочку, а не про человека, и ушло бы в каждый чат.
 */
function inviteHours(invite: Pick<CompatInviteHead, 'totalHours' | 'playtimeHidden'>): string {
  return invite.playtimeHidden
    ? 'время скрыто'
    : `${ru(invite.totalHours)} ${plural(invite.totalHours, 'час', 'часа', 'часов')}`
}

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
 *
 * Считается в МИНУТАХ: из округлённых часов пара «25 и 10 минут» выходила
 * «0 ч | 0 ч» без единой полосы — будто никто не запускал. Подпись —
 * playedShort: меньше получаса — минуты, как у плиток /library.
 */
function HoursSplit({ minutesA, minutesB }: { minutesA: number | null; minutesB: number | null }) {
  // Время скрыто у обоих (lib/playtime.ts) — сравнивать нечего, строка без счёта
  if (minutesA === null && minutesB === null) return null
  const max = Math.max(minutesA ?? 0, minutesB ?? 0)
  // У скрытой стороны полосы нет вовсе: пустая полоса читалась бы нулём
  const share = (m: number | null) => (max && m ? `${(m / max) * 100}%` : '0%')
  const label = (m: number | null) => (m === null ? 'скрыто' : playedShort(m))

  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-right tabular-nums text-[11px] text-dim">
        {label(minutesA)}
      </span>
      <div aria-hidden className="flex h-1.5 flex-1 items-center">
        <div className="flex flex-1 justify-end">
          <div className="h-1.5 rounded-l-full bg-ember" style={{ width: share(minutesA) }} />
        </div>
        <div className="flex-1">
          <div className="h-1.5 rounded-r-full bg-info" style={{ width: share(minutesB) }} />
        </div>
      </div>
      <span className="w-14 shrink-0 tabular-nums text-[11px] text-dim">
        {label(minutesB)}
      </span>
    </div>
  )
}

function CommonRow({ game }: { game: CompatGame }) {
  return (
    <GameLink appid={game.appid} className="common-row game-card">
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
        <HoursSplit minutesA={game.minutesA} minutesB={game.minutesB} />
      </span>
    </GameLink>
  )
}

function PickCard({ pick }: { pick: CompatPick }) {
  return (
    <GameLink appid={pick.appid} className="game-card block">
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
                  cc={pick.priceCc ?? null}
                  unsold={pick.unsold}
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
    </GameLink>
  )
}

/**
 * invite — «Позвать в эту игру» под каждой карточкой: комната сразу с ней
 * первой картой (roomSeedHref). Только у полки «есть у обоих»: это ровно то,
 * во что вдвоём можно зайти сегодня, и самое частое, что после сравнения
 * пишут в чат, — «го в X?». Раньше единственной дорогой в пати была общая
 * кнопка внизу, и игра, которую человек только что увидел, терялась по
 * дороге. У полки «на будущее» ссылки нет: звать в игру, которую обоим ещё
 * покупать, — не приглашение на вечер.
 *
 * Ссылка — рядом с карточкой, а не внутри: карточка сама ссылка на игру, а
 * ссылка в ссылке — невалидная разметка. Зазор держит py-2 самой ссылки:
 * зона пальца .tap (44px) тогда не наползает на карточку над ней.
 */
function Shelf({
  kicker,
  hint,
  picks,
  index,
  invite = false,
}: {
  kicker: string
  hint: string
  picks: CompatPick[]
  index: number
  invite?: boolean
}) {
  if (!picks.length) return null
  return (
    <m.section {...inView(index)}>
      <SectionTitle sub={hint} className="mb-5">
        {kicker}
      </SectionTitle>
      <div className="grid grid-cols-2 gap-x-4 gap-y-6 md:grid-cols-3">
        {picks.map((p) =>
          invite && p.appid > 0 ? (
            <div key={p.appid} className="flex flex-col gap-1">
              <PickCard pick={p} />
              <Link
                href={roomSeedHref(p.appid)}
                prefetch={false}
                className="tap link-more self-start py-2"
              >
                Позвать в эту игру
                <Icon name="arrow" size={14} />
              </Link>
            </div>
          ) : (
            <PickCard key={p.appid} pick={p} />
          ),
        )}
      </div>
    </m.section>
  )
}

export default async function CompatPage({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid: other } = await params
  if (!STEAMID.test(other)) notFound()

  const db = await getDb()
  const session = await currentSession()
  const me = session?.steamid ?? null
  const now = nowSec()
  const state = await loadCompat(db, { other, me, now })
  /*
   * «Сравнили с тобой» у владельца ссылки — только от подтверждённого входа
   * не из демо, и только когда сравнение правда посчитано. Вход по ссылке на
   * профиль не доказывает, что профиль его: иначе любой выдумал бы «X
   * сравнился с тобой». Демо — не человек. Краулер и префетч сюда не
   * доходят: у первого нет сессии, второй останавливается на loading.tsx.
   */
  const records =
    session !== null && isWriter(session) && !isDemoId(session.steamid) && !isDemoId(other)

  if (state.kind === 'self') {
    // Фон — свои же игры. Снапшот и ник уже прочитаны для метаданных (память
    // запроса), новое чтение одно — обложки
    const own = await loadCompatInvite(db, other)
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
        body="Сравнивать пока не с чем. Можно кинуть в ответ свою ссылку — сравнение соберётся, когда по ней подключат библиотеку."
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
                вместе. Прочитаем игры с часами и открытый список желаемого, ничего не
                публикуем.
                {/* Демо-личность отметок не получает (compat_views) — обещать ей нечего */}
                {!isDemoId(other) && <> После входа через Steam {invite.name} увидит у себя, что вы сравнились.</>}
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
  // Время скрыто у обоих (lib/playtime.ts): счёта часов в строках нет вовсе
  const noHours = d.myTimeHidden && d.otherTimeHidden

  // Отметка — после ответа: страница сравнения не ждёт записи. Вне запроса
  // (тест, скрипт) after бросает — тогда и писать некому
  if (records) {
    const view = { owner: d.other, viewer: d.me, percent: d.percent }
    try {
      after(async () => {
        try {
          await recordCompatView(db, view, now)
        } catch (err) {
          logSwallowed('compat/page:view', err)
        }
      })
    } catch {
      // вне контекста запроса
    }
  }

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
              <SectionTitle sub={commonTimeLine(d)} className="mb-4">
                Общие игры
              </SectionTitle>
              {/* Легенда заодно подписывает колонки: какое число чьё, иначе
                  видно только по порядку слов в заголовке страницы. Чисел
                  нет — подписывать нечего */}
              {!noHours && (
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
              )}
              <div className="flex flex-col gap-1">
                {d.commonGames.map((g) => (
                  <CommonRow key={g.appid} game={g} />
                ))}
              </div>
              {hidden > 0 && (
                <p className="mt-3 text-xs text-faint">
                  {/* Время скрыто у обоих — порядок не по часам, и «самых
                      наигранных» было бы неправдой */}
                  Показаны {COMMON_SHOWN} {noHours ? '' : 'самых наигранных '}из {d.commonTotal}.
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
          invite
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
            {/* «Портрет Демо-игрок» не склонялось: ник — не слово, и падеж
                ему даёт только приложение «игрока», как в заголовке портрета */}
            Портрет игрока {d.otherName}
            <Icon name="arrow" size={16} />
          </Link>
          {/* Что осталось после этого экрана — говорится здесь же, а не в политике */}
          {records && (
            <p className="basis-full text-center text-xs text-faint">
              {d.otherName} увидит у себя, что вы сравнились, и ваш процент.
            </p>
          )}
        </m.div>
      </div>
    </div>
  )
}

/** Шапка приглашения: то же лицо, что и на карточке для мессенджера */
function InviteHero({
  invite,
}: {
  invite: Pick<CompatInvite, 'name' | 'gamesCount' | 'totalHours' | 'playtimeHidden' | 'topGames'>
}) {
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
          {invite.gamesCount} {plural(invite.gamesCount, 'игра', 'игры', 'игр')} · {inviteHours(invite)}
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
