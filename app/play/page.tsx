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
import { HeroShots } from '@/components/HeroShots'
import { LogoMark } from '@/components/Logo'
import { PlayersNow } from '@/components/PlayersNow'
import { PrivacyHelp } from '@/components/PrivacyHelp'
import { DiscountCorner, DiscountEnds, PriceTag } from '@/components/PriceTag'
import { SpinWheel } from '@/components/SpinWheel'
import { SteamLaunch } from '@/components/SteamLaunch'
import { WarmupScreen } from '@/components/WarmupScreen'
import { SplitHeading } from '@/components/SplitHeading'
import type { GameArtUrls } from '@/lib/art'
import type { Discount } from '@/lib/discount'
import { EASE } from '@/lib/motion'
import { moodCaption } from '@/lib/quiz'
import type { Focus, Scope } from '@/lib/recommend'
import { SOURCE_BADGE } from '@/lib/sources'
import { STORE_LABEL } from '@/lib/stores'
import { bounceTo } from '@/lib/destination'
import type { CandidateSource, Mood } from '@/lib/types'
import { SectionLabel } from '@/components/Labels'
import { WarmStrip } from '@/components/WarmStrip'
import { runWarmup, type WarmupProgress } from '@/lib/warmup'
import { plural } from '@/lib/plural'
import { TagChips } from '@/components/TagChips'

type Signals = {
  matchPercent: number | null
  sharedTags: string[]
  moodTags: string[]
} | null

type Pick = {
  appid: number
  name: string
  source: CandidateSource
  reason: string
  headerImage: string | null
  art: GameArtUrls | null
  /** Кадры для морфа в герое. Приходят только у picks: карточки открытий
      героем не становятся, им они не нужны. */
  screenshots?: string[]
  ccu: number | null
  shortDescription: string | null
  tags: string[]
  hoursPlayed: number | null
  store: string | null
  storeUrl: string | null
  priceFinal: number | null
  isFree: boolean | null
  discount: Discount | null
  signals: Signals
}

/** Ссылка на игру в магазине: у не-Steam игр она своя, у Steam собирается */
function storeHref(p: Pick): string {
  return p.storeUrl ?? `https://store.steampowered.com/app/${p.appid}/`
}

const SKIP_REASONS: Array<{ key: string; label: string }> = [
  { key: 'genre', label: 'Не тот жанр' },
  { key: 'hard', label: 'Слишком сложная' },
  { key: 'tired', label: 'Надоела' },
  { key: 'notnow', label: 'Просто не сейчас' },
]

const COZY_TAGS = ['Casual', 'Relaxing', 'Cozy', 'Wholesome', 'Puzzle', 'Farming Sim']
const BURNOUT_AFTER_SKIPS = 5
/**
 * На сколько должен вырасти разобранный каталог, чтобы предлагать пересчёт.
 *
 * Полсотни — это примерно четверть пачки GetItems, то есть заметный кусок, а
 * не хвост. Ниже порога предложение обновиться было бы честным по факту и
 * бессмысленным по сути: выдача из пяти карточек от сорока новых игр в пуле
 * почти наверняка не изменится, а перебить человеку чтение карточки — изменит.
 */
const REWARM_MIN_GROWTH = 50

/**
 * Две двери в выдачу. «Любые игры» стоит первой и включена по умолчанию:
 * на «во что поиграть» честный ответ не обязан заканчиваться на том, за что
 * уже заплачено. Кому нужен старый разговор строго про свою полку — вторая
 * кнопка возвращает его в один тап.
 */
const SCOPES: Array<{ key: Scope; label: string }> = [
  { key: 'all', label: 'Любые игры' },
  { key: 'library', label: 'Только моё' },
]

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

/**
 * ПОЧЕМУ ВЫДАЧА НЕ СОБРАЛАСЬ — РАЗНЫМИ СЛОВАМИ, А НЕ ОДНИМИ.
 *
 * /api/recommend отвечает четырьмя разными отказами: нет сессии, не разобрать
 * настроение, нет снимка библиотеки, кандидатов не осталось. Клиент до этой
 * правки различал ровно один случай — потолок частоты (429), — а все прочие
 * сводил к `!res.ok` и показывал одну и ту же строку:
 *
 *     «Возможно, каталог ещё прогревается — попробуй ещё раз через минуту».
 *
 * Замерено сквозным прогоном с включённой веткой `nocandidates`: человек
 * получает именно её, а кнопка «Попробовать снова» под ней будет отдавать тот
 * же 409 сколько угодно раз. Каталог при этом в полном порядке.
 *
 * Тот же разбор уже был сделан для 429 — см. докблок над limitedFor. Здесь он
 * просто доведён до остальных кодов.
 *
 * `retry` — не оформление: кнопка повтора показывается там, где повтор может
 * помочь, и не показывается там, где он гарантированно вернёт тот же ответ.
 */
const FAIL: Record<string, { title: string; text: string; retry: boolean }> = {
  nocandidates: {
    title: 'Подбирать не из чего',
    text: 'Под это настроение не прошла ни одна игра: часть могла уехать в бан, часть не годится под запрос. Смени настроение или верни что-нибудь из бана.',
    retry: false,
  },
  nolibrary: {
    title: 'Библиотека не доехала',
    text: 'Steam не отдал список игр. Чаще всего его прячут настройки профиля — и это чинится за минуту.',
    retry: false,
  },
  badmood: {
    title: 'Настроение не разобрать',
    text: 'Адрес пришёл с непонятными параметрами — собери запрос заново.',
    retry: false,
  },
}

/** Сеть, пятисотка, оборванный ответ: здесь повтор осмыслен. */
const FAIL_UNKNOWN = {
  title: 'Не получилось собрать рекомендации',
  text: 'Возможно, каталог ещё прогревается — попробуй ещё раз через минуту.',
  retry: true,
}

function Player() {
  const router = useRouter()
  const search = useSearchParams()
  const roulette = search.get('roulette') === '1'
  const focus: Focus | null = search.get('from') === 'untouched' ? 'untouched' : null
  const mood: Mood = {
    time: (search.get('time') as Mood['time']) ?? 'medium',
    vibe: (search.get('vibe') as Mood['vibe']) ?? 'chill',
    social: (search.get('social') as Mood['social']) ?? 'solo',
  }
  /**
   * Спрашивали ли настроение вообще. Все три оси, а не любая из них: значения
   * выше подставляются дефолтами, и на прямом заходе на /play подпись экрана
   * ожидания процитировала бы человеку слова, которых он не говорил.
   */
  const askedMood = (['time', 'vibe', 'social'] as const).every((k) => search.has(k))

  const [phase, setPhase] = useState<'prepare' | 'spin' | 'reveal' | 'burnout' | 'error'>('prepare')
  /*
   * Сколько ждать, если выдача отказала по потолку частоты, а не по сбою.
   * Экран ошибки говорит «каталог прогревается» — для 429 это прямая неправда:
   * каталог в порядке, упёрся человек. Держим секунды из Retry-After, чтобы
   * назвать срок, а не отправить «попробуй через минуту» при окне в десять.
   */
  const [limitedFor, setLimitedFor] = useState<number | null>(null)
  /** Код отказа из тела ответа: nocandidates, nolibrary, badmood или null. */
  const [reason, setReason] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>('Изучаю твою библиотеку…')
  const [prep, setPrep] = useState<WarmupProgress | null>(null)
  /** Обложка последнего ответа квиза, если человек пришёл оттуда */
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
  // «Любые игры» против «только моя библиотека». Живёт в состоянии, а не в
  // адресе: это переключатель уже показанной выдачи, и перезагружать ради
  // него страницу (а с ней и весь прогрев) незачем.
  const [scope, setScope] = useState<Scope>('all')
  const [switching, setSwitching] = useState(false)
  const started = useRef(false)

  /**
   * Догрев после того, как выдача уже на экране.
   *
   * 'off' — греть нечего либо всё догрето до первой выдачи (обычный случай для
   * небольшой библиотеки), 'running' — идёт фоном, 'ready' — закончился и
   * каталог заметно вырос, значит есть что предложить пересчитать.
   */
  const [warming, setWarming] = useState<'off' | 'running' | 'ready'>('off')
  // Каким был объём разобранного в момент первой выдачи — с ним сравниваем,
  // чтобы не звать обновляться из-за трёх доехавших игр
  const warmAtReveal = useRef(0)

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

  /**
   * Запрос выдачи. Отдельно от прогрева: переключение режима повторяет только
   * его. Возвращает карточки, а не флаг, — вызывающему нужна длина сразу,
   * а состояние к следующей строке ещё не обновится.
   */
  const fetchPicks = useCallback(
    async (nextScope: Scope): Promise<Pick[] | null> => {
      // try/catch, а не голый await: оборванная сеть на этом шаге всплывала из
      // async-функции и оставляла экран в вечном «Подбираю…» — тот же класс
      // ошибки, что был в цикле прогрева до переезда в lib/warmup.ts.
      // Возвращаем null, и вызывающий покажет экран ошибки.
      try {
        const res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mood, ...(focus ? { focus } : {}), scope: nextScope }),
        })
        if (res.status === 429) {
          const wait = Number(res.headers.get('Retry-After') ?? 0)
          setLimitedFor(Number.isFinite(wait) && wait > 0 ? wait : null)
          return null
        }
        setLimitedFor(null)
        if (!res.ok) {
          /*
           * Код причины читается ИЗ ТЕЛА, а не выводится из статуса: под 409
           * живут два разных отказа — «нет снимка библиотеки» и «кандидатов не
           * осталось», — и советы у них противоположные.
           */
          const code = await res
            .json()
            .then((d: { error?: unknown }) => (typeof d.error === 'string' ? d.error : null))
            .catch(() => null)
          // Сессия отвалилась — экран с текстом здесь не нужен вовсе: человеку
          // нужен вход, а не объяснение. Тот же приём, что при обрыве сессии в
          // фоновом прогреве несколькими строками ниже.
          if (res.status === 401) {
            router.push(bounceTo('/play'))
            return null
          }
          setReason(code)
          return null
        }
        const data = (await res.json()) as {
          picks: Pick[]
          discoveries?: Pick[]
          engine: string
        }
        if (!data.picks?.length) return null
        setPicks(data.picks)
        setDiscoveries(data.discoveries ?? [])
        setEngine(data.engine)
        return data.picks
      } catch {
        // Причину обязательно СБРАСЫВАЕМ, а не оставляем как есть: сюда
        // приходит оборванная сеть, и без сброса повтор после отказа
        // «кандидатов нет» показал бы ту же карточку с тем же советом, хотя
        // на этот раз не доехал запрос.
        setReason(null)
        return null
      }
    },
    // mood и focus собираются из строки запроса и в рамках страницы неизменны
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  useEffect(() => {
    if (started.current) return
    started.current = true

    /** Выдача на экран. Один путь и для догретого каталога, и для частичного. */
    async function reveal(): Promise<boolean> {
      setProgress(
        focus ? 'Ищу то, что ты ни разу не запускал…' : 'Подбираю игру под твоё состояние…',
      )
      const got = await fetchPicks(scope)
      if (!got) {
        setPhase('error')
        return false
      }
      setIndex(roulette ? weightedRandomIndex(got.length) : 0)
      // В рулетке между «подбираю» и выдачей появляется барабан: он и есть
      // та самая случайность, которая до сих пор происходила молча.
      setPhase(roulette ? 'spin' : 'reveal')
      return true
    }

    async function run() {
      // Промис, а не флаг: runWarmup продолжает цикл сразу после onYield и
      // вполне может завершиться раньше, чем выдача доедет. С флагом это была
      // бы гонка, а её цена — второй запрос к /api/recommend поверх первого.
      let revealing: Promise<boolean> | null = null
      // Последний известный объём работы: нужен после цикла, а состояние React
      // к этому моменту читать нельзя — оно обновится только к следующему рендеру
      let lastTotal = 0

      const warm = await runWarmup({
        onProgress: (p) => {
          lastTotal = p.total
          setPrep(p)
          if (p.remaining > 0) setProgress(`Осталось разобрать ${p.remaining} ${plural(p.remaining, 'игру', 'игры', 'игр')}`)
        },
        onYield: (p) => {
          // Данных уже хватает на пять карточек — показываем их, а цикл пусть
          // догревает остальное под живой страницей
          warmAtReveal.current = p.total - p.remaining
          setWarming('running')
          revealing = reveal()
        },
      })

      const revealed = revealing ? await revealing : false

      if (warm === 'unauthorized') {
        // Сессия отвалилась во время ФОНОВОГО догрева — карточки на экране уже
        // есть и работают. Выкидывать с них на лендинг незачем: человек упрётся
        // в это при следующем действии и там же увидит внятную причину.
        if (!revealed) router.push(bounceTo('/play'))
        setWarming('off')
        return
      }
      if (warm === 'error') {
        // Та же логика: подменять работающую выдачу экраном ошибки — потерять
        // работающее ради сообщения о неработающем
        if (!revealed) setPhase('error')
        setWarming('off')
        return
      }

      // library переносим как есть: прогрев закончился, но числа про библиотеку
      // остаются верными — терять их на последнем кадре незачем
      setPrep((p) => ({ remaining: 0, total: p?.total ?? lastTotal, library: p?.library ?? null }))

      if (revealed) {
        // Предлагаем пересчитать, только если каталог вырос заметно: ради
        // десятка доехавших игр дёргать того, кто уже читает карточку, — шум.
        setWarming(lastTotal - warmAtReveal.current >= REWARM_MIN_GROWTH ? 'ready' : 'off')
        return
      }
      await reveal()
    }

    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Смена режима: тот же прогрев, другой вопрос к движку — и выдача с начала */
  /*
   * «Попробовать снова» пробует снова.
   *
   * Кнопка вела на /quiz, то есть отправляла заново отвечать на три вопроса.
   * Настроение при этом было ни при чём: экран показывается, когда подбор не
   * собрался, и абзац над кнопкой прямо говорит «попробуй ещё раз через
   * минуту» — то есть обещает повтор запроса, а не новую анкету.
   *
   * Тот же разбор уже записан в app/error.tsx про пару reset/retry: «единственная
   * кнопка экрана выглядела нажатой и не делала ничего». Здесь она делала —
   * но не то, что написано.
   *
   * Неудача оставляет экран как есть: он и так про неудачу, а мигать с него
   * некуда. Поэтому никакого setPhase в ветке !got.
   */
  const [retrying, setRetrying] = useState(false)
  const retry = useCallback(async () => {
    if (retrying) return
    setRetrying(true)
    try {
      const got = await fetchPicks(scope)
      if (!got) return
      setIndex(roulette ? weightedRandomIndex(got.length) : 0)
      setPhase(roulette ? 'spin' : 'reveal')
    } finally {
      setRetrying(false)
    }
  }, [retrying, fetchPicks, scope, roulette])

  const switchScope = useCallback(
    async (next: Scope) => {
      if (next === scope || switching) return
      setSwitching(true)
      try {
        const got = await fetchPicks(next)
        if (!got) return
        setScope(next)
        setDir('pick')
        setIndex(0)
        setAskReason(false)
        setShowWhy(false)
        setSkipCount(0)
      } finally {
        // finally, а не строка после await: оборванная сеть оставляла бы
        // переключатель навсегда заблокированным, и починить это можно было бы
        // только перезагрузкой страницы. Не вышло — остаёмся на прежней
        // выдаче, она на экране и никуда не делась.
        setSwitching(false)
      }
    },
    [scope, switching, fetchPicks],
  )

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
    return (
      <WarmupScreen
        progress={prep}
        message={progress}
        caption={askedMood ? moodCaption(mood) : undefined}
      />
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
    /*
     * Потолок частоты остаётся отдельной веткой: у него есть СРОК, и назвать
     * его точнее, чем «через минуту», может только Retry-After.
     */
    const fail =
      limitedFor !== null
        ? {
            title: 'Слишком часто',
            text: `Подбор — дорогая операция, и на неё стоит потолок. Вернись через ${Math.ceil(limitedFor / 60)} ${plural(Math.ceil(limitedFor / 60), 'минуту', 'минуты', 'минут')}.`,
            // Повтор остаётся: окно бывает и десятисекундным, и тогда
            // единственной дорогой назад была бы перезагрузка страницы.
            retry: true,
          }
        : (FAIL[reason ?? ''] ?? FAIL_UNKNOWN)

    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
        <p className="text-lg">{fail.title}</p>
        <p className="text-dim text-sm max-w-md leading-relaxed">{fail.text}</p>

        {/* Шаги про настройки Steam — только там, где библиотека и правда не
            доехала. Панель общая с карточкой подключения и с пустой
            библиотекой: три копии одной инструкции про чужой интерфейс
            разъехались бы на первой же правке. */}
        {reason === 'nolibrary' && limitedFor === null && (
          <div className="max-w-md text-left">
            <PrivacyHelp />
          </div>
        )}

        {fail.retry && (
          <button
            onClick={() => void retry()}
            disabled={retrying}
            className="tap cursor-pointer text-sm text-ember-text hover:underline disabled:opacity-50"
          >
            {retrying ? 'Пробую…' : 'Попробовать снова'}
          </button>
        )}

        {/* Прежний адрес кнопки остаётся доступен — но под своим именем.
            Кроме случая, когда библиотеки нет вовсе: менять там настроение
            нечему, и ссылка была бы предложением заняться ерундой. */}
        {reason !== 'nolibrary' && (
          <Link href="/quiz" className="tap text-sm text-dim transition-colors hover:text-ink">
            Изменить настроение →
          </Link>
        )}

        {/* Вернуть игры из бана можно только в библиотеке, и это единственный
            выход, когда кандидатов не осталось из-за банов. */}
        {reason === 'nocandidates' && (
          <Link href="/library" className="tap text-sm text-dim transition-colors hover:text-ink">
            Посмотреть библиотеку →
          </Link>
        )}
        {reason === 'nolibrary' && (
          <Link href="/" className="btn-ember px-6 py-3">
            Подключить заново
          </Link>
        )}
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
          <h1 className="font-display text-display-sm">
            Похоже, сегодня не игровой вечер
          </h1>
          <p className="text-dim leading-relaxed">
            Ты пролистал уже {BURNOUT_AFTER_SKIPS}{' '}
            {plural(BURNOUT_AFTER_SKIPS, 'игру', 'игры', 'игр')} — дело, скорее всего, не в играх. Это
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
              className="btn-ember is-block py-3"
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
              className="tap text-dim hover:text-ink transition-colors"
            >
              Всё равно листать
            </button>
            <Link href="/" className="tap text-dim hover:text-ink transition-colors">
              На сегодня всё
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const pick = picks[Math.min(index, picks.length - 1)]
  const others = picks.filter((p) => p.appid !== pick.appid)
  /*
   * «Почему она?» — то, чего НЕ ВИДНО выше, и только это.
   *
   * Здесь была третья строка, `общие теги: …`. С тех пор как совпавшие теги
   * помечаются прямо в чипсах (components/TagChips.tsx), один и тот же факт
   * оказался на экране трижды в полутора сотнях пикселей: фразой причины
   * («её теги (Multiplayer, Competitive) совпадают…»), точкой на чипсе и
   * списком в этой панели.
   *
   * И третья копия была не просто лишней — она СПОРИЛА с двумя первыми.
   * Замерено на живом ответе: панель перечисляла «Multiplayer, Competitive,
   * Strategy», а чипсов с отметкой два. Strategy — настоящий общий тег, но в
   * четвёрку самых частых тегов игры он не попал, поэтому чипса у него нет
   * вовсе: панель называла то, чего на странице не найти.
   *
   * Осталось ровно дополняющее: насколько сильно совпало и что попало в
   * выбранный вайб. Ни того, ни другого ни фраза, ни чипсы не говорят.
   */
  const whyParts: string[] = []
  if (pick.signals) {
    if (pick.signals.matchPercent !== null)
      whyParts.push(`совпадение со вкусом ${pick.signals.matchPercent}%`)
    if (pick.signals.moodTags.length)
      whyParts.push(`под вайб: ${pick.signals.moodTags.join(', ')}`)
  }

  return (
    <div className="flex-1 flex flex-col">
      <WarmStrip
        state={warming}
        remaining={prep?.remaining ?? 0}
        onRefresh={() => {
          setWarming('off')
          void fetchPicks(scope).then((got) => {
            if (got) setIndex(0)
          })
        }}
        onDismiss={() => setWarming('off')}
      />
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
                <span className="rounded-full bg-ember/15 text-ember-text px-3 py-1 font-medium">
                  {pick.store ? `${STORE_LABEL[pick.store] ?? pick.store}` : SOURCE_BADGE[pick.source]}
                </span>
                {pick.hoursPlayed !== null && pick.hoursPlayed > 0 && (
                  <span className="font-mono text-dim">{pick.hoursPlayed} ч наиграно</span>
                )}
                <PlayersNow ccu={pick.ccu} />
              </motion.div>

              <SplitHeading className="font-display text-display-lg" delay={0.18}>
                {pick.name}
              </SplitHeading>

              <motion.p variants={STEP} className="text-base md:text-lg text-ink/90 leading-relaxed">
                {pick.reason}
              </motion.p>

            {whyParts.length > 0 && (
              <motion.div variants={STEP} className="text-sm">
                <button
                  onClick={() => setShowWhy(!showWhy)}
                  className="tap text-dim hover:text-ink transition-colors cursor-pointer"
                >
                  Почему она? {showWhy ? '▴' : '▾'}
                </button>
                <AnimatePresence initial={false}>
                  {showWhy && (
                    <motion.p
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="mt-1.5 text-dim overflow-hidden"
                    >
                      {whyParts.join(' · ')}
                    </motion.p>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {pick.tags.length > 0 && (
              <motion.div variants={STEP}>
                <TagChips tags={pick.tags} matched={pick.signals?.sharedTags ?? []} />
              </motion.div>
            )}

            {askReason ? (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
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
                  className="text-sm text-dim hover:text-ink p-2 transition-colors"
                >
                  пропустить
                </button>
              </motion.div>
            ) : (
              <motion.div variants={STEP} className="flex flex-wrap items-center gap-3 mt-2">
                {pick.source === 'new' || pick.storeUrl ? (
                  // Игры нет в библиотеке — «Запустить» для неё кнопка-обманка:
                  // steam://run у не купленной игры не делает ничего. Ведём
                  // туда, где её действительно можно взять.
                  <a
                    href={storeHref(pick)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={() => sendFeedback(pick.appid, 'liked')}
                    className="btn-ember px-6 py-3"
                  >
                    {pick.source === 'new'
                      ? `Смотреть в ${STORE_LABEL[pick.store ?? ''] ?? 'Steam'}`
                      : `Открыть в ${STORE_LABEL[pick.store ?? ''] ?? 'магазине'}`}
                  </a>
                ) : (
                  <SteamLaunch
                    appid={pick.appid}
                    onClick={() => sendFeedback(pick.appid, 'liked')}
                    className="btn-ember px-6 py-3"
                  />
                )}
                {pick.source === 'new' && (pick.priceFinal !== null || pick.isFree) && (
                  <a
                    href={storeHref(pick)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-[14px] glass glass-hover px-5 py-3 text-sm flex items-center gap-2"
                  >
                    <PriceTag
                      priceFinal={pick.priceFinal}
                      discount={pick.discount}
                      isFree={pick.isFree}
                      size="hero"
                    />
                    <DiscountEnds discount={pick.discount} />
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
                    liked.has(pick.appid) ? 'bg-ember/20 text-ember-text' : 'glass glass-hover text-dim'
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
                  className="rounded-[14px] glass glass-hover px-3 py-3 text-sm text-faint cursor-pointer"
                >
                  {/*
                    Раньше здесь стояла голая эмодзи. Доступного имени у кнопки
                    не было вовсе (title им не является), а рядом с «Не то —
                    дальше» её смысл не читался и глазами: обе кнопки убирают
                    игру с экрана, но одна на сегодня, а другая навсегда.
                    Эмодзи спрятана от скринридера, текст объясняет разницу.
                  */}
                  <span aria-hidden>🚫</span>
                  <span className="sr-only">Больше никогда не показывать эту игру</span>
                </button>
              </motion.div>
            )}
            </div>
          </motion.div>
        </motion.section>
      </AnimatePresence>

      {!roulette && (
        <section className="mx-auto w-full max-w-6xl px-5 py-10">
          <div className="flex items-baseline justify-between gap-3 flex-wrap mb-4">
            <SectionLabel>
              {focus ? 'Ещё нераспакованное' : 'Ещё варианты под это настроение'}
            </SectionLabel>
            {/* Откуда брать главную выдачу. При фокусе «нераспакованное»
                переключателя нет: там вопрос уже задан и ответ на него — своё. */}
            {!focus && (
              <div
                role="group"
                aria-label="Откуда брать игры"
                /* gap-3, а не gap-1, и это не про воздух. Зона .tap на кнопках
                   ниже вылезает на 6 px вбок с каждой стороны; при зазоре в
                   4 px соседние зоны перекрылись бы на 8 px и воровали бы друг
                   у друга нажатия. 12 px — ровно столько, сколько зона
                   занимает, и ни пикселем больше. */
                className="flex items-center gap-3 rounded-full glass p-1 text-xs"
              >
                {SCOPES.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => switchScope(s.key)}
                    disabled={switching}
                    // Выбранное состояние — не только цветом: скринридеру и
                    // тому, кто не различает ember на стекле, нужен признак
                    aria-pressed={scope === s.key}
                    /* py-2.5, а не py-1: замерено — переключатель выдавал
                       24 px, ровно порог WCAG 2.5.8 без единого запаса, и это
                       основной фильтр экрана выдачи. Зону наращивать нечем:
                       кнопки стоят внутри одной пилюли в 4 px друг от друга, и
                       псевдозона .tap перекрыла бы соседа. */
                    className={`tap rounded-full px-3.5 py-2.5 transition cursor-pointer disabled:opacity-50 ${
                      scope === s.key ? 'bg-ember/20 text-ember-text' : 'text-dim hover:text-ink'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
            <span className="text-xs text-faint font-mono">
              {/*
                «по тегам», а не «эвристика». Раскрытие тут по делу — продукт
                обещает, что рекомендация себя объясняет, — но «эвристика» было
                единственным словом из машинного словаря во всём интерфейсе, и
                рядом с «ИИ» оно читалось как «версия похуже», без единого
                способа что-то с этим сделать. По тегам подбор и идёт, а сами
                теги человек видит чипсами строкой выше.
              */}
              {switching ? 'пересобираю…' : engine === 'claude' ? 'подбор: ИИ' : 'подбор: по тегам'}
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
                <div className="relative">
                  <GameArt
                    appid={p.appid}
                    name={p.name}
                    headerImage={p.headerImage}
                    art={p.art}
                    sizes="(min-width: 768px) 33vw, 100vw"
                    className="w-full aspect-[460/215] object-cover"
                  />
                  <DiscountCorner discount={p.discount} />
                </div>
                <div className="p-3">
                  <div className="text-sm font-semibold leading-tight">{p.name}</div>
                  <div className="text-[11px] mt-1 flex items-center justify-between gap-2">
                    <span className="text-dim truncate">
                      {p.store ? STORE_LABEL[p.store] ?? p.store : SOURCE_BADGE[p.source]}
                    </span>
                    {/* Цена — только у не купленного: у своей игры она уже
                        ничего не решает, а место в строке занимает */}
                    {p.source === 'new' && (
                      <PriceTag
                        priceFinal={p.priceFinal}
                        discount={p.discount}
                        isFree={p.isFree}
                        showPercent={false}
                        className="shrink-0"
                      />
                    )}
                  </div>
                </div>
              </motion.button>
            ))}
          </div>
          <div className="mt-8 text-center">
            <Link href="/quiz" className="tap text-sm text-dim hover:text-ink transition-colors">
              Изменить настроение →
            </Link>
          </div>
        </section>
      )}

      {/* Каталог отдельным блоком: даже когда он участвует в главной выдаче,
          у покупок остаётся своя полка — с ценами и скидками на виду */}
      {!roulette && discoveries.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-5 pb-16">
          <div className="border-t border-edge/60 pt-10">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <SectionLabel>Нет в твоей библиотеке</SectionLabel>
              <a
                href="https://steamdb.info/sales/"
                target="_blank"
                rel="noreferrer"
                className="tap text-xs text-faint hover:text-ink transition-colors shrink-0"
              >
                все скидки Steam →
              </a>
            </div>
            <p className="text-xs text-faint mb-4 max-w-md">
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
                  <div className="relative">
                    <GameArt
                      appid={p.appid}
                      name={p.name}
                      headerImage={p.headerImage}
                      art={p.art}
                      sizes="(min-width: 768px) 33vw, 50vw"
                      className="w-full aspect-[460/215] object-cover"
                    />
                    <DiscountCorner discount={p.discount} />
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-semibold leading-tight">{p.name}</div>
                    <div className="text-[11px] mt-1 flex items-center justify-between gap-2">
                      <span className="text-dim truncate">
                        {p.store ? (STORE_LABEL[p.store] ?? p.store) : 'Steam'}
                      </span>
                      <PriceTag
                        priceFinal={p.priceFinal}
                        discount={p.discount}
                        isFree={p.isFree}
                        showPercent={false}
                        className="shrink-0"
                      />
                    </div>
                    <DiscountEnds discount={p.discount} className="mt-1 block" />
                  </div>
                </motion.a>
              ))}
            </div>
          </div>
        </section>
      )}

      {roulette && (
        <div className="mx-auto w-full max-w-6xl px-5 py-8 text-center">
          <Link href="/quiz" className="tap text-sm text-dim hover:text-ink transition-colors">
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
