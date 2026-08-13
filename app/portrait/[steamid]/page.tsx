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
import { Wordmark } from '@/components/Wordmark'
import {
  getGamesMeta,
  getLatestSnapshot,
  getPersonaName,
  getUserPortrait,
  setUserPortrait,
} from '@/lib/db'
import { claudePortraitText } from '@/lib/llm'
import { buildPortrait } from '@/lib/portrait'
import { currentSteamId, getDb, nowSec } from '@/lib/server'
import { backlogValue } from '@/lib/stats'
import { archetypeEvidence, buildWrapped, pickStarter } from '@/lib/wrapped'

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
  if (!snapshot) return { title: 'Портрет игрока — imbored' }

  const name = (await getPersonaName(db, steamid)) ?? `Игрок ${steamid.slice(-4)}`
  const hours = Math.round(snapshot.games.reduce((s, g) => s + g.playtimeForever, 0) / 60)
  const games = snapshot.games.length
  const title = `Портрет игрока ${name} — imbored`
  const description =
    `${games} ${plural(games, 'игра', 'игры', 'игр')}, ` +
    `${hours.toLocaleString('ru-RU')} ${plural(hours, 'час', 'часа', 'часов')}. ` +
    'Посмотри портрет и проверь совместимость вкусов.'

  return {
    title,
    description,
    openGraph: { title, description, type: 'profile' },
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

/** Мозаика: чем больше часов, тем шире плитка. Аспект 460:215 сохраняется всегда. */
function tileWidth(rank: number): string {
  if (rank === 0) return 'w-1/2 md:w-2/5'
  if (rank < 4) return 'w-1/2 md:w-1/5'
  return 'w-1/4 md:w-[10%]'
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
        <Link href="/" className="text-ember hover:underline text-sm">
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
  const mosaic = [...steamGames]
    .sort((a, b) => b.playtimeForever - a.playtimeForever)
    .slice(0, 40)
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
        <div aria-hidden className="absolute inset-0 flex flex-wrap content-start">
          {mosaic.map((g, i) => (
            <div key={g.appid} className={tileWidth(i)}>
              {cover(g, '', i < 6)}
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
          <p className="text-xs font-mono tracking-[0.3em] text-ember uppercase mb-3">
            Портрет игрока
          </p>
          <SplitHeading
            className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[0.95]"
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
            className="text-xs font-mono tracking-[0.3em] text-ember uppercase mb-8"
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
                  <div className="mt-1.5 h-1.5 rounded-full bg-white/8 overflow-hidden">
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
                <span className="font-mono text-ember">{wrapped.pareto80}</span>{' '}
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
            className="text-xs font-mono tracking-[0.3em] text-ember uppercase mb-3"
          >
            Диагноз
          </motion.p>
          {headline && (
            <motion.h2
              {...inView(1)}
              className="text-4xl md:text-6xl font-extrabold tracking-tight mb-10"
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
                  <span className="font-mono text-ember text-sm">
                    <CountNumber value={a.percent} delay={i * 90} duration={800} suffix="%" />
                  </span>
                </div>
                <div className="h-2 rounded-full bg-white/8 overflow-hidden">
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
            className="text-xs font-mono tracking-[0.3em] text-ember uppercase mb-3"
          >
            Чистилище
          </motion.p>
          <motion.h2 {...inView(1)} className="text-4xl md:text-6xl font-extrabold tracking-tight">
            <CountNumber value={wrapped.unplayedCount} />{' '}
            {plural(wrapped.unplayedCount, 'игра', 'игры', 'игр')} ты так и не запустил
          </motion.h2>

          <motion.div {...inView(2)} className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-dim text-sm">
            {backlog.pricedCount > 0 && (
              <p>
                В них лежит не меньше{' '}
                <span className="font-mono text-ember">
                  ${(backlog.cents / 100).toFixed(0)}
                </span>{' '}
                — цена известна у {backlog.pricedCount} из {backlog.unplayedCount}.
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
              {purgatory.map((g, i) => (
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
            className="rounded-[14px] bg-ember text-bg font-semibold px-6 py-3 hover:brightness-110 transition"
          >
            Сравнить с ним свои вкусы
          </Link>
        )}
        {isMine && (
          <p className="text-xs text-dim max-w-sm">
            Кинь ссылку на эту страницу — увидят твой портрет и смогут проверить совместимость.
          </p>
        )}
        <div className="flex items-center gap-2 text-dim/60 text-xs">
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

/** Русские окончания: 1 игра, 2 игры, 5 игр */
function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}
