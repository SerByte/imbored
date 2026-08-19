'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { GameArt } from '@/components/GameArt'
import { HeroShots } from '@/components/HeroShots'
import { PlayersNow } from '@/components/PlayersNow'
import { DiscountCorner, DiscountEnds, PriceTag } from '@/components/PriceTag'
import { SeasonalSnow } from '@/components/SeasonalSnow'
import { SplitHeadingLazy } from '@/components/SplitHeadingLazy'
import { SteamLaunch } from '@/components/SteamLaunch'
import { DemoNotice } from '@/components/DemoNotice'
import { WarmupScreen } from '@/components/WarmupScreen'
import type { GameArtUrls } from '@/lib/art'
import type { Discount } from '@/lib/discount'
import { SOURCE_BADGE } from '@/lib/sources'
import { STORE_LABEL } from '@/lib/stores'
import type { CandidateSource } from '@/lib/types'
import { connectDemo, runWarmup, type WarmupProgress } from '@/lib/warmup'

/** Карточка магазина: и герой в день каталога, и плитки на полке ниже */
type StoreCard = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
  store: string | null
  storeUrl: string | null
  priceFinal: number | null
  isFree: boolean | null
  discount: Discount | null
}

type DailyPick = StoreCard & {
  source: CandidateSource
  reason: string
  screenshots: string[]
  tags: string[]
  hoursPlayed: number | null
  ccu: number | null
}

const storeHref = (c: StoreCard) =>
  c.storeUrl ?? `https://store.steampowered.com/app/${c.appid}/`

export default function DailyPage() {
  const router = useRouter()
  const [pick, setPick] = useState<DailyPick | null>(null)
  const [discoveries, setDiscoveries] = useState<StoreCard[]>([])
  const [dateLabel, setDateLabel] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  const [prep, setPrep] = useState<WarmupProgress | null>(null)
  const [message, setMessage] = useState('Изучаю твою библиотеку…')
  const started = useRef(false)

  /** Демо-подключение пробуем ровно один раз — та же дисциплина, что на /play */
  const demoTried = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    void (async function run(): Promise<void> {
      // Прогрев тот же, что в основной выдаче, и теперь буквально тот же код.
      // Раньше здесь лежала копия цикла — без прогресса, без проверки ok и без
      // try/catch, из-за чего экран ошибки ниже был недостижим в принципе:
      // любой сбой оставлял страницу в вечном спиннере.
      //
      // onYield здесь НАМЕРЕННО не передаётся, хотя /play его использует и ждёт
      // теперь только первый круг. Игра дня детерминирована сидом steamid:дата,
      // но выбирается из пула, который по ходу прогрева растёт: пик по четверти
      // каталога с хорошей вероятностью окажется не тем, который та же формула
      // выберет минутой позже. На /play выдача и так своя на каждый заход, а
      // здесь обещание ровно обратное — одна игра на весь день. Ожидание тут
      // покупает устойчивость выбора, поэтому его не сокращаем.
      const warm = await runWarmup({
        onProgress: (p) => {
          setPrep(p)
          if (p.remaining > 0) setMessage(`Осталось разобрать ${p.remaining} игр`)
        },
      })
      if (warm === 'unauthorized') {
        // Гость зашёл на «Игру дня» из шапки или нижней панели. Раньше его
        // молча уносило на лендинг — то же, что было на /play. Показываем
        // настоящую игру дня на демо-библиотеке; подпись «демо» едет вместе с
        // фактами и стоит прямо на карточке.
        if (!demoTried.current) {
          demoTried.current = true
          setMessage('Собираю демо-библиотеку…')
          if (await connectDemo()) return run()
        }
        router.push('/')
        return
      }
      if (warm === 'nolibrary') {
        // Сессия есть, библиотеки нет: демо было бы подменой, а не помощью.
        router.push('/?error=nolibrary')
        return
      }
      if (warm === 'error') {
        setPhase('error')
        return
      }

      setMessage('Выбираю твою игру дня…')
      try {
        const res = await fetch('/api/daily')
        if (!res.ok) {
          setPhase('error')
          return
        }
        const data = (await res.json()) as {
          pick: DailyPick
          discoveries?: StoreCard[]
          dateLabel: string
        }
        setPick(data.pick)
        setDiscoveries(data.discoveries ?? [])
        setDateLabel(data.dateLabel)
        setPhase('ok')
      } catch {
        setPhase('error')
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'loading') {
    return <WarmupScreen progress={prep} message={message} />
  }

  if (phase === 'error' || !pick) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-5 text-center">
        <p className="text-lg">Не получилось выбрать игру дня.</p>
        <Link href="/quiz" className="text-ember-text hover:underline text-sm">
          Обычный подбор →
        </Link>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col">
      <section className="media-dark relative flex-1 min-h-[92vh] flex items-end overflow-hidden anim-reveal">
        {/* Внутри media-dark, а не над ним: плашка обязана быть в той же
            цветовой зоне, что и герой, иначе она читается как чужой элемент. */}
        {prep?.library?.demo && <DemoNotice variant="overlay" />}
        <HeroShots
          appid={pick.appid}
          headerImage={pick.headerImage}
          art={pick.art}
          name={pick.name}
          screenshots={pick.screenshots ?? []}
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
            {/*
              На телефоне здесь остаётся только дата.

              Три плашки делили 375 пикселей натрое, и подпись не влезала ни в
              одну: «ИГРА ДНЯ · 15 / АВГУСТА», «Открыл и / закрыл», «1 ч /
              наиграно». Текст, разорванный внутри пилюли, читается как поехавшая
              вёрстка, а не как замысел.

              Прятать выбрано именно поведенческие подписи, потому что абзац
              ниже пересказывает их словами: «Ты открыл „Hollow Knight“ и закрыл,
              не разобравшись» — это тот же SOURCE_BADGE, только по-человечески.
              На узком экране они буквально повторяют соседний текст, и снятие
              дубля не теряет ничего.

              Магазин — исключение и остаётся: он в том же слоте, но нигде больше
              не сказан, а «игра не в Steam» это то, что нужно знать до клика.

              flex-wrap — страховка: даже если подписи однажды подрастут, плашки
              встанут в столбик целиком, а не сломаются внутри себя.
            */}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="rounded-full bg-ember text-on-ember px-3 py-1 font-bold uppercase tracking-wide">
                Игра дня · {dateLabel}
              </span>
              <span
                className={`rounded-full bg-ember/15 text-ember-text px-3 py-1 font-medium ${
                  pick.store ? '' : 'hidden md:inline'
                }`}
              >
                {pick.store ? STORE_LABEL[pick.store] ?? pick.store : SOURCE_BADGE[pick.source]}
              </span>
              {pick.hoursPlayed !== null && pick.hoursPlayed > 0 && (
                <span className="hidden font-mono text-dim md:inline">
                  {pick.hoursPlayed} ч наиграно
                </span>
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
            <SplitHeadingLazy className="text-4xl md:text-6xl font-extrabold tracking-tight" delay={0.2}>
              {pick.name}
            </SplitHeadingLazy>
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
              {/* Некупленную игру запускать нечем: steam://run у неё
                  не делает ровным счётом ничего, поэтому ведём в магазин */}
              {pick.source === 'new' || pick.storeUrl ? (
                <a
                  href={storeHref(pick)}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-[14px] bg-ember text-on-ember font-semibold px-6 py-3 hover:brightness-110 transition"
                >
                  {pick.store
                    ? `Открыть в ${STORE_LABEL[pick.store] ?? 'магазине'}`
                    : 'Смотреть в Steam'}
                </a>
              ) : (
                <SteamLaunch
                  appid={pick.appid}
                  className="rounded-[14px] bg-ember text-on-ember font-semibold px-6 py-3 hover:brightness-110 transition"
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

            {pick.source === 'new' && (
              <div className="flex flex-wrap items-baseline gap-3">
                <PriceTag
                  priceFinal={pick.priceFinal}
                  discount={pick.discount}
                  isFree={pick.isFree}
                  size="hero"
                />
                <DiscountEnds discount={pick.discount} />
              </div>
            )}

            <p className="text-xs text-faint mt-1">
              {pick.source === 'new'
                ? 'Одна игра на день — завтра здесь будет другая. Покупать ничего не нужно.'
                : 'Одна игра на день — завтра здесь будет другая.'}
            </p>
          </div>
        </div>
      </section>

      {/* Полка каталога живёт отдельно от героя: герой — это «во что сесть
          сегодня», а здесь про «присмотреться на будущее». Смешивать их в
          одном блоке значило бы каждый день предлагать что-то купить */}
      {discoveries.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-5 py-16">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <h2 className="text-sm font-medium text-dim">Нет в твоей библиотеке</h2>
            <a
              href="https://steamdb.info/sales/"
              target="_blank"
              rel="noreferrer"
              className="text-xs text-faint hover:text-ink transition-colors shrink-0"
            >
              все скидки Steam →
            </a>
          </div>
          <p className="text-xs text-faint mb-4">
            Подобрано по твоему вкусу среди актуального. Ничего покупать не нужно — это просто на
            будущее.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {discoveries.map((c) => (
              <a
                key={c.appid}
                href={storeHref(c)}
                target="_blank"
                rel="noreferrer"
                className="glass glass-hover rounded-[14px] overflow-hidden text-left"
              >
                <div className="relative">
                  <GameArt
                    appid={c.appid}
                    name={c.name}
                    headerImage={c.headerImage}
                    art={c.art}
                    sizes="(min-width: 768px) 33vw, 50vw"
                    className="w-full aspect-[460/215] object-cover"
                  />
                  <DiscountCorner discount={c.discount} />
                </div>
                <div className="p-3">
                  <div className="text-sm font-semibold leading-tight">{c.name}</div>
                  <div className="text-[11px] mt-1 flex items-center justify-between gap-2">
                    <span className="text-dim truncate">
                      {c.store ? (STORE_LABEL[c.store] ?? c.store) : 'Steam'}
                    </span>
                    <PriceTag
                      priceFinal={c.priceFinal}
                      discount={c.discount}
                      isFree={c.isFree}
                      showPercent={false}
                      className="shrink-0"
                    />
                  </div>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
