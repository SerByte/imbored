'use client'

import Link from '@/components/Link'
import { useLocale } from '@/components/LocaleProvider'
import { useLocaleRouter } from '@/components/useLocaleRouter'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { BlurBand } from '@/components/BlurBand'
import { DailyCountdown } from '@/components/DailyCountdown'
import { DemoBar, useDemoSession } from '@/components/DemoBar'
import { GameCardBody } from '@/components/GameCard'
import { HeroTitle } from '@/components/HeroTitle'
import { HeroTrailer } from '@/components/HeroTrailer'
import { HeroPoster } from '@/components/TypeCover'
import { Icon } from '@/components/Icon'
import { HeroShots } from '@/components/HeroShots'
import { NeedSteam } from '@/components/NeedSteam'
import { useSharePick } from '@/components/SharePick'
import { StatusLine } from '@/components/StatusLine'
import { OutcomeAsk } from '@/components/OutcomeAsk'
import { PlayersNow } from '@/components/PlayersNow'
import { PrivacyHelp } from '@/components/PrivacyHelp'
import { DiscountCorner, DiscountEnds, PriceTag, PriceWhere } from '@/components/PriceTag'
import { RefundNote } from '@/components/RefundNote'
import { SeasonalSnow } from '@/components/SeasonalSnow'
import { SteamLaunch } from '@/components/SteamLaunch'
import { StopAsk } from '@/components/StopAsk'
import { TonightButton, useWarmTonight } from '@/components/TonightLazy'
import { WarmupScreen } from '@/components/WarmupScreen'
import type { DailyPickCard, ShareView, StoreCard } from '@/lib/cards'
import type { DailyYesterday } from '@/lib/daily'
import { bounceTo, reconnectHref, steamLoginFor } from '@/lib/destination'
import { closesPlan } from '@/lib/eveningplan'
import type { CtxIntent, CtxSlot, FeedbackCtx } from '@/lib/feedbackctx'
import type { FeedbackAction, SkipReason } from '@/lib/feedbackkinds'
import { fmtNumber, lp, tr, withLang, type Locale } from '@/lib/i18n'
import {
  dueLaunchFor,
  dueLaunchNow,
  forgetLaunch,
  launchMemoStore,
  rememberLaunch,
  subscribeDueLaunch,
} from '@/lib/launchmemo'
import { forgetPlanned } from '@/lib/planforget'
import { sourceBadge, suggestsInstall } from '@/lib/sources'
import { STORE_LABEL } from '@/lib/stores'
import { withForeignRuns } from '@/lib/textlang'
import type { CandidateSource } from '@/lib/types'
import { remainingLine, runWarmup, type WarmupProgress } from '@/lib/warmup'
import { sendLike, undoLike } from '@/lib/unlike'
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
 *
 * Тексты — на каждом языке свой разбор тех же кодов (FAILS[locale]).
 */
type FailCopy = { title: string; text: string }

const FAILS: Record<Locale, Record<string, FailCopy>> = {
  ru: {
    nolibrary: {
      title: 'Библиотека не доехала',
      text: 'Steam не отдал список игр. Чаще всего его прячут настройки профиля — и это чинится за минуту.',
    },
    nocandidates: {
      title: 'Выбирать не из чего',
      text: 'В библиотеке не осталось игр, из которых можно собрать игру дня: возможно, всё подходящее уехало в бан.',
    },
    /*
     * Потолки частоты /api/daily: десять запросов в час на человека и тридцать
     * отборов в час на адрес — заход в уже выбранную игру дня адрес не тратит
     * (DAILY_IP_LIMIT в app/api/daily/route.ts). Без этой строки 429 уходил в
     * FAIL_UNKNOWN и страница говорила «что-то сломалось по дороге» — неправда:
     * не сломалось ничего, и через несколько минут всё заработает. /play и
     * /explore этот случай уже различали, здесь его просто не было.
     */
    ratelimited: {
      title: 'Слишком часто',
      text: 'Игру дня запрашивали много раз подряд, и на это стоит потолок. Загляни через несколько минут — а пока можно подобрать игру под настроение.',
    },
    // Выбрать было бы из чего, но всё — под «Не предлагать» (lib/mutetags.ts).
    // Фильтр живёт на квизе, куда ведёт «Обычный подбор» под текстом
    muted: {
      title: 'Всё под «Не предлагать»',
      text: 'Игра дня выбирается из того, что осталось после «Не предлагать», — а не осталось ничего. Фильтр меняется на экране настроения.',
    },
  },
  en: {
    nolibrary: {
      title: "Your library didn't come through",
      text: "Steam didn't send your game list. Usually your profile's privacy settings hide it — a one-minute fix.",
    },
    nocandidates: {
      title: 'Nothing to pick from',
      text: "There's nothing left in your library to pick a game of the day from: maybe everything that fits is in Hidden.",
    },
    ratelimited: {
      title: 'Too many tries',
      text: "The game of the day was requested many times in a row, and there's a limit. Check back in a few minutes — or pick a game by mood for now.",
    },
    // Не калька «под»: по-английски игры прячет фильтр. Заголовок — тот же,
    // что у этого отказа на /play: одно состояние — одни слова
    muted: {
      title: "All hidden by “Don't suggest”",
      text: "The game of the day comes from what's left after “Don't suggest” — and nothing is. You can change the filter on the mood screen.",
    },
  },
}

/** Сеть, пятисотка, оборванный ответ. */
const FAILS_UNKNOWN: Record<Locale, FailCopy> = {
  ru: {
    title: 'Не получилось выбрать игру дня',
    text: 'Похоже, что-то сломалось по дороге. Попробуй зайти чуть позже.',
  },
  en: {
    title: "Couldn't pick the game of the day",
    text: 'Something seems to have broken along the way. Try again a bit later.',
  },
}

/*
 * Карточки — DailyPickCard и StoreCard — ровно то, что отдаёт /api/daily:
 * типы выведены из функций, которые их строят (lib/cards.ts), а не
 * переписаны руками. Новое поле там — видно здесь, переименованное — красный
 * tsc там, где его читают.
 */
const storeHref = (c: Pick<StoreCard, 'appid' | 'storeUrl'>) =>
  c.storeUrl ?? `https://store.steampowered.com/app/${c.appid}/`

/**
 * Ответ на «Не зацепило?» (StopAsk) — один: «дай другую», то есть та же
 * notToday(), что у кнопки «Не сегодня».
 *
 * Причин /play — «не тот жанр», «слишком сложная» — здесь нет намеренно: отбор
 * дня слышит только «не сегодня» и «надоела» (notnowSince и cooldownKinds в
 * /api/daily, forgetDailyPick в /api/feedback). После «не тот жанр» запись дня
 * осталась бы на месте, и обещанная «другая» оказалась бы той же игрой.
 */
const STOP_REASONS: Record<Locale, ReadonlyArray<{ key: SkipReason; label: string }>> = {
  ru: [{ key: 'notnow', label: 'Дай другую' }],
  en: [{ key: 'notnow', label: 'Give me another' }],
}

/** «Не сегодня» ушло, а другую не подобрали — одна строка на отказ ответа и обрыв сети */
const rerollFailed = (locale: Locale) =>
  tr(locale, {
    ru: 'Отложили, но другую подобрать не вышло — обнови страницу чуть позже.',
    en: "Set aside, but we couldn't find another — refresh the page in a bit.",
  })

/** Игра дня и подпись для «Отправить другу» (lib/pickshare) — её кладёт роут, не dailyCardView */
type DailyHero = DailyPickCard & Partial<ShareView>

/** Ответ /api/daily — один разбор на все запросы страницы */
type DailyResponse = {
  pick: DailyHero
  discoveries?: StoreCard[]
  /** Своя на магазинный день — «Сегодня хочу из своего»; null — не магазинный */
  ownAlternate?: DailyHero | null
  dateLabel: string
  /** «Вчера была: …» — вчерашняя игра дня (lib/daily yesterdayLine); null — строки нет */
  yesterday?: DailyYesterday | null
  nowSec: number
}

/**
 * Отзыв об игре дня. Тот же роут и та же дисциплина, что у sendFeedback на
 * /play: промис не отклоняется, needsteam переводит страницу в режим чтения —
 * «Зашло» и «Не сегодня» прячутся, и на их месте строка о входе через Steam.
 *
 * Запуск и «Не сегодня» закрывают план на вечер (closesPlan) — и тот, что
 * поставлен на /play: игра дня бывает своей, отложенной там минуту назад.
 * Выдача /play на устройстве её тогда больше не держит отложенной
 * (lib/planforget): «не то» у неё там снова спросят.
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
    else if (r.ok && closesPlan(action, reason, ctx.intent)) forgetPlanned(appid)
    return r.ok
  } catch {
    return false
  }
}

export default function DailyPage() {
  const locale = useLocale()
  const router = useLocaleRouter()
  const [pick, setPick] = useState<DailyHero | null>(null)
  const [discoveries, setDiscoveries] = useState<StoreCard[]>([])
  const [nowSec, setNowSec] = useState(0)
  const [dateLabel, setDateLabel] = useState('')
  const [yesterday, setYesterday] = useState<DailyYesterday | null>(null)
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading')
  /**
   * Код отказа из тела ответа: nolibrary, nocandidates, muted (всё под «Не
   * предлагать», lib/mutetags.ts) или null.
   */
  const [reason, setReason] = useState<string | null>(null)
  const [prep, setPrep] = useState<WarmupProgress | null>(null)
  const [message, setMessage] = useState(() =>
    tr(locale, { ru: 'Изучаю твою библиотеку…', en: 'Looking through your library…' }),
  )
  /** Своя на магазинный день и показана ли она вместо магазинной */
  const [alternate, setAlternate] = useState<DailyHero | null>(null)
  const [ownDay, setOwnDay] = useState(false)
  const [liked, setLiked] = useState<Set<number>>(new Set())
  /** «Не сегодня» ушло, и страница ждёт другую игру */
  const [rerolling, setRerolling] = useState(false)
  /**
   * Почему не вышло действие у героя — строкой под кнопками: «Не сегодня» не
   * подобрало другую или «Зашло» не снялось (lib/unlike). null — нечего сказать
   */
  const [rerollMiss, setRerollMiss] = useState<string | null>(null)
  /**
   * Что сказать скринридеру о смене героя — живая строка стоит с первого кадра.
   * Разметка, а не строка: на /en русское название в ней — своим lang
   * (withForeignRuns), на ru — та же строка одним текстовым узлом
   */
  const [said, setSaid] = useState<ReactNode>('')
  /*
   * Герой сменился по нажатию («Не сегодня», «Сегодня хочу из своего») — и
   * нажатая кнопка ушла вместе со старым героем: секция пересоздаётся по
   * appid. Фокус без присмотра упал бы в body, поэтому его забирает заголовок
   * нового героя, когда смонтируется, — тот же приём, что у героя /play.
   */
  const heroEl = useRef<HTMLElement | null>(null)
  const wantHeroFocus = useRef(false)
  const heroRef = useCallback((el: HTMLElement | null) => {
    heroEl.current = el
    if (!el || !wantHeroFocus.current) return
    wantHeroFocus.current = false
    el.focus({ preventScroll: true })
  }, [])
  /**
   * Плашка «Не зацепило?» уходит вместе с нажатой кнопкой, и фокус без
   * присмотра упал бы в body — отдаём его заголовку героя, как на /play. Если
   * ответ сменит героя, фокус переедет к новому сам (wantHeroFocus выше).
   */
  const focusHero = useCallback(() => {
    heroEl.current?.focus({ preventScroll: true })
  }, [])
  /**
   * Сессия только читает (вошла по ссылке, а не через Steam): «Зашло» и «Не
   * сегодня» ей некуда записать — вместо них строка NeedSteam. null — «не
   * знаем»: кнопки как обычно, правду скажет первый отказ.
   */
  const readOnly =
    useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server) === false
  /** Демо-личность: над героем полоса «это чужая демо-библиотека» (DemoBar) */
  const demo = useDemoSession()
  // «Сыграю вечером на ПК» под героем — кусок прогревается заранее (TonightLazy)
  useWarmTonight()
  /**
   * Запуск с этой вкладки, про который пора спросить «не зацепило?» (см.
   * lib/launchmemo.ts) — тот же снимок, что на /play. Про какую игру
   * спрашивать, решается ниже, когда известен герой (dueLaunchFor).
   */
  const dueLaunch = useSyncExternalStore(subscribeDueLaunch, dueLaunchNow, launchMemoStore.server)

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
    setYesterday(data.yesterday ?? null)
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
        // replace, а не push: запись /daily без сессии мертва, и «Назад» с
        // лендинга открывал её снова — 401 — и снова уводил на лендинг. Гость,
        // зашедший сюда из сцены «Игра дня» или навигации, не мог уйти
        // «Назад» дальше /daily (так же было у /play и /explore). Лендинг — на
        // языке страницы: префикс к '/?next=…' ставит useLocaleRouter
        if (res.status === 401) {
          if (!signal.aborted) router.replace(bounceTo('/daily'))
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
      // Язык — в адресе (withLang): ответ свой на язык, и ключ кэша — адрес
      try {
        const res = await fetch(withLang('/api/daily?cached=1', locale), { signal })
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
          if (p.remaining > 0) setMessage(remainingLine(p.remaining, locale))
        },
      })
      if (warm === 'aborted') return
      if (warm === 'unauthorized') {
        // replace — по той же причине, что в show
        router.replace(bounceTo('/daily'))
        return
      }
      if (warm === 'error') {
        setPhase('error')
        return
      }

      setMessage(tr(locale, { ru: 'Выбираю твою игру дня…', en: 'Picking your game of the day…' }))
      try {
        await show(await fetch(withLang('/api/daily', locale), { signal }))
      } catch {
        if (!signal.aborted) setPhase('error')
      }
    })()
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // «Отправить другу» — хук, поэтому до ранних возвратов; герой тот же, что ниже
  const sharePick = useSharePick(ownDay && alternate ? alternate : pick, 'daily')

  const failed = phase === 'error' || (phase === 'ok' && !pick)
  const fail = FAILS[locale][reason ?? ''] ?? FAILS_UNKNOWN[locale]
  /*
   * Одна живая строка на всю страницу.
   *
   * Отказ здесь — не строка у кнопки, а целый экран вместо экрана прогрева, и
   * WarmupScreen уносит с собой единственную говорившую область — свою строку
   * прогресса. «Библиотека не доехала» или «Слишком часто» появлялись в
   * тишине: человек со скринридером слышал прогрев, а потом ничего, и об отказе
   * узнавал, только обойдя страницу. Область, рождённая вместе с экраном
   * отказа, звучит не везде (components/StatusLine), поэтому у прогрева и
   * отказа она стоит первым ребёнком фрагмента: React сверяет её по месту как
   * один узел, и смена экрана меняет в ней только текст.
   *
   * У героя она в его разметке, на месте прежней строки said (смена героя по
   * «Не сегодня» и «Сегодня хочу из своего»): к герою приходят только с
   * прогрева, и там строка рождается пустой — раньше своего текста. Сторож —
   * lib/liveregion.test.ts.
   */
  const status = (
    <StatusLine text={failed ? `${fail.title}. ${fail.text}` : said} className="sr-only" />
  )

  if (phase === 'loading') {
    return (
      <>
        {status}
        <WarmupScreen progress={prep} message={message} />
      </>
    )
  }

  if (failed || !pick) {
    return (
      <>
        {status}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-5 text-center">
          <p className="text-lg">{fail.title}</p>
          <p className="text-dim text-sm max-w-md leading-relaxed">{fail.text}</p>

          {/* Шаги про настройки Steam — только там, где библиотека и правда не
              доехала. Панель общая с карточкой подключения, пустой библиотекой и
              отказом подбора: четыре копии инструкции по чужому интерфейсу
              разъехались бы на первой же правке. */}
          {/* Проверка — входом через Steam, как на /play: снимок пишет вход. */}
          {reason === 'nolibrary' && (
            <div className="max-w-md text-left">
              {/* Вход — с языком страницы: lp даёт /en/daily, и steamLoginFor
                  везёт lang=en через Steam и обратно */}
              <PrivacyHelp retryHref={readOnly ? undefined : steamLoginFor(lp(locale, '/daily'))} />
            </div>
          )}

          {/* Кандидатов нет — вернуть игры из бана можно только в библиотеке. */}
          {reason === 'nocandidates' && (
            <Link href="/library" className="tap link-more">
              {tr(locale, { ru: 'Посмотреть библиотеку', en: 'Open your library' })}
              <Icon name="arrow" size={16} />
            </Link>
          )}

          {/* Обычный подбор предлагается везде, КРОМЕ случая без библиотеки: там
              он упрётся ровно в ту же причину, и совет был бы тупиком. */}
          {reason !== 'nolibrary' && (
            <Link href="/quiz" className="tap link-more">
              {tr(locale, { ru: 'Обычный подбор', en: 'Pick by mood' })}
              <Icon name="arrow" size={16} />
            </Link>
          )}

          {reason === 'nolibrary' && (
            <Link href={reconnectHref()} className="btn-ember px-6 py-3">
              {tr(locale, { ru: 'Подключить заново', en: 'Reconnect' })}
            </Link>
          )}
        </div>
      </>
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
   *
   * intent 'ask' — это ответ на «Не зацепило?» после запуска, а не нажатие
   * кнопки: отчёт различает их по снимку (lib/feedbackctx).
   */
  const notToday = async (intent?: CtxIntent) => {
    if (rerolling) return
    setRerolling(true)
    setRerollMiss(null)
    // Отложил свою в магазинный день — и следующую хочет своей же
    const wasOwn = hero === alternate
    // Ответил про героя сам — «не зацепило?» про него уже не спрашиваем
    forgetLaunch(hero.appid)
    try {
      const ok = await sendFeedback(hero.appid, 'skipped', 'notnow', ctxOf(hero, intent))
      // Отказ по правам — кнопки уже спрятались, и строка о входе на месте
      if (!ok) {
        if (writerStore.get() !== false)
          setRerollMiss(tr(locale, { ru: 'Не получилось отложить — попробуй ещё раз.', en: "Couldn't set it aside — try again." }))
        return
      }
      const res = await fetch(withLang('/api/daily', locale))
      if (!res.ok) {
        const code = await res
          .json()
          .then((d: { error?: unknown }) => (typeof d.error === 'string' ? d.error : null))
          .catch(() => null)
        // muted — другая была бы, но всё остальное под «Не предлагать»
        // (lib/mutetags.ts): «обнови позже» тут не поможет, поможет фильтр
        setRerollMiss(
          code === 'nocandidates'
            ? tr(locale, {
                ru: 'Отложили. Другой игры на сегодня не нашлось — загляни завтра.',
                en: "Set aside. There's no other game for today — come back tomorrow.",
              })
            : code === 'muted'
              ? tr(locale, {
                  ru: 'Отложили. Остальное на сегодня — под «Не предлагать»: фильтр меняется на экране настроения.',
                  en: "Set aside. Everything else today is hidden by “Don't suggest” — change the filter on the mood screen.",
                })
              : rerollFailed(locale),
        )
        return
      }
      const data = (await res.json()) as DailyResponse
      wantHeroFocus.current = true
      applyDaily(data)
      const own = wasOwn && data.ownAlternate
      if (own) setOwnDay(true)
      const name = (own ? data.ownAlternate! : data.pick).name
      setSaid(
        withForeignRuns(
          locale,
          tr(locale, { ru: `Другая игра на сегодня: ${name}`, en: `Another game for today: ${name}` }),
          [name],
        ),
      )
    } catch {
      setRerollMiss(rerollFailed(locale))
    } finally {
      setRerolling(false)
    }
  }

  /** «Зашло» — с кнопки у героя или «Зацепило» из вопроса после запуска */
  const like = (intent?: CtxIntent) => {
    // «Зашло» после запуска — уже ответ на «не зацепило?», даже повторное
    forgetLaunch(hero.appid)
    // «Зацепило» при горящем сердце — не второе «зашло». Снимает его только
    // само сердце (onClick ниже), а не ответ на вопрос
    if (liked.has(hero.appid)) return
    setLiked(new Set(liked).add(hero.appid))
    // В очереди записей игры (lib/unlike): снятие не обгонит вставку и снимет лишь её строку
    void sendLike('daily', hero.appid, { ctx: ctxOf(hero, intent) })
  }

  /*
   * «Не зацепило?» — только про героя на экране (dueLaunchFor) и только у
   * сессии, которой есть куда записать ответ: как на /play, читателю по
   * ссылке не спрашиваем вовсе.
   */
  const stopDue = readOnly ? null : dueLaunchFor(dueLaunch, hero.appid)

  return (
    <div className="flex-1 flex flex-col">
      {/* «Не зацепило «X»?» — игру дня запустили отсюда и вернулись спустя
          десять минут (lib/launchmemo.ts). «Дай другую» — та же notToday(),
          что у «Не сегодня»: откладывает героя и подбирает другого */}
      <StopAsk
        game={stopDue}
        reasons={STOP_REASONS[locale]}
        hint={tr(locale, {
          ru: 'Так бывает. Отложим её и подберём другую на сегодня.',
          en: "It happens. We'll set it aside and find another one for today.",
        })}
        // Плашка исчезает вместе с нажатой кнопкой, и фокус без присмотра
        // упал бы в body — отдаём его герою, как после любого ответа
        onReason={() => {
          focusHero()
          void notToday('ask')
        }}
        onHooked={() => {
          like('ask')
          focusHero()
        }}
        onClose={() => {
          launchMemoStore.set(null)
          focusHero()
        }}
      />
      {/* «Как тебе?» после сыгранного по прошлому совету (lib/outcome.ts) —
          раз в сутки, общий порог с /play, и только когда «Не зацепило?»
          молчит: два вопроса разом — анкета */}
      {/* Ответ уносит плашку вместе с нажатой кнопкой — фокус берёт герой,
          как после «Не зацепило?» (герой от ответа не меняется) */}
      <OutcomeAsk paused={!!stopDue} onDone={focusHero} />
      {/* Та же строка, что на прогреве и отказе (status выше): здесь в ней
          смена героя. Узел другой — до героя страница доходит только с
          прогрева, и строка рождается пустой, раньше своего текста */}
      {status}
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
        {/* Демо называет себя и даёт дверь к своей библиотеке — вне потока,
            как на /play (см. DemoBar) */}
        {demo && <DemoBar from={lp(locale, '/daily')} overlay />}

        <div className="relative mx-auto w-full max-w-6xl px-safe pb-16 pt-40">
          <HeroPoster appid={hero.appid} name={hero.name} className="absolute bottom-16 right-5" />
          {/* max-w-xl — край, по которому .hero-scrim держит контраст */}
          <div className="max-w-xl flex flex-col gap-4">
            {/*
              На телефоне здесь остаются дата, магазин и русский — поведенческие
              подписи прячутся.

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
              Русский — по той же причине: «без русского» абзац не пересказывает,
              а знать это нужно до клика. Одной строкой без переноса внутри.

              flex-wrap — страховка: даже если подписи однажды подрастут, плашки
              встанут в столбик целиком, а не сломаются внутри себя.
            */}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {/* Пилюля делит ряд на 375 px — английская не шире русской (замер
                  на 360: «GAME OF THE DAY · OCTOBER 19» — 214 px против 167 у
                  «ИГРА ДНЯ · 19 ОКТЯБРЯ»). Поэтому «Daily» — короткое имя раздела
                  из глоссария, как в нижней панели; полное — во вкладке */}
              <span className="rounded-full bg-ember text-on-ember px-3 py-1 text-xs font-bold uppercase tracking-wide">
                {tr(locale, { ru: 'Игра дня', en: 'Daily' })} · {dateLabel}
              </span>
              {/* Источник — фирменным зелёным, как на /play */}
              <span className={`font-extrabold text-ember-text ${hero.store ? '' : 'hidden md:inline'}`}>
                {hero.store ? STORE_LABEL[hero.store] ?? hero.store : sourceBadge(hero.source, locale)}
              </span>
              {hero.hoursPlayed !== null && hero.hoursPlayed > 0 && (
                <span className="hidden tabular-nums text-dim md:inline">
                  {tr(locale, {
                    ru: `${hero.hoursPlayed} ч наиграно`,
                    en: `${fmtNumber(locale, hero.hoursPlayed)} h played`,
                  })}
                </span>
              )}
              {hero.russian && <span className="whitespace-nowrap text-dim">{hero.russian}</span>}
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
            {/* Пустая причина — только на /en у записи дня до английской
                версии (/api/daily): абзац тогда не рисуется. Русская причина
                пустой не бывает, и её абзац — как был.
                Названия в причине — данные: на /en русское название своим
                lang (withForeignRuns), как у героя /play. Называет причина
                героя и якорь «ближе всего к…» */}
            {(hero.reason || locale === 'ru') && (
              <p className="text-base md:text-lg text-ink/90 leading-relaxed">
                {withForeignRuns(locale, hero.reason, [hero.name, hero.via?.name])}
              </p>
            )}
            {/* «О чём игра» — у игры дня из магазина (lib/cards aboutLine) */}
            {hero.about && (
              <p className="-mt-2 line-clamp-3 text-sm text-dim">
                <span className="font-bold text-ink">{tr(locale, { ru: 'О чём: ', en: 'About: ' })}</span>
                {hero.about}
              </p>
            )}

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
                    ? tr(locale, {
                        ru: `Открыть в ${STORE_LABEL[hero.store] ?? 'магазине'}`,
                        en: STORE_LABEL[hero.store] ? `Open in ${STORE_LABEL[hero.store]}` : 'Open store page',
                      })
                    : tr(locale, { ru: 'Смотреть в Steam', en: 'View on Steam' })}
                </a>
              ) : (
                <SteamLaunch
                  appid={hero.appid}
                  // Запуск — не «Зашло»: как и на /play, он же заводит исход
                  // совета, который сверят со следующим снапшотом. Под пальцем
                  // это магазин, а не запуск: план на вечер он не закрывает
                  // (lib/eveningplan.ts) — на телефоне его жмут как раз после
                  // «Сыграю вечером на ПК», ставить игру на загрузку
                  onClick={(via) =>
                    void sendFeedback(
                      hero.appid,
                      'launched',
                      undefined,
                      ctxOf(hero, via === 'store' ? 'store' : 'launch'),
                    )
                  }
                  // Засекаем только настоящий запуск: через десять минут
                  // вернувшегося спросим, зацепило ли (см. StopAsk выше)
                  onLaunch={() => rememberLaunch(hero.appid, hero.name, Math.floor(Date.now() / 1000))}
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
                  {rerolling
                    ? tr(locale, { ru: 'Подбираю другую…', en: 'Finding another…' })
                    : tr(locale, { ru: 'Не сегодня', en: 'Not today' })}
                </button>
              )}
              <Link
                href={`/game/${hero.appid}`}
                onClick={() =>
                  void sendFeedback(hero.appid, 'opened', undefined, ctxOf(hero, 'details'))
                }
                title={tr(locale, { ru: 'Подробнее об игре', en: 'Game details' })}
                className="btn-circle"
              >
                <Icon name="info" size={20} />
                <span className="sr-only">{tr(locale, { ru: 'Подробнее', en: 'Details' })}</span>
              </Link>
              {/* Отзыв об игре дня: «Зашло» учит вкус, «Не сегодня» откладывает
                  и тут же предлагает другую. У сессии только для чтения их нет
                  — ниже строка о входе через Steam */}
              {!readOnly && (
                <button
                  type="button"
                  // Второе нажатие снимает «Зашло» — тем же /api/unlike, что
                  // полка /library (lib/unlike). Отказ — строкой под кнопками,
                  // той же, что у «Не сегодня», и сердце горит снова. Имя
                  // кнопки не меняется — тумблер называет aria-pressed, а
                  // обратимость видна в подсказке. Язык — в отказ: без него
                  // строка под кнопками на /en вышла бы русской (unlikeMiss)
                  onClick={() => (liked.has(hero.appid) ? void undoLike('daily', hero, setLiked, setRerollMiss, locale) : like())}
                  aria-pressed={liked.has(hero.appid)}
                  title={tr(locale, {
                    ru: liked.has(hero.appid) ? 'Зашло — нажми, чтобы снять' : 'Зашло',
                    en: liked.has(hero.appid) ? 'Liked it — tap to undo' : 'Liked it',
                  })}
                  className="btn-circle"
                >
                  <Icon name={liked.has(hero.appid) ? 'check' : 'heart'} size={20} />
                  <span className="sr-only">{tr(locale, { ru: 'Зашло', en: 'Liked it' })}</span>
                </button>
              )}
              {/* Отправить игру дня другу — /pick/<id>; пишет строку, поэтому не читателю */}
              {!readOnly && sharePick.button}
            </div>
            {readOnly && <NeedSteam from={lp(locale, '/daily')} why="launch" className="-mt-1" />}
            {!readOnly && sharePick.panel}
            {/* Отказ «Не сегодня» и снятия «Зашло» — в строке, которая стоит
                всегда: notToday и undoLike сбрасывают прежний, и новый
                приходит изменением текста — такое скринридер объявит
                (components/StatusLine) */}
            <StatusLine text={rerollMiss} className="-mt-1 text-sm text-dim" />
            {/* Своя нетронутая или заброшенная (и любая своя при скрытом
                времени) скорее всего не установлена — поставить на загрузку
                можно сейчас, к вечеру она будет готова (steam://install,
                suggestsInstall). План, а не оценка: вкус его не видит */}
            {suggestsInstall(hero.source) && !hero.storeUrl && (
              <p className="-mt-1 text-xs text-faint">
                <SteamLaunch
                  appid={hero.appid}
                  mode="install"
                  label={tr(locale, {
                    ru: 'Ещё не установлена? Поставь на загрузку заранее',
                    en: 'Not installed yet? Start the download now',
                  })}
                  onClick={() =>
                    void sendFeedback(hero.appid, 'opened', undefined, ctxOf(hero, 'install'))
                  }
                  className="tap hover:text-ink transition-colors"
                />
              </p>
            )}
            {/* Своя на телефоне — «Сыграю вечером на ПК»: игра дня, выбранная
                в дороге, вечером ждёт на компьютере (lib/eveningplan.ts) */}
            {hero.source !== 'new' && !hero.storeUrl && (
              <TonightButton
                key={hero.appid}
                name={hero.name}
                onPlan={() => sendFeedback(hero.appid, 'opened', undefined, ctxOf(hero, 'tonight'))}
              />
            )}
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
              <Link href="/quiz" className="tap link-more">
                {tr(locale, { ru: 'Хочу выбрать сам', en: "I'd rather choose" })}
                <Icon name="arrow" size={16} />
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
                    setSaid(
                      withForeignRuns(
                        locale,
                        tr(locale, { ru: `Игра дня: ${next.name}`, en: `Game of the day: ${next.name}` }),
                        [next.name],
                      ),
                    )
                  }}
                  className="tap link-more cursor-pointer"
                >
                  {ownDay
                    ? tr(locale, { ru: 'Вернуть игру дня из магазина', en: "Back to today's store pick" })
                    : tr(locale, { ru: 'Сегодня хочу из своего', en: "Today I'd rather play my own" })}
                  {!ownDay && <Icon name="arrow" size={16} />}
                </button>
              )}
            </div>

            {hero.source === 'new' && (
              <div className="flex flex-wrap items-baseline gap-3">
                <PriceTag
                  priceFinal={hero.priceFinal}
                  cc={hero.priceCc}
                  unsold={hero.unsold}
                  discount={hero.discount}
                  isFree={hero.isFree}
                  size="hero"
                />
                <DiscountEnds discount={hero.discount} />
                {/* Чья цена — рядом с ней: у KZ и СНГ-доллара она другая */}
                {hero.priceFinal !== null && !hero.isFree && !hero.unsold && (
                  <PriceWhere cc={hero.priceCc} />
                )}
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
                  ? tr(locale, {
                      ru: 'Одна игра на день. Покупать ничего не нужно.',
                      en: 'One game a day. No need to buy anything.',
                    })
                  : tr(locale, { ru: 'Одна игра на день.', en: 'One game a day.' })}
              </span>
            </p>
            {/*
              «Вчера была: …» — сразу под отсчётом до следующей: одна строка
              про соседние дни, тише всего остального в герое. Без архива,
              статусов и «вернуть»: это память, а не вторая рекомендация, и
              отзыв о ней не шлётся — героем она сегодня не была. Сервер уже
              отсеял пустое имя, повтор сегодняшней и скрытую сегодня
              (yesterdayLine, сброс в /api/feedback). Без prefetch, как
              StudioLinks на странице игры: строку видят все, а идут по ней
              редко, и полная выборка статичной /game на каждый заход — лишняя.
            */}
            {yesterday && (
              <p className="-mt-2 text-xs text-faint">
                {/* Ссылка строчная, не inline-flex: длинное название
                    переносится внутри строки, а &nbsp; держат его начало при
                    «Вчера была:» и стрелку при последнем слове */}
                {tr(locale, { ru: 'Вчера была:', en: "Yesterday's:" })}&nbsp;<Link
                  href={`/game/${yesterday.appid}`}
                  prefetch={false}
                  className="tap font-semibold text-dim transition-colors hover:text-ink"
                >
                  {yesterday.name}&nbsp;<Icon name="arrow" size={12} className="inline align-[-0.1em]" />
                </Link>
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Полка каталога живёт отдельно от героя: герой — это «во что сесть
          сегодня», а здесь про «присмотреться на будущее». Смешивать их в
          одном блоке значило бы каждый день предлагать что-то купить */}
      {discoveries.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-safe py-16">
          <div className="flex items-baseline justify-between gap-3 mb-1">
            <SectionLabel>{tr(locale, { ru: 'Нет в твоей библиотеке', en: 'Not in your library' })}</SectionLabel>
            <a
              href="https://steamdb.info/sales/"
              target="_blank"
              rel="noreferrer"
              className="tap link-more shrink-0"
            >
              {tr(locale, { ru: 'Все скидки Steam', en: 'All Steam sales' })} <Icon name="arrow" size={14} />
            </a>
          </div>
          <p className="text-xs text-faint mb-4 max-w-md">
            {tr(locale, {
              ru: 'Подобрано по твоему вкусу среди актуального. Ничего покупать не нужно — это просто на будущее.',
              en: "Picked for your taste from what's out now. No need to buy anything — it's just for later.",
            })}
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
                        cc={c.priceCc}
                        unsold={c.unsold}
                        discount={c.discount}
                        isFree={c.isFree}
                        showPercent={false}
                        className="shrink-0"
                      />
                    </>
                  }
                />
                {/* Как на полке покупок /play: перед покупкой «без русского»
                    весит не меньше цены. Не знаем — строки нет */}
                {c.russian && <span className="text-xs text-faint mt-1 block px-0.5">{c.russian}</span>}
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
