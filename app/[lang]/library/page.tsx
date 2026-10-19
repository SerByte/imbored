import Link from '@/components/Link'
import { redirect } from 'next/navigation'
import { Suspense, type ReactNode } from 'react'
import { GameArt } from '@/components/GameArt'
import { GameCardBody } from '@/components/GameCard'
import { Icon } from '@/components/Icon'
import { PlaytimeHiddenNote, PrivacyHelp } from '@/components/PrivacyHelpView'
import { SignOut } from '@/components/SignOut'
import { WarmCatalog } from '@/components/WarmCatalog'
import { BannedShelf, type BannedGame } from '@/components/BannedShelf'
import { DemoBar } from '@/components/DemoBar'
import { trimArt } from '@/lib/art'
import { fmtNumber, lp, pl, toLocale, tr, type Locale } from '@/lib/i18n'
import {
  bannedAppids,
  feedbackStats,
  getGamesMetaLite,
  getLatestSnapshot,
  listBanned,
  loadTagStats,
  listEvenings,
  listLiked,
  getOlderSnapshotMinutes,
  countLiked,
  getWishlist,
  getFeedLink,
  livePlanAppids,
  latestMajorPatchSince,
} from '@/lib/db'
import { patchSinceLead, wallPatchPairs } from '@/lib/comeback'
import {
  buildLibraryView,
  dayKey,
  forgottenCandidates,
  LIBRARY_FILTERS,
  LIBRARY_PAGE_SIZE,
  libraryFilterLabel,
  libraryHref,
  libraryPage,
  parseLibraryFilter,
  parseLibraryPage,
  parseLibraryQuery,
  pickForgotten,
  searchLibraryView,
  shelfEmpty,
  wallState,
} from '@/lib/forgotten'
import { isReplayable, type LibraryTileState } from '@/lib/recommend'
import { currentSession, getDb, isDemoId, isWriter, nowSec } from '@/lib/server'
import { backlogValue } from '@/lib/stats'
import { byPrices, formatPrice } from '@/lib/steamregion'
import { tagWeightFrom } from '@/lib/tagweight'
import { bounceTo, reconnectHref, steamLoginFor } from '@/lib/destination'
import { Eyebrow } from '@/components/Labels'
import { GameLink } from '@/components/GameLink'
import { LinkPending } from '@/components/LinkPending'
import { LibrarySearch } from '@/components/LibrarySearch'
import { RailToCurrent } from '@/components/RailToCurrent'
import { ShelfToStart } from '@/components/ShelfToStart'
import { StatusLine } from '@/components/StatusLine'
import { dateLabel } from '@/lib/freshness'
import { storeUrlFor } from '@/lib/gamedesc'
import {
  askableNow,
  eveningPlayed,
  eveningsSummary,
  OUTCOME_TTL_SEC,
  playedEnough,
  playedLine,
} from '@/lib/outcome'
import { Evenings, type EveningItem } from '@/components/Evenings'
import { LikedShelf, type LikedGame } from '@/components/LikedShelf'
import { NeedSteam } from '@/components/NeedSteam'
import { pickSnapshotDelta } from '@/lib/libdelta'
import { playedShort, playtimeHidden } from '@/lib/playtime'
import type { Metadata, ResolvingMetadata } from 'next'
import { ownAddress } from '@/lib/site'
import { WishlistShelf } from './WishlistShelf'

/*
 * Язык — из params, а не getLocale(): у страницы есть тест деревом
 * (page.test.ts), а next/root-params вне сборки бросает при импорте.
 * Индексировать страницу нечего (robots), поэтому русская — без alternates и
 * своего openGraph: только вкладка и превью ссылки. Английской свой openGraph
 * нужен ради подписи карточки (docs/i18n.md, п. 10): корневая подписана
 * по-русски, а переподписывает её ownAddress — вместе со своим адресом, как
 * у каждого своего openGraph (lib/social.test.ts).
 */
export async function generateMetadata(
  props: PageProps<'/[lang]/library'>,
  parent: ResolvingMetadata,
): Promise<Metadata> {
  const locale = toLocale((await props.params).lang)
  const text = tr(locale, {
    ru: {
      title: 'Библиотека',
      description: 'Вся твоя Steam-библиотека одной стеной: что заброшено, что ни разу не запускалось и сколько это стоило.',
    },
    en: {
      title: 'Library',
      description: "Your whole Steam library on one wall: what's abandoned, what's never been launched and what it all cost.",
    },
  })
  return locale === 'en' ? ownAddress('/library', text)(props, parent) : text
}

export const dynamic = 'force-dynamic'

/**
 * Две полосы бэклога читаются как иерархия: «не распакована» теперь стоит там,
 * где это правда (ноль минут), а игра, которую открыли и закрыли, получила своё
 * имя. Раньше обе были «не распакована» — включая ту, где на счётчике 110 минут.
 * Ember зарезервирован за «играешь сейчас» и в эту пару не отдаётся.
 *
 * Английские слова — те же, что у чипсов и бейджей источника (глоссарий:
 * Unopened, Bounced off, Abandoned), только строчными: подпись стоит в
 * строке под названием, как и русская. Не шире русских — плитка в две
 * колонки на телефоне, и подпись обрезается рядом с меткой «обновлялась».
 */
const STATE_LABEL: Record<LibraryTileState, { text: Record<Locale, string>; cls: string }> = {
  active: { text: { ru: 'играешь сейчас', en: 'playing now' }, cls: 'text-ember-text' },
  untouched: { text: { ru: 'не распакована', en: 'unopened' }, cls: 'text-info' },
  unplayed: { text: { ru: 'открыл и закрыл', en: 'bounced off' }, cls: 'text-info' },
  comeback: { text: { ru: 'заброшена', en: 'abandoned' }, cls: 'text-dim' },
  played: { text: { ru: '', en: '' }, cls: 'text-dim' },
}

/** Запасное имя игры без метаданных — глоссарий: «Игра 730» / «Game 730» */
function gameFallback(appid: number, locale: Locale): string {
  return tr(locale, { ru: `Игра ${appid}`, en: `Game ${appid}` })
}

/** «в 3 из 5 советов» · «3 of 5 picks» — одни формы на обе подписи над вечерами */
const OF_PICKS: { ru: [string, string, string]; en: [string, string] } = {
  ru: ['совета', 'советов', 'советов'],
  en: ['pick', 'picks'],
}

/** Сколько советов на полке «Твои вечера»: свежие; сводка — по всем за окно */
const EVENINGS_SHOWN = 12

/** С какого числа сверенных советов показывать честную долю */
const EVENINGS_HONEST_MIN = 3

/** С какого размера библиотеки над стеной стоит поиск */
const SEARCH_FROM = 12

/** Сколько постеров в мозаике героя: пять колонок по три на широком экране */
const MOSAIC = 15

export default async function LibraryPage(props: PageProps<'/[lang]/library'>) {
  // Сессия целиком, а не только steamid: SignOut ниже спрашивает, доказано ли
  // владение профилем — от этого зависит, предлагать ли «выйти везде».
  const session = await currentSession()
  // Гостя без куки разворачивает proxy.ts настоящим 307 ещё до рендера:
  // отсюда редирект ушёл бы статусом 200 — каркас loading.tsx к этому моменту
  // уже отдан. Здесь остаются протухшая и поддельная кука.
  // Лендинг — на языке страницы: с /en/library — на /en?next=…
  const locale = toLocale((await props.params).lang)
  if (!session) redirect(lp(locale, bounceTo('/library')))
  const { steamid } = session
  // Видеть оценки, скрытое и вечера — тому же, кто вправе их писать (isWriter):
  // см. докблок чтений ниже
  const writer = isWriter(session)

  const db = await getDb()
  const query = await props.searchParams
  const filter = parseLibraryFilter(query.state)
  const asked = parseLibraryQuery(query.q)
  /*
   * Независимые чтения — одним заходом, а не лесенкой.
   *
   * Снапшот, забаненное и статистика отзывов друг от друга не зависят вовсе, а
   * шли по очереди: обход к Turso за обходом там, где хватает одного. Страница
   * объявлена force-dynamic (export dynamic выше), кэша у неё нет, и эта
   * лесенка ложится в TTFB КАЖДОГО захода. По замеру из соседнего роута комнаты один
   * обход стоит около полутора сотен миллисекунд.
   *
   * Цена размена: у человека с сессией, но без снапшота (редирект строкой
   * ниже) остальные запросы уходят впустую. Это редкий случай — снапшот пишется тем
   * же действием, что заводит сессию, — и он молчаливый, в отличие от
   * задержки, которую видят все.
   *
   * getGamesMetaLite остаётся отдельно: ему нужны appid И из библиотеки, И из
   * забаненного, то есть он честно зависит от обоих.
   *
   * Баны дважды, и это не повтор: listBanned — полка с датами и потолком в
   * шестьдесят плиток, bannedAppids — все до одного, для отсева полки
   * забытого. Шестьдесят первая скрытая игра иначе вернулась бы туда под
   * видом «ты забыл, что она у тебя есть».
   *
   * ОЦЕНКИ, СКРЫТОЕ И ВЕЧЕРА — ТОЛЬКО ТОМУ, КТО ВПРАВЕ ИХ ПИСАТЬ.
   * Пишет их лишь сессия, доказавшая владение профилем (Steam OpenID) или
   * демо, а сессию по вставленной ссылке /api/connect выдаёт на любой
   * публичный профиль. Раньше такая сессия получала всё это целиком и только
   * без кнопок: чужой человек со ссылкой видел, что владелец скрыл и когда,
   * что ему «зашло», во что он играл после советов и как часто подбор
   * попадал. Теперь эти чтения ей не делаются вовсе — пустое не утечёт
   * ни в HTML, ни в пропсы клиентских полок. Правило то же, что у GET
   * /api/outcome и «кто открыл» на /compat. Честному владельцу на втором
   * устройстве это стоит одного входа через Steam: вместо полок ему строка
   * NeedSteam.
   *
   * bannedAppids читается всем — но только для отсева полки забытого и
   * наружу не выводится: иначе скрытая владельцем игра вернулась бы на полку
   * под видом «ты забыл», теперь уже любому со ссылкой.
   *
   * Карта тегов — только полке «Не распакованы»: из всей страницы по вкусу
   * ранжирует она одна, и читать четыре сотни строк tags на каждый заход ради
   * остальных полок незачем.
   *
   * Список желаемого — шестое личное чтение и за той же проверкой: что человек
   * хочет купить, — его дело, а не того, у кого есть ссылка на профиль. Одна
   * строка по ключу; Steam, если строка протухла, зовёт уже полка
   * (WishlistShelf), и страницу он не держит.
   *
   * Есть ли RSS-ссылка — только у вошедшего через Steam: ровно ему SignOut
   * предлагает «выйти везде», а это гасит и ссылку, и подтверждение обязано
   * об этом сказать. Одна строка по первичному ключу.
   *
   * Живые планы на вечер (lib/eveningplan.ts) — тому же, кто их ставил:
   * пишущей сессии не из демо, как и сама живая строка. Игра плана бывает и
   * вечером на полке — советовали, запускали, потом поставили на загрузку, —
   * и «Вернуться к ней» оттуда обязана закрыть план, как запуск со страницы
   * игры (components/Evenings). План ЭТОЙ игры, даже не самый свежий
   * (livePlanAppids, а не latestEveningPlan): вчерашний у одной и утренний у
   * другой живут разом, и по одному свежему запуск старшей не писался — её
   * план вставал живой строкой, едва закрывали свежий. Свои строки за
   * полтора дня по индексу; отказ чтения — просто без плана, полка от него
   * не зависит.
   */
  const [snapshot, banned, bannedAll, stats, tagStats, evenings, liked, likedTotal, older, wishlist, feedLink, plans] = await Promise.all([
    getLatestSnapshot(db, steamid),
    writer ? listBanned(db, steamid) : [],
    bannedAppids(db, steamid),
    // rate: null — и блока «Подбор попадает в N%» нет, как у того, кто ещё не оценивал
    writer ? feedbackStats(db, steamid) : { liked: 0, skipped: 0, rate: null },
    filter === 'untouched' ? loadTagStats(db) : null,
    // «Твои вечера» — советы за тот же срок, что их хранят (OUTCOME_TTL_SEC)
    writer ? listEvenings(db, steamid, nowSec() - OUTCOME_TTL_SEC) : [],
    // Полка «Зашло» — что подбор запомнил как понравившееся, и сколько всего
    writer ? listLiked(db, steamid) : [],
    writer ? countLiked(db, steamid) : 0,
    // Прежние снимки парами [appid, минуты] — для строки «с прошлого снимка»
    getOlderSnapshotMinutes(db, steamid),
    // «Из желаемого подешевело» — последний прочитанный список
    writer ? getWishlist(db, steamid) : null,
    session?.verified ? getFeedLink(db, steamid) : null,
    writer && !isDemoId(steamid)
      ? livePlanAppids(db, steamid, nowSec()).catch(() => new Set<number>())
      : new Set<number>(),
  ])
  if (!snapshot) redirect(lp(locale, bounceTo('/library')))

  const now = nowSec()
  // Сводка, деньги и прогрев считаются по ВСЕЙ библиотеке, а не по выбранной
  // полке: иначе числа в шапке прыгали бы вслед за фильтром
  const games = snapshot.games
  // Запрос — только там, где стоит поле (SEARCH_FROM). Иначе ?q= из
  // набранного руками адреса или старой ссылки молча сужал бы стену и
  // счётчики чипсов, чипсы несли бы его дальше, а показать запрос и сбросить
  // его было бы негде: «Сбросить поиск» появляется, только когда не нашлось
  // ничего. Поле не рисуется условием от самого q и по той же причине:
  // стёр запрос — и поле исчезло бы из-под пальцев, уронив фокус в body.
  const q = games.length >= SEARCH_FROM ? asked : ''
  const totalHours = Math.round(games.reduce((s, g) => s + g.playtimeForever, 0) / 60)
  // Время скрыто настройками Steam (lib/playtime.ts): часы, «ни разу не
  // запускал» и минуты после советов — нули галочки, а не факты
  const timeHidden = playtimeHidden(games)

  // Только игры библиотеки, а не весь каталог: нужны обложки для сетки и
  // цена бэклога, и то и другое считается по своим играм.
  //
  // Забаненное добирается тем же запросом, а не вторым: забанить можно и игру,
  // которой у тебя нет (герой /play бывает каталожным), поэтому её appid в
  // библиотеке не встретится, но обложка на полку нужна.
  // Узкой выборкой: скриншоты на этой странице не показываются нигде
  // Свежие двенадцать — и, сверх них, каждый совет, о котором сейчас можно
  // спросить (askableNow — правило pendingOutcomeAsk): на него ведёт «Как
  // тебе X?» с главной и из OutcomeAsk, и ответить должно быть где, даже если
  // после него было ещё двенадцать советов. Поздняя сверка — совет месячной
  // давности, и без этого вернувшийся не нашёл бы его на полке вовсе
  const shownEvenings = evenings.filter((e, i) => i < EVENINGS_SHOWN || askableNow(e, nowSec()))
  const metas = await getGamesMetaLite(db, [
    ...new Set([
      ...games.map((g) => g.appid),
      ...banned.map((b) => b.appid),
      ...shownEvenings.map((e) => e.appid),
      ...liked.map((l) => l.appid),
    ]),
  ])
  const bannedGames: BannedGame[] = banned.map((b) => {
    const meta = metas.get(b.appid)
    return {
      appid: b.appid,
      // Каталог мог не дойти до этой игры — имя как у ArtPlaceholder, но полка
      // всё равно обязана показать плитку: иначе бан не снять вообще
      name: meta?.name ?? gameFallback(b.appid, locale),
      headerImage: meta?.headerImage ?? null,
      art: trimArt(meta?.art),
      done: b.done,
    }
  })
  const likedGames: LikedGame[] = liked.map((l) => {
    const meta = metas.get(l.appid)
    return {
      appid: l.appid,
      name: meta?.name ?? gameFallback(l.appid, locale),
      headerImage: meta?.headerImage ?? null,
      art: trimArt(meta?.art),
    }
  })
  const backlog = backlogValue(games, (id) => metas.get(id), now)

  // Сводка — по всем советам окна, полка — по свежим (EVENINGS_SHOWN). При
  // скрытом времени сверять нечем: сверенные раньше нули — не «не запускал»
  const eveningsTotal = eveningsSummary(timeHidden ? [] : evenings)
  /*
   * Подпись над полкой «Твои вечера» — здесь, а не в клиентском Evenings:
   * разметка в пропсах едет в RSC, а не в JS маршрута, а /library стоит у
   * потолка бюджета (bundle-budget.json).
   *
   * Каждая ветка обещает только то, что случится. «Минуты подтянутся» — пока
   * есть несверенный совет и время открыто: следующий снапшот сверит его, даже
   * если человек пропадал дольше окна (поздняя сверка). При скрытом времени —
   * не подтянутся, пока Steam его не покажет. Поздние минуты — отдельной
   * фразой: в долю они не идут (eveningsSummary), и молча выкинуть то, что
   * человек наиграл по совету, пока его не было, было бы нечестно в другую
   * сторону.
   *
   * Английская подпись — своей функцией (eveningsLeadEn): ветки те же, но
   * фразы целые, а не русские куски в английском порядке.
   */
  const lateHours = eveningsTotal.lateMinutes > 0 ? playedLine(eveningsTotal.lateMinutes, locale) : null
  const eveningsLead =
    locale === 'en' ? (
      eveningsLeadEn({
        total: eveningsTotal,
        lateHours,
        timeHidden,
        pending: evenings.some((e) => e.minutes === null),
      })
    ) : eveningsTotal.checked > 0 ? (
      <>
        Наиграно после наших советов:{' '}
        <span className="text-ink tabular-nums">{playedLine(eveningsTotal.minutes)}</span>. Всерьёз, от
        пятнадцати минут, — в <span className="tabular-nums">{eveningsTotal.played}</span> из{' '}
        <span className="tabular-nums">{eveningsTotal.checked}</span>{' '}
        {pl(locale, eveningsTotal.checked, OF_PICKS)}.
        {lateHours && (
          <>
            {' '}
            Ещё <span className="text-ink tabular-nums">{lateHours}</span> набежало, пока тебя не было, — их
            мы сверили позже и в долю не считаем.
          </>
        )}
      </>
    ) : lateHours ? (
      <>
        Пока тебя не было, после наших советов набежало{' '}
        <span className="text-ink tabular-nums">{lateHours}</span> — сверили по первому снимку библиотеки
        после возвращения.
      </>
    ) : timeHidden ? (
      'Что мы советовали и что из этого вышло. Минуты появятся, когда Steam снова покажет время игры.'
    ) : evenings.some((e) => e.minutes === null) ? (
      'Что мы советовали и что из этого вышло. Минуты подтянутся со следующим снимком библиотеки.'
    ) : (
      'Что мы советовали и что из этого вышло.'
    )
  // Доля от трёх сверенных советов и больше: «сыграно в 100%» по одному — шум
  const honest = eveningsTotal.checked >= EVENINGS_HONEST_MIN
  const ownedNow = new Set(games.map((g) => g.appid))
  // Уже пройденное — из того же чтения, что полка «Пройдено»: кнопки «Уже
  // прошёл» у вечера с такой игрой нет, есть слово (components/Evenings)
  const doneNow = new Set(banned.filter((b) => b.done).map((b) => b.appid))
  const eveningItems: EveningItem[] = shownEvenings.map((e) => {
    const meta = metas.get(e.appid)
    return {
      appid: e.appid,
      shownAt: e.shownAt,
      name: meta?.name ?? gameFallback(e.appid, locale),
      headerImage: meta?.headerImage ?? null,
      art: trimArt(meta?.art),
      date: dateLabel(e.shownAt, { locale }),
      played: timeHidden ? tr(locale, { ru: 'время скрыто', en: 'time hidden' }) : eveningPlayed(e, locale),
      playedEnough: playedEnough(e.minutes),
      verdict: e.verdict,
      owned: ownedNow.has(e.appid),
      // Пул других магазинов хранит русскую страницу; на /en — английская
      // (storeUrlFor), как у той же игры на /play. Steam — null: адрес собирает островок
      storeUrl: storeUrlFor(meta, locale),
      // Мера та же, что у «Продолжить» на /play (continueView): без меты — не знаем
      finishable: !!meta && !isReplayable(meta),
      finished: doneNow.has(e.appid),
    }
  })
  // Живые планы — только игр этой полки: закрывать с неё больше нечего, и в
  // пропсы островка лишнее не едет. Без повторов: одну игру советуют и дважды
  const eveningPlans = [...new Set(eveningItems.map((i) => i.appid))].filter((a) => plans.has(a))

  // В библиотеку можно зайти в обход подбора: если обложек ещё нет — догреем
  const missingArt = games.filter((g) => !metas.get(g.appid)?.headerImage).length

  const metaOf = (id: number) => metas.get(id)
  // Что изменилось с прошлого снимка — с первого, с которым есть о чём
  // сказать (pickSnapshotDelta). Снимки и отметки года /privacy обещает ради
  // «динамики бэклога и итогов» — вот динамика
  const since = pickSnapshotDelta(older, snapshot, metaOf)
  // Та же мера вкуса, что у /play: без карты тегов — сырой косинус
  const view = buildLibraryView(games, metaOf, filter, now, tagStats ? tagWeightFrom(tagStats) : null)
  // Два разных числа: в строке-сводке — «ни разу не запускал» (ноль минут), в
  // карточке денег — весь бэклог до двух часов, как и раньше. Деньги считает
  // backlogValue по своему определению. Сводка берётся из счётчиков чипсов, а
  // не считается рядом: саундтреки и SDK бэклогом не считаются ни там, ни там
  // (looksLikeNonGame), и строка, чипс «Не распакованы» и ссылка «Все
  // нераспакованные» обязаны назвать одно и то же число.
  const untouched = view.counts.untouched
  // Порция полки, а не вся полка: см. LIBRARY_PAGE_SIZE в lib/forgotten.ts
  // Поиск отбирает внутри полки; сводка выше и деньги — по-прежнему по всему
  const found = searchLibraryView(view, games, metaOf, now, q)
  const wall = libraryPage(found.games, parseLibraryPage(query.page))
  const stateOf = (g: (typeof wall.shown)[number]) => wallState(g, metas.get(g.appid), now, timeHidden)
  /*
   * «Обновлялась» у заброшенных плиток порции — один обход по парам игра —
   * последний запуск (latestMajorPatchSince), и только когда такие плитки
   * есть. Пары отдаёт wallPatchPairs, и она же держит правило: метка —
   * производная от даты последнего запуска, поэтому только writer-сессии и не
   * при скрытом времени. Иначе пар нет, запроса нет, и в HTML нечему утечь.
   *
   * БЕЗ await. Пары зависят от метаданных (порядок, поиск, фильтр), так что
   * запрос встал бы третьей ступенью лесенки выше — ещё один обход в TTFB
   * почти каждого захода владельца со старыми играми, ради декоративной
   * метки. Промис уходит в <Suspense> у плитки (RefreshedPill): стена приходит
   * первым HTML, метка догружается стримом. Сбой запроса — просто без меток:
   * отказ базы здесь не повод ронять страницу.
   *
   * С языком страницы: на /en «подтверждённый» патч — с английским пересказом
   * (tldr_en), как у причины на /en/play. Метка и причина обязаны называть
   * один и тот же факт.
   */
  const patchPairs = wallPatchPairs(wall.shown, stateOf, { hidden: timeHidden, writer })
  const updatedP = patchPairs.length
    ? latestMajorPatchSince(db, patchPairs, locale).catch(() => new Map<number, string>())
    : null
  const mayRefresh = new Set(patchPairs.map(([appid]) => appid))
  const shelf = pickForgotten(
    // «Больше не показывать» — и здесь: полка тоже совет
    forgottenCandidates(games, metaOf, bannedAll),
    // Соль обязательна: без неё первый слот полки коррелировал бы с выбором
    // «Игры дня» — там сид тех же двух частей
    `${steamid}:${dayKey(new Date(now * 1000))}:shelf`,
  )

  // Мозаика героя — самые наигранные: свою полку узнают по тому, во что играли
  const mosaic = [...games].sort((a, b) => b.playtimeForever - a.playtimeForever).slice(0, MOSAIC)

  return (
    <div className="flex-1 flex flex-col">
      <WarmCatalog enabled={missingArt > 0} />
      {/*
        ГЕРОЙ — ЕГО ПОЛКА, А НЕ ЗАГОЛОВОК НАД НЕЙ.
        Справа мозаика постеров самых наигранных игр под наклоном ленты
        главной, слева на скриме — заголовок и три числа крупно. Кино-зона:
        постеры остаются на тёмном и в светлой теме, как арт в герое выдачи.
      */}
      <section className="media-dark lib-hero relative overflow-hidden">
        {mosaic.length > 0 && (
          <div aria-hidden className="lib-mosaic">
            {mosaic.map((g) => (
              <span key={g.appid} className="lib-mosaic-cell">
                <GameArt
                  appid={g.appid}
                  name={g.name}
                  headerImage={metas.get(g.appid)?.headerImage ?? null}
                  art={trimArt(metas.get(g.appid)?.art)}
                  variant="poster"
                  // Фон под скримом: на телефоне хватает постера 300 px и при
                  // плотности 3x — 600-пиксельный весил вчетверо больше
                  sizes="(max-width: 767px) 100px, 180px"
                  fallback={null}
                  className="h-full w-full object-cover"
                />
              </span>
            ))}
          </div>
        )}
        <div aria-hidden className="lib-hero-scrim" />
        <div className="relative mx-auto w-full max-w-6xl px-5 pt-32 pb-12 md:pb-16">
          {/* Демо называет себя и здесь: «твоя библиотека глазами сервиса» над
              чужой витриной — прямая неправда. Признак серверный, полоса
              приходит в первом HTML и стоит в потоке (см. DemoBar). */}
          {isDemoId(steamid) && <DemoBar from={lp(locale, '/library')} className="mb-6" />}
          <Eyebrow className="mb-3">{tr(locale, { ru: 'Библиотека', en: 'Library' })}</Eyebrow>
          <h1 className="font-display text-display-md max-w-md">
            {tr(locale, { ru: 'Твоя библиотека глазами сервиса', en: 'How we see your library' })}
          </h1>
          {/* Подписи чисел по-английски не шире русских («never launched» уже
              «ни разу не запускал»): замер на 360 px — английские три числа
              встают в один ряд, русские в два. Шире подпись быть не должна */}
          <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-4">
            <div className="flex flex-col-reverse">
              <dt className="lib-stat-label">
                {pl(locale, games.length, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })}
              </dt>
              <dd className="lib-stat">{fmtNumber(locale, games.length)}</dd>
            </div>
            {/* Время скрыто — одно слово вместо двух нулей: «0 часов» и «ни
                разу не запускал: 300» были бы сказаны про сотни часов */}
            {timeHidden ? (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">{tr(locale, { ru: 'время в играх', en: 'playtime' })}</dt>
                <dd className="lib-stat">{tr(locale, { ru: 'скрыто', en: 'hidden' })}</dd>
              </div>
            ) : (
              <>
                <div className="flex flex-col-reverse">
                  <dt className="lib-stat-label">
                    {pl(locale, totalHours, {
                      ru: ['час в игре', 'часа в игре', 'часов в игре'],
                      en: ['hour played', 'hours played'],
                    })}
                  </dt>
                  <dd className="lib-stat">{fmtNumber(locale, totalHours)}</dd>
                </div>
                <div className="flex flex-col-reverse">
                  <dt className="lib-stat-label">{tr(locale, { ru: 'ни разу не запускал', en: 'never launched' })}</dt>
                  <dd className="lib-stat text-ember-text">{fmtNumber(locale, untouched)}</dd>
                </div>
              </>
            )}
          </dl>
          {/*
            С прошлого снимка — без «было X, стало Y» рядом с числами выше:
            «ни разу не запускал» двигают и новые нетронутые игры, и разница
            двух чисел врала бы. Обе даты — потому что сама страница снимок не
            обновляет, и «по сегодня» было бы неправдой.
          */}
          {since && (
            <p className="mt-5 max-w-md text-sm leading-relaxed text-dim">
              {/* Снимки одного дня — одна дата, а не «с 26 сентября по 26 сентября».
                  Сравниваются русские подписи: день от языка страницы не зависит */}
              {dateLabel(since.fromAt) === dateLabel(snapshot.takenAt) ? (
                tr(locale, {
                  ru: `За ${dateLabel(snapshot.takenAt)}`,
                  en: `On ${dateLabel(snapshot.takenAt, { locale })}`,
                })
              ) : locale === 'en' ? (
                <>
                  From {dateLabel(since.fromAt, { year: !sameYear(since.fromAt, snapshot.takenAt), locale })} to{' '}
                  {dateLabel(snapshot.takenAt, { locale })}
                </>
              ) : (
                <>
                  С {dateLabel(since.fromAt, { year: !sameYear(since.fromAt, snapshot.takenAt) })} по{' '}
                  {dateLabel(snapshot.takenAt)}
                </>
              )}
              {/* По-английски время идёт первым («3 h played»), а не за словом */}
              {since.delta.minutes > 0 &&
                (locale === 'en' ? (
                  <>
                    {' '}· <span className="tabular-nums text-ink">{playedLine(since.delta.minutes, locale)}</span> played
                  </>
                ) : (
                  <>
                    {' '}· наиграно <span className="tabular-nums text-ink">{playedLine(since.delta.minutes)}</span>
                  </>
                ))}
              {since.delta.added.length > 0 && (
                <>
                  {' '}· <span className="tabular-nums">{since.delta.added.length}</span>{' '}
                  {pl(locale, since.delta.added.length, {
                    ru: ['новая игра', 'новые игры', 'новых игр'],
                    en: ['new game', 'new games'],
                  })}
                </>
              )}
              {since.delta.unpacked.length > 0 && (
                <>
                  {' '}· <span className="tabular-nums">{since.delta.unpacked.length}</span>{' '}
                  {pl(locale, since.delta.unpacked.length, {
                    ru: ['игра впервые запущена', 'игры впервые запущены', 'игр впервые запущено'],
                    en: ['game launched for the first time', 'games launched for the first time'],
                  })}
                </>
              )}
            </p>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/portrait" prefetch={false} className="btn-glass">
              <Icon name="spark" size={18} />
              {tr(locale, { ru: 'Мой портрет игрока', en: 'My player portrait' })}
            </Link>
            {/* Колода без вопросов о настроении — и полка «Приглянулось» при ней */}
            <Link href="/explore" className="btn-glass">
              {tr(locale, { ru: 'Полистать без обязательств', en: 'Just browse' })}
              <Icon name="arrow" size={18} />
            </Link>
          </div>
        </div>
      </section>

      <div className="mx-auto w-full max-w-6xl px-5 pt-10 pb-16">

      {/* Список открыт, а часы — нет: ошибки private тут не бывает, и панель
          ниже этот человек не увидит никогда. Шаг — тот же, что в ней. */}
      {timeHidden && <PlaytimeHiddenNote className="mb-10 max-w-2xl" locale={locale} />}

      {/*
        ПУСТАЯ БИБЛИОТЕКА — НЕ ПУСТАЯ ПОЛКА.
        
        До этой правки страница показывала здесь пять чипсов с нулями и строку
        «Здесь пусто — и это хорошая новость». Замерено снимком: весь экран
        человека, у которого ничего не загрузилось, состоял из заголовка, трёх
        нулей, пяти нулевых чипсов, этой строки — и двух ссылок «Выйти».
        Единственным заметным действием на странице был выход.
        
        Причина почти всегда одна и та же, и она чинится за минуту: Steam по
        умолчанию прячет список игр даже при публичном профиле. Сюда доезжают
        только те, у кого сессия и снимок ЕСТЬ, — то есть отказ случился уже
        после подключения, и на карточке подключения этот текст человек не
        увидит никогда.
        
        Чипсы и сетка ниже при пустой библиотеке не рисуются вовсе: пять нулей
        не сообщают ничего, а якорь #wall на них ведёт только с полки
        «запечатанного», которой здесь тоже нет.

        Отступ снизу — свой, mb-10, как у соседних блоков: сетка карточек со
        своим mb-10 здесь обычно не рисуется, и следующий блок («Твои вечера»
        или строка NeedSteam у сессии по ссылке) иначе лёг бы вплотную под
        кнопку «Подключить заново».
      */}
      {games.length === 0 && (
        <section className="max-w-2xl mb-10">
          <p className="font-semibold text-ink mb-2">
            {tr(locale, { ru: 'Steam не отдал ни одной игры', en: "Steam didn't return any games" })}
          </p>
          <p className="text-dim text-sm leading-relaxed mb-5">
            {tr(locale, {
              ru: 'Причин ровно две: игровые данные закрыты настройками профиля — или библиотека правда пуста. Первая встречается намного чаще.',
              en: 'There are only two reasons: your game details are hidden by your profile settings, or your library really is empty. The first is far more common.',
            })}
          </p>
          {/* Проверка — входом через Steam: он пишет свежий снимок. Сессии по
              ссылке — «Подключить заново» ниже, её дверь. Путь — на языке
              страницы: steamLoginFor везёт язык через Steam (lang=en), и
              возврат приходит на ту же английскую библиотеку. */}
          <PrivacyHelp
            retryHref={session && isWriter(session) ? steamLoginFor(lp(locale, '/library')) : undefined}
            locale={locale}
          />
          <Link href={reconnectHref()} className="btn-ember mt-5 px-6 py-3">
            {tr(locale, { ru: 'Подключить заново', en: 'Reconnect' })}
          </Link>
        </section>
      )}

      {(backlog.pricedCount > 0 || stats.rate !== null || honest) && (
        <div className="grid md:grid-cols-2 gap-4 mb-10">
          {backlog.pricedCount > 0 && (
            /*
              Ниже 1024px карточка встаёт столбиком, и это не вкусовщина.

              Строкой она собрана под ДЕСКТОП, где рядом стоит вторая карточка
              и на текст остаётся 369px при кнопке 121px — всё ложится в одну-
              две строки. На 375px карточка становится во всю ширину, но кнопка
              shrink-0 держит свои 130px, и тексту достаётся 156px из 335: и
              заголовок, и подпись переносятся вдвое, а фраза про Game Pass
              растягивается на четыре строки рядом с пустым местом под кнопкой.

              Порог lg, и это ИСПРАВЛЕНИЕ прежней правки, где стоял sm. Тогда я
              рассуждал «выше 640 карточка во всю ширину» — верно ровно до 768,
              где включается md:grid-cols-2 и карточка снова становится узкой.
              Замер на 768: карточка 349px, текст 170px, строки 2/2/3 — почти то
              же самое, что чинили на телефоне. На 1024 карточка 484px, тексту
              достаётся 307px, и этого хватает на 1/1/2.

              Между 640 и 1024 карточка стоит столбиком, хотя строкой там местами
              влезла бы: это плата за один порог вместо контейнерного запроса.
              Контейнерные запросы в Tailwind 4.3 есть, но требуют лишней
              обёртки — элемент не может опрашивать сам себя, — и заводить новый
              паттерн ради одной карточки не стоит.
            */
            /*
              БЭКЛОГ — ЭТО ТО, ВО ЧТО МОЖНО ИГРАТЬ ПРЯМО СЕЙЧАС, А НЕ ДОЛГ.

              Карточка начиналась с «≥ $4150 лежит несыгранным» и переводила
              сумму в бургеры, «которые ты бы доел». Это счёт за невыполненное:
              деньги уже потрачены, вернуть их нельзя, и напоминание о них
              давит ровно на то, от чего человек сюда пришёл, — на чувство,
              что играть надо «правильно». Невозвратные затраты — плохой повод
              выбирать игру, и сервис, который помогает выбрать, не должен на
              них давить.

              Теперь главное — число игр, которые уже твои, и что попробовать
              их можно сегодня. Сумма осталась второй строкой, справкой, без
              шуток про еду. Шутки живут на портрете: там это самоирония
              владельца, а не укор от сервиса посреди его библиотеки.
            */
            <div className="panel-lift p-5 flex flex-col items-start gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                {/* Фраза целиком на каждую форму числа: английская не длиннее
                    русской — строки текста рядом с кнопкой на lg замерены выше */}
                <div className="font-display text-display-xs">
                  <span className="tabular-nums text-ember-text">{backlog.unplayedCount}</span>{' '}
                  {pl(locale, backlog.unplayedCount, {
                    ru: [
                      'игра уже твоя — попробовать можно прямо сейчас',
                      'игры уже твои — попробовать можно прямо сейчас',
                      'игр уже твои — попробовать можно прямо сейчас',
                    ],
                    en: ['game already yours — try it now', 'games already yours — try one now'],
                  })}
                </div>
                {/* Оговорка — только когда она правда: «не меньше … — цена
                    известна у 8 из 8» спорило само с собой */}
                <div className="text-xs text-dim mt-1">
                  {/* Валюта — региона суммы (backlogValue), а не угаданная:
                      цены других регионов в неё не входят вовсе */}
                  {backlog.pricedCount < backlog.unplayedCount
                    ? tr(locale, { ru: 'Вместе не меньше', en: 'Worth at least' })
                    : tr(locale, { ru: 'Вместе', en: 'Worth' })}{' '}
                  <span className="tabular-nums">
                    {formatPrice(backlog.cents, backlog.cc, { whole: true, locale })}
                  </span>{' '}
                  {byPrices(backlog.cc, locale)}
                  {backlog.pricedCount < backlog.unplayedCount
                    ? tr(locale, {
                        ru: ` — цена известна у ${backlog.pricedCount} из ${backlog.unplayedCount}`,
                        en: ` — prices known for ${backlog.pricedCount} of ${backlog.unplayedCount}`,
                      })
                    : null}
                </div>
              </div>
              {/* Не в общий опрос про настроение: карточка про несыгранное —
                  значит и подбор про несыгранное */}
              <Link
                href="/quiz?from=untouched"
                className="btn-ember shrink-0 px-5 py-3 text-sm"
              >
                <Icon name="play" className="mr-2 inline-block align-[-0.125em]" />
                {tr(locale, { ru: 'Выбрать одну', en: 'Pick one' })}
              </Link>
            </div>
          )}
          {(stats.rate !== null || honest) && (
            <div className="panel-lift p-5">
              {stats.rate !== null && (
                <>
                  <div className="font-display text-display-xs">
                    {locale === 'en' ? (
                      <>
                        Picks land <span className="match">{Math.round(stats.rate * 100)}%</span> of the time
                      </>
                    ) : (
                      <>
                        Подбор попадает в{' '}
                        <span className="match">{Math.round(stats.rate * 100)}%</span>
                      </>
                    )}
                  </div>
                  {/* Кнопки — их собственными словами: «Liked it» и «Not it» на /play */}
                  <div className="text-xs text-dim mt-1">
                    {tr(locale, {
                      ru: `${stats.liked} «зашло» против ${stats.skipped} «не то»`,
                      en: `${stats.liked} “Liked it” vs ${stats.skipped} “Not it”`,
                    })}
                  </div>
                </>
              )}
              {/*
                Честная мера рядом со словами: «зашло» — нажатие, а сыграно
                ли — знает только следующий снапшот библиотеки. Доля от
                сверенных советов (eveningsSummary): несверенный — «ещё
                неизвестно», а не промах.
              */}
              {/* По-английски — целыми фразами, а не «Actually played — 60% picks: 3
                  of 5»: мера (15+ минут) встаёт к слову, а доля — с «of picks» */}
              {honest && (
                <div className={stats.rate !== null ? 'text-xs text-dim mt-2' : 'font-display text-display-xs'}>
                  {locale === 'en' ? (
                    <>
                      {stats.rate !== null ? 'Actually played (15+ minutes): ' : 'Actually played: '}
                      <span className={stats.rate !== null ? 'tabular-nums text-ink' : 'match'}>
                        {Math.round((eveningsTotal.played / eveningsTotal.checked) * 100)}%
                      </span>{' '}
                      of picks
                      {stats.rate !== null ? `, ${eveningsTotal.played} of ${eveningsTotal.checked}` : null}
                    </>
                  ) : (
                    <>
                      Сыграно всерьёз —{' '}
                      <span className={stats.rate !== null ? 'tabular-nums text-ink' : 'match'}>
                        {Math.round((eveningsTotal.played / eveningsTotal.checked) * 100)}%
                      </span>{' '}
                      советов
                      {stats.rate !== null ? (
                        <>
                          : {eveningsTotal.played} из {eveningsTotal.checked}, от пятнадцати минут
                        </>
                      ) : null}
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Вечеров, «Зашло» и скрытого сессии по ссылке не прочитано вовсе (см.
          writer выше) — одна строка на месте первой из полок говорит, где они,
          а не три пустоты подряд. Есть ли там что-то, не сказано: это тоже
          сведение о владельце. */}
      {!writer && <NeedSteam from={lp(locale, '/library')} why="see" className="mb-12 max-w-md" />}

      {eveningItems.length > 0 && (
        <Evenings items={eveningItems} lead={eveningsLead} writer={writer} plans={eveningPlans} />
      )}

      {shelf.length > 0 && (
        <section className="mb-12">
          <Eyebrow className="mb-2">{tr(locale, { ru: 'Запечатанное', en: 'Sealed' })}</Eyebrow>
          <div className="flex items-baseline justify-between gap-4 flex-wrap">
            {/* Заголовок намеренно без числа: «пять игр» — ложь при трёх, а
                согласование «{N} игр, о которых ты забыл» — фабрика багов.
                Число уже стоит в строке-сводке выше. */}
            <h2 className="font-display text-display-sm">
              {tr(locale, { ru: 'Ты забыл, что они у тебя есть', en: 'You forgot you own these' })}
            </h2>
            {/*
              Ссылка ведёт к ФИЛЬТРУ, а не к подбору, и это не мелочь.
              Раньше здесь стояло второе «Разгрести →» на тот же адрес, что и
              кнопка в карточке денег двумя блоками выше: одно действие в двух
              весах — залитой кнопкой и тихой строкой, — то есть оформление
              обещало разницу, которой нет.
              Полка — дневная выборка из пяти, о чём прямо сказано ниже
              («завтра на полке будут другие»). Естественный вопрос к такой
              строке — «а какие ещё?», и до сих пор ответом было прокрутить
              страницу и найти нужный чипс. Показываем только когда за полкой
              действительно кто-то есть.
            */}
            {untouched > shelf.length && (
              <Link
                href="/library?state=untouched#wall"
                prefetch={false}
                className="tap link-more shrink-0"
              >
                {tr(locale, { ru: 'Все нераспакованные', en: 'All unopened' })} <Icon name="arrow" size={14} />
              </Link>
            )}
          </div>
          {/* «По данным Steam», а не «ты никогда в это не играл»: ноль часов
              бывает и у офлайн-игры, и у аккаунта старше 2009 года */}
          {/* max-w-md — мера набора. Подпись стоит в контейнере шириной 1152 px, и
                без ограничения строка растягивалась на 110–180 символов: вдвое
                дальше комфортных 45–75. Сейчас она в одну строку и это сходит с
                рук, но любая правка текста начала бы переносить её на такой
                ширине. Величина та же, что у остальной поясняющей копии
                продукта. */}
          <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
            {tr(locale, {
              ru: 'Ни одну из них ты не запускал — по данным Steam там ноль минут. Завтра на полке будут другие.',
              en: "You've never launched any of them — per Steam, that's zero minutes. Tomorrow the shelf will show others.",
            })}
          </p>
          {/*
            ЛЕСТНИЦА, А НЕ СТУПЕНЬКА. Было `grid-cols-2 md:grid-cols-5`, то
            есть пять колонок начинались с 768 px — с ширины, для которой пять
            и не рассчитывались. Замерено в браузере: на телефоне (375)
            обложка полки 160 px, на планшете (768) — 130. Расширяешь окно, и
            обложки СЖИМАЮТСЯ на пятую часть, а подписи начинают обрезаться.
            Промежуточная ступень в три колонки закрывает полосу 640–1023
            (232 px на 768), пять остаются там, где для них есть место.
          */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-4 gap-y-6">
            {shelf.map((g) => (
              <GameLink
                key={g.appid}
                appid={g.appid}
                className="game-card block"
              >
                <GameCardBody
                  appid={g.appid}
                  name={g.name}
                  headerImage={metas.get(g.appid)?.headerImage ?? null}
                  art={trimArt(metas.get(g.appid)?.art)}
                  /* Пороги — те же, что у лестницы колонок выше: 2 → 3 → 5.
                     Прежняя «(min-width: 768px) 20vw, 50vw» осталась от
                     сетки 2 → 5 и в полосе 640–1023 промахивалась: просила
                     то 50vw, то 20vw при настоящих 33vw. */
                  sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                  corner={<span className="lib-badge badge-line">{tr(locale, { ru: 'Запечатана', en: 'Sealed' })}</span>}
                />
              </GameLink>
            ))}
          </div>
        </section>
      )}

      {/* Поиск — от дюжины игр: на меньшей библиотеке вся стена и так в
          одном экране, и поле было бы лишним словом над ней (и запрос без
          поля не применяется — см. q выше). При скрытом времени поле
          остаётся: полок нет, а имя игры Steam отдаёт всегда. filter —
          показанная полка (view.filter), а не спрошенная: при скрытом
          времени это всегда «Все». */}
      {games.length >= SEARCH_FROM && <LibrarySearch filter={view.filter} q={q} />}

      {/* Чипсы — обычные ссылки: страница и так force-dynamic, а сетка
          обязана остаться серверной и без обработчиков. Префетча у них нет:
          каждый чипс — эта же динамическая страница, то есть пять вызовов
          функции на один просмотр ради фильтров, которые откроют один раз.
          id — цель ссылки с полки «запечатанного»: приводить к фильтру,
          не показав самих чипсов, значит приводить в никуда. */}
      {games.length > 0 && !timeHidden && (
      /* Пилюлями, лентой на телефоне. Полоса липкая: смузер теперь живёт
         только на главной, и sticky здесь снова держится (.lib-filters).
         Липкая подложка и лента — два разных элемента: маска ленты
         (.chip-rail) растворяла бы и фон с размытием, и стена карточек
         проступала бы по краям полосы. */
      <div id="wall" className="lib-filters">
        {/* id у ленты свой: #wall — подложка и цель ссылки с полки
            «запечатанного», а прокручивается вбок именно лента */}
        <div id="wall-rail" className="chip-rail lib-filters-rail">
          {/* Порядок — из LIBRARY_FILTERS, подпись — на языке страницы:
              английские слова те же, что у бейджей источника (глоссарий) */}
          {LIBRARY_FILTERS.map((f) => (
            <Link
              key={f.id}
              href={libraryHref(f.id, 1, q)}
              // Без него Next прокручивал к верху страницы: чипсы стоят экраном
              // ниже героя, и после нажатия человек оказывался над заголовком
              // «Твоя библиотека», а новая полка — за нижним краем (замер на
              // 1440×900: полоса чипсов уезжала с 241 px на 1041). Тот же довод,
              // что у «Показать ещё» ниже. Полоса при этом липкая, и чипс,
              // нажатый из глубины стены, оставил бы человека посреди новой
              // полки, — к её началу тогда докручивает ShelfToStart ниже.
              scroll={false}
              prefetch={false}
              aria-current={f.id === filter ? 'page' : undefined}
              className={`pill shrink-0 ${f.id === filter ? 'is-on' : ''}`}
            >
              {libraryFilterLabel(f.id, locale)} <span className="tabular-nums opacity-70">{found.counts[f.id]}</span>
            </Link>
          ))}
          <RailToCurrent railId="wall-rail" current={filter} />
        </div>
        <ShelfToStart barId="wall" shelf={filter} />
      </div>
      )}

      {/* games.length в условии обязателен: у пустой библиотеки пуста и любая
          полка, и без него человек с ?state=active получил бы два сообщения
          сразу — «за две недели ты не запускал ничего» поверх «Steam не отдал
          ни одной игры». */}
      {games.length > 0 && view.games.length === 0 && view.filter !== 'all' && !q && (
        <p className="text-dim text-sm">{shelfEmpty(view.filter, locale)}</p>
      )}

      {/* Ничего не нашлось — своим сообщением, а не сообщением пустой полки:
          «заброшенных нет» было бы неправдой, их просто нет с таким именем.
          StatusLine стоит всегда (lib/liveregion.test.ts): страница
          перерисовывается на каждую букву поиска, и область, рождённая вместе
          с текстом, звучала бы не везде. Ссылка сброса — вне области: живую
          строку читают целиком, а не нажимают.

          Нашлось — тоже словами, но только скринридеру: глазу видно, что
          стена сменилась, а скринридеру без этой строки поиск молчал бы —
          сработал ли и сколько нашлось. Строка та же, а не вторая рядом:
          обе — ответ на один запрос, и переход «нашлись три» → «ничего»
          звучит сменой текста. */}
      <StatusLine
        className={q && found.games.length === 0 ? 'text-dim text-sm' : 'sr-only'}
        text={
          !q
            ? null
            : found.games.length > 0
              ? foundLine(locale, q, found.games.length, view.filter !== 'all')
              : view.filter === 'all' || found.counts.all === 0
                ? tr(locale, { ru: `Ничего не нашлось по «${q}».`, en: `Nothing found for “${q}”.` })
                : tr(locale, {
                    ru: `На этой полке «${q}» нет — поищи на соседних: счётчики на чипсах показывают, где.`,
                    en: `No “${q}” on this shelf — try the others: the numbers on the filters show where.`,
                  })
        }
      />
      {q && found.games.length === 0 && (
        <Link href={libraryHref(view.filter)} scroll={false} prefetch={false} className="tap link-more -mt-1 mb-4">
          {tr(locale, { ru: 'Сбросить поиск', en: 'Clear search' })}
          <Icon name="close" size={14} />
        </Link>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-6">
        {wall.shown.map((g) => {
          const state = stateOf(g)
          const label = STATE_LABEL[state]
          // Только кандидат: подтвердит ли патч, скажет стрим (RefreshedPill)
          const refreshable = updatedP !== null && state === 'comeback' && mayRefresh.has(g.appid)
          return (
            /*
              Без префетча (GameLink): плитка попадает в экран при
              прокрутке, и каждая префетчила бы /game/<appid>. Игры вне
              заранее собранных страниц рендерятся по требованию, то есть
              порция из 48 плиток — это до 48 рендеров с походами в базу ради
              страниц, куда человек откроет одну.
            */
            <GameLink
              key={g.appid}
              appid={g.appid}
              // Заброшенная приглушается обложкой, а не целиком: прозрачность
              // на всей плитке роняла и подпись под ней — на светлой теме до
              // 3.97:1 (axe, color-contrast)
              className={`library-tile game-card block ${
                state === 'comeback' ? '[&_.card-thumb]:opacity-75 hover:[&_.card-thumb]:opacity-100' : ''
              }`}
            >
              <GameCardBody
                appid={g.appid}
                name={g.name}
                headerImage={metas.get(g.appid)?.headerImage ?? null}
                art={trimArt(metas.get(g.appid)?.art)}
                /* Пороги подсказки обязаны совпадать с сеткой, а она тут
                   grid-cols-2 md:grid-cols-4 — то есть ровно 50vw и 25vw.
                   Стояли пороги 1024 и 640: в полосе 640–767 подсказка просила
                   33vw при настоящих 50vw, и плитки грузились ПОЛТОРА раза
                   мельче нужного, то есть мылом. */
                sizes="(min-width: 768px) 25vw, 50vw"
                meta={
                  <>
                    {/* При скрытом времени — без числа: «0 ч» на каждой плитке
                        было бы неправдой, а «скрыто» сорок восемь раз подряд —
                        шумом; это сказано один раз, в шапке */}
                    {/* self-start у кандидата в «обновлялась»: узкой плитке
                        метка уходит второй строкой, и часы по центру двух
                        строк встали бы между «заброшена» и меткой, а не
                        вровень с первой */}
                    {!timeHidden && (
                      <span className={`tabular-nums ${refreshable ? 'self-start' : ''}`}>
                        {playedShort(g.playtimeForever, locale)}
                      </span>
                    )}
                    {/* «Обновлялась» — рядом с «заброшена», а не вместо: состояние
                        то же, метка добавляет к нему факт о самой игре. Без
                        ссылки на патч — вся плитка уже ссылка, а <a> в <a>
                        невалиден; патчи ждут на /game в «Что нового». Узкой
                        плитке телефона метка уходит второй строкой (flex-wrap),
                        а не обрезает «заброшена» до «забр…» */}
                    {label.text[locale] &&
                      (refreshable ? (
                        <span className="flex min-w-0 flex-wrap items-center justify-end gap-x-1.5 gap-y-0.5 self-start">
                          <span className={`truncate ${label.cls}`}>{label.text[locale]}</span>
                          <Suspense fallback={null}>
                            <RefreshedPill updated={updatedP} appid={g.appid} locale={locale} />
                          </Suspense>
                        </span>
                      ) : (
                        <span className={`truncate ${label.cls}`}>{label.text[locale]}</span>
                      ))}
                  </>
                }
              />
            </GameLink>
          )
        })}
      </div>

      {/*
        «ПОКАЗАТЬ ЕЩЁ» — ССЫЛКА, А НЕ КНОПКА С КЛИЕНТСКОЙ ПОДГРУЗКОЙ.
        Следующая порция — тот же серверный рендер с ?page=N: сетка остаётся
        без клиентского состояния, работает без JS, и адрес можно отправить.
        scroll={false} — человек остаётся там, где нажал, и новые плитки встают
        прямо под прочитанными; без него Next прокрутил бы к верху страницы,
        раз её начало уже уехало из экрана. Префетча нет по той же причине,
        что у чипсов: это та же динамическая страница.
      */}
      {wall.nextPage !== null && (
        <div className="mt-8 flex justify-center">
          <Link
            href={libraryHref(view.filter, wall.nextPage, q)}
            scroll={false}
            prefetch={false}
            className="btn-glass"
          >
            <LinkPending>
              {locale === 'en' ? (
                <>
                  Show <span className="tabular-nums">{Math.min(wall.rest, LIBRARY_PAGE_SIZE)}</span> more of{' '}
                  <span className="tabular-nums">{wall.rest}</span>
                </>
              ) : (
                <>
                  Показать ещё <span className="tabular-nums">{Math.min(wall.rest, LIBRARY_PAGE_SIZE)}</span>{' '}
                  из <span className="tabular-nums">{wall.rest}</span>
                </>
              )}
            </LinkPending>
          </Link>
        </div>
      )}

      {/* Внизу намеренно: это уборка, а не витрина. Но на странице, а не в
          настройках, которых в проекте нет — бан ставится в одном клике от
          выдачи, и сниматься должен так же дёшево. */}
      <div className="mt-14">
        {/* Сессии по ссылке полки приходят пустыми и не рисуются вовсе: строка
            о входе для неё стоит выше, на месте «Твоих вечеров» */}
        <LikedShelf games={likedGames} total={likedTotal} writer={writer} />
        {/* Под «Зашло», над уборкой: страница по-прежнему начинается с «играй
            в своё», а покупки — ниже всего своего. Под Suspense — Steam
            страницу не держит. У демо списка нет, у сессии по ссылке он не
            читается вовсе (writer выше) */}
        {writer && !isDemoId(steamid) && (
          <Suspense fallback={null}>
            <WishlistShelf
              steamid={steamid}
              sid={session.sid}
              row={wishlist}
              owned={ownedNow}
              now={now}
              locale={locale}
            />
          </Suspense>
        )}
        <BannedShelf games={bannedGames} writer={writer} />
      </div>

      {/* Выход живёт здесь, а не в шапке: шапка общая на весь сайт, и чтобы
          показать в ней состояние входа, корневому лэйауту пришлось бы читать
          куки — а это сделало бы динамическими все страницы разом, включая
          кэшируемые /game/[appid]. Библиотека и так force-dynamic. */}
      <SignOut verified={Boolean(session?.verified)} feedLink={feedLink !== null} />
      </div>
    </div>
  )
}

/**
 * Подпись над «Твоими вечерами» по-английски — те же четыре ветки, что у
 * русской в LibraryPage, и обещают они то же самое. Целыми фразами: «Всерьёз,
 * от пятнадцати минут, — в 3 из 5 советов» в английском порядке не
 * собирается, а «Actually played» — то же слово, что в карточке доли выше
 * (глоссарий).
 */
function eveningsLeadEn({
  total,
  lateHours,
  timeHidden,
  pending,
}: {
  total: ReturnType<typeof eveningsSummary>
  lateHours: string | null
  timeHidden: boolean
  pending: boolean
}): ReactNode {
  if (total.checked > 0) {
    return (
      <>
        Time played after our picks:{' '}
        <span className="text-ink tabular-nums">{playedLine(total.minutes, 'en')}</span>. Actually played (15+
        minutes): <span className="tabular-nums">{total.played}</span> of{' '}
        <span className="tabular-nums">{total.checked}</span> {pl('en', total.checked, OF_PICKS)}.
        {lateHours && (
          <>
            {' '}
            Another <span className="text-ink tabular-nums">{lateHours}</span> added up while you were away — we
            checked those later and leave them out of the count.
          </>
        )}
      </>
    )
  }
  if (lateHours) {
    return (
      <>
        While you were away, <span className="text-ink tabular-nums">{lateHours}</span> added up after our picks
        — checked against your first library snapshot once you were back.
      </>
    )
  }
  if (timeHidden) return 'What we picked for you and how it went. Minutes will show up once Steam shows your playtime again.'
  if (pending) return 'What we picked for you and how it went. Minutes will show up with the next library snapshot.'
  return 'What we picked for you and how it went.'
}

/**
 * Метка «обновлялась» у заброшенной плитки — догружается стримом (см.
 * updatedP в LibraryPage): ждёт общий на порцию запрос и рисует пилюлю, только
 * если подтверждённый крупный патч после последнего запуска нашёлся.
 */
async function RefreshedPill({
  updated,
  appid,
  locale,
}: {
  updated: Promise<ReadonlyMap<number, string>>
  appid: number
  locale: Locale
}) {
  if (!(await updated).has(appid)) return null
  return (
    <span
      className="shrink-0 rounded-full border border-edge px-1.5 text-[11px] leading-4 text-ink"
      // Та же формулировка, что в причине на /play и в «Игре дня» (patchSentence)
      title={`${patchSinceLead(locale)}.`}
    >
      {/* Короче русской («updated» против «обновлялась»): метка делит строку
          плитки с обрезаемой подписью состояния */}
      {tr(locale, { ru: 'обновлялась', en: 'updated' })}
    </span>
  )
}

/**
 * «Нашлось» поиска по библиотеке — целой фразой на язык: по-русски запрос
 * впереди («По «portal» нашлись 3 игры»), по-английски — в конце («Found 3
 * games for “portal”»). Число стоит отдельно от слов, а формы — через pl():
 * у русского глагола их три, как у слова при числе, английский «Found» от
 * числа не зависит.
 */
function foundLine(locale: Locale, q: string, n: number, onShelf: boolean): string {
  const found = pl(locale, n, { ru: ['нашлась', 'нашлись', 'нашлось'], en: ['Found', 'Found'] })
  const games = pl(locale, n, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })
  return tr(locale, {
    ru: `По «${q}»${onShelf ? ' на этой полке' : ''} ${found} ${n} ${games}.`,
    en: `${found} ${n} ${games} for “${q}”${onShelf ? ' on this shelf' : ''}.`,
  })
}

/** Два момента в одном году по UTC — тогда дату пишем без года */
function sameYear(a: number, b: number): boolean {
  return new Date(a * 1000).getUTCFullYear() === new Date(b * 1000).getUTCFullYear()
}
