import type { Metadata } from 'next'
import { unstable_cache } from 'next/cache'
import { headers } from 'next/headers'
import * as motion from 'motion/react-client'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { CountNumber } from '@/components/CountNumber'
import { GameArt } from '@/components/GameArt'
import { Magnet } from '@/components/Magnet'
import { ProgressRing } from '@/components/ProgressRing'
import { SplitHeading } from '@/components/SplitHeading'
import { Eyebrow, eyebrow } from '@/components/Labels'
import { Wordmark } from '@/components/Wordmark'
import {
  getGamesMeta,
  getLatestSnapshot,
  getPersonaName,
  getUserPortrait,
  setUserPortrait,
} from '@/lib/db'
import { claudePortraitText } from '@/lib/llm'
import { OG_SITE } from '@/lib/og'
import { gamesCaption, hoursCaption, unplayedCaption } from '@/lib/factcaptions'
import { plural } from '@/lib/plural'
import { checkRate, clientIp } from '@/lib/ratelimit'
import { buildPortraitModel, type PortraitModel } from '@/lib/portraitmodel'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { backlogEquivalent } from '@/lib/stats'
import type { LibraryGame } from '@/lib/types'

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
  params: Promise<{ steamid: string }>
}): Promise<Metadata> {
  const { steamid } = await params
  if (!/^\d{17}$/.test(steamid)) return {}

  const snapshot = await snapshotOf(steamid)
  if (!snapshot) return { title: 'Портрет игрока', robots: { index: false } }

  const name = (await personaOf(steamid)) ?? `Игрок ${steamid.slice(-4)}`
  const hours = Math.round(snapshot.games.reduce((s, g) => s + g.playtimeForever, 0) / 60)
  const games = snapshot.games.length
  const title = `Портрет игрока ${name}`
  const description =
    `${games} ${plural(games, 'игра', 'игры', 'игр')}, ` +
    `${hours.toLocaleString('ru-RU')} ${plural(hours, 'час', 'часа', 'часов')}. ` +
    'Посмотри портрет и проверь совместимость вкусов.'

  return {
    title,
    description,
    // Из индекса убираем, из шеринга — нет. Заголовок содержит настоящий ник
    // Steam, а страница строится по снапшоту без всякой авторизации: место
    // такому в переписке по прямой ссылке, а не в поисковой выдаче.
    // На og-превью и card.png флаг не влияет — их читают по ссылке.
    robots: { index: false, follow: true },
    openGraph: { ...OG_SITE, title, description, type: 'profile' },
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

/** Адрес исчерпал холодные сборки. Бросается ИЗ кэшируемой функции: такой результат кэшу не достаётся */
class ColdBuildLimited extends Error {}

/**
 * Модель страницы — из кэша по снапшоту, холодная сборка — под потолком.
 *
 * Ключ [steamid, takenAt]: новый снапшот — новый ключ, и старую модель не
 * надо сбрасывать. Тег portrait:<steamid> — ручка на случай, когда сбросить
 * всё же понадобится. После удаления данных по запросу (forget-user) запись
 * недостижима: страница сначала читает снапшот, а без него до кэша не доходит.
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
      // Портрет строится по библиотеке игрока — весь каталог для этого не нужен
      const metas = await getGamesMeta(
        db,
        snapshot.games.map((g) => g.appid),
      )
      return buildPortraitModel(snapshot.games, (id) => metas.get(id), now, MOSAIC_PLAN)
    },
    ['portrait-model:v1', steamid, String(snapshot.takenAt)],
    { tags: [`portrait:${steamid}`], revalidate: MODEL_TTL_SEC },
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

function fallbackText(
  name: string,
  archetypes: Array<{ label: string; percent: number }>,
  facts: { gamesCount: number; totalHours: number; unplayedCount: number; topGame: { name: string; sharePercent: number } | null },
): string {
  const parts: string[] = []
  if (archetypes.length >= 2) {
    parts.push(
      `${name}, ты на ${archetypes[0].percent}% ${archetypes[0].label} и на ${archetypes[1].percent}% ${archetypes[1].label}.`,
    )
  }
  parts.push(
    `За плечами ${facts.totalHours.toLocaleString('ru-RU')} ${plural(facts.totalHours, 'час', 'часа', 'часов')} в ${facts.gamesCount} ${plural(facts.gamesCount, 'игре', 'играх', 'играх')}${
      facts.unplayedCount
        ? `, а ${facts.unplayedCount} ${plural(facts.unplayedCount, 'игру', 'игры', 'игр')} ты так и не распаковал`
        : ''
    }.`,
  )
  if (facts.topGame && facts.topGame.sharePercent >= 30) {
    parts.push(`«${facts.topGame.name}» забрала ${facts.topGame.sharePercent}% всей твоей игровой жизни — и, кажется, не собирается отдавать.`)
  }
  return parts.join(' ')
}

export default async function PortraitPage({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params
  if (!/^\d{17}$/.test(steamid)) notFound()

  const now = nowSec()
  const snapshot = await snapshotOf(steamid)
  if (!snapshot) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">Этот игрок ещё не подключал библиотеку к imbored.</p>
        <Link href="/" className="tap text-ember-text hover:underline text-sm">
          Подключить свою →
        </Link>
      </div>
    )
  }

  const ip = clientIp(await headers())
  const { model, complete } = await loadModel(steamid, snapshot, ip, now)
  const { portrait, wrapped, backlog, headline, evidence, starter, mosaic, purgatory } = model
  // Число вынимается из фразы, чтобы остаться моноширинным, как все числа
  const equivalent = (() => {
    const eq = backlogEquivalent(backlog.cents, steamid)
    if (!eq) return null
    const [before, after] = eq.text.split('{n}')
    return { count: eq.count, before, after }
  })()
  const name = (await personaOf(steamid)) ?? `Игрок ${steamid.slice(-4)}`

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
  const db = await getDb()
  let text: string
  const cached = await getUserPortrait(db, steamid)
  if (cached && cached.takenAt === snapshot.takenAt) {
    text = cached.text
  } else if (!complete) {
    text = fallbackText(name, portrait.archetypes, portrait.facts)
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

    const written = allowed
      ? await claudePortraitText({ name, archetypes: portrait.archetypes, facts: portrait.facts })
      : null
    text = written ?? fallbackText(name, portrait.archetypes, portrait.facts)
    if (written) await setUserPortrait(db, steamid, { takenAt: snapshot.takenAt, text })
  }

  const me = await currentSteamId()
  const isMine = me === steamid

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
        <div aria-hidden className="absolute inset-0 flex flex-col">
          {mosaic.map((block, bi) => (
            <div key={MOSAIC_PLAN[bi].cols} className={`grid ${MOSAIC_PLAN[bi].cols}`}>
              {block.map((g) => (
                <div key={g.appid}>{cover(g, MOSAIC_PLAN[bi].sizes, '', bi === 0)}</div>
              ))}
            </div>
          ))}
        </div>
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, #0b0c10 6%, rgba(11,12,16,0.86) 30%, rgba(11,12,16,0.5) 62%, rgba(11,12,16,0.7) 100%)',
          }}
        />
        <BlurBand height="46vh" dir="up" />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-40">
          <Eyebrow className="mb-3">Портрет игрока</Eyebrow>
          <SplitHeading
            className="font-display text-display-xl"
            delay={0.18}
          >
            {name}
          </SplitHeading>
          <div className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            <Fact value={wrapped.gamesCount} caption={gamesCaption(wrapped.gamesCount)} delay={300} />
            <Fact value={wrapped.totalHours} caption={hoursCaption(wrapped.totalHours)} delay={360} />
            <Fact
              value={wrapped.unplayedCount}
              caption={unplayedCaption(wrapped.unplayedCount)}
              delay={420}
            />
          </div>
          {wrapped.days > 0 && (
            <p className="mt-6 text-dim text-sm md:text-base">
              Это <span className="font-mono text-ink">{wrapped.days.toLocaleString('ru-RU')}</span>{' '}
              полных суток за экраном.
            </p>
          )}
          {!complete && (
            <p className="mt-3 max-w-md text-dim text-sm">
              С этого адреса сейчас открывают слишком много портретов подряд. Диагноз по жанрам
              появится здесь через несколько минут.
            </p>
          )}
        </div>
      </section>

      {/* ——— 2. Подиум: куда ушло время ——— */}
      {wrapped.top.length > 0 && (
        <section className="relative mx-auto w-full max-w-5xl px-5 py-24 md:py-32">
          <motion.p
            {...inView()}
            className={`${eyebrow()} mb-8`}
          >
            Куда ушло время
          </motion.p>

          <div className="flex flex-col gap-3">
            {wrapped.top.map((g, i) => (
              <motion.div key={g.appid} {...inView(i)} className="flex items-center gap-4">
                <span className="font-mono text-dim text-sm w-5 shrink-0">{i + 1}</span>
                <Link
                  href={`/game/${g.appid}`}
                  className="glass glass-hover rounded-[14px] overflow-hidden w-28 md:w-44 shrink-0"
                >
                  {cover(g, '(min-width: 768px) 176px, 112px')}
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{g.name}</div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-track overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-ember"
                      initial={{ width: 0 }}
                      whileInView={{ width: `${g.sharePercent}%` }}
                      viewport={{ once: true, margin: '-40px' }}
                      transition={{ duration: 0.9, ease: EASE, delay: i * 0.06 }}
                    />
                  </div>
                </div>
                <span className="font-mono text-sm text-dim shrink-0 tabular-nums">
                  {g.hours.toLocaleString('ru-RU')} ч
                </span>
              </motion.div>
            ))}
          </div>

          <div className="mt-12 flex flex-col md:flex-row items-center gap-8 md:gap-12">
            <motion.div {...inView()} className="shrink-0">
              {/*
                suffix="" — число в центре не процент, а индекс: 0 «размазан
                ровно», 100 «всё в одной игре». С «%» кольцо противоречило
                подписи прямо под собой, и подпись брала на себя работу
                поправлять картинку словами.
                ariaLabel — по той же причине, что расписана в самом кольце:
                без него диктор произносит голое число, а чего именно это
                число, из разметки не следует.
              */}
              <ProgressRing
                percent={wrapped.concentration}
                size={140}
                stroke={8}
                suffix=""
                ariaLabel={`Концентрация ${wrapped.concentration} из 100`}
              />
            </motion.div>
            <motion.div {...inView(1)} className="text-center md:text-left">
              <p className="text-lg md:text-xl leading-relaxed">
                80% твоей игровой жизни — это{' '}
                <span className="font-mono text-ember-text">{wrapped.pareto80}</span>{' '}
                {plural(wrapped.pareto80, 'игра', 'игры', 'игр')} из{' '}
                <span className="font-mono">{wrapped.gamesCount}</span>.
              </p>
              <p className="mt-2 text-dim text-sm">
                Концентрация {wrapped.concentration} из 100:{' '}
                {wrapped.concentration >= 50
                  ? 'ты однолюб и не скрываешь этого'
                  : wrapped.concentration >= 20
                    ? 'есть любимцы, но ты не заперт в одной игре'
                    : 'ты размазан ровным слоем по всей библиотеке'}
                .
              </p>
              {wrapped.social && (
                <p className="mt-2 text-dim text-sm">
                  <span className="font-mono text-ink">{wrapped.social.percent}%</span> часов ты
                  провёл не один.
                </p>
              )}
            </motion.div>
          </div>
        </section>
      )}

      {/* ——— 3. Диагноз ——— */}
      {portrait.archetypes.length > 0 && (
        <section className="relative mx-auto w-full max-w-5xl px-5 py-24 md:py-32">
          <motion.p
            {...inView()}
            className={`${eyebrow()} mb-3`}
          >
            Диагноз
          </motion.p>
          {headline && (
            <motion.h2
              {...inView(1)}
              className="font-display text-display-lg mb-10"
            >
              {headline.label}
            </motion.h2>
          )}

          {evidence.length > 0 && (
            <div className="grid grid-cols-3 gap-3 mb-12">
              {evidence.map((g, i) => (
                <motion.div key={g.appid} {...inView(i)}>
                  <Link
                    href={`/game/${g.appid}`}
                    className="glass glass-hover rounded-[14px] overflow-hidden block"
                  >
                    {/* grid-cols-3 без порогов — треть экрана на любой ширине */}
                    {cover(g, '33vw')}
                    <div className="p-2.5 text-xs font-semibold truncate">{g.name}</div>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3 max-w-xl">
            {portrait.archetypes.map((a, i) => (
              <motion.div key={a.tag} {...inView(i)}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-semibold">{a.label}</span>
                  <span className="font-mono text-ember-text text-sm">
                    <CountNumber value={a.percent} delay={i * 90} duration={800} suffix="%" />
                  </span>
                </div>
                <div className="h-2 rounded-full bg-track overflow-hidden">
                  {/* Ширина — barPercent (лидер = 100%): при нормировке к сумме
                      даже главный архетип получал куцую полосу и шкала читалась
                      как случайная. В тексте остаётся честный percent. */}
                  <motion.div
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
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* ——— 4. Чистилище ——— */}
      {wrapped.unplayedCount > 0 && (
        <section className="relative mx-auto w-full max-w-6xl px-5 py-24 md:py-32">
          <motion.p
            {...inView()}
            className={`${eyebrow()} mb-3`}
          >
            Чистилище
          </motion.p>
          <motion.h2 {...inView(1)} className="font-display text-display-lg">
            <CountNumber value={wrapped.unplayedCount} />{' '}
            {plural(wrapped.unplayedCount, 'игра', 'игры', 'игр')} ты так и не запустил
          </motion.h2>

          <motion.div {...inView(2)} className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-dim text-sm">
            {backlog.pricedCount > 0 && (
              <p>
                В них лежит не меньше{' '}
                <span className="font-mono text-ember-text">
                  ${(backlog.cents / 100).toFixed(0)}
                </span>{' '}
                — цена известна у {backlog.pricedCount} из {backlog.unplayedCount}.
              </p>
            )}
            {equivalent && (
              <p>
                {equivalent.before}
                <span className="font-mono text-ember-text">{equivalent.count}</span>
                {equivalent.after}
              </p>
            )}
            {wrapped.era && (
              <p>
                Медиана твоей библиотеки —{' '}
                <span className="font-mono text-ink">{wrapped.era.medianYear}</span>, а самая старая
                игра с наигранным временем — «{wrapped.era.oldest.name}»{' '}
                <span className="font-mono">{wrapped.era.oldest.year}</span> года.
              </p>
            )}
          </motion.div>

          {purgatory.length > 0 && (
            <div className="mt-10 grid grid-cols-3 md:grid-cols-6 gap-2">
              {purgatory.map((g) => (
                <Link
                  key={g.appid}
                  href={`/game/${g.appid}`}
                  // library-tile уже обесцвечивает обложку в покое нулём JS —
                  // ровно то, что здесь нужно по смыслу
                  className="library-tile glass glass-hover rounded-[14px] overflow-hidden"
                >
                  {/* grid-cols-3 md:grid-cols-6 */}
                  {cover(g, '(min-width: 768px) 17vw, 33vw')}
                </Link>
              ))}
            </div>
          )}

          {starter && (
            <motion.div {...inView()} className="mt-12 flex flex-col items-start gap-3">
              <p className="text-dim text-sm">Если решишься — начни с этой:</p>
              <Magnet>
                <Link
                  href={`/game/${starter.appid}`}
                  className="glass glass-hover no-lift rounded-[14px] overflow-hidden flex items-center gap-4 pr-5"
                >
                  <div className="w-40 shrink-0">{cover(starter, '160px')}</div>
                  <span className="font-semibold">{starter.name}</span>
                </Link>
              </Magnet>
            </motion.div>
          )}
        </section>
      )}

      {/* ——— 5. Финал ——— */}
      <section className="relative mx-auto w-full max-w-xl px-5 pb-24 pt-8 flex flex-col items-center gap-8 text-center">
        <motion.p {...inView()} className="glass rounded-[20px] p-6 leading-relaxed text-ink/90">
          {text}
        </motion.p>

        {/* Превью — обычная картинка на тот же роут, что и скачивание: каждый
            лишний рендер satori заново тянет обложки со Steam. */}
        <motion.a
          {...inView(1)}
          href={`/portrait/${steamid}/card.png`}
          download={`imbored-${steamid}.png`}
          className="glass glass-hover rounded-[20px] overflow-hidden w-56 block"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/portrait/${steamid}/card.png`}
            alt="Карточка портрета"
            loading="lazy"
            className="w-full aspect-[1080/1350] object-cover"
          />
          <span className="block py-2.5 text-xs font-semibold">Скачать карточку</span>
        </motion.a>

        {!isMine && (
          <Link
            href={`/compat/${steamid}`}
            className="btn-ember px-6 py-3"
          >
            Сравнить с ним свои вкусы
          </Link>
        )}
        {isMine && (
          <p className="text-xs text-dim max-w-sm">
            Кинь ссылку на эту страницу — увидят твой портрет и смогут проверить совместимость.
          </p>
        )}
        <div className="flex items-center gap-2 text-faint text-xs">
          <Wordmark className="text-sm" /> · imbored.cc
        </div>
      </section>
    </div>
  )
}

function Fact({ value, caption, delay }: { value: number; caption: string; delay: number }) {
  return (
    <div>
      <div className="font-mono text-3xl md:text-4xl font-bold">
        <CountNumber value={value} delay={delay} />
      </div>
      <div className="text-xs text-dim mt-0.5">{caption}</div>
    </div>
  )
}
