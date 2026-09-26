'use client'

import { AnimatePresence, m } from 'framer-motion'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Ambient } from '@/components/Ambient'
import { BlurBand } from '@/components/BlurBand'
import { ClickSpark } from '@/components/ClickSpark'
import { GameCardBody } from '@/components/GameCard'
import { Magnet } from '@/components/Magnet'
import { HeroShots } from '@/components/HeroShots'
import { LogoMark } from '@/components/Logo'
import { NeedSteam } from '@/components/NeedSteam'
import { useSharePick } from '@/components/SharePick'
import { OutcomeAsk } from '@/components/OutcomeAsk'
import { PlayersNow } from '@/components/PlayersNow'
import { PrivacyHelp } from '@/components/PrivacyHelp'
import { DiscountCorner, DiscountEnds, PriceTag } from '@/components/PriceTag'
import { RefundNote } from '@/components/RefundNote'
import { SpinWheel } from '@/components/SpinWheel'
import { SteamLaunch } from '@/components/SteamLaunch'
import { StopAsk } from '@/components/StopAsk'
import { WarmupScreen, type ChosenGame } from '@/components/WarmupScreen'
import { HeroTitle } from '@/components/HeroTitle'
import { HeroTrailer } from '@/components/HeroTrailer'
import { HeroPoster } from '@/components/TypeCover'
import { Icon } from '@/components/Icon'
import { freshLine, playLine } from '@/lib/announce'
import { EDGE_BADGE, EDGE_LINE } from '@/lib/badges'
import { entryLine } from '@/lib/entry'
import type { CtxIntent, CtxSlot, FeedbackCtx } from '@/lib/feedbackctx'
import type { FeedbackAction, SkipReason } from '@/lib/feedbackkinds'
import { reviewsBrief } from '@/lib/gametraits'
import { rememberMood } from '@/lib/lastmood'
import {
  dueLaunchNow,
  forgetLaunch,
  launchMemoStore,
  rememberLaunch,
  stopRuleLine,
  subscribeDueLaunch,
} from '@/lib/launchmemo'
import { createLocalStore, parseFlag } from '@/lib/localstore'
import { COZY_TAGS, NEUTRAL_MOOD, parseLean, type Lean } from '@/lib/mood'
import { NUDGE_LABEL, NUDGES, type Nudge } from '@/lib/nudge'
import { EASE } from '@/lib/motion'
import {
  BURNOUT_AFTER_SKIPS,
  FRESH_TURN,
  dealFrom,
  landingIndex,
  nextStep,
  switchLine,
  type Deal,
  type Miss,
  type PlayPick,
  type SeedRef,
} from '@/lib/playflow'
import {
  PLAY_CACHE_VERSION,
  hasFreshDeal,
  hasFreshWarm,
  playCacheKey,
  playCacheStore,
  readRecentBans,
  rememberBan,
  restoreDeal,
  warmIsFresh,
  warmMarkStore,
  whoAmI,
} from '@/lib/playcache'
import { moodCaption } from '@/lib/quiz'
import type { ContinueGame, Focus, Scope } from '@/lib/recommend'
import { SOURCE_BADGE, SOURCE_BADGE_SHORT } from '@/lib/sources'
import { STORE_LABEL } from '@/lib/stores'
import { tagRu } from '@/lib/tagsru'
import { bounceTo, reconnectHref } from '@/lib/destination'
import type { Mood } from '@/lib/types'
import { SectionLabel } from '@/components/Labels'
import { WarmStrip } from '@/components/WarmStrip'
import { track } from '@/lib/track'
import { parseWallMemo, remainingLine, runWarmup, type WarmupProgress } from '@/lib/warmup'
import { isNeedSteam, writerStore } from '@/lib/writer'
import { plural } from '@/lib/plural'
import { TagChips } from '@/components/TagChips'
import { TrailerPreview } from '@/components/TrailerPreview'

type Pick = PlayPick

/**
 * «Откладывал 3 дня назад». Сегодняшнее «не сейчас» сюда попадает, только
 * когда без него не набралась выдача, — и «0 дней назад» читалось бы сбоем.
 */
function deferredLabel(days: number): string {
  if (days < 1) return 'Откладывал сегодня'
  return `Откладывал ${days} ${plural(days, 'день', 'дня', 'дней')} назад`
}

/** Ссылка на игру в магазине: у не-Steam игр она своя, у Steam собирается */
function storeHref(p: Pick): string {
  return p.storeUrl ?? `https://store.steampowered.com/app/${p.appid}/`
}

/**
 * Причины «Не то — дальше» с подписями. Ключи — из lib/feedbackkinds.ts, где
 * их пускает роут: опечатка здесь — красный tsc, а не молча выброшенная
 * причина. Не все ключи: 'spin', 'done' и 'explore' ставят свои кнопки.
 */
const SKIP_REASONS: Array<{ key: SkipReason; label: string }> = [
  { key: 'genre', label: 'Не тот жанр' },
  { key: 'hard', label: 'Слишком сложная' },
  { key: 'tired', label: 'Надоела' },
  { key: 'notnow', label: 'Просто не сейчас' },
]

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
 * Ось состояния на самой выдаче: «хочется знакомого / нового». Два из трёх
 * значений, и это не недосмотр: «без сил» — это пресет «После работы», а
 * здесь человек уже смотрит на игру и понимает, чего ему НЕ хватило в ней —
 * узнавания или новизны. Нажатая кнопка отжимается обратно в «без оси».
 */
const LEAN_CHIPS: Array<{ key: Lean; label: string }> = [
  { key: 'familiar', label: 'знакомого' },
  { key: 'fresh', label: 'нового' },
]

/*
 * ОДНА ИГРА ПО УМОЛЧАНИЮ.
 *
 * Выдача обещает ответ человеку, который не знает, чего хочет, а показывала
 * одиннадцать вариантов сразу: героя, четыре «ещё» и до шести покупок. Это
 * снова тот самый список, от которого он пришёл сюда уйти. Теперь на экране
 * одна игра, а остальное — по нажатию: кому нужен весь список, тот раскроет
 * его в один тап.
 *
 * Раскрытие запоминается на устройстве: кто раскрыл однажды, тот из тех, кому
 * список нужен, и прятать его заново на каждой выдаче — наказывать за это.
 * Снимок сервера — «свёрнуто»: разметка до гидратации обязана совпасть.
 */
const moreStore = createLocalStore('imbored.play.more-open', parseFlag)
/** Стена экрана ожидания с прошлого прогрева (lib/warmup, WallMemo) */
const wallStore = createLocalStore('imbored.play.wall', parseWallMemo)
const shelfStore = createLocalStore('imbored.play.shelf-open', parseFlag)

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

/**
 * Сколько ждать /api/recommend. С запасом над худшим живым ответом: восемь
 * секунд модели, две с половиной на цены, чтения базы и холодный старт.
 */
const RECOMMEND_WAIT_MS = 25_000

/** Сеть, пятисотка, оборванный ответ: здесь повтор осмыслен. */
const FAIL_UNKNOWN = {
  title: 'Не получилось собрать рекомендации',
  text: 'Возможно, каталог ещё прогревается — попробуй ещё раз через минуту.',
  retry: true,
}

/**
 * Первая строка экрана ожидания. Одна на два места — начальное состояние
 * Player и фолбэк границы Suspense внизу файла: пререндер обязан показать то
 * же, с чего клиент продолжит, иначе на гидратации подпись моргнёт.
 */
const PREPARE_MESSAGE = 'Изучаю твою библиотеку…'

/**
 * «Из многих — одна»: сколько экран ожидания держится после ответа, пока
 * постер выбранной игры выходит из стены (WarmupScreen, .warmup-chosen).
 * Такт, а не пауза ради паузы: 0.8 с на выход постера и полсекунды, чтобы
 * его увидеть. При «уменьшить движение» не держим вовсе — там это была бы
 * просто задержка.
 */
const CHOSEN_MS = 1300

/**
 * Последний такт: постер наплывает на весь экран и растворяется, и из-под
 * него встаёт герой выдачи (.warmup.is-leaving). View Transitions здесь не
 * годятся: герой сам въезжает из прозрачности и размытия (HERO), и общий
 * элемент приземлялся бы в пустое место.
 */
const LEAVE_MS = 320

function Player({ say }: { say: (line: string) => void }) {
  const router = useRouter()
  const search = useSearchParams()
  const roulette = search.get('roulette') === '1'
  const focus: Focus | null = search.get('from') === 'untouched' ? 'untouched' : null
  // Дефолты — из NEUTRAL_MOOD, а не выписаны здесь: третья копия того же
  // настроения разошлась бы с квизом и «Игрой дня» при первой правке
  const mood: Mood = {
    time: (search.get('time') as Mood['time']) ?? NEUTRAL_MOOD.time,
    vibe: (search.get('vibe') as Mood['vibe']) ?? NEUTRAL_MOOD.vibe,
    social: (search.get('social') as Mood['social']) ?? NEUTRAL_MOOD.social,
  }
  /**
   * Спрашивали ли настроение вообще. Все три оси, а не любая из них: значения
   * выше подставляются дефолтами, и на прямом заходе на /play подпись экрана
   * ожидания процитировала бы человеку слова, которых он не говорил.
   */
  const askedMood = (['time', 'vibe', 'social'] as const).every((k) => search.has(k))

  const [phase, setPhase] = useState<'prepare' | 'spin' | 'reveal' | 'burnout' | 'error'>('prepare')
  /** Игра, выходящая из стены экрана ожидания; null — обычное ожидание */
  const [chosen, setChosen] = useState<ChosenGame | null>(null)
  const [leaving, setLeaving] = useState(false)
  /*
   * Сколько ждать, если выдача отказала по потолку частоты, а не по сбою.
   * Экран ошибки говорит «каталог прогревается» — для 429 это прямая неправда:
   * каталог в порядке, упёрся человек. Держим секунды из Retry-After, чтобы
   * назвать срок, а не отправить «попробуй через минуту» при окне в десять.
   */
  const [limitedFor, setLimitedFor] = useState<number | null>(null)
  /** Код отказа из тела ответа: nocandidates, nolibrary, badmood или null. */
  const [reason, setReason] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>(PREPARE_MESSAGE)
  const [prep, setPrep] = useState<WarmupProgress | null>(null)
  /** Обложка последнего ответа квиза, если человек пришёл оттуда */
  // Откуда пришла следующая игра — задаёт направление смены героя.
  const [dir, setDir] = useState<'next' | 'pick'>('next')
  /**
   * Где стоял герой до того, как стать героем, — для снимка к оценке
   * (lib/feedbackctx): 'picked' — выбран из «Ещё вариантов», 'hero' — выдача
   * начата с него или до него дошли «дальше». dir этого не различает: новая
   * выдача въезжает с той же стороны, что и выбранная карточка.
   */
  const [heroFrom, setHeroFrom] = useState<CtxSlot>('hero')
  const [picks, setPicks] = useState<Pick[]>([])
  const [discoveries, setDiscoveries] = useState<Pick[]>([])
  /** То, во что он играет сейчас (pickContinue): строка под героем, не карточка */
  const [continueGame, setContinueGame] = useState<ContinueGame | null>(null)
  const [index, setIndex] = useState(0)
  const [liked, setLiked] = useState<Set<number>>(new Set())
  const [askReason, setAskReason] = useState(false)
  const [showWhy, setShowWhy] = useState(false)
  const [skipCount, setSkipCount] = useState(0)
  const [nowSec, setNowSec] = useState(0)
  const [engine, setEngine] = useState<string>('')
  // «Любые игры» против «только моя библиотека». Живёт в состоянии, а не в
  // адресе: это переключатель уже показанной выдачи, и перезагружать ради
  // него страницу (а с ней и весь прогрев) незачем.
  const [scope, setScope] = useState<Scope>('all')
  // Ось состояния приходит адресом (пресет «После работы» кладёт туда «без
  // сил»), а дальше живёт в состоянии — как и scope: переключается на уже
  // показанной выдаче, без перезагрузки и прогрева. Мусор в адресе — «без оси».
  const [lean, setLean] = useState<Lean | null>(() => parseLean(search.get('lean')))
  /**
   * «Как «X», но…» — соседи какой игры на экране. Только из эха выдачи
   * (applyDeal): адреса у затравки нет, это шаг по уже показанной выдаче,
   * как переключатели. null — обычная выдача.
   */
  const [seed, setSeed] = useState<SeedRef | null>(null)
  /**
   * Подталкивание под героем (lib/nudge.ts), под которое собрана выдача на
   * экране, — тоже только из эха. null — обычная выдача.
   */
  const [nudge, setNudge] = useState<Nudge | null>(null)
  const [switching, setSwitching] = useState(false)
  /**
   * Почему переключатель не пересобрал выдачу (switchLine) — строкой под ним.
   * null — сказать нечего. Гаснет с любой следующей выдачей (applyDeal).
   */
  const [switchMiss, setSwitchMiss] = useState<string | null>(null)
  /** То же для «Как «X», но…» и подталкиваний — строкой у самих кнопок, под героем */
  const [heroMiss, setHeroMiss] = useState<string | null>(null)
  /*
   * ВЫДАЧА МЕЖДУ ЗАХОДАМИ (lib/playcache.ts).
   *
   * Ключ запроса снят с первого рендера и дальше не меняется — ровно как
   * настроение, с которым fetchPicks ходит за выдачей (его колбэк тоже собран
   * один раз). Иначе смена адреса без перемонтирования записала бы прежнюю
   * выдачу под ключом нового настроения.
   */
  const [cacheKey] = useState(() =>
    playCacheKey({ mood, focus, roulette, lean: parseLean(search.get('lean')) }),
  )
  /** На экране выдача с прошлого захода — рядом «Подобрать заново» */
  const [restored, setRestored] = useState(false)
  /** Номер захода за выдачей: «Подобрать заново» запускает путь первого захода снова */
  const [round, setRound] = useState(0)
  /**
   * Откуда выдача на экране: когда пришла (часы клиента), по каким серверным
   * часам и для кого. Нужна только записи на устройстве, в разметку не идёт.
   */
  const dealMeta = useRef<{ at: number; nowSec: number; viewer: string | null } | null>(null)
  const moreOpen =
    useSyncExternalStore(moreStore.subscribe, moreStore.get, moreStore.server) === true
  const wallMemo = useSyncExternalStore(wallStore.subscribe, wallStore.get, wallStore.server)
  const shelfOpen =
    useSyncExternalStore(shelfStore.subscribe, shelfStore.get, shelfStore.server) === true
  /**
   * Сессия только читает — вошла по вставленной ссылке, а не через Steam
   * (lib/writer). Выдачу она видит целиком, а сохранить ничего не может:
   * «Зашло», бан и вопрос о причине пропуска прячутся, «Не то — дальше»
   * просто листает, и вместо них одна строка NeedSteam о том, как получить
   * право. null — «не знаем»: кнопки как обычно, правду скажет первый отказ.
   */
  const readOnly =
    useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server) === false
  /**
   * Запуск с этой вкладки, про который пора спросить «не зацепило?» — от
   * десяти минут до двух часов назад (lib/launchmemo.ts). Перечитывается при
   * возвращении на вкладку; снимок сервера — «не спрашивать». Сессии только
   * для чтения не спрашиваем вовсе: ответ всё равно было бы некуда записать.
   */
  const dueLaunch = useSyncExternalStore(subscribeDueLaunch, dueLaunchNow, launchMemoStore.server)
  const stopDue = readOnly ? null : dueLaunch
  /**
   * На экране вопрос «как тебе?» после сыгранного (components/OutcomeAsk): он
   * стоит там же, где плашка прогрева, и та ждёт, пока человек не ответит.
   */
  const [outcomeShown, setOutcomeShown] = useState(false)

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

  /*
   * ФОКУС ТУДА, ГДЕ ИДЁТ ДЕЙСТВИЕ.
   *
   * Почти каждое действие выдачи убирает ту самую кнопку, которую нажали:
   * «Не то — дальше» сменяется рядом причин, причина — новым героем, карточка
   * из «Ещё вариантов» сама становится героем и уходит из списка, «Обновить
   * выдачу» пропадает вместе с плашкой. Замер клавиатурой: после каждого из
   * этих нажатий activeElement — BODY. NVDA и VoiceOver в режиме просмотра
   * теряли позицию, а следующий Tab в Safari начинался с начала документа.
   *
   * Поэтому фокус переезжает на заголовок героя — название новой игры и есть
   * результат нажатия. Эффектом это не сделать: при AnimatePresence
   * mode="wait" новый герой монтируется только после того, как доиграет уход
   * старого, а эффект срабатывает сразу, и фокусировать ещё нечего. Узел
   * забирает ref-колбэк, а флаг отличает смену по действию от первой выдачи:
   * воровать фокус у того, кто только открыл страницу, незачем. Тот же приём
   * — у шага квиза (app/quiz/page.tsx, wantStepFocus).
   *
   * Если герой не сменился (выдача из одной карточки, закрытый вопрос «не
   * зацепило?»), нового узла не будет, и фокус ставится на нынешний сразу.
   *
   * preventScroll: заголовок стоит наверху героя, и дёргать страницу к нему
   * незачем; под плавной прокруткой нативный скролл к фокусу вдобавок двигал
   * бы обёртку мимо трансформа (см. lib/skiplink.ts).
   */
  const heroEl = useRef<HTMLElement | null>(null)
  const wantHeroFocus = useRef(false)
  const heroRef = useCallback((el: HTMLElement | null) => {
    heroEl.current = el
    if (!el || !wantHeroFocus.current) return
    wantHeroFocus.current = false
    el.focus({ preventScroll: true })
  }, [])
  const focusHero = useCallback((sameHero: boolean) => {
    const el = heroEl.current
    if (sameHero && el) el.focus({ preventScroll: true })
    else wantHeroFocus.current = true
  }, [])
  /** Узел, появившийся по нажатию, сразу забирает фокус: ряд причин, экран выгорания */
  const focusOnMount = useCallback((el: HTMLElement | null) => {
    el?.focus({ preventScroll: true })
  }, [])

  /**
   * Отзыв о карточке. Отдаёт УСПЕХ, а не void, и это не косметика.
   *
   * Стояло `void fetch(...)` без .catch и без проверки res.ok. Для обучающих
   * сигналов (liked, opened, skipped, launched) молчание допустимо — их теряют
   * по одному, и человеку об этом сообщать не за чем, — но молчать надо
   * ОСОЗНАННО, как в components/SessionKeeper, а не потому что обработчик
   * забыли: непойманный отказ вдобавок падал в консоль на каждый клик.
   *
   * А для 'banned' молчание недопустимо. Докблок components/BannedShelf
   * называет бан «единственным необратимым действием» и требует показывать,
   * что именно он услышал, и уметь это отменить. При обрыве сети карточка
   * исчезала с экрана, человек считал, что высказался, а в базе бана не было —
   * и отменить нечего: полки «Скрытые» и «Пройдено» строятся из сохранённых банов, а
   * незасчитанного там нет. Вернётся завтра в подборе.
   */
  const sendFeedback = useCallback(
    (
      appid: number,
      action: FeedbackAction,
      reason?: SkipReason,
      ctx?: FeedbackCtx,
    ): Promise<boolean> => {
      // Сессия только читает — ответ известен заранее, 403 needsteam. Кнопки
      // записи у неё спрятаны, сюда доходят попутные сигналы: запуск,
      // открытие карточки, «Крутить ещё». Их незачем гонять до сервера.
      if (writerStore.get() === false) return Promise.resolve(false)
      return (
        fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            appid,
            action,
            ...(reason ? { reason } : {}),
            mood,
            ...(ctx ? { ctx } : {}),
          }),
        })
          .then(async (r) => {
            // needsteam — не сбой, а права. Страница переходит в режим чтения
            // и говорит строкой, почему, — вместо «не получилось, нажми ещё
            // раз», после которого не получится никогда.
            if (await isNeedSteam(r)) writerStore.set(false)
            return r.ok
          })
          // Промис намеренно не отклоняется: вызывающий, которому исход не
          // важен, пишет void sendFeedback(...) и не оставляет непойманного отказа.
          .catch(() => false)
      )
    },
    // mood собирается из строки запроса и в рамках страницы неизменен
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /**
   * Бан ждёт подтверждения сервера — см. докблок sendFeedback выше.
   * banFailed хранит appid, а не флаг: строка об отказе относится к той
   * карточке, на которой случилась, и не должна переехать на следующую.
   */
  const [banning, setBanning] = useState(false)
  const [banFailed, setBanFailed] = useState<number | null>(null)

  /**
   * Запрос выдачи. Отдельно от прогрева: переключение режима повторяет только
   * его. Возвращает выдачу, а не кладёт её в состояние: на экран она попадает
   * одной дверью — applyDeal ниже, — чтобы каждый путь сбрасывал одно и то же.
   *
   * Отказ — не голый null, а причина (Miss): экрану ошибки хватает limitedFor
   * и reason ниже, а переключателю на живой выдаче их не прочитать — к строке
   * после await состояние ещё не обновится.
   */
  const fetchPicks = useCallback(
    async (next: {
      scope: Scope
      lean: Lean | null
      seed?: number | null
      nudge?: Nudge | null
      /** Что уже на экране — нужно только «Что-то другое» */
      exclude?: number[]
    }): Promise<Deal | Miss> => {
      // try/catch, а не голый await: оборванная сеть на этом шаге всплывала из
      // async-функции и оставляла экран в вечном «Подбираю…» — тот же класс
      // ошибки, что был в цикле прогрева до переезда в lib/warmup.ts.
      // Возвращаем отказ, и вызывающий покажет экран ошибки.
      try {
        const res = await fetch('/api/recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mood,
            ...(focus ? { focus } : {}),
            scope: next.scope,
            ...(next.lean ? { lean: next.lean } : {}),
            ...(next.seed ? { seed: next.seed } : {}),
            ...(next.nudge ? { nudge: next.nudge } : {}),
            ...(next.exclude?.length ? { exclude: next.exclude } : {}),
          }),
          // Свой срок ожидания, а не браузерный. Сервер модель ждёт не дольше
          // восьми секунд (INTERACTIVE_CLIENT) и дальше отдаёт эвристику, так
          // что ответа дольше RECOMMEND_WAIT_MS не бывает у живого сервера —
          // зависла сеть или инстанс. Без срока экран висел в «Подбираю…»
          // столько, сколько браузер держит соединение; со сроком обрыв
          // уходит в catch ниже и показывает экран с кнопкой повтора.
          signal: AbortSignal.timeout(RECOMMEND_WAIT_MS),
        })
        if (res.status === 429) {
          const wait = Number(res.headers.get('Retry-After') ?? 0)
          const waitSec = Number.isFinite(wait) && wait > 0 ? wait : null
          setLimitedFor(waitSec)
          return { miss: 'limited', waitSec }
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
          // фоновом прогреве несколькими строками ниже. Строка запроса едет
          // с разворотом: без неё гость, прошедший квиз, после входа получал
          // выдачу по дефолтному настроению (см. destinationUrl).
          if (res.status === 401) {
            router.push(bounceTo('/play', search))
            return { miss: 'gone' }
          }
          setReason(code)
          return { miss: 'failed', code }
        }
        const deal = dealFrom(await res.json(), next.scope)
        if (!deal) return { miss: 'failed', code: null }
        /*
         * Прошлое настроение для «Подобрать» в шапке (lib/lastmood.ts) — только
         * после выдачи, которая собралась, и только сказанное им самим:
         *   — askedMood: дефолты — не его слова;
         *   — не рулетка: время там случайное, и бросок кубика — не настроение;
         *   — не «нераспакованное»: туда ведёт и кнопка с нейтральным
         *     настроением, которого он тоже не выбирал.
         * Ось — та, под которую собрана выдача, как и у кнопок выше.
         */
        if (askedMood && !roulette && !focus) {
          rememberMood(mood, deal.lean, Math.floor(Date.now() / 1000))
        }
        return deal
      } catch {
        // Причину обязательно СБРАСЫВАЕМ, а не оставляем как есть: сюда
        // приходит оборванная сеть, и без сброса повтор после отказа
        // «кандидатов нет» показал бы ту же карточку с тем же советом, хотя
        // на этот раз не доехал запрос.
        setReason(null)
        return { miss: 'failed', code: null }
      }
    },
    // mood, focus, askedMood и roulette собираются из строки запроса и в рамках
    // страницы неизменны
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  /**
   * НОВАЯ ВЫДАЧА — ОДНОЙ ДВЕРЬЮ.
   *
   * Её приносят четыре пути: первая выдача после прогрева, «Попробовать снова»,
   * переключатели источника и оси, «Обновить выдачу» после догрева. Каждый
   * раньше сбрасывал своё: переключатель — шесть полей, «Обновить выдачу» —
   * один индекс, и новая пятёрка приезжала с открытым «Почему не то?» и со
   * счётчиком пропусков прошлой (см. докблок lib/playflow.ts). Теперь все четыре
   * зовут эту функцию, и состояние вокруг героя одно — FRESH_TURN.
   *
   * Фазу и объявление ставит вызывающий: у первой выдачи рулетка крутит
   * барабан, у переключателя фокус остаётся на нажатой кнопке. Отдаёт индекс
   * героя — вызывающему он нужен сразу, а состояние обновится к рендеру.
   *
   * Пятая дверь — выдача с прошлого захода (back): та же функция, только герой,
   * время и «Зашло» — сохранённые, а не новые.
   */
  const applyDeal = useCallback(
    (deal: Deal, back?: { index: number; at: number; liked: number[] }): number => {
      const hero = back ? back.index : landingIndex(deal.picks.length, roulette)
      const at = back ? back.at : Date.now()
      dealMeta.current = { at, nowSec: deal.nowSec, viewer: deal.viewer }
      setPicks(deal.picks)
      setDiscoveries(deal.discoveries)
      setContinueGame(deal.continueGame)
      setEngine(deal.engine)
      setScope(deal.scope)
      setLean(deal.lean)
      setSeed(deal.seed)
      setNudge(deal.nudge)
      // Серверные часы — по ним подпись онлайна решает, имеет ли право
      // сказать «сейчас». См. докблок в components/PlayersNow. У выдачи с
      // прошлого захода они ушли вперёд на столько, сколько она пролежала.
      setNowSec(deal.nowSec + Math.max(0, Math.floor((Date.now() - at) / 1000)))
      setIndex(hero)
      setHeroFrom('hero')
      setDir(FRESH_TURN.dir)
      setAskReason(FRESH_TURN.askReason)
      setShowWhy(FRESH_TURN.showWhy)
      setSkipCount(FRESH_TURN.skipCount)
      setRestored(!!back)
      if (back) setLiked(new Set(back.liked))
      // Выдача пришла — прежний отказ переключателя больше не про неё
      setSwitchMiss(null)
      setHeroMiss(null)
      return hero
    },
    [roulette],
  )

  /*
   * Выдача на экране → запись на устройстве. Эффектом, а не строкой в каждом
   * обработчике: выдачу меняют новая выдача, «дальше», выбор из «Ещё
   * вариантов», экран выгорания, бан, «Зашло» и ответ «зацепило», и восьмой
   * путь однажды забыл бы записать. Пока выдачи нет или на экране отказ —
   * писать нечего; без viewer — не к кому её привязать, и она не пишется вовсе.
   */
  useEffect(() => {
    const meta = dealMeta.current
    if (!meta?.viewer || !picks.length || phase === 'prepare' || phase === 'error') return
    playCacheStore.set({
      v: PLAY_CACHE_VERSION,
      key: cacheKey,
      viewer: meta.viewer,
      at: meta.at,
      deal: {
        picks,
        discoveries,
        continueGame,
        engine,
        lean,
        scope,
        seed,
        nudge,
        nowSec: meta.nowSec,
        viewer: meta.viewer,
      },
      hero: picks[Math.min(index, picks.length - 1)].appid,
      liked: [...liked],
    })
  }, [phase, picks, discoveries, continueGame, engine, lean, scope, seed, nudge, index, liked, cacheKey])

  useEffect(() => {
    /*
     * Уход со страницы останавливает прогрев (lib/warmup, opts.signal).
     *
     * Раньше здесь стоял флаг «уже запущено», а цикл жил дольше страницы: после
     * «Назад» он ещё минутами ходил в /api/prepare, а новый заход на /play
     * запускал второй такой же параллельно. Отмена в cleanup заменяет флаг, а
     * не дополняет его: в разработке React монтирует эффект дважды, и с флагом
     * отменённый первый запуск оставил бы страницу без второго.
     */
    const ac = new AbortController()

    /** Выдача на экран. Один путь и для догретого каталога, и для частичного. */
    async function reveal(): Promise<boolean> {
      setProgress(
        focus ? 'Ищу то, что ты ни разу не запускал…' : 'Подбираю игру под твоё состояние…',
      )
      const got = await fetchPicks({ scope, lean })
      if ('miss' in got) {
        setPhase('error')
        return false
      }
      const at = applyDeal(got)
      // Первый показ выдачи; переборы, повторы и восстановление после «Назад»
      // идут мимо reveal() и шагом воронки не считаются
      track('pick_shown')
      /*
       * Такт «из многих — одна». Только на первом показе и не в рулетке: у
       * той свой барабан, и два выбора подряд читались бы как заминка.
       */
      const hero = got.picks[at]
      // У игры не из Steam вертикального постера нет — выходить из стены нечему
      if (!roulette && hero.appid > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        // прерванный показ мог оставить такт ухода взведённым
        setLeaving(false)
        setChosen({ appid: hero.appid, name: hero.name, art: hero.art })
        await new Promise((done) => window.setTimeout(done, CHOSEN_MS))
        if (ac.signal.aborted) return false
        setLeaving(true)
        await new Promise((done) => window.setTimeout(done, LEAVE_MS))
        if (ac.signal.aborted) return false
      }
      setChosen(null)
      setLeaving(false)
      // В рулетке между «подбираю» и выдачей появляется барабан: он и есть
      // та самая случайность, которая до сих пор происходила молча.
      setPhase(roulette ? 'spin' : 'reveal')
      // Выпавшее в рулетке называет сам барабан (SpinWheel)
      if (!roulette) say(playLine({ kind: 'reveal', name: got.picks[0].name }))
      return true
    }

    async function run() {
      /*
       * ВОЗВРАТ — БЕЗ ПРОГРЕВА И БЕЗ НОВОГО ПОДБОРА (lib/playcache.ts).
       *
       * «Подробнее» → «Назад» раньше начинало всё с нуля: экран ожидания, цикл
       * /api/prepare, новый запрос выдачи из двадцати на десять минут — и,
       * вполне возможно, другая пятёрка вместо той, что он читал. Теперь
       * выдача моложе пятнадцати минут возвращается как была, с тем же героем.
       *
       * Кто вошёл, спрашиваем только тогда, когда есть что восстановить или
       * что пропустить: первому заходу лишний круг до сервера ни к чему. Ответ
       * «не знаю» ведёт обычным путём — лишний прогрев лучше чужой выдачи.
       */
      warmAtReveal.current = 0
      const entry = playCacheStore.get()
      const mark = warmMarkStore.get()
      const viewer =
        hasFreshDeal(entry, cacheKey, Date.now()) || hasFreshWarm(mark, Date.now())
          ? await whoAmI(ac.signal)
          : null
      if (ac.signal.aborted) return
      const back = restoreDeal(entry, {
        key: cacheKey,
        viewer,
        nowMs: Date.now(),
        // Бан из соседней вкладки этой записи не видел
        banned: readRecentBans(Date.now()),
      })
      if (back) {
        applyDeal(back.deal, back)
        setPhase('reveal')
        say(playLine({ kind: 'restore', name: back.deal.picks[back.index].name }))
      }

      // Каталог разобран минуты назад: прогрев ответил бы «нечего» первым же
      // вызовом, а экран ожидания простоял бы ради этого лишний круг
      if (warmIsFresh(mark, viewer, Date.now())) {
        if (!back) await reveal()
        return
      }

      /** Разобрано всё — прогрев можно пропускать десять минут */
      const markWarm = () => {
        const who = dealMeta.current?.viewer
        if (who) warmMarkStore.set({ viewer: who, at: Date.now() })
      }

      // Промис, а не флаг: runWarmup продолжает цикл сразу после onYield и
      // вполне может завершиться раньше, чем выдача доедет. С флагом это была
      // бы гонка, а её цена — второй запрос к /api/recommend поверх первого.
      let revealing: Promise<boolean> | null = null
      // Последний известный объём работы: нужен после цикла, а состояние React
      // к этому моменту читать нельзя — оно обновится только к следующему рендеру
      let lastTotal = 0
      // Дошёл ли прогрев до нуля. 'done' этого не говорит: так же кончаются
      // и потолок по времени, и остановка, когда Steam не отдаёт метаданные
      let warmedAll = false

      const warm = await runWarmup({
        signal: ac.signal,
        onProgress: (p) => {
          lastTotal = p.total
          warmedAll = p.remaining <= 0
          setPrep(p)
          if (p.library?.wall) wallStore.set({ games: p.library.games, wall: p.library.wall })
          if (p.remaining > 0) setProgress(remainingLine(p.remaining))
        },
        onYield: (p) => {
          // Данных уже хватает на пять карточек — показываем их, а цикл пусть
          // догревает остальное под живой страницей
          warmAtReveal.current = p.total - p.remaining
          setWarming('running')
          // Выдача с прошлого захода уже на экране — догрев идёт под ней
          if (!back) revealing = reveal()
        },
      })

      // Страница ушла: ни выдачу, ни разворот на вход показывать уже некому
      if (warm === 'aborted') return

      const revealed = back !== null || (revealing ? await revealing : false)

      if (warm === 'unauthorized') {
        // Сессия отвалилась во время ФОНОВОГО догрева — карточки на экране уже
        // есть и работают. Выкидывать с них на лендинг незачем: человек упрётся
        // в это при следующем действии и там же увидит внятную причину.
        if (!revealed) router.push(bounceTo('/play', search))
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
        if (warm === 'done' && warmedAll) markWarm()
        return
      }
      if ((await reveal()) && warm === 'done' && warmedAll) markWarm()
    }

    void run()
    return () => ac.abort()
    // round — «Подобрать заново»; остальное из строки запроса и в рамках
    // страницы неизменно
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  /*
   * «Подобрать заново» у выдачи с прошлого захода: забыть её и пройти путь
   * первого захода — прогрев, если метка не свежая, и новый запрос выдачи.
   */
  const redeal = useCallback(() => {
    playCacheStore.set(null)
    dealMeta.current = null
    setRestored(false)
    setWarming('off')
    setPrep(null)
    setProgress(PREPARE_MESSAGE)
    setPhase('prepare')
    // Кнопка уходит вместе с выдачей — фокус заберёт заголовок нового героя
    focusHero(false)
    setRound((r) => r + 1)
  }, [focusHero])

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
      const got = await fetchPicks({ scope, lean })
      if ('miss' in got) return
      applyDeal(got)
      setPhase(roulette ? 'spin' : 'reveal')
      if (!roulette) say(playLine({ kind: 'reveal', name: got.picks[0].name }))
    } finally {
      setRetrying(false)
    }
  }, [retrying, fetchPicks, applyDeal, scope, lean, roulette, say])

  /*
   * Переключатели уже показанной выдачи: источник, ось состояния, затравка
   * «Как «X», но…» и подталкивания под героем. Один путь на все — тот же
   * прогрев, другой вопрос к движку, и выдача с начала. Затравка и
   * подталкивание переживают переключатели: «похожие на X, но покороче и
   * только мои» — осмысленный вопрос. Кроме «Что-то другое»: оно разовое —
   * новый срез без того, что было на экране, — и повторять его при смене
   * источника значило бы выбросить и ту выдачу, о которой спросили. from —
   * где сказать об отказе: у переключателей или у кнопок под героем.
   */
  const seedAppid = seed?.appid ?? null
  const keptNudge = nudge === 'different' ? null : nudge
  const reshape = useCallback(
    async (
      next: {
        scope: Scope
        lean: Lean | null
        seed: number | null
        nudge: Nudge | null
        exclude?: number[]
      },
      from: 'switch' | 'hero' = 'switch',
    ) => {
      // «Что-то другое» повторяется: каждое нажатие — новый срез
      const same =
        next.scope === scope &&
        next.lean === lean &&
        next.seed === seedAppid &&
        next.nudge === nudge &&
        next.nudge !== 'different'
      if (same || switching) return
      setSwitching(true)
      try {
        const got = await fetchPicks(next)
        if ('miss' in got) {
          // Выдача прежняя — и об этом надо сказать, а не просто отжать кнопку:
          // чаще всего это потолок частоты, и у него есть срок (switchLine)
          const line = switchLine(got)
          if (from === 'hero') setHeroMiss(line)
          else setSwitchMiss(line)
          return
        }
        const hero = applyDeal(got)
        // Фокус не трогаем: нажатый переключатель остаётся на месте, и
        // человек, может быть, нажмёт соседний. Сказать надо только, что
        // герой наверху сменился.
        const name = got.picks[hero].name
        say(playLine(got.seed ? { kind: 'seed', name, seed: got.seed.name } : { kind: 'reshape', name }))
      } finally {
        // finally, а не строка после await: оборванная сеть оставляла бы
        // переключатель навсегда заблокированным, и починить это можно было бы
        // только перезагрузкой страницы. Не вышло — остаёмся на прежней
        // выдаче, она на экране и никуда не делась.
        setSwitching(false)
      }
    },
    [scope, lean, seedAppid, nudge, switching, fetchPicks, applyDeal, say],
  )

  /*
   * Подталкивание под героем (lib/nudge.ts). Нажатое отжимается обратно в
   * обычную выдачу; «Что-то другое» — нет: каждое нажатие — новый срез без
   * того, что сейчас на экране. «Знакомое» — это «только моё» с наклоном к
   * заброшенному, поэтому и переключатель источника покажет «Только моё», а
   * отжатое вернёт «Любые игры».
   */
  const nudgeTo = (n: Nudge) => {
    const off = nudge === n && n !== 'different'
    void reshape(
      {
        scope: n === 'familiar' ? (off ? 'all' : 'library') : scope,
        lean,
        seed: seedAppid,
        nudge: off ? null : n,
        exclude: n === 'different' ? [...picks, ...discoveries].map((p) => p.appid) : undefined,
      },
      'hero',
    )
  }

  const advance = useCallback(
    (from: number) => {
      setAskReason(false)
      setShowWhy(false)
      setDir('next')
      const step = nextStep({ from, length: picks.length, roulette, skipCount })
      setSkipCount(step.skipCount)
      if (step.burnout) {
        setPhase('burnout')
        return
      }
      const { to } = step
      setIndex(to)
      setHeroFrom('hero')
      // «Крутить ещё» — это тоже бросок, а не просто следующая карточка.
      // Выпавшее назовёт барабан, а фокус заберёт заголовок, когда появится.
      if (roulette) {
        setPhase('spin')
        focusHero(false)
        return
      }
      say(playLine({ kind: 'next', name: picks[to].name }))
      focusHero(to === from)
    },
    [skipCount, picks, roulette, say, focusHero],
  )

  /*
   * «Продолжить» не предлагаем там, где он прямо попросил другого: в
   * «нераспакованном» и при «хочется нового». Одно правило и для строки под
   * героем, и для экрана выгорания — иначе второй предложил бы то, что первый
   * честно спрятал.
   */
  const cont = focus || lean === 'fresh' ? null : continueGame

  /**
   * Снимок выдачи к оценке (lib/feedbackctx): где стояла карточка, под что и
   * каким движком собрана выдача, части скора. Собирается в обработчике, на
   * свежем состоянии: у sendFeedback зависимости пустые, и прочитай он
   * состояние сам, видел бы первую выдачу. На экран из снимка не выводится
   * ничего — он только для отчёта (scripts/feedback-report.ts).
   */
  const ctxOf = (p: Pick | null, slot?: CtxSlot, intent?: CtxIntent): FeedbackCtx => ({
    source: 'play',
    slot,
    intent,
    ...(p ? { rank: p.rank, candidate: p.source, parts: p.parts ?? undefined } : {}),
    engine: engine === 'claude' || engine === 'heuristic' ? engine : undefined,
    variant: roulette ? 'roulette' : focus ? 'untouched' : seed ? 'seed' : undefined,
    scope,
    lean: lean ?? undefined,
    nudge: nudge ?? undefined,
  })

  /*
   * «Отправить другу» — до ранних возвратов: хук. Герой тот же, что ниже
   * (pick), просто посчитан раньше; пустой выдачи хук не боится.
   */
  const sharePick = useSharePick(picks[Math.min(index, picks.length - 1)], 'play')

  if (phase === 'prepare') {
    return (
      <WarmupScreen
        progress={prep}
        message={progress}
        caption={askedMood ? moodCaption(mood) : undefined}
        chosen={chosen}
        leaving={leaving}
        memo={wallMemo}
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
          <Link href="/quiz" className="tap link-more">
            Изменить настроение
            <Icon name="arrow" size={16} />
          </Link>
        )}

        {/* Вернуть игры из бана можно только в библиотеке, и это единственный
            выход, когда кандидатов не осталось из-за банов. */}
        {reason === 'nocandidates' && (
          <Link href="/library" className="tap link-more">
            Посмотреть библиотеку
            <Icon name="arrow" size={16} />
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


  if (phase === 'burnout') {
    /*
     * Чем ответить на «не игровой вечер» — по убыванию того, сколько сил это
     * стоит. Сначала знакомое любимое: там нечего осваивать. Потом то, во что
     * он и так играет сейчас, — сразу запуском, а не ещё одной карточкой. И
     * только потом «уютное» по тегам (COZY_TAGS из lib/mood — спокойная ось
     * движка): Casual на обложке ещё не значит, что в игру легко войти.
     */
    const familiar = picks.find((p) => p.source === 'familiar')
    const cozy =
      picks.find((p) => p.tags.some((t) => COZY_TAGS.includes(t))) ?? picks[picks.length - 1]
    // Экран выгорания уходит целиком вместе с нажатой кнопкой — фокус едет
    // на заголовок героя, когда тот смонтируется
    const showPick = (p: Pick) => {
      setSkipCount(0)
      setIndex(picks.indexOf(p))
      setHeroFrom('hero')
      setPhase('reveal')
      say(playLine({ kind: 'pick', name: p.name }))
      focusHero(false)
    }
    return (
      <div className="flex-1 flex items-center justify-center px-5 py-24">
        <div className="max-w-lg w-full panel-lift p-8 text-center flex flex-col gap-5 anim-reveal">
          <LogoMark size={48} className="mx-auto" />
          {/* Сюда приходят только нажатием («Не то — дальше» в пятый раз), и
              нажатая кнопка при этом исчезает — фокус забирает заголовок */}
          <h1 ref={focusOnMount} tabIndex={-1} className="font-display text-display-sm outline-none">
            Похоже, сегодня не игровой вечер
          </h1>
          <p className="text-dim leading-relaxed">
            Ты пролистал уже {BURNOUT_AFTER_SKIPS}{' '}
            {plural(BURNOUT_AFTER_SKIPS, 'игру', 'игры', 'игр')} — дело, скорее всего, не в играх. Это
            нормально. Можно зайти на 20 минут во что-то уютное… а можно просто закрыть Steam, и
            это тоже победа.
          </p>
          {familiar ? (
            <button onClick={() => showPick(familiar)} className="btn-ember is-block py-3">
              Ладно, покажи «{familiar.name}» — там всё знакомо
            </button>
          ) : cont ? (
            <SteamLaunch
              appid={cont.appid}
              label={`Просто продолжить «${cont.name}»`}
              mobileLabel={`Открыть «${cont.name}» в Steam`}
              onClick={() =>
                void sendFeedback(cont.appid, 'launched', undefined, ctxOf(null, 'continue', 'launch'))
              }
              className="btn-ember is-block py-3"
            />
          ) : (
            cozy && (
              <button onClick={() => showPick(cozy)} className="btn-ember is-block py-3">
                Ладно, покажи «{cozy.name}» — она спокойная
              </button>
            )
          )}
          <div className="flex justify-center gap-5 text-sm">
            <button
              onClick={() => {
                setSkipCount(0)
                setPhase('reveal')
                say(playLine({ kind: 'pick', name: picks[Math.min(index, picks.length - 1)].name }))
                focusHero(false)
              }}
              className="tap text-dim hover:text-ink transition-colors"
            >
              Всё равно листать
            </button>
            <Link href="/" className="tap text-dim hover:text-ink transition-colors">
              На сегодня всё
            </Link>
          </div>
          {/* Третий путь для вечера, когда выбирать не хочется: колода без
              вопросов и без последствий (app/explore) — посмотреть, что
              вообще есть, и, может быть, зацепиться за одну */}
          <Link href="/explore" className="tap link-more">
            Просто полистать, без обязательств
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </div>
    )
  }

  const pick = picks[Math.min(index, picks.length - 1)]
  const others = picks.filter((p) => p.appid !== pick.appid)
  /*
   * «Уже прошёл» вместо безымянного бана — у заброшенного и знакомого, то
   * есть у того, во что он уже играл. Без достижений не отличить «прошёл» от
   * «бросил», и спросить честнее, чем гадать. Это тот же бан, но с причиной
   * 'done': игра не разонравилась — она кончилась, и вкус о ней не спорит.
   */
  const finished = pick.source === 'comeback' || pick.source === 'familiar'
  /*
   * Своя игра, которую не проходил, — бан убирает её «с полки», и подпись
   * говорит прямо: бросать игры нормально. Купленное и недопройденное
   * тянет вернуться «раз уж заплачено», а это довод невозвратных затрат, не
   * вкуса. Не купленной полки нет — у неё прежняя подпись.
   */
  const owned = pick.source !== 'new'
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
  // Якорь — только если причина сама его не назвала: шаблон эвристики говорит
  // о нём словами, а Claude может выбрать другой довод. Дважды одно и то же
  // на одном экране — заполнитель, а не объяснение.
  if (pick.via && !pick.reason.includes(pick.via.name)) {
    const h = pick.via.hours
    whyParts.push(`ближе всего к «${pick.via.name}» (${h} ${plural(h, 'час', 'часа', 'часов')})`)
  }
  if (pick.signals) {
    if (pick.signals.matchPercent !== null)
      whyParts.push(`совпадение со вкусом ${pick.signals.matchPercent}%`)
    // Слова из семантики точнее тегов: «спокойная, короткие сессии» говорит,
    // ПОЧЕМУ игра под настроение, а «под вайб: Уютная» — только что тег есть
    if (pick.signals.moodWords?.length)
      whyParts.push(`под настроение: ${pick.signals.moodWords.join(', ')}`)
    else if (pick.signals.moodTags.length)
      whyParts.push(`под вайб: ${pick.signals.moodTags.map(tagRu).join(', ')}`)
  }

  /*
   * «Изменить настроение» — рядом с тем, КАКОЕ оно сейчас. Одна игра без
   * подписи выглядит ответом на вопрос, которого человек не помнит, а
   * пришедший по пресету и не видел трёх вопросов. Подпись — только если
   * настроение и правда спрашивали (askedMood): цитировать дефолты как его
   * слова нельзя.
   */
  const caption = askedMood ? moodCaption(mood) : ''
  const changeMood = (
    <div className="mt-8 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-sm">
      {caption && <span className="text-faint">{caption}</span>}
      {/* Выдача с прошлого захода вернулась сама — а кто хотел новую, берёт её
          здесь, одним нажатием и без смены настроения */}
      {restored && (
        <button
          type="button"
          onClick={redeal}
          className="tap text-dim hover:text-ink transition-colors cursor-pointer"
        >
          Подобрать заново
        </button>
      )}
      <Link href="/quiz" className="tap link-more">
        Изменить настроение
        <Icon name="arrow" size={16} />
      </Link>
      {/* Колода исследователя — для того, кому сейчас не до вопросов */}
      <Link href="/explore" className="tap link-more">
        Просто полистать
        <Icon name="arrow" size={16} />
      </Link>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col">
      {/* Вопрос после запуска важнее фоновой плашки прогрева: они стоят в одном
          месте экрана, и прогрев подождёт, пока человек не ответит */}
      <StopAsk
        game={stopDue}
        reasons={SKIP_REASONS}
        // Плашка исчезает вместе с нажатой кнопкой, и фокус без присмотра
        // упал бы в body — отдаём его герою, как после любого ответа
        onReason={(key) => {
          if (!stopDue) return
          const asked = picks.find((p) => p.appid === stopDue.appid) ?? null
          void sendFeedback(stopDue.appid, 'skipped', key, ctxOf(asked, undefined, 'ask'))
          launchMemoStore.set(null)
          // «Дадим другую» — буквально: если на экране та самая игра, листаем
          if (pick.appid === stopDue.appid) advance(index)
          else focusHero(true)
        }}
        onHooked={() => {
          if (!stopDue) return
          if (!liked.has(stopDue.appid)) {
            setLiked(new Set(liked).add(stopDue.appid))
            const asked = picks.find((p) => p.appid === stopDue.appid) ?? null
            void sendFeedback(stopDue.appid, 'liked', undefined, ctxOf(asked, undefined, 'ask'))
          }
          launchMemoStore.set(null)
          focusHero(true)
        }}
        onClose={() => {
          launchMemoStore.set(null)
          focusHero(true)
        }}
      />
      {/* «Как тебе?» после настоящей игры (lib/outcome.ts) — раз в сутки и
          только когда «Не зацепило?» молчит: два вопроса разом — анкета */}
      <OutcomeAsk paused={!!stopDue} onShown={setOutcomeShown} onDone={() => focusHero(true)} />
      <WarmStrip
        state={stopDue || outcomeShown ? 'off' : warming}
        remaining={prep?.remaining ?? 0}
        onRefresh={() => {
          setWarming('off')
          // Плашка уходит вместе с кнопкой: фокус сразу на героя, а если
          // пересчёт его сменит — на нового, когда тот смонтируется
          focusHero(true)
          const was = pick.appid
          void fetchPicks({ scope, lean, seed: seedAppid }).then((got) => {
            if ('miss' in got) return
            const now = got.picks[applyDeal(got)]
            say(playLine({ kind: 'refresh', name: now.name }))
            if (now.appid !== was) focusHero(false)
          })
        }}
        onDismiss={() => setWarming('off')}
      />
      <AnimatePresence mode="wait" custom={dir}>
        <m.section
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
            anchor={pick.via}
          />
          <HeroTrailer trailer={pick.trailer} />
          <div aria-hidden className="absolute inset-0 hero-scrim" />
          {/* Арт остаётся ярким и просто уходит в мягкость под текстом —
              жёсткий градиент-стоп гасил его целиком, оставляя резким.
              tint включён: базовый скрим настроен под тёмный ключ-арт, а сюда
              попадает любая игра из библиотеки, в том числе светлая. */}
          <BlurBand height="46vh" dir="up" />
          <div aria-hidden className="grain" />

          <m.div
            variants={LADDER}
            initial="hidden"
            animate="show"
            className="relative mx-auto w-full max-w-6xl px-safe pb-12 pt-40"
          >
            <HeroPoster appid={pick.appid} name={pick.name} className="absolute bottom-12 right-5" />
            {/* max-w-xl — не вкус: по этому краю .hero-scrim держит свои 0.63,
                и шире колонка вышла бы из-под гарантии контраста */}
            <div className="max-w-xl flex flex-col gap-4">
              {/* flex-wrap: строка выросла на длину захода, и на 375px плашка,
                  часы, сессия и онлайн в одну линию уже не влезают.
                  Источник — фирменным зелёным, как «совпадение» у стриминга:
                  процента совпадения у выдачи нет, и выдумывать его мы не
                  будем, а «почему она здесь» — ровно то, что он заменяет. */}
              <m.div variants={STEP} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-extrabold text-ember-text">
                  {pick.store ? `${STORE_LABEL[pick.store] ?? pick.store}` : SOURCE_BADGE[pick.source]}
                </span>
                {pick.hoursPlayed !== null && pick.hoursPlayed > 0 && (
                  <span className="text-dim tabular-nums">{pick.hoursPlayed} ч наиграно</span>
                )}
                {/* Сколько уходит на заход — рядом с тем, сколько уже наиграно:
                    оба числа про время, и «хватит ли вечера» решается здесь */}
                {pick.session && (
                  <span className="text-dim">
                    {pick.session.label.toLowerCase()} {pick.session.value}
                  </span>
                )}
                {pick.deferred && <span className="text-dim">{deferredLabel(pick.deferred.daysAgo)}</span>}
                <PlayersNow ccu={pick.ccu} ccuAt={pick.ccuAt} nowSec={nowSec} />
              </m.div>

              <HeroTitle
                appid={pick.appid}
                name={pick.name}
                headingRef={heroRef}
                className="font-display text-display-lg"
                logoClassName="h-[clamp(96px,14vw,184px)]"
                delay={0.18}
              />

              <m.p variants={STEP} className="text-base md:text-lg text-ink/90 leading-relaxed">
                {pick.reason}
              </m.p>

              {/* Одна фраза о том, чем она лучше остальных четырёх. Причина
                  отвечает «почему она тебе», эта строка — «почему она, а не
                  соседняя»: без неё пять подходящих карточек снова выбор с нуля. */}
              {pick.edge && (
                <m.p variants={STEP} className="-mt-2 text-sm text-dim">
                  {EDGE_LINE[pick.edge]}
                </m.p>
              )}

              {/* Сколько времени уйдёт до веселья (lib/entry): вечер с бюджетом,
                  и игра на три часа обучения — другой ответ, чем «сел и
                  играешь». Строка есть, только когда отзывы или жанр это знают */}
              {pick.entry && (
                <m.p variants={STEP} className="-mt-2 text-sm text-dim">
                  {entryLine(pick.entry)}
                </m.p>
              )}

              {/* «О чём игра» — у некупленной из каталога: название, теги и
                  причина не говорят, что это вообще такое (lib/cards aboutLine) */}
              {pick.about && (
                <m.p variants={STEP} className="-mt-2 line-clamp-3 text-sm text-dim">
                  <span className="font-bold text-ink">О чём: </span>
                  {pick.about}
                </m.p>
              )}

            {whyParts.length > 0 && (
              <m.div variants={STEP} className="text-sm">
                {/*
                  aria-expanded — единственный способ сказать скринридеру, что
                  блок раскрыт: до этого признаком состояния был ТОЛЬКО глиф, а
                  он вдобавок зачитывался вслух как «чёрный маленький треугольник
                  вниз». Теперь глиф чисто для глаза.
                */}
                <button
                  onClick={() => setShowWhy(!showWhy)}
                  aria-expanded={showWhy}
                  aria-controls="play-why"
                  className="tap text-dim hover:text-ink transition-colors cursor-pointer"
                >
                  Почему она? <Icon name={showWhy ? 'up' : 'down'} className="inline-block align-[-0.15em]" />
                </button>
                <AnimatePresence initial={false}>
                  {showWhy && (
                    <m.p
                      id="play-why"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22, ease: EASE }}
                      className="mt-1.5 text-dim overflow-hidden"
                    >
                      {whyParts.join(' · ')}
                    </m.p>
                  )}
                </AnimatePresence>
              </m.div>
            )}

            {pick.tags.length > 0 && (
              <m.div variants={STEP}>
                <TagChips tags={pick.tags} matched={pick.signals?.sharedTags ?? []} />
              </m.div>
            )}

            {/* Секунды геймплея — по нажатию, свёрнутые в строку: герой и так
                несёт кадры фоном, а ролик в пару мегабайт качать без спроса на
                каждой пролистанной карточке незачем (см. TrailerPreview). Секция
                героя пересоздаётся на каждую игру, так что ролик прошлой не
                доиграет под новой */}
            {pick.trailer && (
              <m.div variants={STEP} className="max-w-xl">
                <TrailerPreview trailer={pick.trailer} name={pick.name} compact />
              </m.div>
            )}

            {askReason ? (
              /* Ряд встаёт на место кнопок, которые только что нажали, —
                 фокус на первую причину, а вопрос звучит именем группы:
                 фокус на кнопке без него читался бы голым «Не тот жанр». */
              <m.div
                role="group"
                aria-labelledby="play-ask"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.22, ease: EASE }}
                className="flex flex-wrap items-center gap-2 mt-2"
              >
                <span id="play-ask" className="text-sm text-dim mr-1">
                  Почему не то?
                </span>
                {SKIP_REASONS.map((r, i) => (
                  <button
                    key={r.key}
                    ref={i === 0 ? focusOnMount : undefined}
                    onClick={() => {
                      void sendFeedback(pick.appid, 'skipped', r.key, ctxOf(pick, heroFrom))
                      // Ответил сам — «не зацепило?» про неё уже не спрашиваем
                      forgetLaunch(pick.appid)
                      advance(index)
                    }}
                    className="pill"
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  onClick={() => {
                    void sendFeedback(pick.appid, 'skipped', undefined, ctxOf(pick, heroFrom))
                    forgetLaunch(pick.appid)
                    advance(index)
                  }}
                  className="text-sm text-dim hover:text-ink p-2 transition-colors"
                >
                  пропустить
                </button>
              </m.div>
            ) : (
              <>
              {/* С md ряд в одну линию и может быть шире колонки текста: кнопки
                  несут свою подложку, и край скрима им не нужен */}
              <m.div variants={STEP} className="flex flex-wrap items-center gap-3 mt-2 md:w-max md:flex-nowrap">
                {pick.source === 'new' || pick.storeUrl ? (
                  // Игры нет в библиотеке — «Запустить» для неё кнопка-обманка:
                  // steam://run у не купленной игры не делает ничего. Ведём
                  // туда, где её действительно можно взять.
                  <a
                    href={storeHref(pick)}
                    target="_blank"
                    rel="noreferrer"
                    // Не купленную игру смотрят в магазине — это любопытство, а
                    // не запуск. Своя игра из другого магазина открывается там
                    // же, где и запускается, поэтому для неё это запуск.
                    onClick={() =>
                      void sendFeedback(
                        pick.appid,
                        pick.source === 'new' ? 'opened' : 'launched',
                        undefined,
                        ctxOf(pick, heroFrom, pick.source === 'new' ? 'store' : 'launch'),
                      )
                    }
                    className="btn-ember px-6 py-3"
                  >
                    {pick.source === 'new'
                      ? `Смотреть в ${STORE_LABEL[pick.store ?? ''] ?? 'Steam'}`
                      : `Открыть в ${STORE_LABEL[pick.store ?? ''] ?? 'магазине'}`}
                  </a>
                ) : (
                  <SteamLaunch
                    appid={pick.appid}
                    // Запуск — не «Зашло»: раньше он писался как liked, и точность
                    // подбора на /library росла от любого клика
                    onClick={() =>
                      void sendFeedback(pick.appid, 'launched', undefined, ctxOf(pick, heroFrom, 'launch'))
                    }
                    // Засекаем только настоящий запуск: через десять минут
                    // вернувшегося спросим, зацепило ли (см. StopAsk)
                    onLaunch={() => rememberLaunch(pick.appid, pick.name, Math.floor(Date.now() / 1000))}
                    icon
                    className="btn-ember px-6 py-3"
                  />
                )}
                {pick.source === 'new' && (pick.priceFinal !== null || pick.isFree) && (
                  <a
                    href={storeHref(pick)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-glass"
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
                {roulette ? (
                  // Бросок кубика заслуживает физического отклика в точке нажатия
                  <Magnet>
                    <ClickSpark>
                      <button
                        onClick={() => {
                          // Бросок кубика, а не оценка: 'spin' не трогает ни
                          // вкус, ни точность подбора
                          void sendFeedback(pick.appid, 'skipped', 'spin', ctxOf(pick, heroFrom))
                          advance(index)
                        }}
                        className="btn-glass no-lift"
                      >
                        <Icon name="refresh" size={18} />
                        Крутить ещё
                      </button>
                    </ClickSpark>
                  </Magnet>
                ) : (
                  <button
                    // Причину спрашивать не у кого записать — просто листаем
                    onClick={() => {
                      if (readOnly) {
                        advance(index)
                        return
                      }
                      setAskReason(true)
                      say(playLine({ kind: 'ask' }))
                    }}
                    className="btn-glass"
                  >
                    <Icon name="next" size={18} />
                    Не то — дальше
                  </button>
                )}
                <Link
                  href={`/game/${pick.appid}`}
                  onClick={() =>
                    void sendFeedback(pick.appid, 'opened', undefined, ctxOf(pick, heroFrom, 'details'))
                  }
                  // Кругом, как ⓘ у стриминга: подпись — для скринридера и
                  // подсказкой под курсором
                  title="Подробнее об игре"
                  className="btn-circle"
                >
                  <Icon name="info" size={20} />
                  <span className="sr-only">Подробнее</span>
                </Link>
                {!readOnly && (
                  <button
                    onClick={() => {
                      // «Зашло» после запуска — уже ответ на «не зацепило?», даже
                      // повторное: спрашивать про неё больше незачем
                      forgetLaunch(pick.appid)
                      // Повторное нажатие — не второе «зашло»: кнопка уже горит
                      if (liked.has(pick.appid)) return
                      setLiked(new Set(liked).add(pick.appid))
                      void sendFeedback(pick.appid, 'liked', undefined, ctxOf(pick, heroFrom))
                    }}
                    // Круг с сердцем, как «в мой список» у стриминга; подпись
                    // для скринридера — та же, что была текстом кнопки
                    aria-pressed={liked.has(pick.appid)}
                    title={liked.has(pick.appid) ? 'Зашло — учтём в подборе' : 'Зашло'}
                    className="btn-circle"
                  >
                    <Icon name={liked.has(pick.appid) ? 'check' : 'heart'} size={20} />
                    <span className="sr-only">Зашло</span>
                  </button>
                )}
                {/* Отправить выбор другу — /pick/<id>; пишет строку, поэтому не читателю */}
                {!readOnly && sharePick.button}
                {!readOnly && (
                  <button
                    onClick={async () => {
                      /*
                        Бан ЖДЁТ ответа сервера, в отличие от соседей.

                        Остальные кнопки убирают карточку сразу и правы: пропуск и
                        «зашло» — обучающие сигналы, их потеря стоит одного числа в
                        статистике. Бан же необратим и обязан быть записан: раньше
                        карточка исчезала мгновенно, а при обрыве сети в базе не
                        оставалось ничего — ни бана, ни следа на полке «Скрытые», откуда
                        его можно было бы отменить. Человек считал, что высказался
                        навсегда, и встречал ту же игру завтра. «Уже прошёл» — тот
                        же бан с причиной, и правило то же.

                        Ждать здесь дёшево: нажимают редко и осознанно.
                      */
                      if (banning) return
                      // Ответ про игру дан, даже если бан не дойдёт: «не
                      // зацепило?» про неё уже не спрашиваем
                      forgetLaunch(pick.appid)
                      setBanning(true)
                      setBanFailed(null)
                      const ctx = ctxOf(pick, heroFrom)
                      const ok = await sendFeedback(pick.appid, 'banned', finished ? 'done' : undefined, ctx)
                      setBanning(false)
                      if (!ok) {
                        // Отказ по правам — не «нажми ещё раз»: кнопка уже
                        // спряталась, и под ней строка о входе через Steam
                        if (writerStore.get() !== false) setBanFailed(pick.appid)
                        return
                      }
                      // Соседняя вкладка держит свою запись выдачи и про этот
                      // бан не знает — список недавних банов общий на все
                      rememberBan(pick.appid, Date.now())
                      const rest = picks.filter((p) => p.appid !== pick.appid)
                      if (!rest.length) {
                        router.push('/quiz')
                        return
                      }
                      const to = Math.min(index, rest.length - 1)
                      setPicks(rest)
                      setIndex(to)
                      setHeroFrom('hero')
                      setShowWhy(false)
                      say(
                        playLine({ kind: 'ban', name: pick.name, done: finished, next: rest[to].name }),
                      )
                      focusHero(false)
                    }}
                    disabled={banning}
                    title={
                      finished
                        ? 'Прошёл — больше не предлагать'
                        : owned
                          ? 'Убрать с полки. Бросать игры — нормально'
                          : 'Больше не показывать эту игру'
                    }
                    className={finished ? 'btn-glass disabled:opacity-60' : 'btn-circle disabled:opacity-60'}
                  >
                    {/*
                      Раньше здесь стояла голая эмодзи. Доступного имени у кнопки
                      не было вовсе (title им не является), а рядом с «Не то —
                      дальше» её смысл не читался и глазами: обе кнопки убирают
                      игру с экрана, но одна на сегодня, а другая навсегда.
                      Эмодзи спрятана от скринридера, текст объясняет разницу.
                    */}
                    {finished ? (
                      banning ? 'Отмечаю…' : 'Уже прошёл'
                    ) : (
                      <>
                        <Icon name="hide" size={20} />
                        <span className="sr-only">
                          {banning
                            ? 'Убираю навсегда…'
                            : owned
                              ? 'Убрать с полки насовсем. Бросать игры — нормально'
                              : 'Больше никогда не показывать эту игру'}
                        </span>
                      </>
                    )}
                  </button>
                )}
              </m.div>
              {/* Вместо спрятанных «Зашло» и бана — почему их нет и как вернуть */}
              {readOnly && <NeedSteam from={`/play?${search}`} why="launch" className="-mt-1" />}
              {!readOnly && sharePick.panel}
              {/*
                Отказ бана виден, потому что бан необратим. Формулировка ведёт
                к следующему шагу, а не констатирует поломку: карточка на месте,
                жест повторяется тем же нажатием.
              */}
              {banFailed === pick.appid && (
                <p role="status" className="-mt-1 text-sm text-danger">
                  {finished
                    ? 'Не получилось отметить игру пройденной — нажми ещё раз.'
                    : 'Не получилось убрать игру насовсем — нажми ещё раз.'}
                </p>
              )}
              {/* Под ценой — «а если не зайдёт»: покупка перестаёт быть ставкой.
                  Только у платного, вышедшего и из Steam — решает сервер. */}
              {pick.refund && (
                <m.div variants={STEP}>
                  <RefundNote />
                </m.div>
              )}
              {/* Правило остановки — выход, названный заранее: попробовать не
                  страшно, если известно, когда можно бросить. Только у своего
                  (не купленную не запустить, у неё выше строка про возврат) и
                  только там, где кнопка запускает: под пальцем она ведёт в
                  магазин, и двадцати минут игры там не наступает. Признак тот
                  же, что у развилки SteamLaunch, — pointer, а не ширина. */}
              {pick.source !== 'new' && (
                <m.p variants={STEP} className="hidden pointer-fine:block -mt-1 text-xs text-faint">
                  {stopRuleLine(mood.time)}
                </m.p>
              )}
              {/* План на вечер начинается с загрузки: своя нетронутая или
                  заброшенная скорее всего не установлена, и «Запустить» вечером
                  упрётся в полчаса скачивания. Ссылка ставит её на загрузку
                  сейчас (steam://install). Вкус и паузы это нажатие не видят —
                  план, а не оценка (listFeedback). */}
              {(pick.source === 'untouched' || pick.source === 'comeback') && !pick.storeUrl && (
                <m.p variants={STEP} className="-mt-1 text-xs text-faint">
                  <SteamLaunch
                    appid={pick.appid}
                    mode="install"
                    label="Ещё не установлена? Поставь на загрузку заранее"
                    onClick={() =>
                      void sendFeedback(pick.appid, 'opened', undefined, ctxOf(pick, heroFrom, 'install'))
                    }
                    className="tap hover:text-ink transition-colors"
                  />
                </m.p>
              )}
              {/*
                «Как «X», но…» — соседи этой игры (готовые из game_neighbors,
                а до их заливки — по тегу полки) под то же настроение. Шаг по
                выдаче, как переключатели ниже: без адреса и без прогрева. В
                рулетке его нет — там смысл в броске, в «нераспакованном» тоже:
                вопрос там уже задан, и соседи его не услышали бы. У выдачи из
                соседей — подпись, чьи они, и дорога обратно.
              */}
              {(seed || (!roulette && !focus && pick.tags.length > 0)) && (
                <m.div
                  variants={STEP}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
                >
                  {seed && <span className="text-faint">Похожие на «{seed.name}»</span>}
                  {!roulette && !focus && pick.tags.length > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        void reshape({ scope, lean, seed: pick.appid, nudge: keptNudge }, 'hero')
                      }
                      aria-disabled={switching}
                      title="Похожие на эту игру — под то же настроение"
                      className="tap text-dim hover:text-ink transition-colors cursor-pointer aria-disabled:opacity-50"
                    >
                      Как «{pick.name}», но…
                    </button>
                  )}
                  {seed && (
                    <button
                      type="button"
                      onClick={() => void reshape({ scope, lean, seed: null, nudge: keptNudge }, 'hero')}
                      aria-disabled={switching}
                      className="tap text-dim hover:text-ink transition-colors cursor-pointer aria-disabled:opacity-50"
                    >
                      Вернуть обычную выдачу
                    </button>
                  )}
                </m.div>
              )}
              {/*
                Подталкивания — «не то, но почти»: одним тапом та же просьба с
                поправкой (lib/nudge.ts). Там же, где «Как «X», но…», и по
                тем же правилам: не в рулетке и не в «нераспакованном» —
                вопрос там уже задан. Пилюлями, как ось состояния ниже, и с
                тем же зазором gap-3: зоны .tap соседей не перекрываются.
              */}
              {!roulette && !focus && (
                <m.div
                  variants={STEP}
                  role="group"
                  aria-label="Подправить выдачу"
                  className="flex flex-wrap items-center gap-3 text-xs"
                >
                  {NUDGES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => nudgeTo(n)}
                      aria-disabled={switching}
                      // «Что-то другое» — действие, а не переключатель: у
                      // повторяемого нажатия нет «нажатого» состояния
                      aria-pressed={n === 'different' ? undefined : nudge === n}
                      className="tap pill aria-disabled:opacity-50"
                    >
                      {NUDGE_LABEL[n]}
                    </button>
                  ))}
                </m.div>
              )}
              {heroMiss && (
                <p role="status" className="-mt-1 text-sm text-danger">
                  {heroMiss}
                </p>
              )}
              </>
            )}
            </div>
          </m.div>
        </m.section>
      </AnimatePresence>

      {/* «Продолжить» — то, во что он играет сейчас. Строкой, а не карточкой:
          это не рекомендация, и спорить с героем за место ей незачем. В
          рулетке её нет — там весь смысл в броске. */}
      {cont && !roulette && (
        <div className="mx-auto w-full max-w-6xl px-safe pt-8">
          <div className="panel-lift px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
            <span className="text-dim">
              Или продолжи <span className="font-extrabold text-ink">«{cont.name}»</span>
              {cont.recentHours > 0 && (
                <span className="tabular-nums text-faint"> · {cont.recentHours} ч за две недели</span>
              )}
            </span>
            <SteamLaunch
              appid={cont.appid}
              label="Продолжить"
              onClick={() =>
                void sendFeedback(cont.appid, 'launched', undefined, ctxOf(null, 'continue', 'launch'))
              }
              className="tap font-extrabold text-ember-text hover:underline"
            />
          </div>
        </div>
      )}

      {!roulette && (
        <section className="mx-auto w-full max-w-6xl px-safe py-10">
          {others.length > 0 && (
            // Кнопка внутри заголовка, а не вместо него: скринридер по-прежнему
            // находит раздел по h2 и тут же слышит, свёрнут он или раскрыт
            <SectionLabel>
              <button
                onClick={() => moreStore.set(!moreOpen)}
                aria-expanded={moreOpen}
                aria-controls="play-more"
                className="tap hover:text-ink transition-colors cursor-pointer text-left"
              >
                {focus
                  ? `Не то? Ещё ${others.length} ${plural(others.length, 'игра', 'игры', 'игр')} из нераспакованного`
                  : seed
                    ? `Не то? Ещё ${others.length} ${plural(others.length, 'вариант', 'варианта', 'вариантов')}, похожих на «${seed.name}»`
                    : `Не то? Ещё ${others.length} ${plural(others.length, 'вариант', 'варианта', 'вариантов')} под это настроение`}{' '}
                {/* Иконка — для глаза: состояние уже в aria-expanded */}
                <Icon name={moreOpen ? 'up' : 'down'} className="inline-block align-[-0.12em]" />
              </button>
            </SectionLabel>
          )}
          {/* Переключатель источника и подпись движка — внутри раскрытого: они
              про список, а не про одну игру. Когда списка нет вовсе (выдача
              из одной карточки), ряд стоит открыто — иначе «Любые игры» было
              бы не вернуть. */}
          {(moreOpen || others.length === 0) && (
            <div id="play-more" className="mt-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
                {/* Откуда брать главную выдачу. При фокусе «нераспакованное»
                    переключателей нет: там вопрос уже задан и ответ на него — своё. */}
                {!focus && (
                  <div className="flex flex-wrap items-center gap-3">
                    <div
                      role="group"
                      aria-label="Откуда брать игры"
                      /* gap-3, а не gap-1, и это не про воздух. Зона .tap на кнопках
                         ниже вылезает на 6 px вбок с каждой стороны; при зазоре в
                         4 px соседние зоны перекрылись бы на 8 px и воровали бы друг
                         у друга нажатия. 12 px — ровно столько, сколько зона
                         занимает, и ни пикселем больше. */
                      className="seg-group"
                    >
                      {SCOPES.map((s) => (
                        <button
                          key={s.key}
                          onClick={() =>
                            reshape({ scope: s.key, lean, seed: seedAppid, nudge: keptNudge })
                          }
                          /* aria-disabled, а не disabled: пока выдача
                             пересобирается, нажатая кнопка обязана удержать
                             фокус. disabled выбрасывал его в body на всё время
                             запроса; повтор нажатия и так гасит reshape. */
                          aria-disabled={switching}
                          // Выбранное состояние — не только цветом: скринридеру и
                          // тому, кто не различает ember на стекле, нужен признак
                          aria-pressed={scope === s.key}
                          /* py-2.5, а не py-1: замерено — переключатель выдавал
                             24 px, ровно порог WCAG 2.5.8 без единого запаса, и это
                             основной фильтр экрана выдачи. Зону наращивать нечем:
                             кнопки стоят внутри одной пилюли в 4 px друг от друга, и
                             псевдозона .tap перекрыла бы соседа. */
                          className="tap seg"
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    {/* Ось состояния — теми же пилюлями и тем же путём, что
                        источник: нажал — выдача пересобралась. Зазор gap-3 по
                        той же причине, что у соседа: зоны .tap не должны
                        перекрываться. */}
                    <div
                      role="group"
                      aria-label="Чего хочется"
                      className="seg-group"
                    >
                      <span aria-hidden className="pl-2.5 text-faint">
                        хочется
                      </span>
                      {LEAN_CHIPS.map((l) => (
                        <button
                          key={l.key}
                          onClick={() =>
                            reshape({
                              scope,
                              lean: lean === l.key ? null : l.key,
                              seed: seedAppid,
                              nudge: keptNudge,
                            })
                          }
                          aria-disabled={switching}
                          aria-pressed={lean === l.key}
                          className="tap seg"
                        >
                          {l.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <span className="text-xs font-semibold text-faint">
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
              {/* Отказ переключателя — под ним же, где смотрят после нажатия.
                  Живая область стоит всегда, а не появляется вместе с текстом:
                  такую скринридер не объявляет. Пустая — нулевой высоты. */}
              <p role="status" className="text-xs text-danger">
                {switchMiss && <span className="block -mt-2 mb-4">{switchMiss}</span>}
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-6">
                {others.map((p, i) => (
                  <m.button
                    key={p.appid}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, ease: EASE, delay: i * 0.06 }}
                    onClick={() => {
                      setDir('pick')
                      setIndex(picks.indexOf(p))
                      setHeroFrom('picked')
                      setAskReason(false)
                      setShowWhy(false)
                      // Карточка сама становится героем и уходит из списка
                      say(playLine({ kind: 'pick', name: p.name }))
                      focusHero(false)
                    }}
                    className="game-card block text-left cursor-pointer"
                  >
                    <GameCardBody
                      appid={p.appid}
                      name={p.name}
                      headerImage={p.headerImage}
                      art={p.art}
                      /* сетка тут grid-cols-2 md:grid-cols-4, то есть 50vw и 25vw;
                         стояло «33vw, 100vw» — вдвое шире нужного на телефоне */
                      sizes="(min-width: 768px) 25vw, 50vw"
                      corner={<DiscountCorner discount={p.discount} />}
                      meta={
                        <>
                          {/* Преимущество важнее источника: «откуда» видно и по
                              герою, а «чем лучше соседних» — только здесь */}
                          <span className={`truncate ${p.edge ? 'text-ember-text' : ''}`}>
                            {p.edge
                              ? EDGE_BADGE[p.edge]
                              : p.store
                                ? (STORE_LABEL[p.store] ?? p.store)
                                : SOURCE_BADGE_SHORT[p.source]}
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
                        </>
                      }
                    />
                  </m.button>
                ))}
              </div>
            </div>
          )}
          {changeMood}
        </section>
      )}

      {/* Каталог отдельным блоком: даже когда он участвует в главной выдаче,
          у покупок остаётся своя полка — с ценами и скидками на виду. Свёрнута
          по умолчанию: «во что поиграть» не должно начинаться с «что купить» */}
      {!roulette && discoveries.length > 0 && (
        <section className="mx-auto w-full max-w-6xl px-safe pb-16">
          <div className="border-t border-edge/60 pt-10">
            <div className="flex items-baseline justify-between gap-3">
              <SectionLabel>
                <button
                  onClick={() => shelfStore.set(!shelfOpen)}
                  aria-expanded={shelfOpen}
                  aria-controls="play-shelf"
                  className="tap hover:text-ink transition-colors cursor-pointer text-left"
                >
                  Нет в библиотеке · {discoveries.length}{' '}
                  <Icon name={shelfOpen ? 'up' : 'down'} className="inline-block align-[-0.12em]" />
                </button>
              </SectionLabel>
              {shelfOpen && (
                <a
                  href="https://steamdb.info/sales/"
                  target="_blank"
                  rel="noreferrer"
                  className="tap link-more shrink-0"
                >
                  Все скидки Steam <Icon name="arrow" size={14} />
                </a>
              )}
            </div>
            {shelfOpen && (
              <div id="play-shelf" className="mt-1">
                <p className="text-xs text-faint mb-4 max-w-md">
                  Подобрано по твоему вкусу среди актуального. Ничего покупать не нужно — это просто
                  на будущее.
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-6">
                  {discoveries.map((p, i) => {
                    // Отзывы — ответ на «а стоит ли покупать», поэтому только на
                    // полке покупок: у своей игры этот вопрос уже решён
                    const reviews = reviewsBrief(p.reviewsPercent, p.reviewsTotal)
                    return (
                      <m.a
                        key={p.appid}
                        href={p.storeUrl ?? `https://store.steampowered.com/app/${p.appid}/`}
                        target="_blank"
                        rel="noreferrer"
                        initial={{ opacity: 0, y: 12 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true, margin: '-40px' }}
                        transition={{ duration: 0.45, ease: EASE, delay: i * 0.05 }}
                        onClick={() =>
                          void sendFeedback(p.appid, 'opened', undefined, ctxOf(p, 'discovery', 'store'))
                        }
                        className="game-card block text-left"
                      >
                        <GameCardBody
                          appid={p.appid}
                          name={p.name}
                          headerImage={p.headerImage}
                          art={p.art}
                          sizes="(min-width: 768px) 33vw, 50vw"
                          corner={<DiscountCorner discount={p.discount} />}
                          meta={
                            <>
                              <span className="truncate">
                                {p.store ? (STORE_LABEL[p.store] ?? p.store) : 'Steam'}
                              </span>
                              <PriceTag
                                priceFinal={p.priceFinal}
                                discount={p.discount}
                                isFree={p.isFree}
                                showPercent={false}
                                className="shrink-0"
                              />
                            </>
                          }
                        />
                        <span className="block px-0.5">
                          <DiscountEnds discount={p.discount} className="mt-1 block text-xs" />
                          {reviews && (
                            <span className="text-xs text-faint mt-1 block" title={reviews.full}>
                              <span aria-hidden>{reviews.short}</span>
                              <span className="sr-only">{reviews.full}</span>
                            </span>
                          )}
                        </span>
                      </m.a>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {roulette && <div className="mx-auto w-full max-w-6xl px-safe py-8">{changeMood}</div>}
    </div>
  )
}

/*
 * Фолбэк — тот же экран ожидания, с которого Player и начинает.
 *
 * Без него граница была пустой, а useSearchParams внутри неё роняет маршрут в
 * клиентский рендер: /play отдавал в разметке шапку и подвал, и человек,
 * пришедший с квиза по прямой ссылке, смотрел в пустоту, пока не разберётся
 * весь бандл. Теперь в пререндер уходит экран ожидания.
 *
 * Сам Player на useSearch (components/useSearch) при этом НЕ переведён, и это
 * осознанно: кадр гидратации видел бы пустую строку запроса, эффект первого
 * захода успевал бы уйти за выдачей с настроением по умолчанию, а начальное
 * значение оси lean замерло бы пустым. Параметры здесь не подпись, а сам
 * запрос — поэтому они читаются уже в клиентском рендере, как и раньше.
 */
export default function PlayPage() {
  /*
   * Живая область выдачи — здесь, над границей Suspense, а не внутри Player.
   *
   * Player отдаёт на каждую фазу своё дерево (прогрев, барабан, выдача,
   * выгорание), и область внутри любого из них появлялась бы вместе со своим
   * первым текстом — а такую скринридер не объявляет. Эта же живёт с
   * первого кадра страницы, пустой, и звучит на каждой смене героя.
   */
  const [said, setSaid] = useState('')
  const say = useCallback((line: string) => setSaid((prev) => freshLine(prev, line)), [])
  return (
    <>
      <p role="status" className="sr-only">
        {said}
      </p>
      <Suspense fallback={<WarmupScreen progress={null} message={PREPARE_MESSAGE} />}>
        <Player say={say} />
      </Suspense>
    </>
  )
}
