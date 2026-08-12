import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Wordmark } from '@/components/Wordmark'
import {
  getAllGamesMeta,
  getLatestSnapshot,
  getPersonaName,
  getUserPortrait,
  setUserPortrait,
} from '@/lib/db'
import { claudePortraitText } from '@/lib/llm'
import { buildPortrait } from '@/lib/portrait'
import { currentSteamId, getDb } from '@/lib/server'

export const dynamic = 'force-dynamic'

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

  const metas = await getAllGamesMeta(db)
  const portrait = buildPortrait(snapshot.games, (id) => metas.get(id))
  const name = (await getPersonaName(db, steamid)) ?? `Игрок ${steamid.slice(-4)}`

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
  const topArt = portrait.facts.topGame
    ? snapshot.games.find((g) => g.name === portrait.facts.topGame!.name)?.appid
    : undefined

  return (
    <div className="flex-1 relative overflow-hidden">
      {topArt && topArt > 0 && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://cdn.cloudflare.steamstatic.com/steam/apps/${topArt}/header.jpg`}
          alt=""
          aria-hidden
          className="absolute -top-16 left-1/2 -translate-x-1/2 w-[120%] blur-3xl opacity-20"
        />
      )}
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, color-mix(in srgb, var(--bg) 40%, transparent), var(--bg) 80%)',
        }}
      />

      <div className="relative mx-auto w-full max-w-xl px-5 pt-28 pb-16 flex flex-col gap-8">
        <div className="text-center anim-reveal">
          <p className="text-xs font-mono tracking-[0.3em] text-ember uppercase mb-2">
            Портрет игрока
          </p>
          <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">{name}</h1>
        </div>

        {portrait.archetypes.length > 0 && (
          <div className="flex flex-col gap-3">
            {portrait.archetypes.map((a, i) => (
              <div key={a.tag} className="anim-rise" style={{ animationDelay: `${i * 90}ms` }}>
                <div className="flex items-baseline justify-between mb-1.5">
                  <span className="text-sm font-semibold">{a.label}</span>
                  <span className="font-mono text-ember text-sm">{a.percent}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/8 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${a.percent}%`,
                      background:
                        'linear-gradient(to right, color-mix(in srgb, var(--ember) 50%, transparent), var(--ember))',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 anim-rise" style={{ animationDelay: '300ms' }}>
          <div className="glass rounded-[14px] p-4 text-center">
            <div className="font-mono text-2xl font-bold">{portrait.facts.gamesCount}</div>
            <div className="text-xs text-dim mt-0.5">игр в библиотеке</div>
          </div>
          <div className="glass rounded-[14px] p-4 text-center">
            <div className="font-mono text-2xl font-bold">
              {portrait.facts.totalHours.toLocaleString('ru-RU')}
            </div>
            <div className="text-xs text-dim mt-0.5">часов сыграно</div>
          </div>
          <div className="glass rounded-[14px] p-4 text-center">
            <div className="font-mono text-2xl font-bold">{portrait.facts.unplayedCount}</div>
            <div className="text-xs text-dim mt-0.5">так и не запущены</div>
          </div>
          <div className="glass rounded-[14px] p-4 text-center">
            <div className="font-mono text-2xl font-bold">
              {portrait.facts.topGame ? `${portrait.facts.topGame.sharePercent}%` : '—'}
            </div>
            <div className="text-xs text-dim mt-0.5 truncate">
              {portrait.facts.topGame ? `времени — в ${portrait.facts.topGame.name}` : 'нет данных'}
            </div>
          </div>
        </div>

        <div className="glass rounded-[20px] p-6 anim-rise" style={{ animationDelay: '380ms' }}>
          <p className="leading-relaxed text-ink/90">{text}</p>
        </div>

        <div className="flex flex-col items-center gap-4">
          {!isMine && (
            <Link
              href={`/compat/${steamid}`}
              className="rounded-[14px] bg-ember text-bg font-semibold px-6 py-3 hover:brightness-110 transition"
            >
              Сравнить с ним свои вкусы
            </Link>
          )}
          {isMine && (
            <p className="text-xs text-dim text-center max-w-sm">
              Кинь ссылку на эту страницу — увидят твой портрет и смогут проверить совместимость.
            </p>
          )}
          <div className="flex items-center gap-2 text-dim/60 text-xs">
            <Wordmark className="text-sm" /> · imbored.cc
          </div>
        </div>
      </div>
    </div>
  )
}
