'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { DailyCountdown } from '@/components/DailyCountdown'
import { GameCardBody } from '@/components/GameCard'
import { HeroTitle } from '@/components/HeroTitle'
import { HeroTrailer } from '@/components/HeroTrailer'
import { HeroPoster } from '@/components/TypeCover'
import { Icon } from '@/components/Icon'
import { HeroShots } from '@/components/HeroShots'
import { NeedSteam } from '@/components/NeedSteam'
import { OutcomeAsk } from '@/components/OutcomeAsk'
import { PlayersNow } from '@/components/PlayersNow'
import { PrivacyHelp } from '@/components/PrivacyHelp'
import { DiscountCorner, DiscountEnds, PriceTag } from '@/components/PriceTag'
import { RefundNote } from '@/components/RefundNote'
import { SeasonalSnow } from '@/components/SeasonalSnow'
import { SteamLaunch } from '@/components/SteamLaunch'
import { WarmupScreen } from '@/components/WarmupScreen'
import type { DailyPickCard, StoreCard } from '@/lib/cards'
import { bounceTo, reconnectHref } from '@/lib/destination'
import type { CtxIntent, CtxSlot, FeedbackCtx } from '@/lib/feedbackctx'
import type { FeedbackAction, SkipReason } from '@/lib/feedbackkinds'
import { SOURCE_BADGE } from '@/lib/sources'
import { STORE_LABEL } from '@/lib/stores'
import type { CandidateSource } from '@/lib/types'
import { remainingLine, runWarmup, type WarmupProgress } from '@/lib/warmup'
import { isNeedSteam, writerStore } from '@/lib/writer'
import { SectionLabel } from '@/components/Labels'
import { TagChips } from '@/components/TagChips'

/**
 * ПОЧЕМУ ИГРА ДНЯ НЕ ВЫБРАЛАСЬ — РАЗНЫМИ СЛОВАМИ, А НЕ ОДНИМИ.
 *
 * /api/daily отвечает тремя разными отказами: нет сессии, нет снимка
 * библиотеки, кандидатов не осталось. Страница сводила их все к одной строке:
 *
 *     «Не получилось выбрать игру дня.»  [Обычный подбор →]
 *
 * Замерено сквозным прогоном с включённой веткой `nolibrary`: человек получает
 * именно её. А совет ведёт в тупик — обычный подбор упрётся в ровно ту же
 * причину, потому что библиотеки нет и там.
 *
 * Тот же разбор сделан для /play проходом раньше; здесь он повторён по
 * коду, но не по тексту: у страниц разные действия, и предлагать им одно и то
 * же значило бы вернуться к одной строке на все случаи, только длиннее.
 */
const FAIL: Record<string, { title: string; text: string }> = {
  nolibrary: {
    title: 'Библиотека не доехала',
    text: 'Steam не отдал список игр. Чаще всего его прячут настройки профиля — и это чинится за минуту.',
  },
  nocandidates: {
    title: 'Выбирать не из чего',
    text: 'В библиотеке не осталось игр, из которых можно собрать игру дня: возможно, всё подходящее уехало в бан.',
  },
}

/** Сеть, пятисотка, оборванный ответ. */
const FAIL_UNKNOWN = {
  title: 'Не получилось выбрать игру дня',
  text: 'Похоже, что-то сломалось по дороге. Попробуй зайти чуть позже.',
}

/*
 * Карточки — DailyPickCard и StoreCard — ровно то, что отдаёт /api/daily:
 * типы выведены из функций, которые их строят (lib/cards.ts), а не
 * переписаны руками. Новое поле там — видно здесь, переименованное — красный
 * tsc там, где его читают.
 */
const storeHref = (c: Pick<StoreCard, 'appid' | 'storeUrl'>) =>
  c.storeUrl ?? `https://store.steampowered.com/app/${c.appid}/`

/** Ответ /api/daily — один разбор на все запросы страницы */
type DailyResponse = {
  pick: DailyPickCard
  discoveries?: StoreCard[]
  /** Своя на магазинный день — «Сегодня хочу из своего»; null — не магазинный */
  ownAlternate?: DailyPickCard | null
  dateLabel: string
  nowSec: number
}

/**
 * Отзыв об игре дня. Тот же роут и та же дисциплина, что у sendFeedback на
 * /play: промис не отклоняется, needsteam переводит страницу в режим чтения —
 * «Зашло» и «Не сегодня» прячутся, и на их месте строка о входе через Steam.
 */
async function sendFeedback(
  appid: number,
  action: FeedbackAction,
  reason: SkipReason | undefined,
  ctx: FeedbackCtx,
): Promise<boolean> {
  if (writerStore.get() === false) return false
  try {
    const r = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid, action, ...(reason ? { reason } : {}), ctx }),
    })
    if (await isNeedSteam(r)) writerStore.set(false)
    return r.ok
  } catch {
    return false
  }
}

export default function DailyPage() {
  const router = useRouter()
  const [pick, setPick] = useState<DailyPickCard | null>(null)
  const [discoveries, setDiscoveries] = useState<StoreCard[]>([])
  const [nowSec, setNowSec] = useState(0)
  const [dateLabel, setDateLabel] = useState('')
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  /** Код отказа из тела ответа: nolibrary, nocandidates или null. */
  const [reason, setReason] = useState<string | null>(null)
  const [prep, setPrep] = useState<WarmupProgress | null>(null)
  const [message, setMessage] = useState('Изучаю твою библиотеку…')
  /** Своя на магазинный день и показана ли она вместо магазинной */
  const [alternate, setAlternate] = useState<DailyPickCard | null>(null)
  const [ownDay, setOwnDay] = useState(false)
  const [liked, setLiked] = useState<Set<number>>(new Set())
  /** «Не сегодня» ушло, и страница ждёт другую игру */
  const [rerolling, setRerolling] = useState(false)
  /** Почему другую подобрать не вышло — строкой под кнопками; null — нечего сказать */
  const [rerollMiss, setRerollMiss] = useState<string | null>(null)
  /** Что сказать скринридеру о смене героя — живая строка стоит с первого кадра */
  const [said, setSaid] = useState('')
  /*
   * Герой сменился по нажатию («Не сегодня», «Сегодня хочу из своего») — и
   * нажатая кнопка ушла вместе со старым героем: секция пересоздаётся по
   * appid. Фокус без присмотра упал бы в body, поэтому его забирает заголовок
   * нового героя, когда смонтируется, — тот же приём, что у героя /play.
   */
  const wantHeroFocus = useRef(false)
  const heroRef = useCallback((el: HTMLElement | null) => {
    if (!el || !wantHeroFocus.current) return
    wantHeroFocus.current = false
    el.focus({ preventScroll: true })
  }, [])
  /**
   * Сессия только читает (вошла по ссылке, а не через Steam): «Зашло» и «Не
   * сегодня» ей некуда записать — вместо них строка NeedSteam. null — «не
   * знаем»: кнопки как обычно, правду скажет первый отказ.
   */
  const readOnly =
    useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server) === false

  /** Ответ /api/daily — на экран: одна дверь и для первого захода, и для «Не сегодня» */
  function applyDaily(data: DailyResponse) {
    // Серверные часы — по ним подпись онлайна решает, имеет ли право
    // сказать «сейчас». См. докблок в components/PlayersNow.
    setNowSec(data.nowSec)
    setPick(data.pick)
    setDiscoveries(data.discoveries ?? [])
    setAlternate(data.ownAlternate ?? null)
    setOwnDay(false)
    setDateLabel(data.dateLabel)
    setPhase('ok')
  }

  useEffect(() => {
    /*
     * Уход со страницы останавливает и прогрев, и запросы — тот же приём, что
     * на /play (см. там): отмена в cleanup вместо флага «уже запущено».
     */
    const ac = new AbortController()
    const { signal } = ac

    /**
     * Ответ /api/daily — на экран. Один разбор на оба запроса ниже: у ответа
     * «только записанное» и обычного одна и та же форма.
     */
    async function show(res: Response): Promise<void> {
      if (!res.ok) {
        /*
         * Код читается ИЗ ТЕЛА, а не выводится из статуса: под 409 живут два
         * разных отказа — «нет снимка библиотеки» и «кандидатов нет», — и
         * советы у них разные.
         */
        const code = await res
          .json()
          .then((d: { error?: unknown }) => (typeof d.error === 'string' ? d.error : null))
          .catch(() => null)
        // Сессия отвалилась: человеку нужен вход, а не объяснение. Если
        // человек уже ушёл сам, уводить его с новой страницы нельзя.
        if (res.status === 401) {
          if (!signal.aborted) router.push(bounceTo('/daily'))
          return
        }
        setReason(code)
        setPhase('error')
        return
      }
      applyDaily((await res.json()) as DailyResponse)
    }

    void (async () => {
      /*
       * Сначала — уже выбранная сегодня игра (daily_picks), без прогрева.
       *
       * Прогрев каталога нужен ОТБОРУ, а отбор случается раз в сутки. Раньше
       * его ждал каждый заход: до трёх минут у большой библиотеки ради игры,
       * которая с утра лежит в записи. 204 — выбора ещё нет, тогда прогрев и
       * обычный запрос, как раньше. Сеть моргнула на этом шаге — тоже идём
       * обычной дорогой: прогрев сам скажет, если сети нет совсем.
       */
      try {
        const res = await fetch('/api/daily?cached=1', { signal })
        if (res.status !== 204) {
          await show(res)
          return
        }
      } catch {
        // см. выше: обычная дорога — если страница ещё здесь
        if (signal.aborted) return
      }

      // Прогрев тот же, что в основной выдаче, и теперь буквально тот же код.
      // Раньше здесь лежала копия цикла — без прогресса, без проверки ok и без
      // try/catch, из-за чего экран ошибки ниже был недостижим в принципе:
      // любой сбой оставлял страницу в вечном спиннере.
      //
      // onYield здесь НАМЕРЕННО не передаётся, хотя /play его использует и ждёт
      // теперь только первый круг. Первый отбор дня записывается и держится до
      // полуночи (daily_picks), а пул по ходу прогрева растёт: пик по четверти
      // каталога застыл бы на весь день, хотя минутой позже та же формула
      // выбрала бы из полного. На /play выдача и так своя на каждый заход, а
      // здесь обещание ровно обратное — одна игра на весь день. Ожидание
      // покупает качество выбора, и платится оно раз в сутки, а не на каждом
      // заходе: следующие попадают в запись выше.
      const warm = await runWarmup({
        signal,
        onProgress: (p) => {
          setPrep(p)
          if (p.remaining > 0) setMessage(remainingLine(p.remaining))
        },
      })
      if (warm === 'aborted') return
      if (warm === 'unauthorized') {
        router.push(bounceTo('/daily'))
        return
      }
      if (warm === 'error') {
        setPhase('error')
        return
      }

      setMessage('Выбираю твою игру дня…')
      try {
        await show(await fetch('/api/daily', { signal }))
      } catch {
        if (!signal.aborted) setPhase('error')
      }
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (phase === 'loading') {
    return <WarmupScreen progress={prep} message={message} />
  }

  if (phase === 'error' || !pick) {
    const fail = FAIL[reason ?? ''] ?? FAIL_UNKNOWN
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-lg">{fail.title}</p>
        <p className="text-dim text-sm max-w-md leading-relaxed">{fail.text}</p>

        {/* Шаги про настройки Steam — только там, где библиотека и правда не
            доехала. Панель общая с карточкой подключения, пустой библиотекой и
            отказом подбора: четыре копии инструкции по чужому интерфейсу
            разъехались бы на первой же правке. */}
        {reason === 'nolibrary' && (
          <div className="max-w-md text-left">
            <PrivacyHelp />
          </div>
        )}

        {/* Кандидатов нет — вернуть игры из бана можно только в библиотеке. */}
        {reason === 'nocandidates' && (
          <Link href="/library" className="tap text-sm text-dim transition-colors hover:text-ink">
            Посмотреть библиотеку →
          </Link>
        )}

        {/* Обычный подбор предлагается везде, КРОМЕ случая без библиотеки: там
            он упрётся ровно в ту же причину, и совет был бы тупиком. */}
        {reason !== 'nolibrary' && (
          <Link href="/quiz" className="tap text-sm text-dim transition-colors hover:text-ink">
            Обычный подбор →
          </Link>
        )}

        {reason === 'nolibrary' && (
          <Link href={reconnectHref()} className="btn-ember px-6 py-3">
            Подключить заново
          </Link>
        )}
      </div>
    )
  }

  /*
   * Герой на экране: игра дня — или своя, если человек сказал «Сегодня хочу
   * из своего». Всё ниже — про того, кто на экране: и кнопки, и отзыв.
   */
  const hero = ownDay && alternate ? alternate : pick
  /** Снимок к оценке (lib/feedbackctx): откуда, чья карточка и что значило нажатие */
  const ctxOf = (c: { source: CandidateSource }, intent?: CtxIntent, slot?: CtxSlot): FeedbackCtx => ({
    source: 'daily',
    slot: slot ?? (hero === alternate ? 'picked' : 'hero'),
    candidate: c.source,
    intent,
  })

  /*
   * «Не сегодня» — и тут же другая игра. Отзыв пишется как «не сейчас» с
   * /play (пауза на трое суток там же), а запись дня сбрасывается, если он
   * про героя или запасную свою (/api/feedback). Следующий отбор её не
   * вернёт до полуночи (notnowSince в /api/daily).
   */
  const notToday = async () => {
    if (rerolling) return
    setRerolling(true)
    setRerollMiss(null)
    // Отложил свою в магазинный день — и следующую хочет своей же
    const wasOwn = hero === alternate
    try {
      const ok = await sendFeedback(hero.appid, 'skipped', 'notnow', ctxOf(hero))
      // Отказ по правам — кнопки уже спрятались, и строка о входе на месте
      if (!ok) {
        if (writerStore.get() !== false) setRerollMiss('Не получилось отложить — попробуй ещё раз.')
        return
      }
      const res = await fetch('/api/daily')
      if (!res.ok) {
        const code = await res
          .json()
          .then((d: { error?: unknown }) => (typeof d.error === 'string' ? d.error : null))
          .catch(() => null)
        setRerollMiss(
          code === 'nocandidates'
            ? 'Отложили. Другой игры на сегодня не нашлось — загляни завтра.'
            : 'Отложили, но другую подобрать не вышло — обнови страницу чуть позже.',
        )
        return
      }
      const data = (await res.json()) as DailyResponse
      wantHeroFocus.current = true
      applyDaily(data)
      const own = wasOwn && data.ownAlternate
      if (own) setOwnDay(true)
      setSaid(`Другая игра на сегодня: ${(own ? data.ownAlternate! : data.pick).name}`)
    } catch {
      setRerollMiss('Отложили, но другую подобрать не вышло — обнови страницу чуть позже.')
    } finally {
      setRerolling(false)
    }
  }

  return (
    <div className="flex-1 flex flex-col">
      {/* «Как тебе?» после сыгранного по прошлому совету (lib/outcome.ts) —
          раз в сутки, общий порог с /play */}
      <OutcomeAsk />
      <p role="status" className="sr-only">
        {said}
      </p>
      {/* key — герой сменился («Не сегодня», «Сегодня хочу из своего»):
          кадры и заголовок начинаются заново, а не доигрывают прошлую игру */}
      <section
        key={hero.appid}
        className="media-dark relative flex-1 min-h-[92vh] flex items-end overflow-hidden anim-reveal"
      >
        <HeroShots
          appid={hero.appid}
          headerImage={hero.headerImage}
          art={hero.art}
          name={hero.name}
          screenshots={hero.screenshots ?? []}
          anchor={hero.via}
        />
        <HeroTrailer trailer={hero.trailer} />
        <div aria-hidden className="absolute inset-0 hero-scrim" />
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

        <div className="relative mx-auto w-full max-w-6xl px-safe pb-16 pt-40">
          <HeroPoster appid={hero.appid} name={hero.name} className="absolute bottom-16 right-5" />
          {/* max-w-xl — край, по которому .hero-scrim держит контраст */}
          <div className="max-w-xl flex flex-col gap-4">
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
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="rounded-full bg-ember text-on-ember px-3 py-1 text-xs font-bold uppercase tracking-wide">
                Игра дня · {dateLabel}
              </span>
              {/* Источник — фирменным зелёным, как на /play */}
              <span className={`font-extrabold text-ember-text ${hero.store ? '' : 'hidden md:inline'}`}>
                {hero.store ? STORE_LABEL[hero.store] ?? hero.store : SOURCE_BADGE[hero.source]}
              </span>
              {hero.hoursPlayed !== null && hero.hoursPlayed > 0 && (
                <span className="hidden tabular-nums text-dim md:inline">
                  {hero.hoursPlayed} ч наиграно
                </span>
              )}
              <PlayersNow ccu={hero.ccu} ccuAt={hero.ccuAt} nowSec={nowSec} />
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
            <HeroTitle
              appid={hero.appid}
              name={hero.name}
              headingRef={heroRef}
              className="font-display text-display-lg"
              logoClassName="h-[clamp(96px,14vw,184px)]"
              delay={0.2}
            />
            <p className="text-base md:text-lg text-ink/90 leading-relaxed">{hero.reason}</p>

            <TagChips tags={hero.tags} matched={hero.sharedTags ?? []} />

            <div className="flex flex-wrap items-center gap-3 mt-2 md:w-max md:flex-nowrap">
              {/* Некупленную игру запускать нечем: steam://run у неё
                  не делает ровным счётом ничего, поэтому ведём в магазин */}
              {hero.source === 'new' || hero.storeUrl ? (
                <a
                  href={storeHref(hero)}
                  target="_blank"
                  rel="noreferrer"
                  // Не купленную смотрят в магазине — это любопытство, а не
                  // запуск; своя из другого магазина там же и запускается
                  onClick={() =>
                    void sendFeedback(
                      hero.appid,
                      hero.source === 'new' ? 'opened' : 'launched',
                      undefined,
                      ctxOf(hero, hero.source === 'new' ? 'store' : 'launch'),
                    )
                  }
                  className="btn-ember px-6 py-3"
                >
                  {hero.store
                    ? `Открыть в ${STORE_LABEL[hero.store] ?? 'магазине'}`
                    : 'Смотреть в Steam'}
                </a>
              ) : (
                <SteamLaunch
                  appid={hero.appid}
                  // Запуск — не «Зашло»: как и на /play, он же заводит исход
                  // совета, который сверят со следующим снапшотом
                  onClick={() =>
                    void sendFeedback(hero.appid, 'launched', undefined, ctxOf(hero, 'launch'))
                  }
                  icon
                  className="btn-ember px-6 py-3"
                />
              )}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => void notToday()}
                  aria-disabled={rerolling}
                  className="btn-glass aria-disabled:opacity-60"
                >
                  <Icon name="next" size={18} />
                  {rerolling ? 'Подбираю другую…' : 'Не сегодня'}
                </button>
              )}
              <Link
                href={`/game/${hero.appid}`}
                onClick={() =>
                  void sendFeedback(hero.appid, 'opened', undefined, ctxOf(hero, 'details'))
                }
                title="Подробнее об игре"
                className="btn-circle"
              >
                <Icon name="info" size={20} />
                <span className="sr-only">Подробнее</span>
              </Link>
              {/* Отзыв об игре дня: «Зашло» учит вкус, «Не сегодня» откладывает
                  и тут же предлагает другую. У сессии только для чтения их нет
                  — ниже строка о входе через Steam */}
              {!readOnly && (
                <button
                  type="button"
                  onClick={() => {
                    // Повторное нажатие — не второе «зашло»: кнопка уже горит
                    if (liked.has(hero.appid)) return
                    setLiked(new Set(liked).add(hero.appid))
                    void sendFeedback(hero.appid, 'liked', undefined, ctxOf(hero))
                  }}
                  aria-pressed={liked.has(hero.appid)}
                  title={liked.has(hero.appid) ? 'Зашло — учтём в подборе' : 'Зашло'}
                  className="btn-circle"
                >
                  <Icon name={liked.has(hero.appid) ? 'check' : 'heart'} size={20} />
                  <span className="sr-only">Зашло</span>
                </button>
              )}
            </div>
            {readOnly && <NeedSteam from="/daily" className="-mt-1" />}
            {rerollMiss && (
              <p role="status" className="-mt-1 text-sm text-dim">
                {rerollMiss}
              </p>
            )}
            {/* Своя нетронутая или заброшенная скорее всего не установлена —
                поставить на загрузку можно сейчас, к вечеру она будет готова
                (steam://install). План, а не оценка: вкус его не видит */}
            {(hero.source === 'untouched' || hero.source === 'comeback') && !hero.storeUrl && (
              <p className="-mt-1 text-xs text-faint">
                <SteamLaunch
                  appid={hero.appid}
                  mode="install"
                  label="Ещё не установлена? Поставь на загрузку заранее"
                  onClick={() =>
                    void sendFeedback(hero.appid, 'opened', undefined, ctxOf(hero, 'install'))
                  }
                  className="tap hover:text-ink transition-colors"
                />
              </p>
            )}
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
              <Link href="/quiz" className="tap text-dim hover:text-ink transition-colors">
                Хочу выбрать сам →
              </Link>
              {/* Магазинный день — раз в три: кто сегодня покупать не собирался,
                  берёт свою одним нажатием, а не уходит в обычный подбор */}
              {alternate && (
                <button
                  type="button"
                  onClick={() => {
                    const next = ownDay ? pick : alternate
                    wantHeroFocus.current = true
                    setOwnDay(!ownDay)
                    setRerollMiss(null)
                    setSaid(`Игра дня: ${next.name}`)
                  }}
                  className="tap text-dim hover:text-ink transition-colors cursor-pointer"
                >
                  {ownDay ? 'Вернуть игру дня из магазина' : 'Сегодня хочу из своего →'}
                </button>
              )}
            </div>

            {hero.source === 'new' && (
              <div className="flex flex-wrap items-baseline gap-3">
                <PriceTag
                  priceFinal={hero.priceFinal}
                  discount={hero.discount}
                  isFree={hero.isFree}
                  size="hero"
                />
                <DiscountEnds discount={hero.discount} />
              </div>
            )}
            {hero.refund && <RefundNote />}

            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint mt-1 max-w-md">
              <span className="inline-flex items-center gap-1.5 text-dim">
                <Icon name="clock" size={14} />
                <DailyCountdown nowSec={nowSec} />
              </span>
              <span>
                {hero.source === 'new'
                  ? 'Одна игра на день. Покупать ничего не нужно.'
                  : 'Одна игра на день.'}
              </span>
            </p>
          </div>
        </div>
      </section>

      {/* Полка каталога живёт отдельно от героя: герой — это «во что сесть
          сегодня», а здесь про «присмотреться на будущее». Смешивать их в
          одном блоке значило бы каждый день предлагать что-то купить */}
      {discoveries.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-safe py-16">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <SectionLabel>Нет в твоей библиотеке</SectionLabel>
            <a
              href="https://steamdb.info/sales/"
              target="_blank"
              rel="noreferrer"
              className="tap link-more shrink-0"
            >
              Все скидки Steam <Icon name="arrow" size={14} />
            </a>
          </div>
          <p className="text-xs text-faint mb-4 max-w-md">
            Подобрано по твоему вкусу среди актуального. Ничего покупать не нужно — это просто на
            будущее.
          </p>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-6">
            {discoveries.map((c) => (
              <a
                key={c.appid}
                href={storeHref(c)}
                target="_blank"
                rel="noreferrer"
                onClick={() => {
                  const ctx = ctxOf({ source: 'new' }, 'store', 'discovery')
                  void sendFeedback(c.appid, 'opened', undefined, ctx)
                }}
                className="game-card block text-left"
              >
                <GameCardBody
                  appid={c.appid}
                  name={c.name}
                  headerImage={c.headerImage}
                  art={c.art}
                  sizes="(min-width: 768px) 33vw, 50vw"
                  corner={<DiscountCorner discount={c.discount} />}
                  meta={
                    <>
                      <span className="truncate">{c.store ? (STORE_LABEL[c.store] ?? c.store) : 'Steam'}</span>
                      <PriceTag
                        priceFinal={c.priceFinal}
                        discount={c.discount}
                        isFree={c.isFree}
                        showPercent={false}
                        className="shrink-0"
                      />
                    </>
                  }
                />
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
