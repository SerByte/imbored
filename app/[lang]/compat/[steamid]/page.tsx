import type { Metadata } from 'next'
import * as m from 'framer-motion/m'
import Link from '@/components/Link'
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
import { tagLabel } from '@/lib/tagsru'
import { fmtNumber, lp, pl, toLocale, tr, withLang, type Locale } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
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
import { playedShort } from '@/lib/playtime'
import { quoted } from '@/lib/sharedpick'
import { recordCompatView } from '@/lib/db'
import { logSwallowed } from '@/lib/errlog'
import { currentSession, getDb, isDemoId, isWriter, nowSec } from '@/lib/server'
import { STORE_LABEL } from '@/lib/stores'
import { CopyCompatLink } from '../CopyCompatLink'
import { langOn } from '@/lib/textlang'
import { withNicks } from '../nick'
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
 * существует, а сессия у краулера чужая. Картинку на русской странице
 * подставляет opengraph-image.tsx сам; на /en — та же, но своей записью ради
 * английской подписи (cardOn).
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ steamid: string; lang?: string }>
}): Promise<Metadata> {
  const { steamid, lang } = await params
  const locale = toLocale(lang)
  if (!STEAMID.test(steamid)) return missingMeta(locale, steamid)

  // Только голова приглашения: обложек превью не показывает. Снапшот и ник
  // владельца — общие с телом страницы на любом пути (память запроса в
  // lib/compatpage), обложки же метаданным не нужны, и вошедший за них не платит.
  // Язык — и в голову: от него имя демо-владельца («Demo friend» на /en)
  const invite = await loadInviteHead(await getDb(), steamid, locale)

  // Свой адрес, а не корневой: og:url из layout был '/', и VK с Facebook
  // склеивали ссылку на совместимость с главной
  const url = `/compat/${steamid}`

  if (!invite) {
    const fallback = { title: tr(locale, { ru: 'Совместимость', en: 'Compatibility' }), robots: { index: false } }
    // Русская — как была: без своего openGraph, карточка файловая. Английской
    // свой нужен ради подписи карточки (cardOn): файловая подписана по-русски
    if (locale !== 'en') return fallback
    return { ...fallback, openGraph: { ...ogSite(locale), type: 'website', url: lp(locale, url), ...cardOn(locale, url) } }
  }

  const title = inviteTitle(invite.name, locale)
  const description = tr(locale, {
    ru:
      `Сравни свою библиотеку Steam с библиотекой ${invite.name}: ` +
      `${inviteGames(invite.gamesCount, locale)}, ${inviteHours(invite, locale)}. ` +
      'Процент совпадения вкусов, общие игры и во что вам зайти вместе.',
    en:
      `Compare your Steam library with ${invite.name}'s: ` +
      `${inviteGames(invite.gamesCount, locale)}, ${inviteHours(invite, locale)}. ` +
      'See your taste match, the games you have in common and what to play together.',
  })

  return {
    title,
    description,
    alternates: localeAlternates(locale, url),
    // Из индекса убираем, из шеринга — нет: страница личная и строится по
    // чужому снапшоту. На превью по прямой ссылке флаг не влияет. В robots.txt
    // страница открыта намеренно — иначе краулер этого флага не увидит
    // (lib/robots.ts).
    robots: { index: false, follow: true },
    openGraph: { ...ogSite(locale), title, description, type: 'website', url: lp(locale, url), ...cardOn(locale, url) },
    twitter: { card: 'summary_large_image', title, description },
  }
}

/**
 * Подпись карточки превью (og:image:alt) на /en.
 *
 * alt файловой карточки — константа модуля (opengraph-image.tsx), языка у неё
 * нет, и на /en в превью уезжала русская подпись. Свой openGraph.images
 * страницы Next ставит ВМЕСТО файловой (resolve-metadata: файл берётся,
 * только когда у страницы images нет), а twitter:image он дозаполняет из
 * openGraph. Поэтому на /en — та же карточка того же маршрута, но с
 * английской подписью; русская страница images не объявляет и получает
 * файловую, как раньше, до байта.
 *
 * generateImageMetadata не годится: с ним адрес карточки получает хвост
 * /<id>, и сменился бы и у русской страницы. Хвоста ?<хеш> у английского
 * адреса нет — его ставит только файловая метадата; карточку и так
 * перерисовывает revalidate маршрута.
 *
 * lib/social.test.ts запрещает openGraph.images рядом с opengraph-image.tsx —
 * случайная запись тихо подменила бы карточку. Эта страница в нём названа
 * намеренной; что подпись английская, а карточка своя, держит page.test.ts.
 * Удалить cardOn — вернуть русскую подпись в каждое английское превью.
 */
function cardOn(locale: Locale, url: string) {
  if (locale !== 'en') return {}
  return {
    images: [
      {
        url: lp(locale, `${url}/opengraph-image`),
        width: 1200,
        height: 630,
        type: 'image/png',
        alt: 'Compare tastes — imbored',
      },
    ],
  }
}

/**
 * Метаданные битого адреса (/en/compat/abc, /en/compat/123): страница рисует
 * экран 404 (notFound), а файловая карточка сегмента всё равно встаёт в
 * голову — и с ней её русский alt, в HTML сервера и после гидрации (замер на
 * next dev). Поэтому на /en и здесь своя запись: та же карточка, английская
 * подпись (cardOn), тип и имя сайта — те же, что дал бы корень, ведь свой
 * openGraph этого уровня заменяет его целиком. Без og:url, как у корня: у
 * битого адреса его нет и на русской, — так же устроен битый адрес портрета.
 * Заголовок вкладки — корневой, как на русской. Сегмент — через
 * encodeURIComponent: в params он уже раскодирован (/en/compat/a%20b даёт
 * «a b»), а в адрес карточки должен встать закодированным. Русская — пустой
 * объект, как была: её голова не меняется ни на байт.
 */
function missingMeta(locale: Locale, raw: string): Metadata {
  if (locale !== 'en') return {}
  // Адрес — только карточке, своего og:url у битого адреса нет
  const url = `/compat/${encodeURIComponent(raw)}`
  return { openGraph: { ...ogSite(locale), type: 'website', ...cardOn(locale, url) } }
}

/** «Sergey зовёт сравнить библиотеки» — одна фраза на вкладку, превью и героя приглашения */
function inviteTitle(name: string, locale: Locale): string {
  return tr(locale, { ru: `${name} зовёт сравнить библиотеки`, en: `${name} wants to compare libraries` })
}

const EASE = [0.22, 1, 0.36, 1] as const

/** Появление ниже сгиба — канонические настройки проекта (см. /portrait, /play) */
const inView = (i = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.45, ease: EASE, delay: i * 0.05 },
})

/**
 * Часы владельца ссылки — в превью и в герое приглашения одной строкой. Время
 * скрыто настройками Steam (lib/playtime.ts) — слово вместо числа: «0 часов»
 * было бы сказано про галочку, а не про человека, и ушло бы в каждый чат.
 */
function inviteHours(invite: Pick<CompatInviteHead, 'totalHours' | 'playtimeHidden'>, locale: Locale): string {
  if (invite.playtimeHidden) return tr(locale, { ru: 'время скрыто', en: 'playtime hidden' })
  const word = pl(locale, invite.totalHours, { ru: ['час', 'часа', 'часов'], en: ['hour', 'hours'] })
  return `${fmtNumber(locale, invite.totalHours)} ${word}`
}

/**
 * Игры владельца ссылки: «12 игр», «1,234 games». Русское число — без
 * разрядов, как стояло всегда; английское — с запятой, как пишут по-английски
 */
function inviteGames(n: number, locale: Locale): string {
  const word = pl(locale, n, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })
  return `${tr(locale, { ru: String(n), en: fmtNumber(locale, n) })} ${word}`
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
 *
 * Колонки подписей — w-14 (56 px): английские «hidden», «20 min», «1,234 h»
 * не шире русских «скрыто», «20 мин», «1 234 ч», и шрифт ради них не жмётся.
 */
function HoursSplit({
  minutesA,
  minutesB,
  locale,
}: {
  minutesA: number | null
  minutesB: number | null
  locale: Locale
}) {
  // Время скрыто у обоих (lib/playtime.ts) — сравнивать нечего, строка без счёта
  if (minutesA === null && minutesB === null) return null
  const max = Math.max(minutesA ?? 0, minutesB ?? 0)
  // У скрытой стороны полосы нет вовсе: пустая полоса читалась бы нулём
  const share = (m: number | null) => (max && m ? `${(m / max) * 100}%` : '0%')
  const label = (m: number | null) =>
    m === null ? tr(locale, { ru: 'скрыто', en: 'hidden' }) : playedShort(m, locale)

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

function CommonRow({ game, locale }: { game: CompatGame; locale: Locale }) {
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
        <span lang={langOn(locale, game.name)} className="truncate text-[15px] font-extrabold tracking-[-0.01em]">
          {game.name}
        </span>
        <HoursSplit minutesA={game.minutesA} minutesB={game.minutesB} locale={locale} />
      </span>
    </GameLink>
  )
}

/**
 * «Нет у: …» — глоссарием «Not owned by: …». Короче русского «Нет у:» (44 px
 * на 13 px) естественной английской подписи нет: одна приставка — ~94 px.
 *
 * Поэтому на /en ниже md имена стоят своей строкой над ценой, а не в одном
 * ряду с ней. Замер на 360 px: рядом с обычной ценой («39,99 $») строке имён
 * достаётся 93 px, и английская приставка съедала их целиком — «Not owned
 * by…» без единого имени, когда русская «Нет у: Konst…» имя ещё показывала.
 * Своей строкой ей достаётся вся ширина карточки (~150 px), и имя видно.
 * С md карточка шире, и ряд прежний: на 768 px «Not owned by: Sergey»
 * теряет разве что последние буквы. Скринридер читает строку целиком.
 *
 * Русская разметка не тронута: там имя в ряду видно, и страница обязана
 * остаться прежней до байта.
 */
function PickCard({ pick, locale }: { pick: CompatPick; locale: Locale }) {
  const missing = (
    <span className="min-w-0 truncate">
      {withNicks(
        locale,
        tr(locale, {
          ru: `Нет у: ${pick.missingFor.join(', ')}`,
          en: `Not owned by: ${pick.missingFor.join(', ')}`,
        }),
        pick.missingFor,
      )}
    </span>
  )
  const price = (
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
  )
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
              {tr(locale, { ru: 'Есть у обоих', en: 'You both own it' })}
            </span>
          ) : locale === 'en' ? (
            // flex-1 — вся ширина ряда GameCardBody: колонка ниже md, ряд с md
            <span className="flex min-w-0 flex-1 flex-col gap-0.5 md:flex-row md:items-center md:justify-between md:gap-2">
              {missing}
              {price}
            </span>
          ) : (
            <>
              {missing}
              {price}
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
 *
 * Имя игры — в aria-label. Глазу «эта игра» — карточка над ссылкой, а
 * скринридеру соседний div ничего не связывает: ни абзаца, ни пункта
 * списка, ни ячейки. В списке ссылок полка звучала несколькими одинаковыми
 * «Позвать в эту игру», и какая куда зовёт, не понять (WCAG 2.4.4). Видимый
 * текст стоит в имени первым — голосовое управление находит ссылку по тому,
 * что на ней написано (2.5.3).
 */
function Shelf({
  kicker,
  hint,
  picks,
  index,
  invite = false,
  locale,
}: {
  kicker: string
  hint: string
  picks: CompatPick[]
  index: number
  invite?: boolean
  locale: Locale
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
              <PickCard pick={p} locale={locale} />
              {/* «Invite to this game» в колонке на два столбца не шире русской
                  подписи: на 360 px она не переносится, как и «Позвать в эту
                  игру». Кавычки вокруг имени в aria-label — по языку (quoted) */}
              <Link
                href={roomSeedHref(p.appid)}
                prefetch={false}
                aria-label={tr(locale, {
                  ru: `Позвать в эту игру — «${p.name}»`,
                  en: `Invite to this game — ${quoted(p.name, locale)}`,
                })}
                className="tap link-more self-start py-2"
              >
                {tr(locale, { ru: 'Позвать в эту игру', en: 'Invite to this game' })}
                <Icon name="arrow" size={14} />
              </Link>
            </div>
          ) : (
            <PickCard key={p.appid} pick={p} locale={locale} />
          ),
        )}
      </div>
    </m.section>
  )
}

export default async function CompatPage({ params }: { params: Promise<{ steamid: string; lang?: string }> }) {
  // Язык — из params, а не из next/root-params: страницу зовёт тест, а там
  // root-params бросает при импорте. Без lang (тест) — русский
  const { steamid: other, lang } = await params
  const locale = toLocale(lang)
  if (!STEAMID.test(other)) notFound()

  const db = await getDb()
  const session = await currentSession()
  const me = session?.steamid ?? null
  const now = nowSec()
  // Язык — в расчёт: от него имена (демо-ник, «Player 1234»), строка «Нет у: …»
  // и срок скидки полки «на будущее»
  const state = await loadCompat(db, { other, me, now, locale })
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
    const own = await loadCompatInvite(db, other, { locale })
    return (
      <CompatNotice
        locale={locale}
        title={tr(locale, { ru: 'Это твоя собственная ссылка', en: 'This is your own link' })}
        body={tr(locale, {
          ru: 'Кинь её кому-нибудь другому — сервис сравнит ваши библиотеки и покажет, во что вам зайти вместе.',
          en: "Send it to someone else — we'll compare your libraries and show you what to play together.",
        })}
        games={own?.topGames}
      >
        <CopyCompatLink steamid={other} className="btn-ember px-6 py-3" label={myLinkLabel(locale)} />
        <Link href={`/portrait/${other}`} className="tap link-more">
          {tr(locale, { ru: 'Посмотреть свой портрет', en: 'See your portrait' })}
          <Icon name="arrow" size={16} />
        </Link>
      </CompatNotice>
    )
  }

  if (state.kind === 'noprofile') {
    return (
      <CompatNotice
        locale={locale}
        title={
          state.otherName === null
            ? tr(locale, { ru: 'Этот игрок ещё не подключал библиотеку', en: "This player hasn't connected a library yet" })
            : withNicks(
                locale,
                tr(locale, {
                  ru: `${state.otherName} ещё не подключал библиотеку`,
                  en: `${state.otherName} hasn't connected a library yet`,
                }),
                [state.otherName],
              )
        }
        body={tr(locale, {
          ru: 'Сравнивать пока не с чем. Можно кинуть в ответ свою ссылку — сравнение соберётся, когда по ней подключат библиотеку.',
          en: "There's nothing to compare yet. You can send your own link back — the comparison will be ready once someone connects a library through it.",
        })}
      >
        {me && <CopyCompatLink steamid={me} className="btn-ember px-6 py-3" label={myLinkLabel(locale)} />}
        <Link href="/compat" className="tap link-more">
          <Icon name="arrow" size={16} className="rotate-180" />
          {tr(locale, { ru: 'К своей ссылке', en: 'Go to your link' })}
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
        <InviteHero invite={invite} locale={locale} />
        <div className="mx-auto flex w-full max-w-md flex-col gap-3 px-5 pb-24 text-center">
          {state.kind === 'noauth' ? (
            <>
              <p className="text-sm leading-relaxed text-dim">
                {tr(locale, {
                  ru: 'Подключи свою библиотеку — и увидите общий процент, общие игры и во что вам зайти вместе. Прочитаем игры с часами и открытый список желаемого, ничего не публикуем.',
                  en: "Connect your library to see your match percentage, the games you have in common and what to play together. We'll read your games with playtime and your public wishlist, and we never post anything.",
                })}
                {/* Демо-личность отметок не получает (compat_views) — обещать ей нечего */}
                {!isDemoId(other) && (
                  <>
                    {' '}
                    {withNicks(
                      locale,
                      tr(locale, {
                        ru: `После входа через Steam ${invite.name} увидит у себя, что вы сравнились.`,
                        en: `Once you sign in with Steam, ${invite.name} will see that you compared libraries.`,
                      }),
                      [invite.name],
                    )}
                  </>
                )}
              </p>
              {/* Язык входа — в адресе (lang=en), а не догадкой по Referer: его
                  браузер может и не прислать, а возврат обязан прийти на ту же
                  английскую страницу (app/api/auth/steam) */}
              <a
                href={withLang(`/api/auth/steam?compat=${other}`, locale)}
                className="btn-ember is-block py-3"
              >
                {tr(locale, { ru: 'Войти через Steam', en: 'Sign in with Steam' })}
              </a>
              <Link href={`/?compat=${other}`} className="btn-glass flex w-full">
                {tr(locale, { ru: 'Вставить ссылку на профиль / демо', en: 'Paste a profile link or try the demo' })}
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm leading-relaxed text-dim">
                {tr(locale, {
                  ru: 'Твоя библиотека ещё не подключена — сравнивать пока не с чем.',
                  en: "Your library isn't connected yet, so there's nothing to compare.",
                })}
              </p>
              <Link
                href={reconnectHref({ compat: other })}
                className="btn-ember is-block py-3"
              >
                {tr(locale, { ru: 'Подключить библиотеку', en: 'Connect your library' })}
              </Link>
            </>
          )}
        </div>
      </div>
    )
  }

  const d = state.data
  const hidden = d.commonTotal - d.commonGames.length
  const pairHeading = (
    <SplitHeading className="font-display text-display-lg" delay={0.18}>
      {`${d.myName} × ${d.otherName}`}
    </SplitHeading>
  )
  /*
   * «Sergey × Костя» — заголовок из одних ников, и текст его скринридер берёт
   * из aria-label: разрезать строку там нельзя, а SplitHeading lang не
   * принимает. Поэтому на /en весь заголовок — 'ru', если русский хоть один
   * ник: латинский ник русский голос прочтёт так же, как на русской странице,
   * а русский английским — только по буквам. Слов, кроме ников, в нём нет.
   * Русская страница обёртки не получает
   */
  const pairLang = langOn(locale, d.myName) ?? langOn(locale, d.otherName)
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
          <Eyebrow className="mb-3">{tr(locale, { ru: 'Совместимость', en: 'Compatibility' })}</Eyebrow>
          {pairLang ? <div lang={pairLang}>{pairHeading}</div> : pairHeading}
          <p className="mt-4 max-w-xl font-display text-display-md text-dim">{verdict(d.percent, locale)}</p>
          {/*
            Процент — главное число страницы, и он стоит крупно, как счёт, а не
            в кольце на 200 px: кольцо читалось приборной панелью. Рядом — то,
            из чего он сложился.
          */}
          <dl className="mt-10 flex flex-wrap items-end gap-x-10 gap-y-6 md:gap-x-12">
            {/* На телефоне процент — отдельной строкой, два числа под ним рядом */}
            <div className="flex basis-full flex-col-reverse md:basis-auto">
              <dt className="lib-stat-label">{tr(locale, { ru: 'совместимость вкусов', en: 'taste match' })}</dt>
              <dd className="lib-stat compat-percent text-ember-text">
                {d.percent}
                <span className="compat-percent-sign">%</span>
              </dd>
            </div>
            <div className="flex flex-col-reverse">
              <dt className="lib-stat-label">
                {pl(locale, d.commonTotal, {
                  ru: ['общая игра', 'общие игры', 'общих игр'],
                  en: ['game in common', 'games in common'],
                })}
              </dt>
              <dd className="lib-stat">{fmtNumber(locale, d.commonTotal)}</dd>
            </div>
            {d.sharedTags.length > 0 && (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">
                  {pl(locale, d.sharedTags.length, {
                    ru: ['общая тема', 'общие темы', 'общих тем'],
                    en: ['shared theme', 'shared themes'],
                  })}
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
              sub={tr(locale, {
                ru: 'Эти темы совпадают у вас чаще, чем у случайной пары — считаем по редкости тега в каталоге, а не по популярности.',
                en: 'You share these themes more often than a random pair would — we weigh each tag by how rare it is in the catalog, not by how popular.',
              })}
              className="mb-5"
            >
              {tr(locale, { ru: 'Что вас роднит', en: 'What you have in common' })}
            </SectionTitle>
            <ul className="flex flex-wrap gap-2">
              {d.sharedTags.map((tag, i) => (
                <li key={tag} className={`compat-tag ${i === 0 ? 'is-top' : ''}`}>
                  {tagLabel(tag, locale)}
                </li>
              ))}
            </ul>
          </m.section>
        )}

        <m.section {...inView(1)}>
          {d.commonTotal > 0 ? (
            <>
              <SectionTitle sub={withNicks(locale, commonTimeLine(d, locale), [d.otherName])} className="mb-4">
                {tr(locale, { ru: 'Общие игры', en: 'Games in common' })}
              </SectionTitle>
              {/* Легенда заодно подписывает колонки: какое число чьё, иначе
                  видно только по порядку слов в заголовке страницы. Чисел
                  нет — подписывать нечего */}
              {!noHours && (
                <div className="mb-3 flex flex-wrap items-center gap-4 text-[13px] font-semibold text-dim">
                  <span lang={langOn(locale, d.myName)} className="flex items-center gap-1.5">
                    <span aria-hidden className="h-2 w-2 rounded-full bg-ember" />
                    {d.myName}
                  </span>
                  <span lang={langOn(locale, d.otherName)} className="flex items-center gap-1.5">
                    <span aria-hidden className="h-2 w-2 rounded-full bg-info" />
                    {d.otherName}
                  </span>
                </div>
              )}
              <div className="flex flex-col gap-1">
                {d.commonGames.map((g) => (
                  <CommonRow key={g.appid} game={g} locale={locale} />
                ))}
              </div>
              {hidden > 0 && (
                <p className="mt-3 text-xs text-faint">
                  {/* Время скрыто у обоих — порядок не по часам, и «самых
                      наигранных» было бы неправдой */}
                  {noHours
                    ? tr(locale, {
                        ru: `Показаны ${COMMON_SHOWN} из ${d.commonTotal}.`,
                        en: `Showing ${COMMON_SHOWN} of ${fmtNumber(locale, d.commonTotal)}.`,
                      })
                    : tr(locale, {
                        ru: `Показаны ${COMMON_SHOWN} самых наигранных из ${d.commonTotal}.`,
                        en: `Showing the ${COMMON_SHOWN} most played of ${fmtNumber(locale, d.commonTotal)}.`,
                      })}
                </p>
              )}
            </>
          ) : (
            <SectionTitle
              sub={tr(locale, {
                ru: 'Общих игр нет — вы играете в разное. Тем интереснее собрать пати.',
                en: 'No games in common — you play different things. All the more reason to start a party.',
              })}
            >
              {tr(locale, { ru: 'Общие игры', en: 'Games in common' })}
            </SectionTitle>
          )}
        </m.section>

        <Shelf
          kicker={tr(locale, { ru: 'Заходите прямо сейчас', en: 'Jump in now' })}
          hint={tr(locale, {
            ru: 'Есть у обоих, живое и рассчитано на компанию.',
            en: 'You both own these — still alive and made for a group.',
          })}
          picks={d.playNow}
          index={2}
          invite
          locale={locale}
        />
        <Shelf
          kicker={tr(locale, { ru: 'Нет ни у кого — на будущее', en: 'Neither of you has these — for later' })}
          hint={tr(locale, {
            ru: 'Мультиплеер, подобранный по суммарному вкусу двоих.',
            en: 'Multiplayer games picked for your combined taste.',
          })}
          picks={d.playLater}
          index={3}
          locale={locale}
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
              {tr(locale, { ru: 'Собрать пати вместе', en: 'Start a party together' })}
            </Link>
          </Magnet>
          <CopyOwn steamid={d.me} inline locale={locale} />
          <Link href={`/portrait/${d.other}`} className="tap link-more p-2">
            {/* «Портрет Демо-игрок» не склонялось: ник — не слово, и падеж
                ему даёт только приложение «игрока», как в заголовке портрета.
                По-английски падежа нет, и имя встаёт вперёд: «Sergey's» */}
            {withNicks(
              locale,
              tr(locale, { ru: `Портрет игрока ${d.otherName}`, en: `${d.otherName}'s player portrait` }),
              [d.otherName],
            )}
            <Icon name="arrow" size={16} />
          </Link>
          {/* Что осталось после этого экрана — говорится здесь же, а не в политике */}
          {records && (
            <p className="basis-full text-center text-xs text-faint">
              {withNicks(
                locale,
                tr(locale, {
                  ru: `${d.otherName} увидит у себя, что вы сравнились, и ваш процент.`,
                  en: `${d.otherName} will see your comparison and your match percentage.`,
                }),
                [d.otherName],
              )}
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
  locale,
}: {
  invite: Pick<CompatInvite, 'name' | 'gamesCount' | 'totalHours' | 'playtimeHidden' | 'topGames'>
  locale: Locale
}) {
  return (
    <section className="media-dark anim-reveal relative flex min-h-[62svh] flex-col justify-end overflow-hidden">
      <CoverWall rows={[invite.topGames, [...invite.topGames].reverse()]} />
      <div aria-hidden className="cwall-scrim" />
      <div aria-hidden className="grain" />
      <div className="relative mx-auto w-full max-w-2xl px-5 pb-10 pt-32 text-center">
        <Eyebrow className="mb-3">{tr(locale, { ru: 'Совместимость', en: 'Compatibility' })}</Eyebrow>
        <h1 className="font-display text-display-lg">
          {withNicks(locale, inviteTitle(invite.name, locale), [invite.name])}
        </h1>
        <p className="mt-4 text-sm text-dim">
          {inviteGames(invite.gamesCount, locale)} · {inviteHours(invite, locale)}
        </p>
      </div>
    </section>
  )
}

/** «Моя ссылка совместимости» — подпись кнопки своей ссылки на всех экранах страницы */
function myLinkLabel(locale: Locale): string {
  return tr(locale, { ru: 'Моя ссылка совместимости', en: 'My compatibility link' })
}

/**
 * «Моя ссылка» раньше уводила на хаб /compat, хотя steamid зрителя страница уже
 * знала — поле приезжало на клиент и не читалось вообще. Копируем на месте:
 * открыл чужую ссылку, увидел свой процент, забрал свою.
 */
function CopyOwn({ steamid, inline = false, locale }: { steamid: string; inline?: boolean; locale: Locale }) {
  return (
    <CopyCompatLink
      steamid={steamid}
      className={
        inline
          ? 'btn-glass px-6'
          : 'btn-ember is-block py-3'
      }
      label={myLinkLabel(locale)}
    />
  )
}
