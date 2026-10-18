import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import * as m from 'framer-motion/m'
import Link from '@/components/Link'
import { notFound } from 'next/navigation'
import { cache, type ReactNode } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { CardDownload } from '@/components/CardDownload'
import { CountNumber } from '@/components/CountNumber'
import { GameArt } from '@/components/GameArt'
import { Magnet } from '@/components/Magnet'
import { GameCardBody } from '@/components/GameCard'
import { GameLink } from '@/components/GameLink'
import { ShareLinkField } from '@/components/ShareLink'
import { SplitHeading } from '@/components/SplitHeading'
import { Eyebrow, eyebrow } from '@/components/Labels'
import { Wordmark } from '@/components/Wordmark'
import {
  bannedAppids,
  getGamesMetaLite,
  getLatestSnapshot,
  getLibraryBaselines,
  getPersonaName,
  getUserPortrait,
  loadTagStats,
  setUserPortrait,
} from '@/lib/db'
import { claudePortraitText, llmAvailable } from '@/lib/llm'
import { takeLlmBudgetForIp } from '@/lib/llmcap'
import { reconnectHref } from '@/lib/destination'
import { fmtNumber, lp, pl, toLocale, tr, type Locale } from '@/lib/i18n'
import { localeAlternates, ogSite } from '@/lib/site'
import { gamesCaption, playedFact, unplayedCaption } from '@/lib/factcaptions'
import { playedLine } from '@/lib/outcome'
import { archetypeLabelOf } from '@/lib/portrait'
import { pickYearWindow, yearEyebrow, yearsToRead, type WrappedYear } from '@/lib/wrapped'
import { plural } from '@/lib/plural'
import { playedShort, playtimeHidden } from '@/lib/playtime'
import { checkRate, clientIp } from '@/lib/ratelimit'
import { buildPortraitModel, portraitTag, type PortraitModel } from '@/lib/portraitmodel'
import {
  concentrationVerdict,
  eraLead,
  freshPortraitText,
  paretoLead,
  portraitFallbackText,
  PORTRAIT_TEXT_V,
  socialTail,
  unplayedHeading,
  type PortraitVoice,
} from '@/lib/portraitvoice'
import { appBaseUrl, currentSteamId, getDb, nowSec } from '@/lib/server'
import { backlogEquivalent } from '@/lib/stats'
import { quoted } from '@/lib/sharedpick'
import { byPrices, formatPrice } from '@/lib/steamregion'
import { tagWeightFrom } from '@/lib/tagweight'
import type { LibraryGame } from '@/lib/types'
import { Icon } from '@/components/Icon'
import { withRef } from '@/lib/track'
import { Notice } from '@/components/Notice'
import { langOn, ogImageOn, playerName, SnapshotDates } from './portrait-text'

export const dynamic = 'force-dynamic'

// Страница рендерится синхронно и по дороге зовёт модель. Предел объявляем
// явно, как в кроновых маршрутах: иначе он неявный, а зависший вызов способен
// съесть его целиком вместо того, чтобы упасть на шаблон.
export const maxDuration = 60

/*
 * Потолки на пересборку текста портрета. Считаем ХОЛОДНЫЕ пути, не заходы:
 * прогретый портрет отдаётся из кэша и сюда не доходит вовсе.
 *
 * По steamid — три: столько холодных пересборок подряд по одному портрету
 * бывает только при параллельных заходах, а человек за это окно снапшот не
 * меняет. По адресу — десять: за одним IP бывает общий NAT, но перебор чужих
 * steamid упирается уже в него.
 */
const PORTRAIT_LIMIT = 3
const PORTRAIT_IP_LIMIT = 10
const PORTRAIT_WINDOW_SEC = 600

/*
 * Потолок на холодную сборку модели страницы — по адресу.
 *
 * Сборка читает метаданные ВСЕЙ библиотеки: у коллекционера это тысячи строк
 * Turso на один заход. Прогретая модель лежит в кэше по снапшоту и сюда не
 * доходит, так что потолок видит только заходы на НОВЫЕ портреты — скрипт,
 * перебирающий steamid. Шестьдесят за десять минут — это не человек даже за
 * общим NAT.
 *
 * Сверх потолка страница не падает, а собирается по одному снапшоту: числа,
 * топ и мозаика остаются, диагноз, улики и деньги — нет. В кэш такая модель
 * не попадает (сборка бросает), и следующий заход после окна получит полную.
 */
const MODEL_BUILD_IP_LIMIT = 60
const MODEL_BUILD_WINDOW_SEC = 600

/**
 * Срок модели в кэше. Ключ и так меняется вместе со снапшотом; сутки — чтобы
 * догнать то, что меняется без него: метаданные, которые прогрев довёз позже,
 * и цены в сумме бэклога.
 */
const MODEL_TTL_SEC = 86_400

/*
 * Снапшот и ник — один раз на запрос.
 *
 * Их читают и generateMetadata, и страница, и раньше каждый читал сам:
 * снапшот — это строка с JSON всей библиотеки, и публичный адрес платил за
 * неё дважды на каждый заход. cache() живёт ровно один запрос — тот же приём,
 * что на карточке игры и в /compat.
 */
const snapshotOf = cache(async (steamid: string) => getLatestSnapshot(await getDb(), steamid))
const personaOf = cache(async (steamid: string) => getPersonaName(await getDb(), steamid))

/**
 * Без этого ссылка на портрет разворачивалась в мессенджерах общим заголовком
 * сайта и вообще без картинки. Саму картинку рисует opengraph-image.tsx —
 * Next подставляет её сюда сам.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ steamid: string; lang?: string }>
}): Promise<Metadata> {
  const { steamid, lang } = await params
  const locale = toLocale(lang)
  if (!/^\d{17}$/.test(steamid)) return {}

  // Ник от снапшота не зависит — читаем вместе; страница возьмёт оба из cache()
  const [snapshot, persona] = await Promise.all([snapshotOf(steamid), personaOf(steamid)])
  if (!snapshot) return { title: tr(locale, { ru: 'Портрет игрока', en: 'Player portrait' }), robots: { index: false } }

  const name = playerName(steamid, persona, locale)
  const hours = Math.round(snapshot.games.reduce((s, g) => s + g.playtimeForever, 0) / 60)
  const games = snapshot.games.length
  const title = tr(locale, { ru: `Портрет игрока ${name}`, en: `${name}'s player portrait` })
  // Превью ссылки в чате — то же правило, что и сама страница: при скрытом
  // времени «0 часов» было бы сказано про галочку Steam (lib/playtime.ts)
  const time = playtimeHidden(snapshot.games)
    ? tr(locale, { ru: 'время скрыто', en: 'playtime hidden' })
    : `${fmtNumber(locale, hours)} ${pl(locale, hours, { ru: ['час', 'часа', 'часов'], en: ['hour', 'hours'] })}`
  const gameWord = pl(locale, games, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })
  const description = tr(locale, {
    ru: `${games} ${gameWord}, ${time}. ` + 'Посмотри портрет и проверь совместимость вкусов.',
    en: `${fmtNumber(locale, games)} ${gameWord}, ${time}. See the portrait and check your taste match.`,
  })

  // Свой адрес, а не корневой '/': см. ownAddress в lib/site.ts
  const url = `/portrait/${steamid}`

  return {
    title,
    description,
    alternates: localeAlternates(locale, url),
    // Из индекса убираем, из шеринга — нет. Заголовок содержит настоящий ник
    // Steam, а страница строится по снапшоту без всякой авторизации: место
    // такому в переписке по прямой ссылке, а не в поисковой выдаче.
    // На og-превью и card.png флаг не влияет — их читают по ссылке, а из
    // поиска по картинкам их убирает X-Robots-Tag (lib/robots.ts): метатега
    // у PNG нет.
    robots: { index: false, follow: true },
    openGraph: {
      ...ogSite(locale),
      title,
      description,
      type: 'profile',
      url: lp(locale, url),
      ...ogImageOn(locale, url, 'Player portrait — imbored'),
    },
    twitter: { card: 'summary_large_image', title, description },
  }
}

const EASE = [0.22, 1, 0.36, 1] as const

/** Появление ниже сгиба — канонические настройки проекта (см. /play). */
const inView = (i = 0) => ({
  initial: { opacity: 0, y: 12 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: '-40px' },
  transition: { duration: 0.45, ease: EASE, delay: i * 0.05 },
})

/**
 * Мозаика: плитки крупнее у самых наигранных, дальше мельче.
 *
 * `step` — сколько плиток заполняет ряд целиком И на телефоне, И на десктопе
 * (общее кратное числа колонок). Внутри блока ширина одна, поэтому ряд не
 * может выровняться по самой высокой плитке и оставить под мелкими пустоту.
 */
/*
 * У каждого ряда мозаики СВОЯ подсказка ширины, и это не педантизм.
 *
 * Рядов четыре, и колонок в них 2, 2→4, 3→6 и 4→8 — то есть плитка занимает от
 * половины экрана до одной восьмой. Одна подсказка на всех давала верхнему,
 * самому крупному ряду «20vw» при настоящих 50vw: он грузился ВДВОЕ С
 * ПОЛОВИНОЙ мельче нужного и заметно мылил, а нижний наоборот приезжал
 * тяжелее необходимого.
 */
const MOSAIC_PLAN = [
  { take: 2, step: 2, cols: 'grid-cols-2', sizes: '50vw' },
  { take: 4, step: 4, cols: 'grid-cols-2 md:grid-cols-4', sizes: '(min-width: 768px) 25vw, 50vw' },
  { take: 12, step: 6, cols: 'grid-cols-3 md:grid-cols-6', sizes: '(min-width: 768px) 17vw, 33vw' },
  { take: 24, step: 8, cols: 'grid-cols-4 md:grid-cols-8', sizes: '(min-width: 768px) 13vw, 25vw' },
]

/** Постеров в стене героя: восемь колонок на четыре ряда на десктопе */
const PORTRAIT_WALL = 32

/** Адрес исчерпал холодные сборки. Бросается ИЗ кэшируемой функции: такой результат кэшу не достаётся */
class ColdBuildLimited extends Error {}

/**
 * Модель страницы — из кэша по снапшоту, холодная сборка — под потолком.
 *
 * Ключ [steamid, takenAt]: новый снапшот — новый ключ, и старую модель не
 * надо сбрасывать. Тег portrait:<steamid> (portraitTag) — ручка на то, что
 * меняется без снапшота: бан и его снятие сбрасывают модель из /api/feedback
 * и /api/unban, иначе «начни с этой» сутки указывала бы на скрытую игру.
 * После удаления данных по запросу (forget-user) запись недостижима:
 * страница сначала читает снапшот, а без него до кэша не доходит.
 *
 * Обёртка собирается на каждый запрос, потому что в замыкании адрес и
 * снапшот: они нужны холодной сборке, но в ключ попадать не должны — ключ
 * задают только keyParts (плюс исходник функции).
 */
async function loadModel(
  steamid: string,
  snapshot: { takenAt: number; games: LibraryGame[] },
  ip: string,
  now: number,
): Promise<{ model: PortraitModel; complete: boolean }> {
  const build = unstable_cache(
    async (): Promise<PortraitModel> => {
      // getDb внутри: объект соединения в ключ кэша не сериализуется
      const db = await getDb()
      const gate = await checkRate(db, {
        bucket: 'portrait-build-ip',
        id: ip,
        limit: MODEL_BUILD_IP_LIMIT,
        windowSec: MODEL_BUILD_WINDOW_SEC,
        nowSec: now,
      })
      if (!gate.ok) throw new ColdBuildLimited()
      // Портрет строится по библиотеке игрока — весь каталог для этого не
      // нужен, и блобы тоже: скриншотов на странице нет. Баны владельца и
      // карта тегов — здесь же, внутри кэша: страница публичная, и читать их
      // на каждый заход значило бы платить всей историей фидбека владельца и
      // всей таблицей тегов за каждый просмотр чужой ссылки
      //
      // Отметки года — тоже здесь: блоб библиотеки на начало года, и
      // платить им за каждый просмотр незачем. Год — от снапшота, а не от
      // часов сервера: ключ кэша — снапшот (yearsToRead)
      const [fromYear, toYear] = yearsToRead(snapshot.takenAt)
      const [metas, banned, tagStats, baselines] = await Promise.all([
        getGamesMetaLite(db, snapshot.games.map((g) => g.appid)),
        bannedAppids(db, steamid),
        loadTagStats(db),
        getLibraryBaselines(db, steamid, fromYear, toYear),
      ])
      return buildPortraitModel(snapshot.games, (id) => metas.get(id), now, MOSAIC_PLAN, {
        banned,
        // «Начни с этой» — той же мерой вкуса, что /play
        tagWeight: tagWeightFrom(tagStats),
        yearWindow: pickYearWindow(snapshot, baselines),
      })
    },
    // v3 — в модели появились итоги года: запись v2 без них отдавалась бы сутки.
    // v4 — признак скрытого времени (wrapped.playtimeHidden): запись v3 без него
    // сутки показывала бы «0 часов» и «Чистилище» на всю библиотеку.
    // v5 — сумма бэклога несёт свой регион (backlog.cc): запись v4 после смены
    // STEAM_STORE_CC сутки рисовала бы долларовые центы знаком рубля.
    // v6 — у игр топа есть минуты (WrappedGame.minutes): запись v5 без них
    // сутки подписывала бы всю «Куда ушло время» как «0 ч». Заодно доля
    // топ-игры из минут и «полные дни» вниз — без смены ключа запись v5
    // сутки держала бы «142%» и «1 полный день» за 12 часов. И всё наигранное —
    // минутами (Wrapped.totalMinutes, а не готовые часы): запись без поля
    // отдала бы герою undefined вместо «0 часов».
    // v7 — у архетипов есть ключ (Archetype.key): подпись на языке страницы
    // берётся по нему (archetypeLabelOf), а запись v6 несла бы один русский
    // label. Ключ кэша без языка: модель — числа и игры, слов в ней нет
    ['portrait-model:v7', steamid, String(snapshot.takenAt)],
    { tags: [portraitTag(steamid)], revalidate: MODEL_TTL_SEC },
  )
  try {
    return { model: await build(), complete: true }
  } catch (err) {
    if (!(err instanceof ColdBuildLimited)) throw err
    return {
      model: buildPortraitModel(snapshot.games, () => undefined, now, MOSAIC_PLAN),
      complete: false,
    }
  }
}

export default async function PortraitPage({ params }: { params: Promise<{ steamid: string; lang?: string }> }) {
  const { steamid, lang } = await params
  // Язык — из params, как в generateMetadata: без маршрута (тест) — русский
  const locale = toLocale(lang)
  if (!/^\d{17}$/.test(steamid)) notFound()

  const now = nowSec()
  const snapshot = await snapshotOf(steamid)
  if (!snapshot) {
    return (
      <Notice
        title={tr(locale, { ru: 'Портрета пока нет', en: 'No portrait yet' })}
        body={tr(locale, {
          ru: 'Этот игрок ещё не подключал библиотеку к imbored — рисовать не из чего. Свой портрет собирается за минуту.',
          en: "This player hasn't connected their library to imbored yet, so there's nothing to draw from. Yours takes about a minute to build.",
        })}
      >
        <Link href={reconnectHref()} className="btn-ember px-6 py-3">
          {tr(locale, { ru: 'Подключить свою', en: 'Connect your library' })}
        </Link>
      </Notice>
    )
  }

  /*
   * Ник, сессия и записанный текст портрета от модели не зависят — им нужен
   * только steamid, — поэтому ждутся вместе с ней. Цепочкой «модель → ник →
   * сессия → текст» каждый заход по чужой ссылке, даже из прогретого кэша,
   * платил лишние последовательные походы в Turso до первого байта.
   * После проверки снапшота, а не до: без снапшота страница отвечает
   * заглушкой, и заранее начатые чтения были бы оплачены зря (а их отказ —
   * необработанным отклонением промиса).
   * Текст НЕ читается внутри кэша модели: он меняется без снапшота
   * (setUserPortrait ниже), и замыкание кэша заморозило бы его.
   * Читается слот языка страницы: на /en — английский текст, а нет его —
   * null, и русский на английской странице не показывается никогда.
   */
  const ip = clientIp(await headers())
  const db = await getDb()
  const [{ model, complete }, persona, me, cached] = await Promise.all([
    loadModel(steamid, snapshot, ip, now),
    personaOf(steamid),
    currentSteamId(),
    getUserPortrait(db, steamid, locale),
  ])
  const { portrait, wrapped, backlog, headline, evidence, starter, mosaic, purgatory } = model
  // Число вынимается из фразы, чтобы остаться моноширинным, как все числа
  const equivalent = (() => {
    const eq = backlogEquivalent(backlog.cents, backlog.cc, steamid, locale)
    if (!eq) return null
    const [before, after] = eq.text.split('{n}')
    return { count: eq.count, before, after }
  })()
  const name = playerName(steamid, persona, locale)
  // Русский ник на /en — с lang="ru" (langOn); на русской странице — без атрибута
  const nameLang = langOn(locale, name)
  // Счёт посреди фразы: по-английски — с разрядами, по-русски — как был, голым числом
  const count = (n: number) => (locale === 'en' ? fmtNumber(locale, n) : n)

  /*
   * Свой портрет или чужой — от этого зависит голос страницы (lib/portraitvoice).
   * Владельцу она говорит «ты», гостю по ссылке — о владельце. Раньше «ты»
   * слышали все, и друг над ником «Аня» читал «80% твоей игровой жизни».
   */
  const isMine = me === steamid
  const voice: PortraitVoice = isMine ? 'you' : 'them'
  const fallbackText = () => portraitFallbackText(name, portrait.archetypes, portrait.facts, voice, locale)

  /*
   * Текст портрета: кэш по времени снапшота, Claude при наличии ключа, иначе шаблон.
   *
   * ПОТОЛОК НА ХОЛОДНЫЙ ПУТЬ ОБЯЗАТЕЛЕН, и это не перестраховка. Страница
   * публичная по замыслу — портретом делятся ссылкой, поэтому требовать сессию
   * нельзя, — но steamid в адресе выбирает кто угодно, а демо-личность выдаётся
   * даром через POST /api/connect {demo:true}. Без потолка публичный GET
   * оказывался прямой дверью к нашему ключу Anthropic: замерено на подменённом
   * эндпоинте — цепочка «получить демо-сессию → открыть /portrait/<id>» шла
   * в модель на каждом холодном рендере, без единой куки в запросе.
   *
   * Кэш дырой не закрывает: холодный портрет чеканится бесплатно, а параллельные
   * рендеры одного и того же холодного адреса замка не имеют — десять
   * одновременных заходов дали десять вызовов, потому что запись в кэш случается
   * только ПОСЛЕ ответа модели. Поэтому считаем обе оси: адрес (от скрипта,
   * перебирающего steamid) и сам steamid (от параллельных заходов по одному).
   *
   * Отказ не ломает страницу и НЕ ПИШЕТСЯ В КЭШ: человек видит шаблонный текст,
   * а следующий заход после снятия потолка получит настоящий. Записать шаблон
   * значило бы заморозить его до смены снапшота.
   *
   * Модель-шаблон (complete: false) к Claude не ходит вовсе: архетипов у неё
   * нет, и записанный по ней текст заморозил бы пустой портрет до смены снапшота.
   */
  let text: string
  // Снапшот тот же — но текст про «0 часов», записанный до того, как промпт
  // узнал о скрытом времени, не годится и при нём (PORTRAIT_TEXT_V).
  // Свежесть и сам текст — одного слота, языка страницы: судить английский,
  // а показать русский так нельзя (freshPortraitText)
  const fresh = freshPortraitText(cached, snapshot.takenAt, portrait.facts.playtimeHidden, locale)
  if (fresh !== null) {
    text = fresh
  } else if (!complete) {
    text = fallbackText()
  } else {
    const allowed = (
      await Promise.all([
        checkRate(db, {
          bucket: 'portrait-ip',
          id: ip,
          limit: PORTRAIT_IP_LIMIT,
          windowSec: PORTRAIT_WINDOW_SEC,
          nowSec: now,
        }),
        checkRate(db, {
          bucket: 'portrait',
          id: steamid,
          limit: PORTRAIT_LIMIT,
          windowSec: PORTRAIT_WINDOW_SEC,
          nowSec: now,
        }),
      ])
    ).every((v) => v.ok)

    // Общий суточный бюджет модели — после личных потолков: иначе его тратили
    // бы и отказанные запросы (lib/llmcap). И через долю адреса, общую с
    // подбором: потолок адреса выше — десять холодных портретов за десять
    // минут — стережёт ключ от перебора steamid, а не суточный бюджет. Это
    // до полутора тысяч вызовов в сутки с одного адреса, и снимки чужих
    // публичных профилей через /api/connect выбирали бы LLM_DAILY_CAP за всех.
    // Доля выбрана — тот же шаблон, что и при отказе по потолку
    const written =
      allowed && llmAvailable() && (await takeLlmBudgetForIp(db, ip, now))
        ? await claudePortraitText({ name, archetypes: portrait.archetypes, facts: portrait.facts, locale })
        : null
    text = written ?? fallbackText()
    // В слот своего языка: английский текст не стирает русский, и наоборот
    if (written) await setUserPortrait(db, steamid, { takenAt: snapshot.takenAt, text, v: PORTRAIT_TEXT_V }, locale)
  }

  /*
   * sizes — ОБЯЗАТЕЛЬНЫЙ довод, а не значение по умолчанию.
   *
   * Помощник зовут из пяти мест с пятью разными раскладками: четыре ряда
   * мозаики, строка топа с шириной w-28/md:w-44, сетка в три колонки, сетка
   * 3→6 и коробка в фиксированные w-40. Общая подсказка «20vw, 50vw» не
   * подходила НИ ОДНОМУ из них: где-то просила вдвое мельче нужного (и мылила),
   * где-то вдвое крупнее (и грузила лишнее). Обязательный довод заставляет
   * каждое место назвать свою ширину — забыть его нельзя, сборка не даст.
   */
  const flat = mosaic.flat()
  const wall = flat.length ? Array.from({ length: PORTRAIT_WALL }, (_, i) => flat[i % flat.length]) : []

  const cover = (
    g: { appid: number; name: string },
    sizes: string,
    extra = '',
    eager = false,
  ) => (
    <GameArt
      appid={g.appid}
      name={g.name}
      headerImage={model.covers[g.appid]?.headerImage ?? null}
      art={model.covers[g.appid]?.art ?? null}
      eager={eager}
      sizes={sizes}
      className={`w-full aspect-[460/215] object-cover ${extra}`}
    />
  )

  return (
    <div className="flex-1">
      {/* ——— 1. Обложка: библиотека как есть ——— */}
      <section
        className="media-dark relative flex min-h-screen flex-col justify-end overflow-hidden"
        style={{ minHeight: '100svh' }}
      >
        {/*
          Библиотека стеной постеров — самые наигранные первыми, то есть в
          верхнем левом углу, где взгляд начинает. Раньше стена была из
          капсул 460×215 рядами разной высоты и читалась как таблица.
          Маленькая библиотека добирается повтором, как стена ожидания:
          иначе от стены оставался один ряд.
        */}
        <div aria-hidden className="portrait-wall">
          {wall.map((g, i) => (
            <span key={i} className="portrait-wall-cell">
              <GameArt
                appid={g.appid}
                name={g.name}
                headerImage={model.covers[g.appid]?.headerImage ?? null}
                art={model.covers[g.appid]?.art ?? null}
                variant="poster"
                sizes="(min-width: 768px) 12vw, 25vw"
                eager={i < 8}
                fallback={null}
                className="h-full w-full object-cover"
              />
            </span>
          ))}
        </div>
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, #050505 6%, rgba(5,5,5,0.86) 30%, rgba(5,5,5,0.45) 62%, rgba(5,5,5,0.5) 100%)',
          }}
        />
        <BlurBand height="46vh" dir="up" />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto w-full max-w-6xl px-safe pb-16 pt-40">
          <Eyebrow className="mb-3">{tr(locale, { ru: 'Портрет игрока', en: 'Player portrait' })}</Eyebrow>
          {/* Обёртка с lang — только у русского ника на /en: у SplitHeading своего
              lang нет, а русская разметка героя остаётся прежней до узла */}
          {nameLang ? (
            <div lang={nameLang}>
              <SplitHeading className="font-display text-display-xl" delay={0.18}>
                {name}
              </SplitHeading>
            </div>
          ) : (
            <SplitHeading
              className="font-display text-display-xl"
              delay={0.18}
            >
              {name}
            </SplitHeading>
          )}
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            <Fact value={wrapped.gamesCount} caption={gamesCaption(wrapped.gamesCount, locale)} delay={300} />
            {/* Время скрыто настройками Steam (lib/playtime.ts): одно слово
                вместо «0 часов» и «0 не запущено» — оба нуля были бы про
                галочку, а не про человека */}
            {wrapped.playtimeHidden ? (
              <div className="flex flex-col-reverse">
                <dt className="lib-stat-label">{tr(locale, { ru: 'время в играх', en: 'playtime' })}</dt>
                <dd className="lib-stat">{tr(locale, { ru: 'скрыто', en: 'hidden' })}</dd>
              </div>
            ) : (
              <>
                {/* Меньше получаса на всю библиотеку — минутами (playedFact):
                    «0 часов» стояло над «Куда ушло время» с «20 мин» */}
                <Fact {...playedFact(wrapped.totalMinutes, locale)} delay={360} />
                <Fact
                  value={wrapped.unplayedCount}
                  caption={unplayedCaption(wrapped.unplayedCount, locale)}
                  delay={420}
                  accent
                />
              </>
            )}
          </dl>
          {wrapped.days > 0 && (
            <p className="mt-6 text-dim text-sm md:text-base">
              {/* «Дней», а не «суток»: у «суток» нет формы на 21, 31, 101 —
                  выходило «31 полных суток» */}
              {tr(locale, {
                ru: (
                  <>
                    Это <span className="tabular-nums text-ink">{fmtNumber(locale, wrapped.days)}</span>{' '}
                    {plural(wrapped.days, 'полный день', 'полных дня', 'полных дней')} за экраном.
                  </>
                ),
                en: (
                  <>
                    That&apos;s <span className="tabular-nums text-ink">{fmtNumber(locale, wrapped.days)}</span>{' '}
                    {pl(locale, wrapped.days, { ru: ['полный день', 'полных дня', 'полных дней'], en: ['full day', 'full days'] })}{' '}
                    of screen time.
                  </>
                ),
              })}
            </p>
          )}
          {!complete && (
            <p className="mt-3 max-w-md text-dim text-sm">
              {tr(locale, {
                ru: 'С этого адреса сейчас открывают слишком много портретов подряд. Диагноз по жанрам появится здесь через несколько минут.',
                en: 'Too many portraits are being opened from this address right now. The genre diagnosis will show up here in a few minutes.',
              })}
            </p>
          )}
        </div>
      </section>

      {/* ——— 2. Подиум: куда ушло время ——— */}
      {wrapped.top.length > 0 && (
        <section className="relative mx-auto w-full max-w-5xl px-safe py-24 md:py-32">
          <m.h2 {...inView()} className="mb-8 font-display text-display-lg">
            {tr(locale, { ru: 'Куда ушло время', en: 'Where the time went' })}
          </m.h2>

          <div className="flex flex-col gap-3">
            {wrapped.top.map((g, i) => (
              <m.div key={g.appid} {...inView(i)} className="flex items-center gap-4">
                <span className="portrait-rank w-7 shrink-0">{i + 1}</span>
                <GameLink
                  appid={g.appid}
                  aria-label={g.name}
                  lang={langOn(locale, g.name)}
                  className="game-card w-28 shrink-0 md:w-44"
                >
                  <span className="card-thumb">{cover(g, '(min-width: 768px) 176px, 112px')}</span>
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
                {/* Минуты, а не округлённые часы: игра на 20 минут была «0 ч»
                    рядом с непустой полосой (playedShort) */}
                <span className="shrink-0 text-sm font-bold tabular-nums text-dim">
                  {playedShort(g.minutes, locale)}
                </span>
              </m.div>
            ))}
          </div>

          <div className="mt-12 flex flex-col md:flex-row items-center gap-8 md:gap-12">
            <m.div {...inView()} className="shrink-0">
              {/*
                suffix="" — число в центре не процент, а индекс: 0 «размазан
                ровно», 100 «всё в одной игре». С «%» кольцо противоречило
                подписи прямо под собой, и подпись брала на себя работу
                поправлять картинку словами.
                ariaLabel — по той же причине, что расписана в самом кольце:
                без него диктор произносит голое число, а чего именно это
                число, из разметки не следует.
              */}
              <p className="lib-stat portrait-index">
                <span aria-hidden>
                  {wrapped.concentration}
                  <span className="portrait-index-of">/100</span>
                </span>
                <span className="sr-only">
                  {tr(locale, {
                    ru: <>Концентрация {wrapped.concentration} из 100</>,
                    en: <>Concentration {wrapped.concentration} out of 100</>,
                  })}
                </span>
              </p>
            </m.div>
            <m.div {...inView(1)} className="text-center md:text-left">
              <p className="font-display text-display-sm">
                {paretoLead(voice, locale)}{' '}
                <span className="tabular-nums text-ember-text">{count(wrapped.pareto80)}</span>{' '}
                {pl(locale, wrapped.pareto80, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })}
                {tr(locale, { ru: ' из', en: ' out of' })}{' '}
                <span className="tabular-nums">{count(wrapped.gamesCount)}</span>.
              </p>
              <p className="mt-2 text-dim text-sm">
                {tr(locale, {
                  ru: <>Концентрация {wrapped.concentration} из 100:</>,
                  en: <>Concentration {wrapped.concentration} out of 100:</>,
                })}{' '}
                {concentrationVerdict(wrapped.concentration, voice, locale)}.
              </p>
              {wrapped.social && (
                <p className="mt-2 text-dim text-sm">
                  <span className="tabular-nums text-ink">{wrapped.social.percent}%</span>{' '}
                  {socialTail(voice, locale)}
                </p>
              )}
            </m.div>
          </div>
        </section>
      )}

      {/* ——— 2½. Итоги года ——— */}
      {model.year && (
        <YearBlock year={model.year} steamid={steamid} cover={cover} locale={locale} />
      )}

      {/* ——— 3. Диагноз ——— */}
      {portrait.archetypes.length > 0 && (
        <section className="relative mx-auto w-full max-w-5xl px-safe py-24 md:py-32">
          <m.p {...inView()} className={`${eyebrow()} mb-3`}>
            {tr(locale, { ru: 'Диагноз', en: 'Diagnosis' })}
          </m.p>
          {headline && (
            <m.h2
              {...inView(1)}
              className="font-display text-display-lg mb-10"
            >
              {/* label у архетипа всегда русский — подпись по ключу (lib/archetypes) */}
              {archetypeLabelOf(headline, locale)}
            </m.h2>
          )}

          {evidence.length > 0 && (
            <div className="mb-12 grid grid-cols-3 gap-3 md:gap-4">
              {evidence.map((g, i) => (
                <m.div key={g.appid} {...inView(i)}>
                  <GameLink appid={g.appid} lang={langOn(locale, g.name)} className="game-card block">
                    {/* grid-cols-3 без порогов — треть экрана на любой ширине */}
                    <GameCardBody
                      appid={g.appid}
                      name={g.name}
                      headerImage={model.covers[g.appid]?.headerImage ?? null}
                      art={model.covers[g.appid]?.art ?? null}
                      sizes="33vw"
                    />
                  </GameLink>
                </m.div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3 max-w-xl">
            {portrait.archetypes.map((a, i) => (
              <m.div key={a.tag} {...inView(i)}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-[15px] font-bold">{archetypeLabelOf(a, locale)}</span>
                  <span className="tabular-nums text-ember-text text-sm font-extrabold">
                    <CountNumber value={a.percent} delay={i * 90} duration={800} suffix="%" />
                  </span>
                </div>
                <div className="h-2 rounded-full bg-track overflow-hidden">
                  {/* Ширина — barPercent (лидер = 100%): при нормировке к сумме
                      даже главный архетип получал куцую полосу и шкала читалась
                      как случайная. В тексте остаётся честный percent. */}
                  <m.div
                    className="h-full rounded-full"
                    initial={{ width: 0 }}
                    whileInView={{ width: `${a.barPercent}%` }}
                    viewport={{ once: true, margin: '-40px' }}
                    transition={{ duration: 0.9, ease: EASE, delay: i * 0.09 }}
                    style={{
                      background:
                        'linear-gradient(to right, color-mix(in srgb, var(--ember) 50%, transparent), var(--ember))',
                    }}
                  />
                </div>
              </m.div>
            ))}
          </div>
        </section>
      )}

      {/* ——— 4. Чистилище ——— */}
      {wrapped.unplayedCount > 0 && (
        <section className="relative mx-auto w-full max-w-6xl px-safe py-24 md:py-32">
          <m.p {...inView()} className={`${eyebrow()} mb-3`}>
            {tr(locale, { ru: 'Чистилище', en: 'Purgatory' })}
          </m.p>
          <m.h2 {...inView(1)} className="font-display text-display-lg">
            <CountNumber value={wrapped.unplayedCount} />{' '}
            {unplayedHeading(wrapped.unplayedCount, voice, locale)}
          </m.h2>

          <m.div {...inView(2)} className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-dim text-sm">
            {backlog.pricedCount > 0 && (
              <p>
                {/* «Не меньше» и «цена известна у 8 из 8» — только при
                    неполном счёте, как в карточке бэклога на /library */}
                {backlog.pricedCount < backlog.unplayedCount
                  ? tr(locale, { ru: 'В них лежит не меньше', en: "They're worth at least" })
                  : tr(locale, { ru: 'В них лежит', en: "They're worth" })}{' '}
                <span className="tabular-nums text-ember-text">
                  {formatPrice(backlog.cents, backlog.cc, { whole: true, locale })}
                </span>{' '}
                {byPrices(backlog.cc, locale)}
                {backlog.pricedCount < backlog.unplayedCount
                  ? tr(locale, {
                      ru: ` — цена известна у ${backlog.pricedCount} из ${backlog.unplayedCount}.`,
                      en: ` — ${fmtNumber(locale, backlog.pricedCount)} of ${fmtNumber(locale, backlog.unplayedCount)} have a known price.`,
                    })
                  : '.'}
              </p>
            )}
            {/* Шутки про бургеры обращаются к владельцу («их бы ты доел») —
                гостю они адресованы не были */}
            {isMine && equivalent && (
              <p>
                {equivalent.before}
                <span className="tabular-nums text-ember-text">{equivalent.count}</span>
                {equivalent.after}
              </p>
            )}
            {/* Целой фразой на язык: «2004 года» по-английски — «from 2004», и
                склейка русских кусков с переведённым началом не собралась бы */}
            {wrapped.era &&
              (locale === 'en' ? (
                <p>
                  {eraLead(voice, locale)}{' '}
                  <span className="tabular-nums text-ink">{wrapped.era.medianYear}</span>, and the oldest game
                  with any playtime is{' '}
                  <span lang={langOn(locale, wrapped.era.oldest.name)}>{quoted(wrapped.era.oldest.name, locale)}</span> from{' '}
                  <span className="tabular-nums">{wrapped.era.oldest.year}</span>.
                </p>
              ) : (
                <p>
                  {eraLead(voice)}{' '}
                  <span className="tabular-nums text-ink">{wrapped.era.medianYear}</span>, а самая старая
                  игра с наигранным временем — «{wrapped.era.oldest.name}»{' '}
                  <span className="tabular-nums">{wrapped.era.oldest.year}</span> года.
                </p>
              ))}
          </m.div>

          {purgatory.length > 0 && (
            <div className="mt-10 grid grid-cols-3 md:grid-cols-6 gap-2">
              {purgatory.map((g) => (
                <GameLink
                  key={g.appid}
                  appid={g.appid}
                  aria-label={g.name}
                  lang={langOn(locale, g.name)}
                  // library-tile уже обесцвечивает обложку в покое нулём JS —
                  // ровно то, что здесь нужно по смыслу
                  className="library-tile game-card block"
                >
                  {/* grid-cols-3 md:grid-cols-6 */}
                  <span className="card-thumb">{cover(g, '(min-width: 768px) 17vw, 33vw')}</span>
                </GameLink>
              ))}
            </div>
          )}

          {/* Совет, с чего начать, — владельцу: у гостя этой игры может не быть вовсе */}
          {isMine && starter && (
            <m.div {...inView()} className="mt-12 flex flex-col items-start gap-3">
              <p className="text-sm text-dim">
                {tr(locale, { ru: 'Если решишься — начни с этой:', en: "If you're up for it, start with this one:" })}
              </p>
              <Magnet>
                <GameLink
                  appid={starter.appid}
                  lang={langOn(locale, starter.name)}
                  className="panel-lift game-card no-lift flex items-center gap-4 p-2 pr-5"
                >
                  <span className="card-thumb w-40 shrink-0">{cover(starter, '160px')}</span>
                  <span className="font-extrabold tracking-[-0.01em]">{starter.name}</span>
                  <Icon name="arrow" size={18} className="text-dim" />
                </GameLink>
              </Magnet>
            </m.div>
          )}
        </section>
      )}

      {/* ——— 5. Финал ——— */}
      <section className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-10 px-safe pb-24 pt-8 text-center">
        {/*
          Гостю текст — цитатой с подписью. Текст модели пишется владельцу, на
          «ты», и кэшируется на снапшот: переписать его под гостя нельзя без
          ещё одного вызова, а без подписи он читается как обращение к тому,
          кто открыл ссылку. «Об игроке», а не «о {name}»: ник не склоняется,
          а «о Аня» и «о Игорь» — ошибка там, где «об» требует гласная.
        */}
        {/* Текст — крупной цитатой, а не абзацем в стеклянной рамке: это
            вывод всей страницы, и читается он как вывод */}
        <m.figure {...inView()} className="portrait-quote">
          <blockquote>{text}</blockquote>
          {!isMine && (
            <figcaption>
              {tr(locale, {
                ru: <>— imbored об игроке {name}</>,
                en: (
                  <>
                    — imbored on <span lang={nameLang}>{name}</span>
                  </>
                ),
              })}
            </figcaption>
          )}
        </m.figure>

        {/* Превью — обычная картинка на тот же роут, что и скачивание: каждый
            лишний рендер satori заново тянет обложки со Steam. Поэтому
            скачивание считается нажатием (CardDownload), а не на роуте.
            Адрес — на языке страницы: под /en роут рисует английскую карточку. */}
        <CardDownload
          what="portrait"
          {...inView(1)}
          href={lp(locale, `/portrait/${steamid}/card.png`)}
          download={`imbored-${steamid}.png`}
          className="game-card block w-56"
        >
          <span className="card-thumb">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lp(locale, `/portrait/${steamid}/card.png`)}
              alt={tr(locale, { ru: 'Карточка портрета', en: 'Portrait card' })}
              loading="lazy"
              className="w-full aspect-[1080/1350] object-cover"
            />
          </span>
          <span className="link-more mt-3">{tr(locale, { ru: 'Скачать карточку', en: 'Download card' })}</span>
        </CardDownload>

        {!isMine && (
          <Link
            href={`/compat/${steamid}`}
            className="btn-ember px-6 py-3"
          >
            {/* Без «с ним»: кто за ником, мы не знаем, а угаданный род
                ошибается в половине случаев */}
            {tr(locale, { ru: 'Сравнить вкусы', en: 'Compare tastes' })}
          </Link>
        )}
        {/*
          Страницей делятся — значит, отправить её должно быть чем. Раньше
          здесь был только совет «кинь ссылку», а в установленном приложении
          адресной строки нет вовсе: в чат уходила картинка без ссылки, и
          проверить по ней совместимость было нельзя. Адрес собирается на
          сервере: полю он нужен в разметке, а не после гидратации.
        */}
        {isMine && (
          <m.div {...inView(2)} className="flex w-full flex-col gap-2.5 text-left">
            <p className="text-xs text-dim">
              {tr(locale, {
                ru: 'По этой ссылке увидят твой портрет и смогут проверить совместимость.',
                en: 'Anyone with this link can see your portrait and check their compatibility with you.',
              })}
            </p>
            {/* Адрес — на языке страницы: друг по английской ссылке откроет английский портрет */}
            <ShareLinkField
              what="portrait"
              url={withRef(`${appBaseUrl()}${lp(locale, `/portrait/${steamid}`)}`, 'portrait')}
              label={tr(locale, { ru: 'Ссылка на твой портрет игрока', en: 'Link to your player portrait' })}
              title={tr(locale, { ru: `Портрет игрока ${name} — imbored`, en: `${name}'s player portrait — imbored` })}
              text={tr(locale, {
                ru: 'Мой портрет игрока по библиотеке Steam — проверь, совпадаем ли мы',
                en: 'My player portrait from my Steam library — see if our tastes match',
              })}
            />
          </m.div>
        )}
        <div className="flex items-center gap-2 text-faint text-xs">
          <Wordmark className="text-sm" /> · imbored.cc
        </div>
      </section>
    </div>
  )
}

function Fact({
  value,
  caption,
  delay,
  accent = false,
}: {
  value: number
  caption: string
  delay: number
  accent?: boolean
}) {
  return (
    <div className="flex flex-col-reverse">
      <dt className="lib-stat-label">{caption}</dt>
      <dd className={`lib-stat ${accent ? 'text-ember-text' : ''}`}>
        <CountNumber value={value} delay={delay} />
      </dd>
    </div>
  )
}

/**
 * Итоги года — коротко, между подиумом и диагнозом: сколько наиграно по
 * снимкам, тройка года по приросту, сколько распаковано и появилось, две
 * честные даты и дверь на страницу итогов целиком. Голос нейтральный: блок
 * читают и владелец, и гость по ссылке.
 */
function YearBlock({
  year,
  steamid,
  cover,
  locale,
}: {
  year: WrappedYear
  steamid: string
  cover: (g: { appid: number; name: string }, sizes: string) => ReactNode
  locale: Locale
}) {
  // Счёт посреди фразы: по-английски — с разрядами, по-русски — как был
  const count = (n: number) => (locale === 'en' ? fmtNumber(locale, n) : n)
  return (
    <section className="relative mx-auto w-full max-w-5xl px-safe py-24 md:py-32">
      <m.p {...inView()} className={`${eyebrow()} mb-3`}>
        {yearEyebrow(year, locale)}
      </m.p>
      {/* Без минут (только новые игры с нулём) заголовок — они, а не «0 мин в играх» */}
      <m.h2 {...inView(1)} className="font-display text-display-lg">
        {year.minutes > 0 ? (
          <>
            <span className="tabular-nums text-ember-text">{playedLine(year.minutes, locale)}</span>
            {tr(locale, { ru: ' в играх', en: ' played' })}
          </>
        ) : (
          <>
            <span className="tabular-nums text-ember-text">{count(year.added.count)}</span>{' '}
            {pl(locale, year.added.count, {
              ru: ['игра появилась', 'игры появились', 'игр появилось'],
              en: ['game added', 'games added'],
            })}
            {tr(locale, { ru: ' в библиотеке', en: ' to the library' })}
          </>
        )}
      </m.h2>
      <m.p {...inView(2)} className="mt-3 text-dim text-sm">
        <SnapshotDates year={year} locale={locale} />
      </m.p>

      {year.top.length > 0 && (
        <div className="mt-10 flex flex-col gap-3">
          {year.top.slice(0, 3).map((g, i) => (
            <m.div key={g.appid} {...inView(i)} className="flex items-center gap-4">
              <span className="portrait-rank w-7 shrink-0">{i + 1}</span>
              <GameLink
                appid={g.appid}
                aria-label={g.name}
                lang={langOn(locale, g.name)}
                className="game-card w-28 shrink-0 md:w-44"
              >
                <span className="card-thumb">{cover(g, '(min-width: 768px) 176px, 112px')}</span>
              </GameLink>
              <div
                lang={langOn(locale, g.name)}
                className="min-w-0 flex-1 truncate text-[15px] font-extrabold tracking-[-0.01em] md:text-base"
              >
                {g.name}
              </div>
              <span className="shrink-0 text-sm font-bold tabular-nums text-dim">+{playedLine(g.minutes, locale)}</span>
            </m.div>
          ))}
        </div>
      )}

      {year.minutes > 0 && (year.unpacked.count > 0 || year.added.count > 0) && (
        <m.p {...inView()} className="mt-8 text-dim text-sm">
          {year.unpacked.count > 0 && (
            <>
              <span className="tabular-nums text-ink">{count(year.unpacked.count)}</span>{' '}
              {pl(locale, year.unpacked.count, {
                ru: ['игра впервые запущена', 'игры впервые запущены', 'игр впервые запущено'],
                en: ['game launched for the first time', 'games launched for the first time'],
              })}
            </>
          )}
          {year.unpacked.count > 0 && year.added.count > 0 && ' · '}
          {year.added.count > 0 && (
            <>
              <span className="tabular-nums text-ink">{count(year.added.count)}</span>{' '}
              {tr(locale, {
                ru: plural(year.added.count, 'появилась', 'появились', 'появилось'),
                en: 'added',
              })}
              {tr(locale, { ru: ' в библиотеке', en: ' to the library' })}
            </>
          )}
        </m.p>
      )}

      <m.div {...inView()} className="mt-8">
        <Link href={`/portrait/${steamid}/year`} prefetch={false} className="tap link-more">
          {tr(locale, { ru: 'Все итоги года', en: 'Full year in review' })}
          <Icon name="arrow" size={16} />
        </Link>
      </m.div>
    </section>
  )
}
