'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { HeroArt } from '@/components/HeroArt'
import { PlayersNow } from '@/components/PlayersNow'
import { SeasonalSnow } from '@/components/SeasonalSnow'
import { SplitHeading } from '@/components/SplitHeading'
import { SteamLaunch } from '@/components/SteamLaunch'
import { Spinner } from '@/components/Spinner'
import type { GameArtUrls } from '@/lib/art'
import { SOURCE_BADGE } from '@/lib/sources'
import { STORE_LABEL } from '@/lib/stores'
import type { CandidateSource } from '@/lib/types'

type DailyPick = {
  appid: number
  name: string
  source: CandidateSource
  reason: string
  headerImage: string | null
  art: GameArtUrls | null
  tags: string[]
  hoursPlayed: number | null
  ccu: number | null
  store: string | null
  storeUrl: string | null
}

export default function DailyPage() {
  const router = useRouter()
  const [pick, setPick] = useState<DailyPick | null>(null)
  const [dateLabel, setDateLabel] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      // прогрев каталога — как в основной выдаче
      for (let i = 0; i < 80; i++) {
        const res = await fetch('/api/prepare', { method: 'POST' })
        if (res.status === 401 || res.status === 409) {
          router.push('/')
          return
        }
        const data = (await res.json()) as { remaining?: number }
        if ((data.remaining ?? 0) <= 0) break
      }
      const res = await fetch('/api/daily')
      if (!res.ok) {
        setPhase('error')
        return
      }
      const data = (await res.json()) as { pick: DailyPick; dateLabel: string }
      setPick(data.pick)
      setDateLabel(data.dateLabel)
      setPhase('ok')
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-6 px-5">
        <Spinner />
        <p className="text-dim text-sm">Выбираю твою игру дня…</p>
      </div>
    )
  }

  if (phase === 'error' || !pick) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">Не получилось выбрать игру дня.</p>
        <Link href="/quiz" className="text-ember hover:underline text-sm">
          Обычный подбор →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <section className="media-dark relative flex-1 min-h-[92vh] flex items-end overflow-hidden anim-reveal">
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
        {/* Снег идёт ПОД стеклом и над артом: хлопья, проходящие под панелями,
            подмораживаются их backdrop-filter. */}
        <SeasonalSnow />
        {/*
          tint включён намеренно. Базовый скрим страницы настроен под тёмный
          ключ-арт, а он бывает любой яркости: на светлом (Stardew — небо и
          трава) бейдж, «N ч наиграно» и нижняя строка теряли контраст.
          Заливка полосы добавляет var(--bg) снизу вверх ровно там, где лежит
          текст, и не трогает верх кадра.
        */}
        <BlurBand height="46vh" dir="up" />
        <div aria-hidden className="grain" />

        <div className="relative mx-auto w-full max-w-6xl px-5 pb-16 pt-40">
          <div className="max-w-2xl flex flex-col gap-4">
            <div className="flex items-center gap-3 text-xs">
              <span className="rounded-full bg-ember text-bg px-3 py-1 font-bold uppercase tracking-wide">
                Игра дня · {dateLabel}
              </span>
              <span className="rounded-full bg-ember/15 text-ember px-3 py-1 font-medium">
                {pick.store ? STORE_LABEL[pick.store] ?? pick.store : SOURCE_BADGE[pick.source]}
              </span>
              {pick.hoursPlayed !== null && pick.hoursPlayed > 0 && (
                <span className="font-mono text-dim">{pick.hoursPlayed} ч наиграно</span>
              )}
              <PlayersNow ccu={pick.ccu} />
            </div>

            {/*
              Здесь был MaskedHeading — арт игры, просвечивающий сквозь буквы.
              На бумаге это был самый сильный образ плана, на реальных данных —
              провал: глифы заливаются ТЕМ ЖЕ артом, что лежит за ними, и на
              светлом ключ-арте (Stardew Valley — небо и трава) название теряет
              контраст и читается хуже всего остального текста на постере.
              Приём работает, когда заливка и фон — разные изображения; здесь
              они по определению одно и то же. Название игры — главный текст
              этой страницы, рисковать его читаемостью нельзя.
            */}
            <SplitHeading className="text-4xl md:text-6xl font-extrabold tracking-tight" delay={0.2}>
              {pick.name}
            </SplitHeading>
            <p className="text-base md:text-lg text-ink/90 leading-relaxed">{pick.reason}</p>

            {pick.tags.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {pick.tags.map((t) => (
                  <span key={t} className="glass rounded-full px-3 py-1 text-xs text-dim">
                    {t}
                  </span>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3 mt-2">
              {pick.storeUrl ? (
                <a
                  href={pick.storeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[14px] bg-ember text-bg font-semibold px-6 py-3 hover:brightness-110 transition"
                >
                  Открыть в {STORE_LABEL[pick.store ?? ''] ?? 'магазине'}
                </a>
              ) : (
                <SteamLaunch
                  appid={pick.appid}
                  className="rounded-[14px] bg-ember text-bg font-semibold px-6 py-3 hover:brightness-110 transition"
                />
              )}
              <Link
                href={`/game/${pick.appid}`}
                className="rounded-[14px] glass glass-hover px-6 py-3 text-sm"
              >
                Подробнее
              </Link>
              <Link href="/quiz" className="text-sm text-dim hover:text-ink transition-colors px-2">
                Хочу выбрать сам →
              </Link>
            </div>

            <p className="text-xs text-dim/60 mt-1">
              Одна игра на день — завтра здесь будет другая.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
