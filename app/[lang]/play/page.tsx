'use client'

import { AnimatePresence, m } from 'framer-motion'
import Link from '@/components/Link'
import { useSearchParams } from 'next/navigation'
import { useLocaleRouter } from '@/components/useLocaleRouter'
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Ambient } from '@/components/Ambient'
import { BlurBand } from '@/components/BlurBand'
import { ClickSpark } from '@/components/ClickSpark'
import { DemoBar, useDemoSession } from '@/components/DemoBar'
import { GameCardBody } from '@/components/GameCard'
import { Magnet } from '@/components/Magnet'
import { HeroShots } from '@/components/HeroShots'
import { LogoMark } from '@/components/Logo'
import { NeedSteam } from '@/components/NeedSteam'
import { useSharePick } from '@/components/SharePick'
import { StatusLine } from '@/components/StatusLine'
import { OutcomeAsk } from '@/components/OutcomeAsk'
import { PlayersNow } from '@/components/PlayersNow'
import { PlaytimeHiddenNote, PrivacyHelp } from '@/components/PrivacyHelp'
import { DiscountCorner, DiscountEnds, PriceTag, PriceWhere } from '@/components/PriceTag'
import { RefundNote } from '@/components/RefundNote'
import { SpinWheel } from '@/components/SpinWheel'
import { SteamLaunch, type LaunchVia } from '@/components/SteamLaunch'
import { StopAsk } from '@/components/StopAsk'
import { heroTail, TonightButton, useWarmTonight } from '@/components/TonightLazy'
import { WarmupScreen, type ChosenGame } from '@/components/WarmupScreen'
import { HeroTitle } from '@/components/HeroTitle'
import { HeroTrailer } from '@/components/HeroTrailer'
import { HeroPoster } from '@/components/TypeCover'
import { Icon } from '@/components/Icon'
import { useLocale } from '@/components/LocaleProvider'
import { freshLine, liveLineOn, playLine as announce, type PlayEvent } from '@/lib/announce'
import { edgeBadge, edgeLine } from '@/lib/badges'
import { entryLine } from '@/lib/entry'
import { closesPlan, planBeside, planLine, writesPlan, type EveningPlan } from '@/lib/eveningplan'
import type { CtxIntent, CtxSlot, FeedbackCtx } from '@/lib/feedbackctx'
import type { FeedbackAction, SkipReason } from '@/lib/feedbackkinds'
import { reviewsBrief, sessionPhrase } from '@/lib/gametraits'
import { fmtNumber, lp, pl, tr, withLang, type Locale } from '@/lib/i18n'
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
import { nudgeLabel, NUDGES, type Nudge } from '@/lib/nudge'
import { EASE } from '@/lib/motion'
import {
  BURNOUT_AFTER_SKIPS,
  FRESH_TURN,
  afterBan,
  burnoutInvite,
  burnoutOffer,
  dealFrom,
  genreLine,
  landingIndex,
  nextStep,
  parseGenreRef,
  parseSeedRef,
  switchLine,
  type Deal,
  type GenreRef,
  type Miss,
  type PlayPick,
  type SeedRef,
} from '@/lib/playflow'
import {
  PLAY_CACHE_VERSION,
  hasFreshDeal,
  hasFreshWarm,
  heldPlanned,
  playCacheKey,
  playCacheStore,
  readRecentBans,
  rememberBan,
  restoreDeal,
  warmIsFresh,
  warmMarkStore,
  whoAmI,
} from '@/lib/playcache'
import { timeHiddenStore } from '@/lib/playtime'
import { parseGenreParam, parseSeedParam, quizHref, roomBridgeHref } from '@/lib/presets'
import { moodCaption } from '@/lib/quiz'
import type { ContinueGame, Focus, Scope } from '@/lib/recommend'
import { sourceBadge, sourceBadgeShort, suggestsInstall } from '@/lib/sources'
import { STORE_LABEL } from '@/lib/stores'
import { tagLabel } from '@/lib/tagsru'
import { bounceTo, reconnectHref, steamLoginFor } from '@/lib/destination'
import { isDemoId } from '@/lib/demoid'
import { focusAdrift } from '@/lib/focushandoff'
import type { Mood } from '@/lib/types'
import { SectionLabel } from '@/components/Labels'
import { WarmStrip } from '@/components/WarmStrip'
import { track, trackWait, type WaitPath } from '@/lib/track'
import { parseWallMemo, remainingLine, runWarmup, type WarmupProgress } from '@/lib/warmup'
import { CHOSEN_POSTER_WAIT_MS, chosenPoster, posterReady } from '@/lib/warmupwall'
import { isNeedSteam, writerStore } from '@/lib/writer'
import { plural } from '@/lib/plural'
import { TagChips } from '@/components/TagChips'
import { TrailerPreview } from '@/components/TrailerPreview'

type Pick = PlayPick

/**
 * «Откладывал 3 дня назад». Сегодняшнее «не сейчас» сюда попадает, только
 * когда без него не набралась выдача, — и «0 дней назад» читалось бы сбоем.
 */
function deferredLabel(days: number, locale: Locale): string {
  if (days < 1) return tr(locale, { ru: 'Откладывал сегодня', en: 'Put off today' })
  const word = pl(locale, days, { ru: ['день', 'дня', 'дней'], en: ['day', 'days'] })
  return tr(locale, { ru: `Откладывал ${days} ${word} назад`, en: `Put off ${days} ${word} ago` })
}

/** Ссылка на игру в магазине: у не-Steam игр она своя, у Steam собирается */
function storeHref(p: Pick): string {
  return p.storeUrl ?? `https://store.steampowered.com/app/${p.appid}/`
}

/**
 * Причины «Не то — дальше» с подписями. Ключи — из lib/feedbackkinds.ts, где
 * их пускает роут: опечатка здесь — красный tsc, а не молча выброшенная
 * причина. Не все ключи: 'spin', 'done' и 'explore' ставят свои кнопки.
 *
 * По языку — целым списком: подписи короткие, и пара tr у каждой весила бы
 * больше самих слов (/play у потолка bundle-budget.json).
 */
const SKIP_REASONS = {
  ru: [
    { key: 'genre', label: 'Не тот жанр' },
    { key: 'hard', label: 'Слишком сложная' },
    { key: 'tired', label: 'Надоела' },
    { key: 'notnow', label: 'Просто не сейчас' },
  ],
  en: [
    { key: 'genre', label: 'Wrong genre' },
    { key: 'hard', label: 'Too hard' },
    { key: 'tired', label: 'Tired of it' },
    { key: 'notnow', label: 'Just not now' },
  ],
} satisfies Record<Locale, Array<{ key: SkipReason; label: string }>>

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
const SCOPES = {
  ru: [
    { key: 'all', label: 'Любые игры' },
    { key: 'library', label: 'Только моё' },
  ],
  en: [
    { key: 'all', label: 'Any games' },
    { key: 'library', label: 'Only mine' },
  ],
} satisfies Record<Locale, Array<{ key: Scope; label: string }>>

/**
 * Ось состояния на самой выдаче: «хочется знакомого / нового». Два из трёх
 * значений, и это не недосмотр: «без сил» — это пресет «После работы», а
 * здесь человек уже смотрит на игру и понимает, чего ему НЕ хватило в ней —
 * узнавания или новизны. Нажатая кнопка отжимается обратно в «без оси».
 */
const LEAN_CHIPS = {
  ru: [
    { key: 'familiar', label: 'знакомого' },
    { key: 'fresh', label: 'нового' },
  ],
  // Подпись группы — «craving»: «хочется знакомого» по-английски не
  // складывается из кусков, а ряд стоит рядом с источником и не шире русского
  en: [
    { key: 'familiar', label: 'familiar' },
    { key: 'fresh', label: 'new' },
  ],
} satisfies Record<Locale, Array<{ key: Lean; label: string }>>

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
 * /api/recommend отвечает пятью разными отказами: нет сессии, не разобрать
 * настроение, нет снимка библиотеки, кандидатов не осталось и кандидаты
 * были, но все под «Не предлагать» (muted, lib/mutetags.ts). Клиент до этой
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
 * Флаг — согласие, а не отказ: retry: true ставят только там, где повтор
 * помогает (FAIL_UNKNOWN и потолок частоты), а без флага кнопки нет. Так
 * забытый флаг не нарисует повтор, обречённый на тот же 409, — и не везёт
 * в каждой строке «retry: false»: /play стоит у потолка бюджета
 * (bundle-budget.json), и девять байт на разбор там в счёт.
 *
 * `seedless` — второй выход тем же согласием: та же выдача без затравки
 * («Подобрать без «похожих»»). У отказа «в духе X», где соседей X под это
 * настроение нет (seedFail), и у «Всё под «Не предлагать»», где соседи есть,
 * но все под фильтром при любом настроении. Кнопка встаёт, только если
 * затравка и правда была: «Не предлагать» бывает и у обычной выдачи.
 *
 * `genreless` — тот же выход для жанра со страницы /games («Подобрать без
 * жанра», genreFail ниже).
 */
type FailCard = { title: string; text: string; retry?: boolean; seedless?: boolean; genreless?: boolean }

/*
 * По языку — целыми карточками, а не парой у каждой строки: разбор кода
 * («  nocandidates: {») и флаги согласия (retry, seedless) у каждой карточки
 * свои, и сторож экранов отказа (lib/failscreens.test.ts) читает их так же.
 */
const FAIL: Record<Locale, Record<string, FailCard>> = {
  ru: {
    nocandidates: {
      title: 'Подбирать не из чего',
      text: 'Под это настроение не прошла ни одна игра: часть могла уехать в бан, часть не годится под запрос. Смени настроение или верни что-нибудь из бана.',
    },
    nolibrary: {
      title: 'Библиотека не доехала',
      text: 'Steam не отдал список игр. Чаще всего его прячут настройки профиля — и это чинится за минуту.',
    },
    badmood: {
      title: 'Настроение не разобрать',
      text: 'Адрес пришёл с непонятными параметрами — собери запрос заново.',
    },
    // Кандидаты были, но все под «Не предлагать» (lib/mutetags.ts): «верни
    // из бана» тут чужой совет. Фильтр живёт на квизе — туда ведёт «Изменить
    // настроение» под текстом, а «Посмотреть библиотеку» не встаёт: банов нет.
    // «Смени настроение» здесь нет намеренно: у «Как «X», но…» соседи X под
    // фильтром при любом настроении, и выход там — «Подобрать без «похожих»».
    // Коротко — ради потолка /play (bundle-budget.json): что случилось, говорит
    // заголовок, где чинится — текст, а ссылка «Изменить настроение» под ним
    // ведёт на квиз, где фильтр и стоит
    muted: {
      title: 'Всё под «Не предлагать»',
      text: 'Фильтр — по ссылке.',
      seedless: true,
    },
  },
  en: {
    nocandidates: {
      title: 'Nothing to pick from',
      text: "No game made it through for this mood: some may be hidden for good, the rest don't fit. Change the mood or bring something back from Hidden.",
    },
    nolibrary: {
      title: "Your library didn't come through",
      text: "Steam didn't send your game list. Usually your profile's privacy settings hide it — a one-minute fix.",
    },
    badmood: {
      title: "Can't read the mood",
      text: 'The link came with odd parameters — pick your mood again.',
    },
    // Не калька «под»: по-английски игры прячет фильтр. И «по ссылке» тут
    // ничего не называет — ссылка под текстом зовётся «Change mood», её и
    // называем. Заголовок — коротким: длинный на 360 px рвал «Don't suggest»
    // переносом посередине, русский там в одну строку
    muted: {
      title: "All hidden by “Don't suggest”",
      text: 'The filter is under “Change mood” below.',
      seedless: true,
    },
  },
}

/**
 * nocandidates у выдачи «в духе X», спрошенной адресом (askSeed в Player).
 *
 * Общий текст здесь врёт дважды: «смени настроение или верни из бана» —
 * не те советы, когда человек пришёл со страницы игры за похожими на неё, а
 * соседей под это настроение просто не нашлось. Экран называет X (имя — из
 * тела отказа) и предлагает то, что поможет: подобрать без «похожих» —
 * кнопкой под текстом — или сменить настроение, сохранив затравку. Повтор
 * того же запроса вернёт тот же отказ — без retry, как у nocandidates.
 */
function seedFail(name: string | null): Record<Locale, FailCard> {
  return {
    ru: {
      title: 'Похожих не нашлось',
      text: `Под это настроение не прошла ни одна игра, похожая на ${name ? `«${name}»` : 'выбранную'}. Можно подобрать без «похожих» или сменить настроение.`,
      seedless: true,
    },
    en: {
      title: 'No similar games found',
      text: `No game like ${name ? `“${name}”` : 'that one'} fits this mood. Try regular picks or change the mood.`,
      seedless: true,
    },
  }
}

/**
 * nocandidates у выдачи по жанру со страницы /games (название — из тела
 * отказа, как имя затравки). Общий текст винил бы баны, а пусто чаще всего
 * от самого жанра: «с друзьями» оставляет из своих только сетевые
 * (fitsSocial), а пул магазина того же жанра — только мультиплеер, и у
 * визуальных новелл или головоломок там не остаётся ничего. Выход —
 * та же выдача без жанра (кнопкой) или другое настроение. Название уже на
 * языке страницы (hubTitle в роуте), как у seedFail — по языку целиком.
 */
function genreFail(title: string): Record<Locale, FailCard> {
  return {
    ru: {
      title: 'В этом жанре ничего не нашлось',
      text: `Под это настроение не прошла ни одна игра жанра «${title}» — ни своя, ни из магазина. Можно подобрать без жанра или сменить настроение.`,
      genreless: true,
    },
    en: {
      title: 'Nothing in this genre',
      text: `No game in the “${title}” genre fits this mood — none of yours, none from the store. Try any genre or change the mood.`,
      genreless: true,
    },
  }
}

/**
 * Отказ «Уже прошёл» — у героя и у строки «Продолжить» одними словами, но
 * со своей игрой: обе кнопки бывают на экране разом, и «не получилось
 * отметить игру» не говорило, какую. Слова — те же, что у components/MarkFinished,
 * на обоих языках.
 */
const DONE_MISS = (name: string, locale: Locale) =>
  tr(locale, {
    ru: `Не получилось отметить «${name}» пройденной — нажми ещё раз.`,
    en: `Couldn't mark “${name}” as finished — try again.`,
  })

/**
 * Сколько ждать /api/recommend. С запасом над худшим живым ответом: восемь
 * секунд модели, две с половиной на цены, чтения базы и холодный старт.
 */
const RECOMMEND_WAIT_MS = 25_000

/** Сеть, пятисотка, оборванный ответ: здесь повтор осмыслен. */
const FAIL_UNKNOWN: Record<Locale, FailCard> = {
  ru: {
    title: 'Не получилось собрать рекомендации',
    text: 'Возможно, каталог ещё прогревается — попробуй ещё раз через минуту.',
    retry: true,
  },
  en: {
    title: "Couldn't put your picks together",
    text: 'The catalog may still be warming up — try again in a minute.',
    retry: true,
  },
}

/**
 * Первая строка экрана ожидания. Одна на два места — начальное состояние
 * Player и фолбэк границы Suspense внизу файла: пререндер обязан показать то
 * же, с чего клиент продолжит, иначе на гидратации подпись моргнёт. На
 * каждом языке своя, и оба места берут её по одному языку страницы.
 */
const PREPARE_MESSAGE = {
  ru: 'Изучаю твою библиотеку…',
  en: 'Looking through your library…',
} satisfies Record<Locale, string>

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

/**
 * Строка с запуском под героем — «Продолжить» и план на вечер
 * (lib/eveningplan.ts). Одна разметка на обе: вид у них один, а /play стоит у
 * потолка бюджета (bundle-budget.json), и вторая копия классов весила бы
 * столько же, сколько сама строка. fineOnly — только там, где кнопка
 * запускает (pointer-fine, признак развилки SteamLaunch): без кнопки строка
 * плана была бы упрёком, а не дверью. onLaunch получает ветку нажатия
 * (launchIntent ниже).
 */
function LaunchRow({
  appid,
  label,
  fineOnly = false,
  onLaunch,
  children,
}: {
  appid: number
  label: string
  fineOnly?: boolean
  onLaunch: (via: LaunchVia) => void
  children: ReactNode
}) {
  return (
    <div className={`mx-auto w-full max-w-6xl px-safe pt-8${fineOnly ? ' hidden pointer-fine:block' : ''}`}>
      <div className="panel-lift px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
        <span className="text-dim">{children}</span>
        <SteamLaunch
          appid={appid}
          label={label}
          mobileLabel={fineOnly ? null : undefined}
          onClick={onLaunch}
          className="tap font-extrabold text-ember-text hover:underline"
        />
      </div>
    </div>
  )
}

/**
 * Чем было нажатие «Запустить» у своей — для снимка к оценке: steam://run —
 * запуск, «Открыть в Steam» под пальцем — переход в магазин. Оценка у обоих
 * 'launched' (исход совета заводят оба), но магазинная — не запуск, и план на
 * вечер она не закрывает: на телефоне её жмут как раз после «Сыграю вечером
 * на ПК», чтобы поставить игру на загрузку из приложения Steam
 * (lib/eveningplan.ts, closesPlan).
 */
const launchIntent = (via: LaunchVia): CtxIntent => (via === 'store' ? 'store' : 'launch')

function Player({ say }: { say: (line: string) => void }) {
  const router = useLocaleRouter()
  const locale = useLocale()
  /*
   * Строка живой области — на языке страницы. Связана здесь один раз, а не
   * вторым аргументом у каждого события: их на странице полтора десятка, и
   * забытый язык у одного молча говорил бы на /en по-русски.
   */
  const playLine = useCallback((e: PlayEvent) => announce(e, locale), [locale])
  const search = useSearchParams()
  const roulette = search.get('roulette') === '1'
  const focus: Focus | null = search.get('from') === 'untouched' ? 'untouched' : null
  /*
   * Жанр со страницы /games — адресом (/play?…&genre=roguelike, quizHref →
   * квиз → playHref). Как mood и focus, из строки запроса: едет с каждым
   * запросом выдачи, а сервер решает, применился ли он (при затравке — нет),
   * и говорит это эхом (genre ниже). В рулетке и «нераспакованном» его нет —
   * по той же причине, что затравки. Здесь — только форма адреса
   * (parseGenreParam): словарь жанров /play не везёт, название приходит с
   * эхом.
   *
   * askGenre — с адреса и для ключа выдачи (снят с первого рендера, как и
   * всё в cacheKey), а запрос читает genreAsk: «Подобрать без жанра» на
   * экране отказа (genreFail) снимает жанр насовсем, как «без «похожих»» —
   * затравку. Ref, а не состояние: fetchPicks собран один раз и иначе
   * помнил бы жанр первого рендера.
   */
  const askGenre = roulette || focus ? null : parseGenreParam(search.get('genre'))
  const genreAsk = useRef(askGenre)
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
  /**
   * Код отказа из тела ответа: nocandidates, nolibrary, badmood, muted (всё
   * под «Не предлагать», lib/mutetags.ts) или null.
   */
  const [reason, setReason] = useState<string | null>(null)
  const [progress, setProgress] = useState<string>(PREPARE_MESSAGE[locale])
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
  /** План на вечер (lib/eveningplan.ts): поставленное на загрузку — строкой с запуском */
  const [plan, setPlan] = useState<EveningPlan | null>(null)
  /**
   * Игры, отложенные на вечер в этом заходе («Поставь на загрузку», «Сыграю
   * вечером на ПК») и записанные сервером. «Не то — дальше» у такого героя —
   * шаг по выдаче, а не «передумал»: листает без вопроса о причине и без
   * пропуска, который закрыл бы план (writesPlan, closesPlan). План, уже
   * закрытый здесь же (запустил с героя), отсюда уходит: после запуска «не
   * то» — снова ответ, и причину у него спросят.
   *
   * Состояние, а не ref, — и едет с выдачей в запись на устройстве
   * (lib/playcache, planned). «Подробнее» → «Назад» и перезагрузка
   * возвращают ту же выдачу, но на новом монтировании, и ref пустел вместе
   * с прошлым: «Не то — дальше» у героя, отложенного минуту назад, снова
   * спрашивал причину, и «Просто не сейчас» закрывал план. А
   * эффект записи выдачи видит только состояние: ref, тронутый после
   * «Сыграю вечером», в запись не попадал, если следующим нажатием было ⓘ.
   * Массив, а не Set: в записи он и так массив, а игр в нём — по пальцам.
   *
   * Заход — это вкладка, а не настроение. «Изменить настроение» → квиз →
   * /play — новое монтирование под другим ключом, и выдачу не вернуть, но
   * отложенные того же человека едут в новую выдачу (heldOver ниже), пока
   * заход жив — час с последнего показа выдачи, сколько бы ни было ей
   * самой (seenAt в lib/playcache). И наоборот: план, закрытый не здесь, —
   * запуском со страницы игры, из «Твоих вечеров», с «Игры дня», — из
   * записи вычёркивает lib/planforget, и «не то» у такой игры снова спросят.
   */
  const [planned, setPlanned] = useState<number[]>([])
  /**
   * Отложенные из записи, которую не вернули (heldPlanned в lib/playcache), —
   * ждут первую новую выдачу и сливаются в planned, если она того же
   * человека. Ref: рисовать по нему нечего, а читает его один applyDeal.
   */
  const heldOver = useRef<{ viewer: string; appids: number[] } | null>(null)
  // «Сыграю вечером на ПК» под героем — кусок прогревается заранее (TonightLazy)
  useWarmTonight()
  /** Время скрыто настройками Steam (lib/playtime.ts) — эхо сервера, строка над «Продолжить» */
  const [timeHidden, setTimeHidden] = useState(false)
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
   * (applyDeal), как и ось: кнопки и подпись обязаны говорить, подо что
   * собрана выдача на экране. Шаг по уже показанной выдаче — без адреса,
   * как переключатели. null — обычная выдача.
   */
  const [seed, setSeed] = useState<SeedRef | null>(null)
  /** Жанр, под который собрана выдача на экране, — только из эха, как seed */
  const [genre, setGenre] = useState<GenreRef | null>(null)
  /**
   * Затравка, с которой ИДТИ за выдачей, — адресом (/play?…&seed=).
   *
   * Раньше адреса у затравки не было вовсе: «хочу как Hades» было
   * невыполнимо, пока Hades сам не выпадет героем. Теперь в выдачу «в духе X»
   * ведут страница игры, «Уже прошёл» и «Твои вечера» — через квиз
   * (quizHref). Адрес — это вход, а не второй переключатель: с него уходят
   * первая выдача и «Попробовать снова», а дальше затравка живёт в эхе (seed
   * выше) и меняется кнопками под героем, как раньше. «Подобрать заново»
   * перед новым заходом ставит сюда затравку выдачи на экране (redeal) —
   * как источник и ось, она едет с тем, на что человек переключил. В рулетке
   * и «нераспакованном» её нет — по той же причине, по которой там нет кнопки
   * «Как «X», но…». null — без затравки, в том числе после «Подобрать без
   * «похожих»» на экране отказа.
   */
  const [askSeed, setAskSeed] = useState(() =>
    roulette || focus ? null : parseSeedParam(search.get('seed')),
  )
  /** Чьих соседей не нашлось — имя из тела отказа nocandidates, для экрана отказа */
  const [failSeed, setFailSeed] = useState<string | null>(null)
  /** Какого жанра не нашлось — название оттуда же: роут кладёт его, только если жанр применился */
  const [failGenre, setFailGenre] = useState<string | null>(null)
  /**
   * Подталкивание под героем (lib/nudge.ts), под которое собрана выдача на
   * экране, — тоже только из эха. null — обычная выдача.
   */
  const [nudge, setNudge] = useState<Nudge | null>(null)
  const [switching, setSwitching] = useState(false)
  /**
   * Почему переключатель не пересобрал выдачу (switchLine) — строкой под ним.
   * null — сказать нечего. Гаснет с новым нажатием (reshape) и с любой
   * следующей выдачей (applyDeal).
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
    playCacheKey({ mood, focus, roulette, lean: parseLean(search.get('lean')), seed: askSeed, genre: askGenre, locale }),
  )
  /** На экране выдача с прошлого захода — рядом «Подобрать заново» */
  const [restored, setRestored] = useState(false)
  /** Номер захода за выдачей: «Подобрать заново» запускает путь первого захода снова */
  const [round, setRound] = useState(0)
  /**
   * Тот же номер — для ответов, которые доезжают после await.
   *
   * Пересборка и «Обновить выдачу», начатые на выдаче с прошлого захода,
   * доезжали уже после «Подобрать заново» — на экран ожидания нового захода —
   * и клали туда выдачу, от которой человек только что отказался. Фазу они не
   * трогают, и экран ожидания мог так и остаться висеть (см. revealed в run).
   * Ref, а не состояние: замыканию обработчика нужен номер не на момент клика,
   * а сейчас. Растёт в redeal синхронно, до любого рендера, и round берёт
   * значение у него — разойтись им негде.
   */
  const roundNow = useRef(0)
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
  /** Демо-личность: над героем полоса «это чужая демо-библиотека» (DemoBar) */
  const demo = useDemoSession()
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
  /*
   * То же разовое «забери фокус» — для строки «Продолжить» после «Уже
   * прошёл» (contFocus ниже). Объявлено здесь, а не рядом: любое действие,
   * которое отдаёт фокус герою, отменяет и его — иначе отметка, доехавшая в
   * пятый пропуск, отняла бы фокус у героя, вернувшегося с экрана выгорания.
   */
  const wantContFocus = useRef(false)
  const heroRef = useCallback((el: HTMLElement | null) => {
    heroEl.current = el
    if (!el || !wantHeroFocus.current) return
    wantHeroFocus.current = false
    el.focus({ preventScroll: true })
  }, [])
  const focusHero = useCallback((sameHero: boolean) => {
    wantContFocus.current = false
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
            // Оценка, закрывшая план на вечер на сервере, закрывает и строку
            // плана (closesPlan — то же правило, что у latestEveningPlan):
            // иначе она висела бы до новой выдачи и переживала бы уход в
            // записи выдачи (lib/playcache). Только записанная — незаписанная
            // план не закрыла. Функцией, а не по plan: замыкание у
            // sendFeedback — от первого рендера
            if (r.ok && closesPlan(action, reason, ctx?.intent)) {
              setPlan((p) => (p?.appid === appid ? null : p))
              setPlanned((a) => (a.includes(appid) ? a.filter((x) => x !== appid) : a))
            }
            if (r.ok && writesPlan(action, ctx?.intent)) setPlanned((a) => (a.includes(appid) ? a : [...a, appid]))
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
   * «Зашло» — в очереди записей игры (sendLike в lib/unlike): снятие тем же
   * сердцем через полсекунды не обгонит эту вставку на сервере, а новое
   * «Зашло» сразу после снятия — запоздалый DELETE. Там же запоминается
   * строка, которую оно легло: снятие у героя удаляет только её, а не
   * прежние «зашло» игры, которых сердце не показывало. Едет ленивым куском
   * героя (heroTail, components/HeroTail): /play у потолка бюджета. Не
   * пришёл кусок — оценка уходит сразу, как до очереди: учебный сигнал не
   * теряется из-за куска, который нужен только для отмены.
   */
  const sendLike = (appid: number, ctx: FeedbackCtx) => {
    const send = () => sendFeedback(appid, 'liked', undefined, ctx)
    void heroTail().then((t) => t.sendLike('play', appid, { mood, ctx }), send)
  }

  /**
   * Бан ждёт подтверждения сервера — см. докблок sendFeedback выше.
   * banFailed хранит appid, а не флаг: строка об отказе относится к той
   * карточке, на которой случилась, и не должна переехать на следующую.
   */
  const [banning, setBanning] = useState(false)
  const [banFailed, setBanFailed] = useState<number | null>(null)
  /**
   * Выдача, какой она стоит на экране сейчас, — для бана, который применяет
   * результат после await. Экран на время запроса не заперт (lib/playflow,
   * afterBan), и замыкание клика к ответу сервера видит пятёрку и героя,
   * которых уже нет. Эффектом, а не присваиванием в рендере: ref, тронутый
   * рендером, React вправе не увидеть. Фаза — там же: виден ли герой вообще.
   */
  const live = useRef({ picks, index, phase })
  useEffect(() => {
    live.current = { picks, index, phase }
  }, [picks, index, phase])

  /**
   * Запрос выдачи. Отдельно от прогрева: переключение режима повторяет только
   * его. Возвращает выдачу, а не кладёт её в состояние: на экран она попадает
   * одной дверью — applyDeal ниже, — чтобы каждый путь сбрасывал одно и то же.
   *
   * Отказ — не голый null, а причина (Miss): экрану ошибки хватает limitedFor
   * и reason ниже, а переключателю на живой выдаче их не прочитать — к строке
   * после await состояние ещё не обновится.
   *
   * signal — уход со страницы (первая выдача, run ниже). Запрос он не рвёт:
   * роут его не слушает, и место в потолке частоты уже занято, — а свой срок
   * ожидания держит AbortSignal.timeout. Он запрещает ответу, доехавшему после
   * ухода, что-либо делать: поздний 401 разворачивал бы на вход человека уже с
   * другой страницы, а поздний отказ писал бы причину в никуда.
   */
  const fetchPicks = useCallback(
    async (
      next: {
        scope: Scope
        lean: Lean | null
        seed?: number | null
        nudge?: Nudge | null
        /** Что уже на экране — нужно только «Что-то другое» */
        exclude?: number[]
      },
      signal?: AbortSignal,
    ): Promise<Deal | Miss> => {
      // try/catch, а не голый await: оборванная сеть на этом шаге всплывала из
      // async-функции и оставляла экран в вечном «Подбираю…» — тот же класс
      // ошибки, что был в цикле прогрева до переезда в lib/warmup.ts.
      // Возвращаем отказ, и вызывающий покажет экран ошибки.
      try {
        // Язык — адресом (withLang): причины, подписи и текст «Отправить
        // другу» сервер пишет на нём
        const res = await fetch(withLang('/api/recommend', locale), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mood,
            ...(focus ? { focus } : {}),
            scope: next.scope,
            ...(next.lean ? { lean: next.lean } : {}),
            ...(next.seed ? { seed: next.seed } : {}),
            ...(genreAsk.current ? { genre: genreAsk.current } : {}),
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
        if (signal?.aborted) return { miss: 'gone' }
        if (res.status === 429) {
          const wait = Number(res.headers.get('Retry-After') ?? 0)
          const waitSec = Number.isFinite(wait) && wait > 0 ? wait : null
          setLimitedFor(waitSec)
          return { miss: 'limited', waitSec }
        }
        /*
         * Прочие отказы сбрасывают потолок частоты вместе со своей причиной —
         * после последнего await, а не сразу за 429. Экран ошибки читает
         * потолок первым, и сброс до чтения тела на время повтора менял под
         * «Пробую…» «Слишком часто» на чужой отказ, а теперь ещё и объявлял бы
         * его (эффект экрана ошибки ниже). Удачной выдаче сбрасывать нечего:
         * limitedFor читает только экран ошибки, а туда без нового отказа —
         * со своими полями — не попасть.
         */
        if (!res.ok) {
          // Сессия отвалилась — экран с текстом здесь не нужен вовсе: человеку
          // нужен вход, а не объяснение. Тот же приём, что при обрыве сессии в
          // фоновом прогреве несколькими строками ниже. Строка запроса едет
          // с разворотом: без неё гость, прошедший квиз, после входа получал
          // выдачу по дефолтному настроению (см. destinationUrl).
          // replace, а не push: запись /play без сессии мертва, и «Назад» с
          // лендинга вернул бы сюда — за новым 401 и новым разворотом. Гость с
          // квиза не мог уйти «Назад» дальше /play. Так же поступает серверный
          // redirect() у хабов.
          // До чтения тела, а не после: статус уже известен, а await тела —
          // ещё одно окно, за которое человек успевал уйти, и разворот на вход
          // догонял его на чужой странице мимо проверки сигнала выше.
          // Язык лендинга ставит сам роутер (useLocaleRouter): '/?next=…'
          // на /en уходит на '/en?next=…', как bounceTo('/en/play', …).
          if (res.status === 401) {
            router.replace(bounceTo('/play', search))
            return { miss: 'gone' }
          }
          /*
           * Код причины читается ИЗ ТЕЛА, а не выводится из статуса: под 409
           * живут два разных отказа — «нет снимка библиотеки» и «кандидатов не
           * осталось», — и советы у них противоположные. Там же — чьих соседей
           * не нашлось у «Как «X», но…» (seed у nocandidates, см. роут).
           */
          const d = (await res.json().catch(() => null)) as { error?: unknown; seed?: unknown; genre?: unknown } | null
          const code = d && typeof d.error === 'string' ? d.error : null
          // Ушёл, пока читалось тело, — причину писать уже некуда
          if (signal?.aborted) return { miss: 'gone' }
          setLimitedFor(null)
          setReason(code)
          setFailSeed(parseSeedRef(d?.seed)?.name ?? null)
          setFailGenre(parseGenreRef(d?.genre)?.title ?? null)
          return { miss: 'failed', code }
        }
        const body: unknown = await res.json()
        // То же для удачи: пустой ответ писал бы причину в никуда, а
        // собравшаяся выдача — прошлое настроение тому, кто её не увидел
        if (signal?.aborted) return { miss: 'gone' }
        const deal = dealFrom(body, next.scope)
        if (!deal) {
          setLimitedFor(null)
          setReason(null)
          return { miss: 'failed', code: null }
        }
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
        // на этот раз не доехал запрос. Потолок частоты — тоже: срок из
        // прошлого Retry-After к этому запросу не относится, а экран ошибки
        // читает его первым и продолжал бы говорить «Слишком часто».
        setReason(null)
        setLimitedFor(null)
        return { miss: 'failed', code: null }
      }
    },
    // mood, focus, askedMood и roulette собираются из строки запроса и в рамках
    // страницы неизменны, а жанр читается из ref (genreAsk)
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
   * время, «Зашло» и отложенные на вечер — сохранённые, а не новые. У новой
   * выдачи отложенные остаются прежними: план стоит, пока его не закрыли, и
   * герой, вернувшийся следующей пятёркой, по-прежнему отложен. Первая новая
   * выдача после монтирования добирает их и из записи другого настроения
   * (heldOver) — здесь, а не в reveal: выдачу приносит и «Попробовать снова».
   */
  const applyDeal = useCallback(
    (deal: Deal, back?: { index: number; at: number; liked: number[]; planned: number[] }): number => {
      const hero = back ? back.index : landingIndex(deal.picks.length, roulette)
      const at = back ? back.at : Date.now()
      dealMeta.current = { at, nowSec: deal.nowSec, viewer: deal.viewer }
      setPicks(deal.picks)
      setDiscoveries(deal.discoveries)
      setContinueGame(deal.continueGame)
      setPlan(deal.plan)
      setTimeHidden(deal.playtimeHidden)
      // И на устройство: /quiz и строка ожидания узнают признак до ответа
      timeHiddenStore.set(deal.playtimeHidden ? true : null)
      setEngine(deal.engine)
      setScope(deal.scope)
      setLean(deal.lean)
      setSeed(deal.seed)
      setGenre(deal.genre)
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
      if (back) {
        setLiked(new Set(back.liked))
        setPlanned(back.planned)
      } else if (heldOver.current) {
        const held = heldOver.current
        heldOver.current = null
        // Чужая запись (вход сменился) — её отложенные не про этого человека
        if (held.viewer === deal.viewer) setPlanned((a) => [...a, ...held.appids.filter((x) => !a.includes(x))])
      }
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
        genre,
        nudge,
        nowSec: meta.nowSec,
        viewer: meta.viewer,
        playtimeHidden: timeHidden,
        plan,
      },
      hero: picks[Math.min(index, picks.length - 1)].appid,
      liked: [...liked],
      planned,
      // Выдача на экране сейчас — заход жив, и отложенным отсчёт с нуля
      // (heldPlanned): время выдачи (meta.at) старит цены, а не план
      seenAt: Date.now(),
    })
  }, [phase, picks, discoveries, continueGame, plan, timeHidden, engine, lean, scope, seed, genre, nudge, index, liked, planned, cacheKey])

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

    /*
     * Замер ожидания первой выдачи (pick_wait в lib/track): от захода до
     * карточки, и каким путём к ней пришёл каталог. performance.now, а не
     * Date.now: длительность не должна прыгать вместе с часами устройства.
     */
    const waitFrom = performance.now()
    let waitPath: WaitPath = 'cold'

    /** Выдача на экран. Один путь и для догретого каталога, и для частичного. */
    async function reveal(): Promise<boolean> {
      // При скрытом времени нетронутого не узнать — сервер отдаст всё своё, и
      // «ни разу не запускал» было бы обещанием, которого выдача не сдержит
      setProgress(
        !focus
          ? tr(locale, { ru: 'Подбираю игру под твоё состояние…', en: 'Finding a game for your mood…' })
          : timeHiddenStore.fresh()
            ? tr(locale, { ru: 'Ищу в твоей библиотеке…', en: 'Searching your library…' })
            : tr(locale, { ru: 'Ищу то, что ты ни разу не запускал…', en: "Looking for what you've never launched…" }),
      )
      /*
       * Ушёл со страницы, пока модель думала, — ответ всё равно доезжает:
       * fetchPicks слушает только свой срок. Проверка сразу за await, до
       * applyDeal и счётчиков: pick_shown и долгий pick_wait тому, кто карточки
       * не увидел, рисовали бы брошенное ожидание удачным — а ровно брошенное
       * pick_wait и должен показывать.
       */
      const got = await fetchPicks({ scope, lean, seed: askSeed }, ac.signal)
      if (ac.signal.aborted) return false
      if ('miss' in got) {
        // 401 уже разворачивает на вход: экран «не получилось» по дороге не нужен
        if (got.miss !== 'gone') setPhase('error')
        return false
      }
      const at = applyDeal(got)
      // Первый показ выдачи; переборы, повторы и восстановление после «Назад»
      // идут мимо reveal() и шагом воронки не считаются
      track('pick_shown')
      // Замер — только у захода: «Подобрать заново» ждёт на уже тронутом
      // каталоге и размыл бы холодный путь. Демо — по ответу сервера, а не
      // по подсказке: чья выдача, знает он
      if (round === 0) {
        trackWait(got.viewer && isDemoId(got.viewer) ? 'demo' : waitPath, performance.now() - waitFrom)
      }
      /*
       * Такт «из многих — одна». Только на первом показе и не в рулетке: у
       * той свой барабан, и два выбора подряд читались бы как заминка.
       */
      const hero = got.picks[at]
      /*
       * Такт — только с постером, который УЖЕ здесь. Он держит экран 1.6 с
       * ради картинки, и на медленной сети шёл на пустой рамке: постер
       * просился в ту же секунду и доезжал через десяток (замер на проде —
       * запрос на 4.1 с, конец на 16.4 с), а герой выдачи всё это время
       * ждал. Не успел за CHOSEN_POSTER_WAIT_MS — такта нет, герой встаёт
       * сразу (lib/warmupwall). У игры не из Steam постера нет вовсе.
       */
      const poster = chosenPoster(hero)
      const ceremony =
        !roulette &&
        poster !== undefined &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
        (await posterReady(poster, CHOSEN_POSTER_WAIT_MS))
      // Ожидание постера — тоже await: ушедшему за эти доли секунды ни такта,
      // ни выдачи, ни реплики не положено, как и после fetchPicks выше
      if (ac.signal.aborted) return false
      if (ceremony && poster) {
        // прерванный показ мог оставить такт ухода взведённым
        setLeaving(false)
        setChosen({ appid: hero.appid, name: hero.name, art: hero.art, poster })
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
      // Из хранилища, а не из памяти вкладки: запись правят и мимо модуля
      // выдачи (lib/planforget), пока /play не смонтирована
      const entry = playCacheStore.fresh()
      const mark = warmMarkStore.get()
      const viewer =
        hasFreshDeal(entry, cacheKey, Date.now()) || hasFreshWarm(mark, Date.now())
          ? await whoAmI(ac.signal)
          : null
      if (ac.signal.aborted) return
      // Бан из соседней вкладки этой записи не видел
      const banned = readRecentBans(Date.now())
      const back = restoreDeal(entry, { key: cacheKey, viewer, nowMs: Date.now(), banned })
      // Выдачу не вернули — другое настроение, вход не узнан, выдача старше
      // пятнадцати минут, — а отложенные из той же записи ждут новую
      // (heldOver): их срок — от последнего показа, а не от прихода выдачи
      heldOver.current = back ? null : heldPlanned(entry, { nowMs: Date.now(), banned })
      if (back) {
        applyDeal(back.deal, back)
        setPhase('reveal')
        say(playLine({ kind: 'restore', name: back.deal.picks[back.index].name }))
      }

      // Каталог разобран минуты назад: прогрев ответил бы «нечего» первым же
      // вызовом, а экран ожидания простоял бы ради этого лишний круг
      if (warmIsFresh(mark, viewer, Date.now())) {
        waitPath = 'skip'
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
        // Первый круг сделал квиз (startPrewarm) — экран ожидания короче ровно
        // на него, и замер это должен различать
        onPrewarm: () => {
          waitPath = 'prewarm'
        },
        onProgress: (p) => {
          lastTotal = p.total
          warmedAll = p.remaining <= 0
          setPrep(p)
          if (p.library?.wall) wallStore.set({ games: p.library.games, wall: p.library.wall })
          // Факты прогрева — со свежего снимка: приходят раньше выдачи, и
          // строка ожидания reveal() читает признак уже по ним
          if (p.library) timeHiddenStore.set(p.library.timeHidden ? true : null)
          if (p.remaining > 0) setProgress(remainingLine(p.remaining, locale))
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

      /*
       * Выдача на экране — откуда бы она ни пришла. Не только с прошлого захода
       * и не только из onYield: первая выдача под догревом могла не собраться
       * (429, кандидатов из четверти каталога не набралось), а «Попробовать
       * снова» взяло свою, пока догрев шёл дальше. Цикл о ней не знал и
       * подменял её новой под рукой — сбрасывая «Почему не то?» и тратя ещё
       * одно место в потолке частоты. Читается после await: повтор, доехавший
       * за время догрева, тоже считается.
       *
       * dealMeta сам по себе — «applyDeal был», а не «выдача видна»: его ставит
       * любая выдача, и «Подобрать заново» его обнуляет, но ответ, доехавший
       * после этого на экран ожидания, ставил его снова, а фазу не трогал.
       * Догрев, закончившийся без onYield, принимал это за показанную выдачу и
       * выходил — и экран ожидания висел до перезагрузки, а 401 и сбой догрева
       * не разворачивали и не показывали ошибку. Такие ответы теперь
       * отбрасываются (roundNow), а здесь видна ли выдача, решает и фаза: на
       * экране ожидания её нет, что бы ни лежало в dealMeta.
       */
      const revealed =
        back !== null ||
        (revealing ? await revealing : false) ||
        (dealMeta.current !== null && live.current.phase !== 'prepare')
      // Ушёл, пока доезжала первая выдача, — разворачивать на вход уже некого
      if (ac.signal.aborted) return

      if (warm === 'unauthorized') {
        // Сессия отвалилась во время ФОНОВОГО догрева — карточки на экране уже
        // есть и работают. Выкидывать с них на лендинг незачем: человек упрётся
        // в это при следующем действии и там же увидит внятную причину.
        // replace — по той же причине, что в fetchPicks: мёртвая запись /play.
        if (!revealed) router.replace(bounceTo('/play', search))
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
      // На экране ничего: первая выдача под догревом не собралась, и висит
      // экран ошибки. Плашка «Дочитываю библиотеку» стояла бы над следующей
      // выдачей вечно — 'running' здесь больше никто не снимет, — а эта
      // собирается на каталоге, догретом до конца, и «Обновить» под ней нечего.
      setWarming('off')
      if ((await reveal()) && warm === 'done' && warmedAll) markWarm()
    }

    void run()
    return () => ac.abort()
    // round — «Подобрать заново»; остальное из строки запроса и в рамках
    // страницы неизменно. askSeed меняется на экране отказа и в самом
    // «Подобрать заново» (redeal ставит её тем же рендером, что и round), а
    // в этот путь ведёт только он — он её и перечитает
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  /*
   * «Подобрать заново» у выдачи с прошлого захода: забыть её и пройти путь
   * первого захода — прогрев, если метка не свежая, и новый запрос выдачи.
   *
   * Затравка — та, под которую собрана выдача на экране, а не та, что в
   * адресе: источник и ось новый заход и так берёт с экрана (восстановленная
   * запись их помнит, см. playCacheKey), и затравка обязана ехать с ними.
   * Иначе /play?…&seed=Hades → «Вернуть обычную выдачу» → «Подробнее» →
   * «Назад» → «Подобрать заново» возвращало «похожих на Hades», от которых
   * человек только что отказался, а затравка, выбранная на выдаче, наоборот
   * пропадала. В рулетке и «нераспакованном» её нет, как и у адреса (askSeed).
   */
  const redeal = useCallback(() => {
    playCacheStore.set(null)
    dealMeta.current = null
    setRestored(false)
    setWarming('off')
    setPrep(null)
    setProgress(PREPARE_MESSAGE[locale])
    // Отказ прошлой выдачи — не про эту: 429 переключателя на восстановленной
    // выдаче иначе встретил бы экраном «Слишком часто» сбой прогрева нового захода
    setLimitedFor(null)
    setReason(null)
    setPhase('prepare')
    // Тем же рендером, что и round: эффект первого захода прочтёт уже её
    setAskSeed(roulette || focus ? null : (seed?.appid ?? null))
    // Кнопка уходит вместе с выдачей — фокус заберёт заголовок нового героя
    focusHero(false)
    roundNow.current += 1
    setRound(roundNow.current)
  }, [focusHero, seed, roulette, focus, locale])

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
   * некуда. Поэтому никакого setPhase в ветке !got. Но молчать ей нельзя:
   * кнопка всего лишь вернула себе прежнюю подпись, а смену имени кнопки в
   * фокусе скринридер не объявляет. Говорит экран ошибки (failTick ниже).
   */
  const [retrying, setRetrying] = useState(false)
  /**
   * Сколько повторов не сменили экран ошибки. Тот же отказ — тот же текст, и
   * объявление экрана, завязанное на текст, второй раз промолчало бы: счётчик
   * меняется на каждой неудаче, а freshLine делает строку новой.
   */
  const [failTick, setFailTick] = useState(0)
  /**
   * Неудача повтора могла убрать саму кнопку: новый отказ — «кандидатов нет»
   * или «библиотека не доехала», где повтор не предлагается. Фокус тогда в
   * body, и его забирает заголовок экрана. Только по нажатию: у того, кто
   * экран ошибки получил, ничего не нажимая, фокус не отбираем.
   */
  const wantFailFocus = useRef(false)
  /*
   * withSeed — с какой затравкой повторять. По умолчанию — с той, что
   * спрошена адресом; «Подобрать без «похожих»» на экране отказа зовёт с null
   * и снимает её насовсем: «Подобрать заново» потом её не вернёт. Снимает
   * после ответа, а не до: экран отказа читает askSeed, и на время запроса
   * он подменился бы общим текстом, а нажатая кнопка ушла бы из-под фокуса.
   *
   * genreless — «Подобрать без жанра»: снимает жанр насовсем (genreAsk).
   * Здесь — до запроса: экран отказа читает не его, а эхо отказа (failGenre),
   * и оно меняется только с новым ответом.
   */
  const retry = useCallback(async (withSeed: number | null = askSeed, genreless = false) => {
    if (retrying) return
    if (genreless) genreAsk.current = null
    setRetrying(true)
    try {
      const got = await fetchPicks({ scope, lean, seed: withSeed })
      setAskSeed(withSeed)
      if ('miss' in got) {
        // 401 — страница уже уходит на вход, говорить некому
        if (got.miss === 'gone') return
        wantFailFocus.current = true
        setFailTick((t) => t + 1)
        return
      }
      applyDeal(got)
      // Кнопка уходит вместе с экраном ошибки, и фокус без присмотра упал бы
      // в body — его заберёт заголовок нового героя (в рулетке — после барабана)
      focusHero(false)
      setPhase(roulette ? 'spin' : 'reveal')
      if (!roulette) say(playLine({ kind: 'reveal', name: got.picks[0].name }))
    } finally {
      setRetrying(false)
    }
  }, [retrying, askSeed, fetchPicks, applyDeal, scope, lean, roulette, say, playLine, focusHero])

  /*
   * Переключатели уже показанной выдачи: источник, ось состояния, затравка
   * «Как «X», но…» и подталкивания под героем. Один путь на все — тот же
   * прогрев, другой вопрос к движку, и выдача с начала. Затравка и
   * подталкивание переживают переключатели: «похожие на X, но покороче и
   * только мои» — осмысленный вопрос. Кроме «Что-то другое»: оно разовое —
   * новый срез без того, что было на экране, — и повторять его при смене
   * источника значило бы выбросить и ту выдачу, о которой спросили. from —
   * где сказать об отказе: у переключателей или у кнопок под героем.
   *
   * Отдаёт appid героя новой выдачи, null — выдача прежняя. Фокус reshape
   * не трогает, его несёт вызывающий — по тому, где стоит кнопка.
   * Переключатели источника и оси (from 'switch') живут вне секции героя и
   * остаются на месте: фокус с них уносить незачем. А всё, что зовёт с
   * 'hero', уходит из разметки: «Как «X», но…», «Вернуть обычную выдачу» и
   * пилюли подталкиваний — в секции героя, а она ключом appid
   * перемонтируется с каждым новым героем; «Дальше — в духе X» — вместе с
   * пройденной игрой. Им фокус надо унести на героя, иначе он падает в body
   * (ФОКУС ТУДА, ГДЕ ИДЁТ ДЕЙСТВИЕ выше). Именно appid, а не «встала»: герой
   * новой выдачи бывает тем же (соседи X часто начинаются с похожего на X
   * героя), тогда заголовок не перемонтируется, и ждать его ref-колбэка —
   * потерять фокус в body, как «Обновить выдачу» до focusHero(now.appid !== was).
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
    ): Promise<number | null> => {
      // «Что-то другое» повторяется: каждое нажатие — новый срез
      const same =
        next.scope === scope &&
        next.lean === lean &&
        next.seed === seedAppid &&
        next.nudge === nudge &&
        next.nudge !== 'different'
      if (same || switching) return null
      // Прежний отказ этого места гаснет с новой попыткой: второй потолок
      // частоты подряд — тот же switchLine, и живая область, где текст не
      // изменился, промолчала бы — нажатие осталось бы без отклика вовсе
      // (components/StatusLine)
      if (from === 'hero') setHeroMiss(null)
      else setSwitchMiss(null)
      setSwitching(true)
      const ofRound = roundNow.current
      try {
        const got = await fetchPicks(next)
        // Пока шёл запрос, нажали «Подобрать заново»: ни выдача, ни отказ к экрану не относятся
        if (roundNow.current !== ofRound) return null
        if ('miss' in got) {
          // Выдача прежняя — и об этом надо сказать, а не просто отжать кнопку:
          // чаще всего это потолок частоты, и у него есть срок (switchLine)
          const line = switchLine(got, locale)
          if (from === 'hero') setHeroMiss(line)
          else setSwitchMiss(line)
          return null
        }
        const hero = got.picks[applyDeal(got)]
        // Фокус здесь не трогаем: нажатый переключатель остаётся на месте, и
        // человек, может быть, нажмёт соседний, а кнопкам в секции героя его
        // переносит вызывающий по appid ниже. Сказать надо только, что герой
        // наверху сменился.
        const name = hero.name
        say(playLine(got.seed ? { kind: 'seed', name, seed: got.seed.name } : { kind: 'reshape', name }))
        return hero.appid
      } finally {
        // finally, а не строка после await: оборванная сеть оставляла бы
        // переключатель навсегда заблокированным, и починить это можно было бы
        // только перезагрузкой страницы. Не вышло — остаёмся на прежней
        // выдаче, она на экране и никуда не делась.
        setSwitching(false)
      }
    },
    [scope, lean, seedAppid, nudge, switching, fetchPicks, applyDeal, say, playLine, locale],
  )

  /*
   * Подталкивание под героем (lib/nudge.ts). Нажатое отжимается обратно в
   * обычную выдачу; «Что-то другое» — нет: каждое нажатие — новый срез без
   * того, что сейчас на экране. «Знакомое» — это «только моё» с наклоном к
   * заброшенному, поэтому и переключатель источника покажет «Только моё», а
   * отжатое вернёт «Любые игры».
   */
  const nudgeTo = async (n: Nudge, was: number) => {
    const off = nudge === n && n !== 'different'
    const hero = await reshape(
      {
        scope: n === 'familiar' ? (off ? 'all' : 'library') : scope,
        lean,
        seed: seedAppid,
        nudge: off ? null : n,
        exclude: n === 'different' ? [...picks, ...discoveries].map((p) => p.appid) : undefined,
      },
      'hero',
    )
    // Пилюли — в секции героя: новый герой уносит их с собой, и фокус едет
    // на его заголовок (reshape). Тот же герой — нажатая пилюля на месте и
    // фокус держит; взведённый зря флаг отнял бы его у героя потом
    if (hero !== null && hero !== was) focusHero(false)
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
    [skipCount, picks, roulette, say, playLine, focusHero],
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
   * «УЖЕ ПРОШЁЛ» У СТРОКИ «ПРОДОЛЖИТЬ».
   *
   * Игру, которую человек как раз доигрывает, закрыть было негде: «Уже
   * прошёл» жил только у героя, а героем она не бывает — активное в
   * кандидаты не идёт, оно стоит здесь, строкой. Тот же бан с причиной
   * 'done', что у героя, и по тем же правилам: ждёт ответа сервера, отказ
   * говорит строкой под панелью, а соседние вкладки узнают о нём из
   * rememberBan. Только у игры с финалом (finishable — решает сервер по
   * тегам): Dota 2 не «проходят».
   *
   * Свой флаг, а не banning: бан героя и этот идут независимо, и кнопка героя
   * не должна говорить «Отмечаю…», пока отмечается чужая игра. И свой отказ,
   * а не banFailed: общий гасил бы чужую строку — «Уже прошёл» здесь молча
   * стирал «не получилось убрать игру насовсем» у героя, хотя тот бан так и
   * не записан, а повтор бана героя — отказ этой панели. По appid, как и
   * banFailed: новая выдача приносит другую «Продолжить», и строка про
   * прежнюю на неё не переезжает.
   *
   * После ответа панель говорит «пройдена» и зовёт дальше — в духе этой игры
   * (contDone, «Как «X», но…» без адреса, тем же reshape).
   */
  const [finishing, setFinishing] = useState(false)
  const [contFailed, setContFailed] = useState<number | null>(null)
  /** appid игры из «Продолжить», только что отмеченной пройденной */
  const [contDone, setContDone] = useState<number | null>(null)
  const finishCont = async () => {
    if (finishing || !cont) return
    const c = cont
    // Ответ про игру дан: «не зацепило?» про неё уже не спрашиваем
    forgetLaunch(c.appid)
    setFinishing(true)
    setContFailed(null)
    const ok = await sendFeedback(c.appid, 'banned', 'done', ctxOf(null, 'continue'))
    setFinishing(false)
    if (!ok) {
      // Отказ по правам — не «нажми ещё раз»: кнопка уже спряталась
      if (writerStore.get() !== false) setContFailed(c.appid)
      return
    }
    rememberBan(c.appid, Date.now())
    // «Уже прошёл» уходит из разметки — фокус встанет на то, что её сменит
    wantContFocus.current = true
    setContDone(c.appid)
    say(playLine({ kind: 'ban', name: c.name, done: true }))
  }
  /*
   * Фокус на строку «пройдена» — разово, по нажатию, а не при каждом
   * монтировании: панель уходит вместе с экраном выгорания и возвращается
   * тем же коммитом, что и новый заголовок героя, и ref-колбэк, стоящий ниже
   * героя по дереву, отнимал бы фокус у героя (focusHero) каждый раз. Флаг
   * ставит удачный finishCont, снимает первый же узел, который его забрал,
   * — или focusHero, если фокус к тому времени понадобился герою.
   */
  const contFocus = useCallback((el: HTMLElement | null) => {
    if (!el || !wantContFocus.current) return
    wantContFocus.current = false
    el.focus({ preventScroll: true })
  }, [])

  /*
   * «Отправить другу» — до ранних возвратов: хук. Герой тот же, что ниже
   * (pick), просто посчитан раньше; пустой выдачи хук не боится.
   */
  const sharePick = useSharePick(picks[Math.min(index, picks.length - 1)], 'play')

  /*
   * Почему выдача не собралась — один расчёт на экран ошибки и на его
   * объявление ниже. Потолок частоты остаётся отдельной веткой: у него есть
   * СРОК, и назвать его точнее, чем «через минуту», может только Retry-After.
   */
  const waitMin = Math.ceil((limitedFor ?? 0) / 60)
  const fail =
    limitedFor !== null
      ? {
          title: tr(locale, { ru: 'Слишком часто', en: 'Too many tries' }),
          text: tr(locale, {
            ru: `Подбор — дорогая операция, и на неё стоит потолок. Вернись через ${waitMin} ${plural(waitMin, 'минуту', 'минуты', 'минут')}.`,
            en: `Picking is expensive, so there's a limit. Come back in ${waitMin} ${waitMin === 1 ? 'minute' : 'minutes'}.`,
          }),
          // Повтор остаётся: окно бывает и десятисекундным, и тогда
          // единственной дорогой назад была бы перезагрузка страницы.
          retry: true,
        }
      : reason === 'nocandidates' && askSeed !== null
        ? seedFail(failSeed)[locale]
        : reason === 'nocandidates' && failGenre !== null
          ? genreFail(failGenre)[locale]
          : (FAIL[locale][reason ?? ''] ?? FAIL_UNKNOWN[locale])

  /*
   * ЭКРАН ОШИБКИ ЗВУЧИТ.
   *
   * Он подменяет экран ожидания целиком, и единственная говорившая область —
   * строка прогресса WarmupScreen — уходит вместе с ним. Человек со
   * скринридером слышал «Изучаю библиотеку…», а потом тишину: «Steam прячет
   * библиотеку» рисовалась молча, и о провале он узнавал, только обойдя
   * страницу. Теперь отказ говорит область страницы (PlayPage) — она живёт с
   * первого кадра и переживает любую смену фазы. Эффектом, а не строкой у
   * каждого setPhase('error'): к этому кадру reason и limitedFor уже на месте,
   * а в обработчике после await их ещё не прочитать.
   */
  const failHead = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => {
    if (phase !== 'error') return
    say(playLine({ kind: 'fail', title: fail.title, text: fail.text }))
    if (!wantFailFocus.current) return
    wantFailFocus.current = false
    if (focusAdrift(document)) failHead.current?.focus({ preventScroll: true })
  }, [phase, failTick, fail.title, fail.text, say, playLine])

  if (phase === 'prepare') {
    return (
      <WarmupScreen
        progress={prep}
        message={progress}
        caption={askedMood ? moodCaption(mood, locale) : undefined}
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
        <p className="relative text-sm text-dim">{tr(locale, { ru: 'Крутим…', en: 'Spinning…' })}</p>
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
        {/* Заголовок — цель фокуса, когда неудачный повтор убрал саму кнопку
            (эффект выше). Ролей на нём нет: его объявляет фокус */}
        <h1 ref={failHead} tabIndex={-1} className="text-lg outline-none">
          {fail.title}
        </h1>
        <p className="text-dim text-sm max-w-md leading-relaxed">{fail.text}</p>

        {/* Шаги про настройки Steam — только там, где библиотека и правда не
            доехала. Панель общая с карточкой подключения и с пустой
            библиотекой: три копии одной инструкции про чужой интерфейс
            разъехались бы на первой же правке. */}
        {/* Проверка — входом через Steam: снимок библиотеки пишет вход, а
            /api/prepare без снимка сам ничего не перезапрашивает. Возвращает
            на ту же выдачу. Сессии по ссылке Steam-вход не предлагаем
            проверкой: её дверь — «Подключить заново» ниже. */}
        {reason === 'nolibrary' && limitedFor === null && (
          <div className="max-w-md text-left">
            {/* Путь — на языке страницы: steamLoginFor берёт язык из него и
                везёт его через вход, и возврат ведёт на ту же /en/play */}
            <PrivacyHelp retryHref={readOnly ? undefined : steamLoginFor(lp(locale, `/play?${search}`))} />
          </div>
        )}

        {/* aria-disabled, а не disabled: неудача повтора оставляет экран как
            есть (см. retry), и фокус обязан остаться на кнопке, а не упасть
            в body. Второе нажатие гасит сам retry */}
        {fail.retry && (
          <button
            onClick={() => void retry()}
            aria-disabled={retrying}
            className="tap cursor-pointer text-sm text-ember-text hover:underline aria-disabled:opacity-50"
          >
            {retrying
              ? tr(locale, { ru: 'Пробую…', en: 'Trying…' })
              : tr(locale, { ru: 'Попробовать снова', en: 'Try again' })}
          </button>
        )}
        {/* Соседей X под это настроение нет — та же выдача без затравки, тем
            же повтором и с той же защитой от второго нажатия. Не повтор того
            же запроса: этот вернул бы тот же отказ (seedFail). И когда соседи
            есть, но все под «Не предлагать» (muted): смена настроения их не
            вернёт — затравка едет в квиз вместе с ним (quizHref). Карточка
            потолка частоты этого выхода не несёт: запрос без затравки упрётся
            в тот же потолок */}
        {fail.seedless && askSeed !== null && (
          <button
            onClick={() => void retry(null)}
            aria-disabled={retrying}
            className="btn-ember px-6 py-3"
          >
            {retrying
              ? tr(locale, { ru: 'Подбираю…', en: 'Picking…' })
              : tr(locale, { ru: 'Подобрать без «похожих»', en: 'Show regular picks' })}
          </button>
        )}
        {/* Жанра под это настроение нет — та же выдача без него, тем же
            повтором (genreFail). Затравки тут нет: при ней экран — seedFail */}
        {fail.genreless && (
          <button
            onClick={() => void retry(null, true)}
            aria-disabled={retrying}
            className="btn-ember px-6 py-3"
          >
            {retrying
              ? tr(locale, { ru: 'Подбираю…', en: 'Picking…' })
              : tr(locale, { ru: 'Подобрать без жанра', en: 'Pick from any genre' })}
          </button>
        )}

        {/* Прежний адрес кнопки остаётся доступен — но под своим именем.
            Кроме случая, когда библиотеки нет вовсе: менять там настроение
            нечему, и ссылка была бы предложением заняться ерундой.
            Затравка с адреса едет в квиз: «похожие на X» переживают смену
            настроения (quizHref) */}
        {reason !== 'nolibrary' && (
          <Link href={quizHref(focus, askSeed)} className="tap link-more">
            {tr(locale, { ru: 'Изменить настроение', en: 'Change mood' })}
            <Icon name="arrow" size={16} />
          </Link>
        )}

        {/* Вернуть игры из бана можно только в библиотеке, и это единственный
            выход, когда кандидатов не осталось из-за банов. */}
        {reason === 'nocandidates' && (
          <Link href="/library" className="tap link-more">
            {tr(locale, { ru: 'Посмотреть библиотеку', en: 'Open your library' })}
            <Icon name="arrow" size={16} />
          </Link>
        )}
        {reason === 'nolibrary' && (
          <Link href={reconnectHref()} className="btn-ember px-6 py-3">
            {tr(locale, { ru: 'Подключить заново', en: 'Reconnect' })}
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
     *
     * Абзац и кнопка — из одного offer (lib/playflow, burnoutInvite): абзац
     * всегда звал «на 20 минут во что-то уютное», а кнопкой под ним бывало
     * «Просто продолжить «Dota 2»». И без запасной «последней из пятёрки» у
     * уютного: «она спокойная» у игры без единого спокойного тега — обещание,
     * которого игра не сдержит. Нечего предложить — кнопки нет, а «Всё равно
     * листать» и «На сегодня всё» остаются.
     */
    const familiar = picks.find((p) => p.source === 'familiar')
    const cozy = picks.find((p) => p.tags.some((t) => COZY_TAGS.includes(t)))
    // Только что пройденную «Продолжить» не предлагаем и здесь
    const offer = burnoutOffer({ familiar: !!familiar, cont: !!cont && cont.appid !== contDone, cozy: !!cozy })
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
            {tr(locale, { ru: 'Похоже, сегодня не игровой вечер', en: "Looks like tonight isn't a gaming night" })}
          </h1>
          {/* Абзац — целыми фразами на язык: русская склейка «уже N игр — дело
              не в играх» по-английски строится своим порядком слов */}
          <p className="text-dim leading-relaxed">
            {tr(locale, {
              ru: `Ты пролистал уже ${BURNOUT_AFTER_SKIPS} ${plural(BURNOUT_AFTER_SKIPS, 'игру', 'игры', 'игр')} — дело, скорее всего, не в играх. Это нормально.`,
              en: `You've skipped ${BURNOUT_AFTER_SKIPS} games already — it's probably not the games. That's okay.`,
            })}{' '}
            {burnoutInvite(offer, locale)}
          </p>
          {offer === 'familiar' && familiar ? (
            <button onClick={() => showPick(familiar)} className="btn-ember is-block py-3">
              {tr(locale, {
                ru: `Ладно, покажи «${familiar.name}» — там всё знакомо`,
                en: `Okay, show me “${familiar.name}” — it's familiar ground`,
              })}
            </button>
          ) : offer === 'continue' && cont ? (
            <SteamLaunch
              appid={cont.appid}
              label={tr(locale, { ru: `Просто продолжить «${cont.name}»`, en: `Just keep playing “${cont.name}”` })}
              mobileLabel={tr(locale, { ru: `Открыть «${cont.name}» в Steam`, en: `Open “${cont.name}” in Steam` })}
              // По ветке нажатия, как у строки «Продолжить»: под пальцем это
              // магазин, а не запуск, и план на вечер он не закрывает (launchIntent)
              onClick={(via) =>
                void sendFeedback(cont.appid, 'launched', undefined, ctxOf(null, 'continue', launchIntent(via)))
              }
              className="btn-ember is-block py-3"
            />
          ) : (
            offer === 'cozy' &&
            cozy && (
              <button onClick={() => showPick(cozy)} className="btn-ember is-block py-3">
                {tr(locale, {
                  ru: `Ладно, покажи «${cozy.name}» — она спокойная`,
                  en: `Okay, show me “${cozy.name}” — it's a calm one`,
                })}
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
              {tr(locale, { ru: 'Всё равно листать', en: 'Keep going anyway' })}
            </button>
            <Link href="/" className="tap text-dim hover:text-ink transition-colors">
              {tr(locale, { ru: 'На сегодня всё', en: "That's it for today" })}
            </Link>
          </div>
          {/* Третий путь для вечера, когда выбирать не хочется: колода без
              вопросов и без последствий (app/explore) — посмотреть, что
              вообще есть, и, может быть, зацепиться за одну */}
          <Link href="/explore" className="tap link-more">
            {tr(locale, { ru: 'Просто полистать, без обязательств', en: 'Just browse, no strings attached' })}
            <Icon name="arrow" size={16} />
          </Link>
        </div>
      </div>
    )
  }

  const pick = picks[Math.min(index, picks.length - 1)]
  const others = picks.filter((p) => p.appid !== pick.appid)
  /** Строка плана на вечер — если его игры ещё нет на экране (planBeside) */
  const planRow = roulette ? null : planBeside(plan, [pick.appid, cont?.appid])
  /*
   * «Уже прошёл» вместо безымянного бана — у заброшенного и знакомого, то
   * есть у того, во что он уже играл. Без достижений не отличить «прошёл» от
   * «бросил», и спросить честнее, чем гадать. Это тот же бан, но с причиной
   * 'done': игра не разонравилась — она кончилась, и вкус о ней не спорит.
   */
  const finished = pick.source === 'comeback' || pick.source === 'familiar'
  /** Сердце героя горит: «Зашло» поставлено, и второе нажатие его снимет */
  const heartOn = liked.has(pick.appid)
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
  // Каждый кусок — целой фразой на язык страницы: склеиваются они только
  // точкой-разделителем, и порядок слов внутри у каждого языка свой
  if (pick.via && !pick.reason.includes(pick.via.name)) {
    const h = pick.via.hours
    const hours = pl(locale, h, { ru: ['час', 'часа', 'часов'], en: ['hour', 'hours'] })
    whyParts.push(
      tr(locale, {
        ru: `ближе всего к «${pick.via.name}» (${h} ${hours})`,
        en: `closest to “${pick.via.name}” (${fmtNumber(locale, h)} ${hours})`,
      }),
    )
  }
  if (pick.signals) {
    const { matchPercent } = pick.signals
    if (matchPercent !== null)
      whyParts.push(tr(locale, { ru: `совпадение со вкусом ${matchPercent}%`, en: `${matchPercent}% taste match` }))
    // Слова из семантики точнее тегов: «спокойная, короткие сессии» говорит,
    // ПОЧЕМУ игра под настроение, а «под вайб: Уютная» — только что тег есть.
    // Слова сервер пишет на языке запроса (explainMatch), теги подписывает tagLabel
    if (pick.signals.moodWords?.length)
      whyParts.push(
        tr(locale, { ru: 'под настроение: ', en: 'fits the mood: ' }) + pick.signals.moodWords.join(', '),
      )
    else if (pick.signals.moodTags.length)
      whyParts.push(
        tr(locale, { ru: 'под вайб: ', en: 'vibe: ' }) +
          pick.signals.moodTags.map((t) => tagLabel(t, locale)).join(', '),
      )
  }

  /*
   * «Изменить настроение» — рядом с тем, КАКОЕ оно сейчас. Одна игра без
   * подписи выглядит ответом на вопрос, которого человек не помнит, а
   * пришедший по пресету и не видел трёх вопросов. Подпись — только если
   * настроение и правда спрашивали (askedMood): цитировать дефолты как его
   * слова нельзя.
   */
  const caption = askedMood ? moodCaption(mood, locale) : ''
  /*
   * Мост в пати — только когда человек сам сказал «с друзьями»: выдача выше
   * собрана из одной его библиотеки, а комната учтёт библиотеки всех. Ссылкой
   * в этой же строке, последней, а не кнопкой у героя:
   * это другой путь, а не действие над игрой, и выбор одной игры он не
   * перебивает. Адрес — lib/presets: точный пресет создаёт комнату в один тап,
   * без точного /room/new только отмечает похожий. prefetch выключен, как у
   * «Позвать в эту игру» на /pick: путь редкий, и грузить его с каждой выдачей
   * незачем.
   */
  const party = askedMood ? roomBridgeHref(mood) : null
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
          {tr(locale, { ru: 'Подобрать заново', en: 'Pick again' })}
        </button>
      )}
      {/* Только настроение: «нераспакованное» и «похожие на X» едут в квиз
          и обратно (quizHref) — затравка та, под которую собрана выдача */}
      <Link href={quizHref(focus, seedAppid)} className="tap link-more">
        {tr(locale, { ru: 'Изменить настроение', en: 'Change mood' })}
        <Icon name="arrow" size={16} />
      </Link>
      {/* Колода исследователя — для того, кому сейчас не до вопросов */}
      <Link href="/explore" className="tap link-more">
        {tr(locale, { ru: 'Просто полистать', en: 'Just browse' })}
        <Icon name="arrow" size={16} />
      </Link>
      {/* Мост в пати — последним: пара «подпись → Изменить настроение» не
          разрывается, а другой путь стоит тихо в хвосте строки */}
      {party && (
        <Link href={party} prefetch={false} className="tap link-more">
          {tr(locale, { ru: 'Позвать друзей выбрать вместе', en: 'Invite friends to pick together' })}
          <Icon name="arrow" size={16} />
        </Link>
      )}
    </div>
  )

  return (
    <div className="flex-1 flex flex-col">
      {/* Вопрос после запуска важнее фоновой плашки прогрева: они стоят в одном
          месте экрана, и прогрев подождёт, пока человек не ответит */}
      <StopAsk
        game={stopDue}
        reasons={SKIP_REASONS[locale]}
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
            sendLike(stopDue.appid, ctxOf(asked, undefined, 'ask'))
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
        /*
          Свой запрос, а не reshape: тот отбросил бы его как «то же самое» —
          источник, ось, затравка и подталкивание совпадают с экраном. Но по
          его правилам: подталкивание переживает пересчёт (keptNudge — раньше
          «Покороче» молча отжималось), идущая пересборка не перебивается, а
          отказ говорит строкой под героем — там, куда уже ушёл фокус. Кнопка
          возвращается: на 429 повторить через пару минут больше негде.
        */
        onRefresh={async () => {
          if (switching) return
          setWarming('off')
          // Плашка уходит вместе с кнопкой: фокус сразу на героя, а если
          // пересчёт его сменит — на нового, когда тот смонтируется
          focusHero(true)
          const was = pick.appid
          const ofRound = roundNow.current
          setHeroMiss(null)
          setSwitching(true)
          try {
            const got = await fetchPicks({ scope, lean, seed: seedAppid, nudge: keptNudge })
            // «Подобрать заново» за время запроса — как у reshape: ответ не про этот экран
            if (roundNow.current !== ofRound) return
            if ('miss' in got) {
              setHeroMiss(switchLine(got, locale))
              if (got.miss !== 'gone') setWarming('ready')
              return
            }
            const now = got.picks[applyDeal(got)]
            say(playLine({ kind: 'refresh', name: now.name }))
            if (now.appid !== was) focusHero(false)
          } finally {
            setSwitching(false)
          }
        }}
        // «Скрыть» уходит вместе с плашкой, и фокус без присмотра упал бы в
        // body — отдаём его герою, как после «Обновить выдачу»
        onDismiss={() => {
          setWarming('off')
          focusHero(true)
        }}
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
          {/* Демо называет себя здесь, в момент ценности, и даёт дверь к своей
              библиотеке. Поверх верха кадра, вне потока: признак клиентский,
              и полоса в потоке двигала бы героя (см. DemoBar). */}
          {demo && <DemoBar from={lp(locale, `/play?${search}`)} overlay />}

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
                  {pick.store ? `${STORE_LABEL[pick.store] ?? pick.store}` : sourceBadge(pick.source, locale)}
                </span>
                {pick.hoursPlayed !== null && pick.hoursPlayed > 0 && (
                  <span className="text-dim tabular-nums">
                    {tr(locale, {
                      ru: `${pick.hoursPlayed} ч наиграно`,
                      en: `${fmtNumber(locale, pick.hoursPlayed)} h played`,
                    })}
                  </span>
                )}
                {/* Сколько уходит на заход — рядом с тем, сколько уже наиграно:
                    оба числа про время, и «хватит ли вечера» решается здесь.
                    Одной фразой (sessionPhrase): «сессия ~40 мин», но
                    «~40 min sessions» — по-английски склейка ярлыка и значения
                    дала бы «session ~40 min» */}
                {pick.session && <span className="text-dim">{sessionPhrase(pick.session, locale)}</span>}
                {/* «русские субтитры» / «без русского» — готовой фразой с
                    сервера (ruLangLine в lib/gametraits, считается в
                    lib/cards): не знаем — молчим */}
                {pick.russian && <span className="text-dim">{pick.russian}</span>}
                {pick.deferred && <span className="text-dim">{deferredLabel(pick.deferred.daysAgo, locale)}</span>}
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
                  {edgeLine(pick.edge, timeHidden, locale)}
                </m.p>
              )}

              {/* Сколько времени уйдёт до веселья (lib/entry): вечер с бюджетом,
                  и игра на три часа обучения — другой ответ, чем «сел и
                  играешь». Строка есть, только когда отзывы или жанр это знают */}
              {pick.entry && (
                <m.p variants={STEP} className="-mt-2 text-sm text-dim">
                  {entryLine(pick.entry, locale)}
                </m.p>
              )}

              {/* «О чём игра» — у некупленной из каталога: название, теги и
                  причина не говорят, что это вообще такое (lib/cards aboutLine) */}
              {pick.about && (
                <m.p variants={STEP} className="-mt-2 line-clamp-3 text-sm text-dim">
                  <span className="font-bold text-ink">{tr(locale, { ru: 'О чём: ', en: 'About: ' })}</span>
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
                  {tr(locale, { ru: 'Почему она?', en: 'Why this one?' })}{' '}
                  <Icon name={showWhy ? 'up' : 'down'} className="inline-block align-[-0.15em]" />
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
                  {tr(locale, { ru: 'Почему не то?', en: "What's off?" })}
                </span>
                {SKIP_REASONS[locale].map((r, i) => (
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
                  {tr(locale, { ru: 'пропустить', en: 'skip' })}
                </button>
              </m.div>
            ) : (
              <>
              {/* С md ряд в одну линию и может быть шире колонки текста: кнопки
                  несут свою подложку, и край скрима им не нужен. Но не шире
                  экрана без полей: секция героя режет вылезшее (overflow-hidden),
                  и под запретом переноса планшет в 768px терял за краем
                  «Подробнее», «Зашло» и бан у игры из магазина со скидкой, а в
                  820px — пилюлю «Скрыть насовсем». Влез — одна линия, как была;
                  не влез — перенос, как на телефоне.
                  Поля — те же, что у контейнера (px-safe), а не 2 × 1.25rem:
                  iPhone в ландшафте шире md, и вырез там даёт полю ~47px.
                  Потолок в 100vw − 2.5rem пускал ряд от x = 47 до 851 при
                  ширине 844 — за край и под вырез. */}
              <m.div
                variants={STEP}
                className="flex flex-wrap items-center gap-3 mt-2 md:w-max md:max-w-[calc(100vw-max(1.25rem,env(safe-area-inset-left))-max(1.25rem,env(safe-area-inset-right)))]"
              >
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
                      ? tr(locale, {
                          ru: `Смотреть в ${STORE_LABEL[pick.store ?? ''] ?? 'Steam'}`,
                          en: `View on ${STORE_LABEL[pick.store ?? ''] ?? 'Steam'}`,
                        })
                      : tr(locale, {
                          ru: `Открыть в ${STORE_LABEL[pick.store ?? ''] ?? 'магазине'}`,
                          // Без названия магазина — «Open store page» (глоссарий), а не «Open in store»
                          en: STORE_LABEL[pick.store ?? ''] ? `Open in ${STORE_LABEL[pick.store ?? '']}` : 'Open store page',
                        })}
                  </a>
                ) : (
                  <SteamLaunch
                    appid={pick.appid}
                    // Запуск — не «Зашло»: раньше он писался как liked, и точность
                    // подбора на /library росла от любого клика. Под пальцем это
                    // магазин, а не запуск (launchIntent): план на вечер цел
                    onClick={(via) =>
                      void sendFeedback(pick.appid, 'launched', undefined, ctxOf(pick, heroFrom, launchIntent(via)))
                    }
                    // Засекаем только настоящий запуск: через десять минут
                    // вернувшегося спросим, зацепило ли (см. StopAsk)
                    onLaunch={() => rememberLaunch(pick.appid, pick.name, Math.floor(Date.now() / 1000))}
                    icon
                    className="btn-ember px-6 py-3"
                  />
                )}
                {pick.source === 'new' && (pick.priceFinal !== null || pick.isFree || pick.unsold) && (
                  <a
                    href={storeHref(pick)}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-glass"
                  >
                    <PriceTag
                      priceFinal={pick.priceFinal}
                      cc={pick.priceCc}
                      unsold={pick.unsold}
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
                        {tr(locale, { ru: 'Крутить ещё', en: 'Spin again' })}
                      </button>
                    </ClickSpark>
                  </Magnet>
                ) : (
                  <button
                    // Причину спрашивать не у кого записать — просто листаем.
                    // И у героя, только что отложенного на вечер: это шаг по
                    // выдаче, а пропуск закрыл бы план (planned)
                    onClick={() => {
                      if (readOnly || planned.includes(pick.appid)) {
                        advance(index)
                        return
                      }
                      setAskReason(true)
                      say(playLine({ kind: 'ask' }))
                    }}
                    className="btn-glass"
                  >
                    <Icon name="next" size={18} />
                    {tr(locale, { ru: 'Не то — дальше', en: 'Not it — next' })}
                  </button>
                )}
                <Link
                  href={`/game/${pick.appid}`}
                  onClick={() =>
                    void sendFeedback(pick.appid, 'opened', undefined, ctxOf(pick, heroFrom, 'details'))
                  }
                  // Кругом, как ⓘ у стриминга: подпись — для скринридера и
                  // подсказкой под курсором
                  title={tr(locale, { ru: 'Подробнее об игре', en: 'Game details' })}
                  className="btn-circle"
                >
                  <Icon name="info" size={20} />
                  <span className="sr-only">{tr(locale, { ru: 'Подробнее', en: 'Details' })}</span>
                </Link>
                {!readOnly && (
                  <button
                    onClick={() => {
                      // Второе нажатие снимает «Зашло» — тем же /api/unlike,
                      // что полка /library (lib/unlike, ленивым куском героя
                      // heroTail): ошибочное сердце забирается там, где
                      // поставлено, — ровно строка этого нажатия, а не
                      // прежние «зашло» игры. Отказ — строкой под героем
                      // (heroMiss), и сердце горит снова. Не пришёл кусок
                      // (деплой сменил хеш, а вкладка старая; на компьютере
                      // его никто не прогревал) — снятия не было, сердце
                      // горит как горело, и та же строка говорит, что
                      // делать: молча нажатие было бы мёртвым. Коротко —
                      // /play у самого потолка bundle-budget.json; отчёт о
                      // куске шлёт островок «Сыграю вечером»
                      // (components/TonightLazy)
                      if (heartOn) return void heroTail().then((t) => t.undoLike('play', pick, setLiked, setHeroMiss, locale), () => setHeroMiss(tr(locale, { ru: 'Обнови страницу', en: 'Reload the page' })))
                      // «Зашло» после запуска — уже ответ на «не зацепило?»:
                      // спрашивать про неё больше незачем
                      forgetLaunch(pick.appid)
                      setLiked(new Set(liked).add(pick.appid))
                      sendLike(pick.appid, ctxOf(pick, heroFrom))
                    }}
                    // Круг с сердцем, как «в мой список» у стриминга; подпись
                    // для скринридера — та же, что была текстом кнопки, и
                    // не меняется с нажатием: тумблер называет aria-pressed
                    aria-pressed={heartOn}
                    title={
                      heartOn
                        ? tr(locale, { ru: 'Зашло — нажми, чтобы снять', en: 'Liked it — tap to undo' })
                        : tr(locale, { ru: 'Зашло', en: 'Liked it' })
                    }
                    className="btn-circle"
                  >
                    <Icon name={heartOn ? 'check' : 'heart'} size={20} />
                    <span className="sr-only">{tr(locale, { ru: 'Зашло', en: 'Liked it' })}</span>
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
                      // Выдача — сегодняшняя, а не из замыкания клика: пока шёл
                      // запрос, человек мог пролистать дальше или выбрать
                      // карточку, и героя увело бы на соседа забаненной
                      const now = live.current
                      const after = afterBan({ picks: now.picks, index: now.index, banned: pick.appid })
                      // Что бан записан, звучит всегда — и там, где на экране
                      // менять нечего: действие необратимо, и молча оно
                      // выглядит не дошедшим. Без «следующей игры» (lib/announce)
                      const told = playLine({ kind: 'ban', name: pick.name, done: finished })
                      if (after.empty) {
                        /*
                          «Подобрать заново» за время запроса: на экране ожидания
                          (или ошибки нового захода) старой выдачи уже не видно,
                          и вот-вот придёт новая — та, о которой человек и
                          попросил. Уводить его в квиз из-за опустевшей прежней
                          значило бы бросить её на полпути.
                        */
                        if (now.phase === 'prepare' || now.phase === 'error') say(told)
                        else router.push(quizHref(focus))
                        return
                      }
                      setPicks(after.picks)
                      setIndex(after.index)
                      /*
                        Герой уже другой — он и остаётся, переносить нечего. Или
                        героя не видно вовсе: пятый пропуск за время запроса
                        открыл экран выгорания (индекс он не трогает), а
                        «Подобрать заново» — экран ожидания. «Следующая игра: …»
                        назвала бы карточку, которой на экране нет; игра просто
                        уходит из выдачи, а фокус остаётся, где был.
                      */
                      if (!after.heroGone || now.phase !== 'reveal') {
                        say(told)
                        return
                      }
                      setHeroFrom('hero')
                      // «Почему не то?», открытое у этой игры, пока бан шёл, не
                      // переезжает на следующую: фокус встал бы на её «Не тот
                      // жанр», и Enter записал бы пропуск игре, которую не отвергали
                      setAskReason(false)
                      setShowWhy(false)
                      say(
                        playLine({
                          kind: 'ban',
                          name: pick.name,
                          done: finished,
                          next: after.picks[after.index].name,
                        }),
                      )
                      focusHero(false)
                    }}
                    /* aria-disabled, а не disabled: бан ждёт ответа, и на
                       отказе кнопка остаётся на месте со строкой «не дошло»
                       под ней. disabled выбрасывал фокус в body на всё время
                       запроса — нажать ещё раз было уже не с чего. Повтор
                       гасит if (banning) в начале обработчика. */
                    aria-disabled={banning}
                    title={
                      finished
                        ? tr(locale, { ru: 'Прошёл — больше не предлагать', en: "Finished — don't suggest it again" })
                        : owned
                          ? tr(locale, {
                              ru: 'Убрать с полки. Бросать игры — нормально',
                              en: 'Take it off your shelf. Dropping games is fine',
                            })
                          : tr(locale, { ru: 'Больше не показывать эту игру', en: 'Never show this game again' })
                    }
                    className={
                      finished
                        ? 'btn-glass aria-disabled:opacity-60'
                        : 'btn-circle pointer-coarse:w-auto pointer-coarse:grid-flow-col pointer-coarse:gap-2 pointer-coarse:px-4 aria-disabled:opacity-60'
                    }
                  >
                    {/*
                      Раньше здесь стояла голая эмодзи. Доступного имени у кнопки
                      не было вовсе (title им не является), а рядом с «Не то —
                      дальше» её смысл не читался и глазами: обе кнопки убирают
                      игру с экрана, но одна на сегодня, а другая навсегда.

                      Разницу объясняли title и текст для скринридера — то есть
                      никому из тех, кто смотрит на телефон: подсказки под
                      пальцем не бывает, и безымянный перечёркнутый глаз
                      нажимали как «пропустить». Под пальцем круг становится
                      пилюлей со словами «Скрыть насовсем» — тем же словом, что
                      полка «Скрытые» в библиотеке, откуда её вернуть. Под
                      курсором остаётся круг: там есть title, а ряд с md стоит в
                      одну линию. Имя кнопки начинается с видимых слов (WCAG
                      2.5.3): голосом её зовут тем, что видно, — поэтому видимая
                      подпись спрятана от скринридера, а полную говорит sr-only.

                      «Уже прошёл» — с игрой в имени, тоже после видимых слов:
                      у строки «Продолжить» ниже бывает своя такая же кнопка
                      другой игры, и в списке кнопок два одинаковых имени не
                      различить (DONE_MISS).
                    */}
                    {finished ? (
                      banning ? (
                        tr(locale, { ru: 'Отмечаю…', en: 'Marking…' })
                      ) : (
                        tr(locale, {
                          ru: (
                            <>
                              Уже прошёл<span className="sr-only"> «{pick.name}»</span>
                            </>
                          ),
                          en: (
                            <>
                              Already finished<span className="sr-only"> “{pick.name}”</span>
                            </>
                          ),
                        })
                      )
                    ) : (
                      <>
                        <Icon name="hide" size={20} />
                        <span aria-hidden className="hidden pointer-coarse:inline text-sm font-bold">
                          {banning
                            ? tr(locale, { ru: 'Скрываю…', en: 'Hiding…' })
                            : tr(locale, { ru: 'Скрыть насовсем', en: 'Hide for good' })}
                        </span>
                        <span className="sr-only">
                          {banning
                            ? tr(locale, { ru: 'Скрываю насовсем…', en: 'Hiding for good…' })
                            : owned
                              ? tr(locale, {
                                  ru: 'Скрыть насовсем: убрать с полки. Бросать игры — нормально',
                                  en: 'Hide for good: take it off your shelf. Dropping games is fine',
                                })
                              : tr(locale, {
                                  ru: 'Скрыть насовсем: больше никогда не показывать эту игру',
                                  en: 'Hide for good: never show this game again',
                                })}
                        </span>
                      </>
                    )}
                  </button>
                )}
              </m.div>
              {/* Вместо спрятанных «Зашло» и бана — почему их нет и как вернуть */}
              {readOnly && <NeedSteam from={lp(locale, `/play?${search}`)} why="launch" className="-mt-1" />}
              {!readOnly && sharePick.panel}
              {/*
                Отказ бана виден, потому что бан необратим. Формулировка ведёт
                к следующему шагу, а не констатирует поломку: карточка на месте,
                жест повторяется тем же нажатием. Строка стоит всегда, пустой:
                отказ приходит в неё изменением текста, и скринридер его
                объявит (components/StatusLine).
              */}
              <StatusLine
                text={
                  banFailed !== pick.appid
                    ? null
                    : finished
                      ? DONE_MISS(pick.name, locale)
                      : tr(locale, {
                          ru: 'Не получилось убрать игру насовсем — нажми ещё раз.',
                          en: "Couldn't hide the game for good — try again.",
                        })
                }
                className="-mt-1 text-sm text-danger"
              />
              {/* Чья это цена — под кнопкой с ней: русскоязычный аккаунт не
                  обязательно российский, и у KZ или СНГ-доллара она другая.
                  Только у цены: «бесплатно» и «не продаётся…» регион уже
                  называют сами. */}
              {pick.source === 'new' && pick.priceFinal !== null && !pick.isFree && !pick.unsold && (
                <m.div variants={STEP} className="-mt-1">
                  <PriceWhere cc={pick.priceCc} />
                </m.div>
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
                  {stopRuleLine(mood.time, locale)}
                </m.p>
              )}
              {/* План на вечер начинается с загрузки: своя нетронутая или
                  заброшенная (и любая своя при скрытом времени) скорее всего
                  не установлена, и «Запустить» вечером упрётся в полчаса
                  скачивания. Ссылка ставит её на загрузку сейчас
                  (steam://install), кому — решает suggestsInstall. Вкус и
                  паузы это нажатие не видят — план, а не оценка (listFeedback). */}
              {suggestsInstall(pick.source) && !pick.storeUrl && (
                <m.p variants={STEP} className="-mt-1 text-xs text-faint">
                  <SteamLaunch
                    appid={pick.appid}
                    mode="install"
                    label={tr(locale, {
                      ru: 'Ещё не установлена? Поставь на загрузку заранее',
                      en: 'Not installed yet? Start the download now',
                    })}
                    onClick={() =>
                      void sendFeedback(pick.appid, 'opened', undefined, ctxOf(pick, heroFrom, 'install'))
                    }
                    className="tap hover:text-ink transition-colors"
                  />
                </m.p>
              )}
              {/* Своя игра на телефоне — «Сыграю вечером на ПК»: запустить её
                  отсюда нельзя, а вечером на компьютере она вернётся строкой
                  над «Продолжить» (lib/eveningplan.ts). План, а не оценка.
                  Кнопка сама прячется на компьютере и у не пишущей сессии —
                  поэтому без обёртки: пустой узел в колонке героя всё равно
                  взял бы себе зазор gap-4. Отложенный в этом заходе — и после
                  «Подробнее» → «Назад» — встаёт уже отложенным (planned) */}
              {pick.source !== 'new' && !pick.storeUrl && (
                <TonightButton
                  key={pick.appid}
                  initialDone={planned.includes(pick.appid)}
                  name={pick.name}
                  onPlan={() => sendFeedback(pick.appid, 'opened', undefined, ctxOf(pick, heroFrom, 'tonight'))}
                />
              )}
              {/*
                «Как «X», но…» — соседи этой игры (готовые из game_neighbors,
                а до их заливки — по тегу полки) под то же настроение. Шаг по
                выдаче, как переключатели ниже: без адреса и без прогрева. В
                рулетке его нет — там смысл в броске, в «нераспакованном» тоже:
                вопрос там уже задан, и соседи его не услышали бы. У выдачи из
                соседей — подпись, чьи они, и дорога обратно. Та же выдача
                приходит и адресом — со страницы игры и из библиотеки (askSeed):
                подпись и «Вернуть обычную выдачу» у неё те же.
              */}
              {(seed || genre || (!roulette && !focus && pick.tags.length > 0)) && (
                <m.div
                  variants={STEP}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
                >
                  {seed && (
                    <span className="text-faint">
                      {tr(locale, { ru: `Похожие на «${seed.name}»`, en: `Similar to “${seed.name}”` })}
                    </span>
                  )}
                  {/* Жанр со страницы /games — подписью, как затравка: подо что
                      собрана выдача и есть ли в ней свои (genreLine). Название
                      уже на языке страницы (эхо роута, hubTitle); по-английски
                      оно не понижается и начинает строку — «Roguelikes only» */}
                  {genre && (
                    <span className="text-faint">
                      {tr(locale, {
                        ru: genreLine(genre),
                        en: genre.own
                          ? `${genre.title} only`
                          : `${genre.title} only: none of yours turned up — these are from the store`,
                      })}
                    </span>
                  )}
                  {!roulette && !focus && pick.tags.length > 0 && (
                    <button
                      type="button"
                      // Затравка — сам герой, а в своих соседях он не бывает:
                      // удача почти всегда приводит другого, и кнопка уходит
                      // вместе со старым героем — фокус едет на нового (reshape)
                      onClick={async () => {
                        const was = pick.appid
                        const hero = await reshape({ scope, lean, seed: pick.appid, nudge: keptNudge }, 'hero')
                        if (hero !== null && hero !== was) focusHero(false)
                      }}
                      aria-disabled={switching}
                      title={tr(locale, {
                        ru: 'Похожие на эту игру — под то же настроение',
                        en: 'Games like this one — for the same mood',
                      })}
                      className="tap text-dim hover:text-ink transition-colors cursor-pointer aria-disabled:opacity-50"
                    >
                      {tr(locale, { ru: `Как «${pick.name}», но…`, en: `Like “${pick.name}”, but…` })}
                    </button>
                  )}
                  {seed && (
                    <button
                      type="button"
                      // Уходит при любой удаче, даже с тем же героем: затравки
                      // больше нет. Тогда фокус — на заголовок нынешнего сразу
                      onClick={async () => {
                        const was = pick.appid
                        const hero = await reshape({ scope, lean, seed: null, nudge: keptNudge }, 'hero')
                        if (hero !== null) focusHero(hero === was)
                      }}
                      aria-disabled={switching}
                      className="tap text-dim hover:text-ink transition-colors cursor-pointer aria-disabled:opacity-50"
                    >
                      {tr(locale, { ru: 'Вернуть обычную выдачу', en: 'Back to regular picks' })}
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

                У ряда своя видимая подпись, и она же имя группы. Без неё «Как
                «Factorio», но…» с многоточием стояло прямо над пилюлями и
                читалось их началом — «как Factorio, но покороче», — а
                подталкивания затравку не берут (nudgeTo несёт только уже
                выбранную): «Покороче» отдавало игру, с Factorio не связанную.
              */}
              {!roulette && !focus && (
                <m.div
                  variants={STEP}
                  role="group"
                  aria-labelledby="play-nudge-label"
                  className="flex flex-wrap items-center gap-3 text-xs"
                >
                  <span id="play-nudge-label" className="text-faint">
                    {tr(locale, { ru: 'Подправить выдачу:', en: 'Tweak picks:' })}
                  </span>
                  {NUDGES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => void nudgeTo(n, pick.appid)}
                      aria-disabled={switching}
                      // «Что-то другое» — действие, а не переключатель: у
                      // повторяемого нажатия нет «нажатого» состояния
                      aria-pressed={n === 'different' ? undefined : nudge === n}
                      className="tap pill aria-disabled:opacity-50"
                    >
                      {nudgeLabel(n, locale)}
                    </button>
                  ))}
                </m.div>
              )}
              </>
            )}
            {/* Отказ «Как «X», но…», подталкиваний и «Обновить выдачу» — тем же
                приёмом: строка стоит всегда, а меняется в ней только текст.
                Снаружи ряда «Почему не то?», а не в его ветке «иначе»: плашка
                догрева живёт над героем и жмётся и при открытом ряде, а 429
                «Обновить выдачу» в размонтированную строку не звучал вовсе —
                и потом молча всплывал, когда ряд закрывался. */}
            <StatusLine text={heroMiss} className="-mt-1 text-sm text-danger" />
            </div>
          </m.div>
        </m.section>
      </AnimatePresence>

      {/* Время скрыто настройками Steam: карточки «Из твоей библиотеки» без
          единого часа иначе выглядели бы сбоем, а подбор — случайным. Строка
          говорит, почему так, и как открыть, — шагом из PrivacyHelp. */}
      {timeHidden && (
        <div className="mx-auto w-full max-w-6xl px-safe pt-8">
          <PlaytimeHiddenNote />
        </div>
      )}

      {/* План на вечер (lib/eveningplan.ts) — игра, которую человек сам
          поставил на загрузку или отложил с телефона. Строкой над
          «Продолжить» и тем же видом: это его решение, а не наша карточка.
          Только там, где кнопка запускает (pointer-fine — признак развилки
          SteamLaunch): на телефоне запускать нечем, и строка без кнопки была
          бы упрёком. Не в рулетке и не когда игра плана уже на экране — у
          героя свой «Запустить», у «Продолжить» свой (planBeside). Запуск
          пишется как у «Продолжить», со слотом plan: он закрывает план и
          заводит исход совета («Твои вечера»). Записанный — убирает и строку
          (closesPlan в sendFeedback), поэтому фокус с её кнопки сразу
          переезжает к герою, как после любого ответа: иначе он упал бы в
          body вместе со строкой. */}
      {planRow && (
        <LaunchRow
          appid={planRow.appid}
          label={tr(locale, { ru: 'Запустить', en: 'Launch' })}
          fineOnly
          onLaunch={() => {
            focusHero(true)
            void sendFeedback(planRow.appid, 'launched', undefined, ctxOf(null, 'plan', 'launch'))
          }}
        >
          {planLine(planRow, locale)}
        </LaunchRow>
      )}

      {/* «Продолжить» — то, во что он играет сейчас. Строкой, а не карточкой:
          это не рекомендация, и спорить с героем за место ей незачем. В
          рулетке её нет — там весь смысл в броске. */}
      {cont && !roulette && (
        <div className="mx-auto w-full max-w-6xl px-safe pt-8">
          <div className="panel-lift px-4 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm">
            {contDone === cont.appid ? (
              <>
                {/* Выдача на экране уже «похожие на X» — пройденная игра и
                    есть её затравка (pickContinue затравку не исключает, а
                    сама она в соседи не идёт). «Дальше» тогда звал бы тот же
                    запрос, и reshape отбрасывал бы его как «то же самое»:
                    кнопка, которая молча ничего не делает. Остаётся строка —
                    и фокус, ушедший с «Уже прошёл», забирает она */}
                <span
                  ref={cont.appid === seedAppid ? contFocus : undefined}
                  tabIndex={cont.appid === seedAppid ? -1 : undefined}
                  className="text-dim outline-none"
                >
                  {tr(locale, {
                    ru: (
                      <>
                        <span className="font-extrabold text-ink">«{cont.name}»</span> пройдена — больше не
                        предложу
                      </>
                    ),
                    en: (
                      <>
                        <span className="font-extrabold text-ink">“{cont.name}”</span> finished — won&apos;t
                        suggest it again
                      </>
                    ),
                  })}
                </span>
                {/* «Уже прошёл» ушла из-под пальца — фокус встаёт сюда. Удачная
                    выдача уносит и эту кнопку: фокус едет на героя — на
                    нового, когда тот смонтируется, или сразу на нынешний,
                    если герой остался тем же (reshape отдаёт его appid) */}
                {cont.appid !== seedAppid && (
                  <button
                    ref={contFocus}
                    type="button"
                    onClick={async () => {
                      const was = pick.appid
                      const hero = await reshape({ scope, lean, seed: cont.appid, nudge: keptNudge }, 'hero')
                      if (hero !== null) focusHero(hero === was)
                    }}
                    aria-disabled={switching}
                    className="tap font-extrabold text-ember-text hover:underline cursor-pointer aria-disabled:opacity-50"
                  >
                    {tr(locale, { ru: <>Дальше — в духе «{cont.name}»</>, en: <>Next: more like “{cont.name}”</> })}
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="text-dim">
                  {tr(locale, {
                    ru: (
                      <>
                        Или продолжи <span className="font-extrabold text-ink">«{cont.name}»</span>
                      </>
                    ),
                    en: (
                      <>
                        Or keep playing <span className="font-extrabold text-ink">“{cont.name}”</span>
                      </>
                    ),
                  })}
                  {/* «past 2 weeks» — слова самого Steam, и строка на 360 px не
                      шире русской: «in the last two weeks» переносило её */}
                  {cont.recentHours > 0 && (
                    <span className="tabular-nums text-faint">
                      {tr(locale, {
                        ru: ` · ${cont.recentHours} ч за две недели`,
                        en: ` · ${fmtNumber(locale, cont.recentHours)} h past 2 weeks`,
                      })}
                    </span>
                  )}
                </span>
                <span className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {/* Сессии только для чтения бан не записать — кнопки нет,
                      как и у героя. Игра в имени — после видимых слов (WCAG
                      2.5.3): своего заголовка у панели нет, по заголовкам
                      кнопка стоит под h1 героя, а у героя бывает своя «Уже
                      прошёл» — без игры их не различить (DONE_MISS) */}
                  {cont.finishable && !readOnly && (
                    <button
                      type="button"
                      onClick={() => void finishCont()}
                      aria-disabled={finishing}
                      title={tr(locale, { ru: 'Прошёл — больше не предлагать', en: "Finished — don't suggest it again" })}
                      className="tap text-dim hover:text-ink transition-colors cursor-pointer aria-disabled:opacity-60"
                    >
                      {finishing
                        ? tr(locale, { ru: 'Отмечаю…', en: 'Marking…' })
                        : tr(locale, {
                            ru: (
                              <>
                                Уже прошёл<span className="sr-only"> «{cont.name}»</span>
                              </>
                            ),
                            en: (
                              <>
                                Already finished<span className="sr-only"> “{cont.name}”</span>
                              </>
                            ),
                          })}
                    </button>
                  )}
                  <SteamLaunch
                    appid={cont.appid}
                    label={tr(locale, { ru: 'Продолжить', en: 'Continue' })}
                    onClick={(via) =>
                      void sendFeedback(cont.appid, 'launched', undefined, ctxOf(null, 'continue', launchIntent(via)))
                    }
                    className="tap font-extrabold text-ember-text hover:underline"
                  />
                </span>
              </>
            )}
          </div>
          {/* Отказ «Уже прошёл» — под панелью, тем же приёмом, что у героя:
              строка стоит всегда, меняется только текст */}
          <StatusLine
            text={contFailed === cont.appid ? DONE_MISS(cont.name, locale) : null}
            className="mt-2 text-sm text-danger"
          />
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
                {/* При скрытом времени нераспакованного не узнать: сервер
                    отдаёт тогда всё своё, и подпись говорит ровно это */}
                {/* Целыми шаблонами на язык: у русского причастие согласуется
                    с числом («похожий / похожих»), у английского число и
                    слово стоят своим порядком («4 more unopened games») */}
                {focus
                  ? tr(locale, {
                      ru: `Не то? Ещё ${others.length} ${plural(others.length, 'игра', 'игры', 'игр')} ${timeHidden ? 'из твоей библиотеки' : 'из нераспакованного'}`,
                      en: `Not it? ${others.length} more ${timeHidden ? '' : 'unopened '}${others.length === 1 ? 'game' : 'games'}${timeHidden ? ' from your library' : ''}`,
                    })
                  : seed
                    ? tr(locale, {
                        ru: `Не то? Ещё ${others.length} ${plural(others.length, 'вариант, похожий', 'варианта, похожих', 'вариантов, похожих')} на «${seed.name}»`,
                        en: `Not it? ${others.length} more ${others.length === 1 ? 'option' : 'options'} like “${seed.name}”`,
                      })
                    : tr(locale, {
                        ru: `Не то? Ещё ${others.length} ${plural(others.length, 'вариант', 'варианта', 'вариантов')} под это настроение`,
                        en: `Not it? ${others.length} more ${others.length === 1 ? 'option' : 'options'} for this mood`,
                      })}{' '}
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
                      aria-label={tr(locale, { ru: 'Откуда брать игры', en: 'Where to pick from' })}
                      /* gap-3, а не gap-1, и это не про воздух. Зона .tap на кнопках
                         ниже вылезает на 6 px вбок с каждой стороны; при зазоре в
                         4 px соседние зоны перекрылись бы на 8 px и воровали бы друг
                         у друга нажатия. 12 px — ровно столько, сколько зона
                         занимает, и ни пикселем больше. */
                      className="seg-group"
                    >
                      {SCOPES[locale].map((s) => (
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
                      aria-label={tr(locale, { ru: 'Чего хочется', en: "What you're craving" })}
                      className="seg-group"
                    >
                      <span aria-hidden className="pl-2.5 text-faint">
                        {tr(locale, { ru: 'хочется', en: 'craving' })}
                      </span>
                      {LEAN_CHIPS[locale].map((l) => (
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
                  {switching
                    ? tr(locale, { ru: 'пересобираю…', en: 'rebuilding…' })
                    : engine === 'claude'
                      ? tr(locale, { ru: 'подбор: ИИ', en: 'picked by: AI' })
                      : tr(locale, { ru: 'подбор: по тегам', en: 'picked by: tags' })}
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
                        /* Своя строка с переносом внутри общей строки плитки:
                           подпись и цена не делят 163px телефона пополам — не
                           влезли вдвоём, цена уходит строкой ниже, а подпись
                           остаётся целой. Скидочная пара цен заняла бы почти всю
                           ширину, и обрезалась бы даже «По вкусу». */
                        <span className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-2">
                          {/* Преимущество важнее источника: «откуда» видно и по
                              герою, а «чем лучше соседних» — только здесь */}
                          <span className={`truncate ${p.edge ? 'text-ember-text' : ''}`}>
                            {p.edge
                              ? edgeBadge(p.edge, locale)
                              : p.store
                                ? (STORE_LABEL[p.store] ?? p.store)
                                : sourceBadgeShort(p.source, locale)}
                          </span>
                          {/* Цена — только у не купленного: у своей игры она уже
                              ничего не решает, а место в строке занимает */}
                          {p.source === 'new' && (
                            <PriceTag
                              priceFinal={p.priceFinal}
                              cc={p.priceCc}
                              unsold={p.unsold}
                              discount={p.discount}
                              isFree={p.isFree}
                              showPercent={false}
                              className="shrink-0"
                            />
                          )}
                        </span>
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
                  {tr(locale, { ru: 'Нет в библиотеке', en: 'Not in your library' })} · {discoveries.length}{' '}
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
                  {tr(locale, { ru: 'Все скидки Steam', en: 'All Steam sales' })} <Icon name="arrow" size={14} />
                </a>
              )}
            </div>
            {shelfOpen && (
              <div id="play-shelf" className="mt-1">
                <p className="text-xs text-faint mb-4 max-w-md">
                  {tr(locale, {
                    ru: 'Подобрано по твоему вкусу среди актуального. Ничего покупать не нужно — это просто на будущее.',
                    en: "Picked for your taste from what's out now. No need to buy anything — it's just for later.",
                  })}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-6">
                  {discoveries.map((p, i) => {
                    // Отзывы — ответ на «а стоит ли покупать», поэтому только на
                    // полке покупок: у своей игры этот вопрос уже решён
                    const reviews = reviewsBrief(p.reviewsPercent, p.reviewsTotal, locale)
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
                                cc={p.priceCc}
                                unsold={p.unsold}
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
                          {/* Перед покупкой «без русского» весит не меньше отзывов */}
                          {p.russian && <span className="text-xs text-faint mt-1 block">{p.russian}</span>}
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
  const locale = useLocale()
  const [said, setSaid] = useState('')
  const say = useCallback((line: string) => setSaid((prev) => freshLine(prev, line)), [])
  return (
    <>
      <p role="status" className="sr-only">
        {liveLineOn(locale, said)}
      </p>
      <Suspense fallback={<WarmupScreen progress={null} message={PREPARE_MESSAGE[locale]} />}>
        <Player say={say} />
      </Suspense>
    </>
  )
}
