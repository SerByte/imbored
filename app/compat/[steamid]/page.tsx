'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { GameArt } from '@/components/GameArt'
import { DiscountCorner } from '@/components/PriceTag'
import { ProgressRing } from '@/components/ProgressRing'
import { Spinner } from '@/components/Spinner'
import type { GameArtUrls } from '@/lib/art'
import type { Discount } from '@/lib/discount'
import { STORE_LABEL } from '@/lib/stores'

type CompatData = {
  percent: number
  commonGames: Array<{
    appid: number
    name: string
    hoursA: number
    hoursB: number
    headerImage: string | null
    art: GameArtUrls | null
  }>
  sharedTags: string[]
  playTogether: Array<{
    appid: number
    name: string
    ownedByAll: boolean
    missingFor: string[]
    priceFinal?: number
    discount?: Discount | null
    headerImage: string | null
    art: GameArtUrls | null
    tags: string[]
    store?: string
  }>
  myName: string
  otherName: string
  mySteamid: string
}

function verdict(percent: number): string {
  if (percent >= 80) return 'Вы буквально один человек'
  if (percent >= 60) return 'Отличная пара для коопа'
  if (percent >= 40) return 'Есть о чём поиграть вместе'
  if (percent >= 20) return 'Разные, но это даже интересно'
  return 'Противоположности. Притянетесь?'
}

export default function CompatResultPage() {
  const params = useParams<{ steamid: string }>()
  const other = params.steamid ?? ''

  const [data, setData] = useState<CompatData | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'noauth' | 'noprofile' | 'self' | 'error'>(
    'loading',
  )
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async () => {
      const res = await fetch(`/api/compat/${other}`)
      if (res.status === 401) return setStatus('noauth')
      if (res.status === 404) return setStatus('noprofile')
      if (res.status === 400) return setStatus('self')
      if (!res.ok) return setStatus('error')
      setData((await res.json()) as CompatData)
      setStatus('ok')
    })()
  }, [other])

  if (status === 'loading') {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Spinner />
      </div>
    )
  }

  if (status === 'noauth') {
    return (
      <div className="flex-1 flex items-center justify-center px-5 py-24">
        <div className="max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col gap-4 anim-rise">
          <h1 className="text-2xl font-bold tracking-tight">Проверка совместимости</h1>
          <p className="text-dim text-sm">
            Кто-то хочет сравнить с тобой игровые вкусы. Подключи свою библиотеку — и увидите свой
            процент.
          </p>
          <a
            href={`/api/auth/steam?compat=${other}`}
            className="rounded-[14px] bg-ember text-bg font-semibold py-3 hover:brightness-110 transition"
          >
            Войти через Steam
          </a>
          <Link href={`/?compat=${other}`} className="rounded-[14px] glass glass-hover py-3 text-sm">
            Вставить ссылку на профиль / демо
          </Link>
        </div>
      </div>
    )
  }

  if (status !== 'ok' || !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">
          {status === 'self'
            ? 'Это твоя собственная ссылка — кинь её кому-нибудь другому.'
            : status === 'noprofile'
              ? 'Этот игрок ещё не подключал библиотеку к imbored.'
              : 'Не получилось посчитать совместимость.'}
        </p>
        <Link href="/compat" className="text-ember hover:underline text-sm">
          Моя ссылка совместимости →
        </Link>
      </div>
    )
  }

  const artA = data.commonGames[0]
  const artB = data.commonGames[1]

  return (
    <div className="flex-1">
      {/* шапка: арт общих игр красит экран */}
      <section className="relative overflow-hidden">
        {artA && (
          <GameArt
            appid={artA.appid}
            name=""
            headerImage={artA.headerImage}
            art={artA.art}
            variant="hero"
            fallback={null}
            className="absolute -left-10 -top-10 w-2/3 blur-3xl opacity-25 scale-125"
          />
        )}
        {artB && (
          <GameArt
            appid={artB.appid}
            name=""
            headerImage={artB.headerImage}
            art={artB.art}
            variant="hero"
            fallback={null}
            className="absolute -right-10 top-20 w-2/3 blur-3xl opacity-20 scale-125"
          />
        )}
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(to bottom, color-mix(in srgb, var(--bg) 35%, transparent), var(--bg) 92%)',
          }}
        />

        <div className="relative mx-auto max-w-2xl px-5 pt-28 pb-10 flex flex-col items-center gap-4 text-center anim-reveal">
          <p className="text-dim text-sm">
            {data.myName} <span className="text-ember">×</span> {data.otherName}
          </p>
          <ProgressRing percent={data.percent} />
          <p className="text-xl md:text-2xl font-bold tracking-tight">{verdict(data.percent)}</p>
          {data.sharedTags.length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {data.sharedTags.map((t) => (
                <span key={t} className="glass rounded-full px-3 py-1 text-xs text-dim">
                  {t}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="mx-auto w-full max-w-2xl px-5 pb-16 flex flex-col gap-10">
        {data.commonGames.length > 0 && (
          <section className="anim-rise">
            <h2 className="text-sm font-medium text-dim mb-3">
              Общие игры — <span className="font-mono">{data.commonGames.length}</span>
            </h2>
            <div className="flex flex-col gap-2">
              {data.commonGames.slice(0, 6).map((g) => (
                <Link
                  key={g.appid}
                  href={`/game/${g.appid}`}
                  className="glass glass-hover rounded-[14px] p-2 pr-4 flex items-center gap-3"
                >
                  <GameArt
                    appid={g.appid}
                    name={g.name}
                    headerImage={g.headerImage}
                    art={g.art}
                    className="h-12 w-[104px] object-cover rounded-[8px] border border-edge"
                  />
                  <span className="font-semibold text-sm flex-1">{g.name}</span>
                  <span className="font-mono text-xs text-dim shrink-0">
                    {g.hoursA} ч · {g.hoursB} ч
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {data.playTogether.length > 0 && (
          <section className="anim-rise" style={{ animationDelay: '80ms' }}>
            <h2 className="text-sm font-medium text-dim mb-3">Во что вам зайти вместе</h2>
            <div className="grid md:grid-cols-3 gap-3">
              {data.playTogether.map((c) => (
                <Link
                  key={c.appid}
                  href={`/game/${c.appid}`}
                  className="glass glass-hover rounded-[14px] overflow-hidden"
                >
                  <div className="relative">
                    <GameArt
                      appid={c.appid}
                      name={c.name}
                      headerImage={c.headerImage}
                      art={c.art}
                      sizes="(min-width: 768px) 33vw, 100vw"
                      className="w-full aspect-[460/215] object-cover"
                    />
                    <DiscountCorner discount={c.discount} />
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-semibold leading-tight">{c.name}</div>
                    <div className="text-[11px] text-dim mt-1">
                      {c.ownedByAll
                        ? '✓ есть у обоих'
                        : `нет у: ${c.missingFor.join(', ')}${
                            c.priceFinal
                              ? ` · $${(c.priceFinal / 100).toFixed(0)}`
                              : c.store
                                ? ` · ${STORE_LABEL[c.store] ?? ''}`
                                : ''
                          }`}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/room/new"
            className="rounded-[14px] bg-ember text-bg font-semibold px-6 py-3 hover:brightness-110 transition"
          >
            Собрать пати вместе
          </Link>
          <Link href="/compat" className="rounded-[14px] glass glass-hover px-6 py-3 text-sm">
            Моя ссылка совместимости
          </Link>
        </div>
      </div>
    </div>
  )
}
