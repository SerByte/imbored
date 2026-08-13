'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { BlurBand } from '@/components/BlurBand'
import { ClickSpark } from '@/components/ClickSpark'
import { GameArt } from '@/components/GameArt'
import { Magnet } from '@/components/Magnet'
import { HeroArt } from '@/components/HeroArt'
import { LogoMark } from '@/components/Logo'
import { ProgressRing } from '@/components/ProgressRing'
import { SpinWheel } from '@/components/SpinWheel'
import { SplitHeading } from '@/components/SplitHeading'
import { Spinner } from '@/components/Spinner'
import type { GameArtUrls } from '@/lib/art'
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
  art: GameArtUrls | null
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

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Смена героя. Направление кодирует, ЧТО произошло: «дальше» уводит текущую
 * игру влево (движение по ленте), выбор из «Ещё вариантов» поднимает новую
 * снизу — оттуда, где на неё нажали. Раньше оба случая выглядели одинаково.
 */
const HERO = {
  enter: (d: 'next' | 'pick') => ({
    opacity: 0,
    x: d === 'next' ? 64 : 0,
    y: d === 'pick' ? 48 : 0,
    filter: 'blur(12px)',
  }),
  center: {
    opacity: 1,
    x: 0,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.55, ease: EASE },
  },
  exit: (d: 'next' | 'pick') => ({
    opacity: 0,
    x: d === 'next' ? -64 : 0,
    y: d === 'pick' ? -32 : 0,
    filter: 'blur(10px)',
    transition: { duration: 0.24, ease: 'easeIn' as const },
  }),
}

/** Лестница выдачи: бейдж → (заголовок ведёт gsap) → причина → теги → кнопки. */
const LADDER = {
  hidden: {},
  show: { transition: { delayChildren: 0.12, staggerChildren: 0.1 } },
}

const STEP = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
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

  const [phase, setPhase] = useState<'prepare' | 'spin' | 'reveal' | 'burnout' | 'error'>('prepare')
  const [progress, setProgress] = useState<string>('Изучаю твою библиотеку…')
  const [prep, setPrep] = useState<{ remaining: number; total: number } | null>(null)
  // Откуда пришла следующая игра — задаёт направление смены героя.
  const [dir, setDir] = useState<'next' | 'pick'>('next')
  const [picks, setPicks] = useState<Pick[]>([])
  const [discoveries, setDiscoveries] = useState<Pick[]>([])
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
      let total = 0
      for (let i = 0; i < 80; i++) {
        const res = await fetch('/api/prepare', { method: 'POST' })
        if (res.status === 401 || res.status === 409) {
          router.push('/')
          return
        }
        const data = (await res.json()) as { remaining?: number }
        const remaining = data.remaining ?? 0
        // Первый замер — он же общий объём работы: дальше остаток только убывает.
        if (remaining > total) total = remaining
        setPrep({ remaining, total })
        if (remaining <= 0) break
        setProgress(`Осталось разобрать ${remaining} игр`)
      }

      setPrep({ remaining: 0, total })
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
      const data = (await res.json()) as {
        picks: Pick[]
        discoveries?: Pick[]
        engine: string
      }
      if (!data.picks?.length) {
        setPhase('error')
        return
      }
      setPicks(data.picks)
      setDiscoveries(data.discoveries ?? [])
      setEngine(data.engine)
      setIndex(roulette ? weightedRandomIndex(data.picks.length) : 0)
      // В рулетке между «подбираю» и выдачей появляется барабан: он и есть
      // та самая случайность, которая до сих пор происходила молча.
      setPhase(roulette ? 'spin' : 'reveal')
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const advance = useCallback(
    (from: number) => {
      setAskReason(false)
      setShowWhy(false)
      setDir('next')
      const next = skipCount + 1
      setSkipCount(next)
      if (next >= BURNOUT_AFTER_SKIPS) {
        setPhase('burnout')
        return
      }
      setIndex(roulette ? weightedRandomIndex(picks.length, from) : (from + 1) % picks.length)
      // «Крутить ещё» — это тоже бросок, а не просто следующая карточка.
      if (roulette) setPhase('spin')
    },
    [skipCount, picks.length, roulette],
  )

  if (phase === 'prepare') {
    // Прогресс у этого экрана был всегда — просто висел текстом рядом со спиннером.
    const pct = prep && prep.total > 0 ? ((prep.total - prep.remaining) / prep.total) * 100 : 0
    const known = prep !== null && prep.total > 0

    return (
      <div className="relative flex-1 flex flex-col items-center justify-center gap-7 px-5 overflow-hidden">
        <Ambient className="anim-breathe" />
        <div aria-hidden className="grain" />

        <div className="relative">
          {known ? (
            <ProgressRing
              percent={pct}
              size={160}
              stroke={8}
              duration={600}
              label={
                <div className="flex flex-col items-center gap-0.5">
                  <span
                    className="font-mono text-3xl font-extrabold text-ink"
                    style={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {Math.round(pct)}%
                  </span>
                  <span className="text-[11px] text-dim/70">разобрано</span>
                </div>
              }
            />
          ) : (
            <div className="flex h-40 w-40 items-center justify-center">
              <Spinner />
            </div>
          )}
        </div>

        {/* Строка статуса меняется по ходу — подменять её встык значит терять
            единственный сигнал, что что-то вообще происходит. */}
        <div className="h-5 relative w-full max-w-sm text-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={progress}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="absolute inset-x-0 text-dim text-sm"
            >
              {progress}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    )
  }

  if (phase === 'spin') {
    return (
      <div className="relative flex-1 flex flex-col items-center justify-center gap-8 px-5 overflow-hidden">
        <Ambient className="anim-breathe" />
        <div aria-hidden className="grain" />
        <p className="relative text-sm text-dim">Крутим…</p>
        <SpinWheel
          items={picks.map((p) => p.name)}
          landOn={index}
          onDone={() => setPhase('reveal')}
        />
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
      <AnimatePresence mode="wait" custom={dir}>
        <motion.section
          key={pick.appid}
          custom={dir}
          variants={HERO}
          initial="enter"
          animate="center"
          exit="exit"
          className="media-dark relative min-h-[78vh] flex items-end overflow-hidden"
        >
          <HeroArt
          appid={pick.appid}
          headerImage={pick.headerImage}
          art={pick.art}
          name={pick.name}
        />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to top, #0b0c10 4%, rgba(11,12,16,0.82) 26%, rgba(11,12,16,0.25) 55%, rgba(11,12,16,0.45) 100%)',
            }}
          />
          {/* Арт остаётся ярким и просто уходит в мягкость под текстом —
              жёсткий градиент-стоп гасил его целиком, оставляя резким.
              tint включён: базовый скрим настроен под тёмный ключ-арт, а сюда
              попадает любая игра из библиотеки, в том числе светлая. */}
          <BlurBand height="46vh" dir="up" />
          <div aria-hidden className="grain" />

          <motion.div
            variants={LADDER}
            initial="hidden"
            animate="show"
            className="relative mx-auto w-full max-w-6xl px-5 pb-12 pt-40"
          >
            <div className="max-w-2xl flex flex-col gap-4">
              <motion.div variants={STEP} className="flex items-center gap-3 text-xs">
                <span className="rounded-full bg-ember/15 text-ember px-3 py-1 font-medium">
                  {pick.store ? `${STORE_LABEL[pick.store] ?? pick.store}` : SOURCE_BADGE[pick.source]}
                </span>
                {pick.hoursPlayed !== null && pick.hoursPlayed > 0 && (
                  <span className="font-mono text-dim">{pick.hoursPlayed} ч наиграно</span>
                )}
              </motion.div>

              <SplitHeading className="text-4xl md:text-6xl font-extrabold tracking-tight" delay={0.18}>
                {pick.name}
              </SplitHeading>

              <motion.p variants={STEP} className="text-base md:text-lg text-ink/90 leading-relaxed">
                {pick.reason}
              </motion.p>

            {whyParts.length > 0 && (
              <motion.div variants={STEP} className="text-sm">
                <button
                  onClick={() => setShowWhy(!showWhy)}
                  className="text-dim hover:text-ink transition-colors cursor-pointer"
                >
                  Почему она? {showWhy ? '▴' : '▾'}
                </button>
                <AnimatePresence initial={false}>
                  {showWhy && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                      className="mt-1.5 text-dim overflow-hidden"
                    >
                      {whyParts.join(' · ')}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {pick.tags.length > 0 && (
              <motion.div variants={STEP} className="flex flex-wrap gap-2">
                {pick.tags.map((t) => (
                  <span key={t} className="glass rounded-full px-3 py-1 text-xs text-dim">
                    {t}
                  </span>
                ))}
              </motion.div>
            )}

            {askReason ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-wrap items-center gap-2 mt-2"
              >
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
              </motion.div>
            ) : (
              <motion.div variants={STEP} className="flex flex-wrap items-center gap-3 mt-2">
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
                {roulette ? (
                  // Бросок кубика заслуживает физического отклика в точке нажатия
                  <Magnet>
                    <ClickSpark>
                      <button
                        onClick={() => {
                          sendFeedback(pick.appid, 'skipped')
                          advance(index)
                        }}
                        className="rounded-[14px] glass glass-hover no-lift px-4 py-3 text-sm text-dim cursor-pointer"
                      >
                        Крутить ещё
                      </button>
                    </ClickSpark>
                  </Magnet>
                ) : (
                  <button
                    onClick={() => setAskReason(true)}
                    className="rounded-[14px] glass glass-hover px-4 py-3 text-sm text-dim cursor-pointer"
                  >
                    Не то — дальше
                  </button>
                )}
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
              </motion.div>
            )}
            </div>
          </motion.div>
        </motion.section>
      </AnimatePresence>

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
              <motion.button
                key={p.appid}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE, delay: i * 0.06 }}
                onClick={() => {
                  setDir('pick')
                  setIndex(picks.indexOf(p))
                  setAskReason(false)
                  setShowWhy(false)
                }}
                className="glass glass-hover rounded-[14px] overflow-hidden text-left cursor-pointer"
              >
                <GameArt
                  appid={p.appid}
                  name={p.name}
                  headerImage={p.headerImage}
                  art={p.art}
                  sizes="(min-width: 768px) 33vw, 100vw"
                  className="w-full aspect-[460/215] object-cover"
                />
                <div className="p-3">
                  <div className="text-sm font-semibold leading-tight">{p.name}</div>
                  <div className="text-[11px] text-dim mt-1">
                    {p.store ? STORE_LABEL[p.store] ?? p.store : SOURCE_BADGE[p.source]}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/quiz" className="text-sm text-dim hover:text-ink transition-colors">
              Изменить настроение →
            </Link>
          </div>
        </section>
      )}

      {/* Покупки — отдельным разговором: выше только то, за что уже заплачено */}
      {!roulette && discoveries.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-5 pb-16">
          <div className="border-t border-edge/60 pt-10">
            <h2 className="text-sm font-medium text-dim mb-1">Нет в твоей библиотеке</h2>
            <p className="text-xs text-dim/60 mb-4">
              Подобрано по твоему вкусу среди актуального. Ничего покупать не нужно — это просто
              на будущее.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {discoveries.map((p, i) => (
                <motion.a
                  key={p.appid}
                  href={p.storeUrl ?? `https://store.steampowered.com/app/${p.appid}/`}
                  target="_blank"
                  rel="noreferrer"
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.45, ease: EASE, delay: i * 0.05 }}
                  onClick={() => sendFeedback(p.appid, 'opened')}
                  className="glass glass-hover rounded-[14px] overflow-hidden text-left"
                >
                  <GameArt
                    appid={p.appid}
                    name={p.name}
                    headerImage={p.headerImage}
                    art={p.art}
                    sizes="(min-width: 768px) 33vw, 50vw"
                    className="w-full aspect-[460/215] object-cover"
                  />
                  <div className="p-3">
                    <div className="text-sm font-semibold leading-tight">{p.name}</div>
                    <div className="text-[11px] mt-1 flex items-center justify-between gap-2">
                      <span className="text-dim truncate">
                        {p.store ? (STORE_LABEL[p.store] ?? p.store) : 'Steam'}
                      </span>
                      <span className="font-mono text-ember shrink-0">
                        {p.priceFinal === 0
                          ? 'бесплатно'
                          : p.priceFinal
                            ? `${Math.round(p.priceFinal / 100)} $`
                            : ''}
                      </span>
                    </div>
                  </div>
                </motion.a>
              ))}
            </div>
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
