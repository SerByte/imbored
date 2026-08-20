import type { Metadata } from 'next'
import * as motion from 'motion/react-client'
import Link from 'next/link'
import { notFound } from 'next/navigation'
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
import { plural } from '@/lib/plural'
import { buildPortrait } from '@/lib/portrait'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { backlogEquivalent, backlogValue } from '@/lib/stats'
import { archetypeEvidence, buildWrapped, mosaicBlocks, pickStarter } from '@/lib/wrapped'

export const dynamic = 'force-dynamic'

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

  const db = await getDb()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) return { title: 'Портрет игрока', robots: { index: false } }

  const name = (await getPersonaName(db, steamid)) ?? `Игрок ${steamid.slice(-4)}`
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
const MOSAIC_PLAN = [
  { take: 2, step: 2, cols: 'grid-cols-2' },
  { take: 4, step: 4, cols: 'grid-cols-2 md:grid-cols-4' },
  { take: 12, step: 6, cols: 'grid-cols-3 md:grid-cols-6' },
  { take: 24, step: 8, cols: 'grid-cols-4 md:grid-cols-8' },
]

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
  parts.push(`За плечами ${facts.totalHours.toLocaleString('ru-RU')} часов в ${facts.gamesCount} играх${facts.unplayedCount ? `, а ${facts.unplayedCount} так и лежат нераспакованными` : ''}.`)
  if (facts.topGame && facts.topGame.sharePercent >= 30) {
    parts.push(`«${facts.topGame.name}» забрала ${facts.topGame.sharePercent}% всей твоей игровой жизни — и, кажется, не собирается отдавать.`)
  }
  return parts.join(' ')
}

export default async function PortraitPage({ params }: { params: Promise<{ steamid: string }> }) {
  const { steamid } = await params
  if (!/^\d{17}$/.test(steamid)) notFound()

  const db = await getDb()
  const snapshot = await getLatestSnapshot(db, steamid)
  if (!snapshot) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">Этот игрок ещё не подключал библиотеку к imbored.</p>
        <Link href="/" className="text-ember-text hover:underline text-sm">
          Подключить свою →
        </Link>
      </div>
    )
  }

  // Портрет строится по библиотеке игрока — весь каталог для этого не нужен
  const games = snapshot.games
  const metas = await getGamesMeta(
    db,
    games.map((g) => g.appid),
  )
  const metaOf = (id: number) => metas.get(id)
  const portrait = buildPortrait(games, metaOf)
  const wrapped = buildWrapped(games, metaOf)
  const backlog = backlogValue(games, metaOf, nowSec())
  // Число вынимается из фразы, чтобы остаться моноширинным, как все числа
  const equivalent = (() => {
    const eq = backlogEquivalent(backlog.cents, steamid)
    if (!eq) return null
    const [before, after] = eq.text.split('{n}')
    return { count: eq.count, before, after }
  })()
  const name = (await getPersonaName(db, steamid)) ?? `Игрок ${steamid.slice(-4)}`

  // Заголовок-диагноз только со словарной подписью: фолбэк «фанат Fantasy»
  // простителен в 14px, но не во весь экран
  const headline = portrait.archetypes.find((a) => a.known) ?? null
  // Улики не должны повторить подиум: вес архетипа определяется в основном
  // часами, поэтому без исключения это были бы те же самые обложки
  const shownOnPodium = new Set(wrapped.top.map((g) => g.appid))
  const evidence = headline
    ? archetypeEvidence(games, metaOf, headline.tag, shownOnPodium, 3)
    : []
  const starter = pickStarter(games, metaOf)

  // Мозаика и стена: только Steam-игры, у не-Steam записей арта нет
  const steamGames = games.filter((g) => g.appid > 0)
  const mosaic = mosaicBlocks(
    [...steamGames].sort((a, b) => b.playtimeForever - a.playtimeForever),
    MOSAIC_PLAN,
  )
  const purgatory = wrapped.unplayed.filter((g) => g.appid > 0).slice(0, 36)

  // текст: кэш по времени снапшота, Claude при наличии ключа, иначе шаблон
  let text: string
  const cached = await getUserPortrait(db, steamid)
  if (cached && cached.takenAt === snapshot.takenAt) {
    text = cached.text
  } else {
    text =
      (await claudePortraitText({ name, archetypes: portrait.archetypes, facts: portrait.facts })) ??
      fallbackText(name, portrait.archetypes, portrait.facts)
    await setUserPortrait(db, steamid, { takenAt: snapshot.takenAt, text })
  }

  const me = await currentSteamId()
  const isMine = me === steamid

  const cover = (g: { appid: number; name: string }, extra = '', eager = false) => (
    <GameArt
      appid={g.appid}
      name={g.name}
      headerImage={metaOf(g.appid)?.headerImage ?? null}
      art={metaOf(g.appid)?.art ?? null}
      eager={eager}
      sizes="(min-width: 768px) 20vw, 50vw"
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
                <div key={g.appid}>{cover(g, '', bi === 0)}</div>
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
            <Fact value={wrapped.gamesCount} caption="игр в библиотеке" delay={300} />
            <Fact value={wrapped.totalHours} caption="часов сыграно" delay={360} />
            <Fact value={wrapped.unplayedCount} caption="так и не запущены" delay={420} />
          </div>
          {wrapped.days > 0 && (
            <p className="mt-6 text-dim text-sm md:text-base">
              Это <span className="font-mono text-ink">{wrapped.days.toLocaleString('ru-RU')}</span>{' '}
              полных суток за экраном.
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
                  {cover(g)}
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
              <ProgressRing percent={wrapped.concentration} size={140} stroke={8} />
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
                    {cover(g)}
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
                  {cover(g)}
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
                  <div className="w-40 shrink-0">{cover(starter)}</div>
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
            className="rounded-[14px] bg-ember text-on-ember font-semibold px-6 py-3 hover:brightness-110 transition"
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
