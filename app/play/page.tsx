'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { LogoMark } from '@/components/Logo'
import { STORE_LABEL } from '@/lib/stores'
import type { Mood } from '@/lib/types'

type Signals = {
  matchPercent: number | null
  sharedTags: string[]
  moodTags: string[]
} | null

type Pick = {
  appid: number
  name: string
  source: 'backlog' | 'comeback' | 'new'
  reason: string
  headerImage: string | null
  shortDescription: string | null
  tags: string[]
  hoursPlayed: number | null
  store: string | null
  storeUrl: string | null
  priceFinal: number | null
  signals: Signals
}

const SOURCE_BADGE: Record<Pick['source'], string> = {
  backlog: 'Куплена, но не распакована',
  comeback: 'Пора вернуться',
  new: 'Новое для тебя',
}

const SKIP_REASONS: Array<{ key: string; label: string }> = [
  { key: 'genre', label: 'Не тот жанр' },
  { key: 'hard', label: 'Слишком сложная' },
  { key: 'tired', label: 'Надоела' },
  { key: 'notnow', label: 'Просто не сейчас' },
]

const COZY_TAGS = ['Casual', 'Relaxing', 'Cozy', 'Wholesome', 'Puzzle', 'Farming Sim']
const BURNOUT_AFTER_SKIPS = 5

function heroUrl(pick: Pick): string | null {
  if (pick.appid > 0)
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${pick.appid}/library_hero.jpg`
  return pick.headerImage
}

function HeroArt({ pick }: { pick: Pick }) {
  const [src, setSrc] = useState(heroUrl(pick))
  useEffect(() => setSrc(heroUrl(pick)), [pick])
  if (!src) {
    return (
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 70% 20%, rgba(255,158,100,0.16), transparent 70%), radial-gradient(50% 45% at 20% 80%, rgba(100,140,255,0.10), transparent 70%)',
        }}
      />
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      onError={() => setSrc(src !== pick.headerImage ? pick.headerImage : null)}
      className="absolute inset-0 h-full w-full object-cover anim-kenburns"
    />
  )
}

function weightedRandomIndex(length: number, exclude?: number): number {
  // ранние (лучше отранжированные) позиции весят больше
  const weights = Array.from({ length }, (_, i) => length - i)
  if (exclude !== undefined && length > 1) weights[exclude] = 0
  const total = weights.reduce((s, w) => s + w, 0)
  let r = Math.random() * total
  for (let i = 0; i < length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return 0
}

function Player() {
  const router = useRouter()
  const search = useSearchParams()
  const roulette = search.get('roulette') === '1'
  const mood: Mood = {
    time: (search.get('time') as Mood['time']) ?? 'medium',
    vibe: (search.get('vibe') as Mood['vibe']) ?? 'chill',
    social: (search.get('social') as Mood['social']) ?? 'solo',
  }

  const [phase, setPhase] = useState<'prepare' | 'reveal' | 'burnout' | 'error'>('prepare')
  const [progress, setProgress] = useState<string>('Изучаю твою библиотеку…')
  const [picks, setPicks] = useState<Pick[]>([])
  const [index, setIndex] = useState(0)
  const [liked, setLiked] = useState<Set<number>>(new Set())
  const [askReason, setAskReason] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [skipCount, setSkipCount] = useState(0)
  const [engine, setEngine] = useState<string>('')
  const started = useRef(false)

  const sendFeedback = useCallback(
    (appid: number, action: 'liked' | 'skipped' | 'opened' | 'banned', reason?: string) => {
      void fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid, action, ...(reason ? { reason } : {}), mood }),
      })
    },
    // mood собирается из строки запроса и в рамках страницы неизменен
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    if (started.current) return
    started.current = true

    async function run() {
      for (let i = 0; i < 80; i++) {
        const res = await fetch('/api/prepare', { method: 'POST' })
        if (res.status === 401 || res.status === 409) {
          router.push('/')
          return
        }
        const data = (await res.json()) as { remaining?: number }
        const remaining = data.remaining ?? 0
        if (remaining <= 0) break
        setProgress(`Изучаю твою библиотеку… осталось разобрать ${remaining} игр`)
      }

      setProgress('Подбираю игру под твоё состояние…')
      const res = await fetch('/api/recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mood }),
      })
      if (!res.ok) {
        setPhase('error')
        return
      }
      const data = (await res.json()) as { picks: Pick[]; engine: string }
      if (!data.picks?.length) {
        setPhase('error')
        return
      }
      setPicks(data.picks)
      setEngine(data.engine)
      setIndex(roulette ? weightedRandomIndex(data.picks.length) : 0)
      setPhase('reveal')
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const advance = useCallback(
    (from: number) => {
      setAskReason(false)
      setShowWhy(false)
      const next = skipCount + 1
      setSkipCount(next)
      if (next >= BURNOUT_AFTER_SKIPS) {
        setPhase('burnout')
        return
      }
      setIndex(roulette ? weightedRandomIndex(picks.length, from) : (from + 1) % picks.length)
    },
    [skipCount, picks.length, roulette],
  )

  if (phase === 'prepare') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5">
        <div className="h-10 w-10 rounded-full border-2 border-white/15 border-t-ember animate-spin" />
        <p className="text-dim text-sm">{progress}</p>
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-lg">Не получилось собрать рекомендации.</p>
        <p className="text-dim text-sm max-w-md">
          Возможно, каталог ещё прогревается — попробуй ещё раз через минуту.
        </p>
        <Link href="/quiz" className="text-ember hover:underline text-sm">
          Попробовать снова
        </Link>
      </div>
    )
  }

  if (phase === 'burnout') {
    const cozy =
      picks.find((p) => p.tags.some((t) => COZY_TAGS.includes(t))) ?? picks[picks.length - 1]
    return (
      <div className="flex-1 flex items-center justify-center px-5 py-24">
        <div className="max-w-lg w-full glass rounded-[20px] p-8 text-center flex flex-col gap-5 anim-reveal">
          <LogoMark size={48} className="mx-auto" />
          <h1 className="text-2xl font-bold tracking-tight">
            Похоже, сегодня не игровой вечер
          </h1>
          <p className="text-dim leading-relaxed">
            Ты пролистал уже {BURNOUT_AFTER_SKIPS} игр — дело, скорее всего, не в играх. Это
            нормально. Можно зайти на 20 минут во что-то уютное… а можно просто закрыть Steam, и
            это тоже победа.
          </p>
          {cozy && (
            <button
              onClick={() => {
                setSkipCount(0)
                setIndex(picks.indexOf(cozy))
                setPhase('reveal')
              }}
              className="rounded-[14px] bg-ember text-bg font-semibold py-3 hover:brightness-110 transition"
            >
              Ладно, покажи «{cozy.name}» — она спокойная
            </button>
          )}
          <div className="flex justify-center gap-5 text-sm">
            <button
              onClick={() => {
                setSkipCount(0)
                setPhase('reveal')
              }}
              className="text-dim hover:text-ink transition-colors"
            >
              Всё равно листать
            </button>
            <Link href="/" className="text-dim hover:text-ink transition-colors">
              На сегодня всё
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const pick = picks[Math.min(index, picks.length - 1)]
  const others = picks.filter((p) => p.appid !== pick.appid)
  const whyParts: string[] = []
  if (pick.signals) {
    if (pick.signals.matchPercent !== null)
      whyParts.push(`совпадение со вкусом ${pick.signals.matchPercent}%`)
    if (pick.signals.sharedTags.length)
      whyParts.push(`общие теги: ${pick.signals.sharedTags.join(', ')}`)
    if (pick.signals.moodTags.length)
      whyParts.push(`под вайб: ${pick.signals.moodTags.join(', ')}`)
  }

  return (
    <div className="flex-1 flex flex-col">
      <section
        key={pick.appid}
        className="media-dark relative min-h-[78vh] flex items-end overflow-hidden anim-reveal"
      >
        <HeroArt pick={pick} />
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to top, #0b0c10 4%, rgba(11,12,16,0.82) 26%, rgba(11,12,16,0.25) 55%, rgba(11,12,16,0.45) 100%)',
          }}
        />

        <div className="relative mx-auto w-full max-w-6xl px-5 pb-12 pt-40">
          <div className="max-w-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 text-xs">
              <span className="rounded-full bg-ember/15 text-ember px-3 py-1 font-medium">
                {pick.store ? `${STORE_LABEL[pick.store] ?? pick.store}` : SOURCE_BADGE[pick.source]}
              </span>
              {pick.hoursPlayed !== null && pick.hoursPlayed > 0 && (
                <span className="font-mono text-dim">{pick.hoursPlayed} ч наиграно</span>
              )}
            </div>

            <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight">{pick.name}</h1>

            <p className="text-base md:text-lg text-ink/90 leading-relaxed">{pick.reason}</p>

            {whyParts.length > 0 && (
              <div className="text-sm">
                <button
                  onClick={() => setShowWhy(!showWhy)}
                  className="text-dim hover:text-ink transition-colors"
                >
                  Почему она? {showWhy ? '▴' : '▾'}
                </button>
                {showWhy && (
                  <p className="mt-1.5 text-dim anim-rise">{whyParts.join(' · ')}</p>
                )}
              </div>
            )}

            {pick.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pick.tags.map((t) => (
                  <span key={t} className="glass rounded-full px-3 py-1 text-xs text-dim">
                    {t}
                  </span>
                ))}
              </div>
            )}

            {askReason ? (
              <div className="flex flex-wrap items-center gap-2 mt-2 anim-rise">
                <span className="text-sm text-dim mr-1">Почему не то?</span>
                {SKIP_REASONS.map((r) => (
                  <button
                    key={r.key}
                    onClick={() => {
                      sendFeedback(pick.appid, 'skipped', r.key)
                      advance(index)
                    }}
                    className="rounded-full glass glass-hover px-4 py-2 text-sm"
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  onClick={() => {
                    sendFeedback(pick.appid, 'skipped')
                    advance(index)
                  }}
                  className="text-sm text-dim hover:text-ink px-2 transition-colors"
                >
                  пропустить
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 mt-2">
                {pick.storeUrl ? (
                  <a
                    href={pick.storeUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => sendFeedback(pick.appid, 'liked')}
                    className="rounded-[14px] bg-ember text-bg font-semibold px-6 py-3 hover:brightness-110 transition"
                  >
                    Открыть в {STORE_LABEL[pick.store ?? ''] ?? 'магазине'}
                  </a>
                ) : (
                  <a
                    href={`steam://run/${pick.appid}`}
                    onClick={() => sendFeedback(pick.appid, 'liked')}
                    className="rounded-[14px] bg-ember text-bg font-semibold px-6 py-3 hover:brightness-110 transition"
                  >
                    Запустить в Steam
                  </a>
                )}
                {pick.source === 'new' && !pick.storeUrl && pick.priceFinal !== null && pick.priceFinal > 0 && (
                  <a
                    href={`https://store.steampowered.com/app/${pick.appid}/`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[14px] glass glass-hover px-5 py-3 text-sm"
                  >
                    <span className="font-mono text-ember">${(pick.priceFinal / 100).toFixed(2)}</span>
                    <span className="text-dim"> · в Steam</span>
                  </a>
                )}
                <Link
                  href={`/game/${pick.appid}`}
                  onClick={() => sendFeedback(pick.appid, 'opened')}
                  className="rounded-[14px] glass glass-hover px-6 py-3 text-sm"
                >
                  Подробнее
                </Link>
                <button
                  onClick={() => {
                    setLiked(new Set(liked).add(pick.appid))
                    sendFeedback(pick.appid, 'liked')
                  }}
                  className={`rounded-[14px] px-4 py-3 text-sm transition ${
                    liked.has(pick.appid) ? 'bg-ember/20 text-ember' : 'glass glass-hover text-dim'
                  }`}
                >
                  {liked.has(pick.appid) ? 'Зашло ✓' : 'Зашло'}
                </button>
                <button
                  onClick={() => {
                    if (roulette) {
                      sendFeedback(pick.appid, 'skipped')
                      advance(index)
                    } else {
                      setAskReason(true)
                    }
                  }}
                  className="rounded-[14px] glass glass-hover px-4 py-3 text-sm text-dim"
                >
                  {roulette ? 'Крутить ещё' : 'Не то — дальше'}
                </button>
                <button
                  onClick={() => {
                    sendFeedback(pick.appid, 'banned')
                    const rest = picks.filter((p) => p.appid !== pick.appid)
                    if (!rest.length) {
                      router.push('/quiz')
                      return
                    }
                    setPicks(rest)
                    setIndex(Math.min(index, rest.length - 1))
                    setShowWhy(false)
                  }}
                  title="Больше не показывать эту игру"
                  className="rounded-[14px] glass glass-hover px-3 py-3 text-sm text-dim/70"
                >
                  🚫
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {!roulette && (
        <section className="mx-auto w-full max-w-6xl px-5 py-10">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-medium text-dim">Ещё варианты под это настроение</h2>
            <span className="text-xs text-dim/60 font-mono">
              {engine === 'claude' ? 'подбор: ИИ' : 'подбор: эвристика'}
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {others.map((p, i) => (
              <button
                key={p.appid}
                onClick={() => {
                  setIndex(picks.indexOf(p))
                  setAskReason(false)
                  setShowWhy(false)
                }}
                className="glass glass-hover rounded-[14px] overflow-hidden text-left anim-rise cursor-pointer"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {p.headerImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.headerImage} alt="" className="w-full aspect-[460/215] object-cover" />
                ) : (
                  <div className="w-full aspect-[460/215] flex items-center justify-center bg-white/5 text-ink font-bold text-lg px-3 text-center">
                    {p.name}
                  </div>
                )}
                <div className="p-3">
                  <div className="text-sm font-semibold leading-tight">{p.name}</div>
                  <div className="text-[11px] text-dim mt-1">
                    {p.store ? STORE_LABEL[p.store] ?? p.store : SOURCE_BADGE[p.source]}
                  </div>
                </div>
              </button>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/quiz" className="text-sm text-dim hover:text-ink transition-colors">
              Изменить настроение →
            </Link>
          </div>
        </section>
      )}

      {roulette && (
        <div className="mx-auto w-full max-w-6xl px-5 py-8 text-center">
          <Link href="/quiz" className="text-sm text-dim hover:text-ink transition-colors">
            Изменить настроение →
          </Link>
        </div>
      )}
    </div>
  )
}

export default function PlayPage() {
  return (
    <Suspense>
      <Player />
    </Suspense>
  )
}
