'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Ambient } from '@/components/Ambient'
import { ArtWash } from '@/components/ArtWash'
import { ClickSpark } from '@/components/ClickSpark'
import { CountNumber } from '@/components/CountNumber'
import { AnswerPanel } from '@/components/quiz/AnswerPanel'
import { AxisRail } from '@/components/quiz/AxisRail'
import { QuizShelf } from '@/components/quiz/QuizShelf'
import {
  endIntro,
  readIntro,
  readIntroOnServer,
  subscribeIntro,
} from '@/components/quiz/introOnce'
import { RoomBed } from '@/components/quiz/RoomBed'
import { playCue } from '@/components/quiz/sound'
import { SoundToggle } from '@/components/quiz/SoundToggle'
import { TitleCard } from '@/components/quiz/TitleCard'
import { useTier } from '@/components/quiz/useTier'
import { SplitHeading } from '@/components/SplitHeading'
import { cool, warm } from '@/lib/gpu'
import { stashQuizCover } from '@/lib/handoff'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { CONFIRM_MS, DUR, EASE, EASE_IN, OUTRO, RELIGHT } from '@/lib/motion'
import { plural } from '@/lib/plural'
import { VIBE_PRESETS } from '@/lib/presets'
import { type AnswerValue, countKey, moodCaption, STEPS } from '@/lib/quiz'
import { type QuizBoard, quizBoard } from '@/lib/quizcovers'
import type { Focus } from '@/lib/recommend'
import type { Mood } from '@/lib/types'

gsap.registerPlugin(useGSAP, CustomEase)

/**
 * GSAP-двойник --ease-out: та же кривая, что у CSS-переходов и motion (EASE).
 * Раньше таймлайны квиза ехали на power3.out — близкой, но другой кривой, и
 * финальный такт звучал в чужой тональности. Создаётся лениво: CustomEase
 * трогать на сервере незачем.
 */
let appOut: gsap.EaseFunction | null = null
function appOutEase(): gsap.EaseFunction {
  appOut ??= CustomEase.create('appOut', '0.22, 1, 0.36, 1')
  return appOut
}

/** GSAP-двойник --ease-strike: контакт. Свет БЬЁТ, а не приезжает. */
let appStrike: gsap.EaseFunction | null = null
function strikeEase(): gsap.EaseFunction {
  appStrike ??= CustomEase.create('appStrike', '0.05, 0.9, 0.1, 1')
  return appStrike
}

/** GSAP-двойник --ease-in: уходящее ускоряется. */
let appIn: gsap.EaseFunction | null = null
function inEase(): gsap.EaseFunction {
  appIn ??= CustomEase.create('appIn', '0.7, 0, 0.84, 0')
  return appIn
}

/** GSAP-двойник --ease-glow: мягкий разлив крупных поверхностей. */
let appGlow: gsap.EaseFunction | null = null
function glowEase(): gsap.EaseFunction {
  appGlow ??= CustomEase.create('appGlow', '0.33, 1, 0.68, 1')
  return appGlow
}

/** GSAP-двойник --ease-lift: ~6% перелёта, только победитель финала. */
let appLift: gsap.EaseFunction | null = null
function liftEase(): gsap.EaseFunction {
  appLift ??= CustomEase.create('appLift', '0.34, 1.36, 0.64, 1')
  return appLift
}

/** Направление задаёт возврат по рельсу: шаг возвращается оттуда, куда ушёл. */
const STEP_VARIANTS = {
  enter: (back: boolean) => ({ opacity: 0, x: back ? -24 : 24 }),
  center: { opacity: 1, x: 0, transition: { duration: DUR.base, ease: EASE } },
  exit: (back: boolean) => ({
    opacity: 0,
    x: back ? 24 : -24,
    transition: { duration: DUR.fast, ease: EASE_IN },
  }),
}

/**
 * Заголовок НЕ ездит по горизонтали вместе с карточками: боковой сдвиг — язык
 * панелей, он кодирует направление по рельсу, а заголовку направление не нужно.
 * Его вход — это стаггер слов SplitHeading; обёртке остаётся только фейд,
 * который заодно прячет кадр до старта стаггера. Раньше обе системы двигали
 * один элемент с разными кривыми, и на смене шага это читалось как двоение.
 */
const HEADING_VARIANTS = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: DUR.fast, ease: EASE } },
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: EASE_IN } },
}

/**
 * «Уменьшить движение» как внешний источник истины — тот же приём, что у
 * ThemeToggle с атрибутом темы. Значение нужно ВО ВРЕМЯ отрисовки (постель
 * света получает его пропом), а состояние с записью из эффекта здесь было бы
 * лишним рендером на каждом заходе.
 */
const REDUCE_QUERY = '(prefers-reduced-motion: reduce)'
function subscribeReduce(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCE_QUERY)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
function readReduce(): boolean {
  return window.matchMedia(REDUCE_QUERY).matches
}
/** На сервере медиазапросов нет; там движение считаем включённым. */
function readReduceOnServer(): boolean {
  return false
}

function moodUrl(mood: Mood, opts: { roulette?: boolean; focus?: Focus | null } = {}): string {
  const q = new URLSearchParams(mood as unknown as Record<string, string>)
  if (opts.roulette) q.set('roulette', '1')
  if (opts.focus) q.set('from', opts.focus)
  return `/play?${q.toString()}`
}

function Quiz() {
  const router = useRouter()
  const search = useSearchParams()
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Partial<Mood>>({})
  const [back, setBack] = useState(false)
  const [board, setBoard] = useState<QuizBoard>({ covers: {} })
  const [hovered, setHovered] = useState<AnswerValue | null>(null)
  /** Нажат, но шаг ещё не сменился — те самые CONFIRM_MS */
  const [chosen, setChosen] = useState<AnswerValue | null>(null)
  /** Непусто ровно в финальном такте: квиз уже отвечен, но ещё не ушёл */
  const [outro, setOutro] = useState<Mood | null>(null)
  /**
   * Читается один раз и живёт в состоянии, потому что нужен ВО ВРЕМЯ отрисовки
   * (постель света получает его пропом). MotionConfig reducedMotion="user"
   * здесь не помощник: он глушит transform и layout, но оставляет opacity, а
   * перекраска комнаты обязана быть состоянием, а не фейдом.
   */
  const reduce = useSyncExternalStore(subscribeReduce, readReduce, readReduceOnServer)
  /** Титры владеют экраном. Пока true — ни один ответ принять нельзя. */
  const intro = useSyncExternalStore(subscribeIntro, readIntro, readIntroOnServer)
  /**
   * Ящик пресетов. Закрыт по умолчанию: створка во весь экран не делит нижнюю
   * полосу с рядом кнопок — там уже стоят подписи ответов. Ручка живёт в
   * служебной строке сверху, вместе с тумблером звука.
   */
  const [presets, setPresets] = useState(false)
  const scope = useRef<HTMLDivElement>(null)
  const panels = useRef<Array<HTMLButtonElement | null>>([])
  /**
   * Ось, на которой комната горит прямо сейчас. Именно ось, а не флаг «уже
   * запускались»: под StrictMode эффекты гоняются монтирование → очистка →
   * монтирование, а реф это переживает — и флаг давал такт перекраски прямо на
   * загрузке страницы, который тут же обрывался очисткой и оставлял кадр
   * притемнённым навсегда. Сравнение ключей честно отвечает на нужный вопрос:
   * СМЕНИЛСЯ ли шаг.
   */
  const litAxis = useRef<string | null>(null)
  const sampleTier = useTier()

  const step = STEPS[stepIndex]
  // Приходит с /library («Разгрести →») и живёт до самого /play. Не настроение,
  // а отдельная ось — как roulette у «Мне повезёт»
  const focus: Focus | null = search.get('from') === 'untouched' ? 'untouched' : null

  /**
   * Обложки и числа НЕ блокируют отрисовку: панели рендерятся текстом сразу,
   * арт вплывает следом. Квиз до сих пор не ходил в сеть вовсе, и терять эту
   * мгновенность ради картинок нельзя. Запрос чаще всего уже в пути — его
   * начинает посадочная (см. primeQuizBoard).
   */
  useEffect(() => {
    let alive = true
    void quizBoard(Boolean(focus)).then((next) => {
      if (alive) setBoard(next)
    })
    return () => {
      alive = false
    }
  }, [focus])

  /**
   * Эмбиент-петли встают, когда вкладка не видна. Четыре бесконечные анимации
   * на фоновой вкладке греют GPU и жгут батарею, ничего не показывая; в
   * ноутбуке это слышно вентилятором.
   */
  useEffect(() => {
    const root = document.documentElement
    const sync = () => {
      if (document.visibilityState === 'visible') delete root.dataset.quizHidden
      else root.dataset.quizHidden = ''
    }
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      delete root.dataset.quizHidden
    }
  }, [])

  /**
   * Последний шаг — два возможных ответа, значит два возможных адреса. Оба
   * дешевле прогреть заранее, чем оставить переход на конец финального такта.
   */
  useEffect(() => {
    if (stepIndex !== STEPS.length - 1) return
    for (const option of STEPS[2].options) {
      router.prefetch(moodUrl({ ...answers, social: option.value } as Mood, { focus }))
    }
  }, [stepIndex, answers, focus, router])

  /**
   * Уход на выдачу. Таймер СПЕЦИАЛЬНО живёт вне gsap: если анимация не
   * отработает (скрытая вкладка, задушенный rAF, сбой плагина), человек всё
   * равно должен уехать на выдачу, а не остаться на замершем квизе. Та же
   * логика, по которой .anim-page-in оставлен без fill-mode: анимация может
   * только добавить проявление, но не может запереть.
   */
  useEffect(() => {
    if (!outro) return
    const soft = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Ноль мс означал, что человек с выключенными анимациями НИКОГДА не видел,
    // что его ответ принят: выдача открывалась в тот же кадр. Твинов
    // по-прежнему нет, но статическое состояние обязано побыть на экране.
    const t = window.setTimeout(
      () => router.push(moodUrl(outro, { focus })),
      soft ? OUTRO.reducedNavMs : OUTRO.navMs,
    )
    return () => window.clearTimeout(t)
  }, [outro, focus, router])

  /**
   * ПЕРЕКРАСКА КОМНАТЫ. Свет — единственное, что отличает один вопрос от
   * другого, и провал диммера прячет склейку между ними.
   *
   * Ключ такта — step.key, а НЕ вызов из pick(): возврат по рельсу обязан
   * получить ровно тот же такт, иначе jump() назад выглядел бы обрывом. Это же
   * снимает целый класс ошибок вида «чередуем две лампы по чётности шага»:
   * с нулевого на второй и обратно чётность совпадает, и лампа перетекала бы
   * сама в себя.
   *
   * Пик темноты приходится ровно на --dur-fast — момент, когда AnimatePresence
   * подменяет детей. Такт не удлиняет взаимодействие: он ложится ПОВЕРХ уже
   * существующей сериализации exit→enter, а не после неё.
   */
  useGSAP(
    () => {
      const from = litAxis.current
      litAxis.current = step.key
      // Первая отрисовка и повторный прогон того же шага — не перекраска.
      if (from === null || from === step.key) return
      if (reduce) return
      const dip = scope.current?.querySelector<HTMLElement>('[data-quiz-dip]')
      if (!dip) return

      // Замер уровня открывается на ПЕРВОЙ перекраске, а не на простое: мерить
      // самый дешёвый момент и делать выводы по его лёгкости — мерить не то.
      sampleTier()
      // Развёртка фильтра — звуковой аналог смены геля на лампе. Корень свой
      // на каждый шаг: три перекраски складываются в каденцию.
      playCue('relight', Math.min(stepIndex, 2) as 0 | 1 | 2)

      warm(dip, 'opacity')
      const tl = gsap.timeline({
        onComplete: () => cool(dip),
      })
      tl.to(
        dip,
        { opacity: RELIGHT.dipPeak, duration: RELIGHT.dipInDur, ease: strikeEase() },
        RELIGHT.dipAt,
      ).to(dip, { opacity: 0, duration: RELIGHT.dipOutDur, ease: appOutEase() })

      return () => {
        // tl.kill() НЕ зовёт onComplete — без этой строки слой остаётся
        // продвинутым до выгрузки страницы. Классическая утечка текстур.
        cool(dip)
        tl.kill()
        // Оборванный провал обязан вернуть свет. kill() оставляет текущее
        // значение как есть, и полутёмный кадр залипал бы до ухода со страницы —
        // ровно то, что запрещает закон «анимация не может спрятать».
        gsap.set(dip, { opacity: 0 })
      }
    },
    { scope, dependencies: [step.key, reduce] },
  )

  /**
   * Финальный такт (партитура — OUTRO в lib/motion.ts): невыбранные панели
   * растворяются размытием раскрытия, выбранная делает шаг вперёд и доезжает
   * рывок резкости (data-chosen на ней живёт весь такт), свет локапа уходит на
   * строку настроения, залп искр доигрывает целиком до навигации. Эта же
   * строка и обложка этого же ответа встретят человека на экране ожидания —
   * шов между экранами держится на содержании и на картинке, а не на
   * геометрии: App Router сносит дерево квиза до монтирования выдачи, и общий
   * layoutId между маршрутами невозможен.
   */
  useGSAP(
    () => {
      if (!outro) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const root = scope.current
      const losers = root?.querySelectorAll<HTMLElement>('[data-answer]:not([data-chosen])')
      const streak = root?.querySelector<HTMLElement>('[data-quiz-streak]')
      const winner = root?.querySelector<HTMLElement>('[data-answer][data-chosen]')

      // Косая летит на уровне КАДРА, а не внутри панели: overflow панели
      // обрезал бы её ровно там, где она обязана вылететь наружу. Высоту берём
      // одним замером через setProperty — инлайновый объект с кастомным
      // свойством под strict это TS2353, в проекте принят этот путь.
      if (streak && winner && root) {
        const a = winner.getBoundingClientRect()
        const b = root.getBoundingClientRect()
        streak.style.setProperty('--streak-y', `${Math.round(a.top - b.top + a.height * 0.42)}px`)
      }

      warm(losers?.[0], 'opacity,transform')
      warm(streak, 'opacity')

      // Удар финала звучит вместе с искрами и обрывается жёстко до навигации:
      // ничто не должно пережить снос дерева квиза.
      const cue = window.setTimeout(() => playCue('outro'), OUTRO.sparkAt)

      const tl = gsap.timeline({
        defaults: { ease: appOutEase() },
        onComplete: () => {
          cool(losers?.[0])
          cool(streak)
        },
      })

      tl
        /*
         * Створки проигравших ЗАКРЫВАЮТСЯ: ширина уходит в ноль (это делает
         * CSS по data-shut, одним свойством на контейнере), а сюда остаётся
         * только гашение.
         *
         * Прежний такт вёл filter: blur(16px) brightness(.2) — и на створке во
         * весь экран это был бы АНИМИРУЕМЫЙ ФИЛЬТР РАЗМЕРОМ С ВЬЮПОРТ, ровно
         * то, что запрещает пятый закон материала. Тест этого не ловит:
         * quizgpu грепает CSS, а такт живёт в GSAP. Затвор и дешевле, и
         * честнее по смыслу — ответ не расплывается, его закрывают.
         */
        .to(
          '[data-answer]:not([data-chosen])',
          { opacity: 0, duration: OUTRO.losersDur, ease: inEase() },
          OUTRO.losersAt,
        )
        // Комнату заливает ключевым светом и стягивает виньеткой.
        .to('.quiz-rays', { opacity: 0.78, duration: OUTRO.keyDur, ease: glowEase() }, OUTRO.keyAt)
        .to(
          '.quiz-vignette[data-tight]',
          { opacity: 1, duration: OUTRO.keyDur, ease: glowEase() },
          OUTRO.keyAt,
        )
        // Победитель делает ШАГ ВПЕРЁД: перелёт ~6% отличает шаг от ресайза.
        .to(
          '[data-answer][data-chosen]',
          { scale: 1.04, y: -6, duration: OUTRO.winnerDur, ease: liftEase() },
          OUTRO.winnerAt,
        )
        .fromTo(
          '[data-quiz-streak]',
          { scaleX: 0.16, opacity: 0 },
          { scaleX: 1, opacity: 0.9, duration: OUTRO.flareDur, ease: strikeEase() },
          OUTRO.flareAt,
        )
        .to('[data-quiz-lockup]', { opacity: 0.3, duration: OUTRO.captionDur }, OUTRO.captionAt)
        // Полке — ТОЛЬКО непрозрачность: её transform занят дрожанием кадра,
        // и две системы не должны драться за одно свойство.
        .to('[data-quiz-shelf]', { opacity: 0.2, duration: OUTRO.captionDur }, OUTRO.captionAt)
        .from('[data-outro]', { opacity: 0, y: 10, duration: OUTRO.captionDur }, OUTRO.captionAt)
        .to(
          '[data-quiz-streak]',
          { opacity: 0, duration: OUTRO.flareDur, ease: appOutEase() },
          OUTRO.flareAt + OUTRO.flareDur,
        )
        // ШОВ: свет возвращается к покою, чтобы последний кадр квиза совпал по
        // весу с первым кадром выдачи — там та же обложка в ArtWash immediate.
        .to(
          '.quiz-rays',
          { opacity: 0.5, duration: OUTRO.roomOutDur, ease: glowEase() },
          OUTRO.roomOutAt,
        )
        .to(
          '.quiz-vignette[data-tight]',
          { opacity: 0, duration: OUTRO.roomOutDur, ease: glowEase() },
          OUTRO.roomOutAt,
        )

      return () => {
        // tl.kill() не зовёт onComplete — снимаем подсказки слоёв руками.
        window.clearTimeout(cue)
        cool(losers?.[0])
        cool(streak)
        tl.kill()
      }
    },
    { scope, dependencies: [outro] },
  )

  function go(mood: Mood, opts: { roulette?: boolean; focus?: Focus } = {}) {
    router.push(moodUrl(mood, { roulette: opts.roulette, focus: opts.focus ?? focus }))
  }

  const pick = useCallback(
    (value: AnswerValue) => {
      // Пока идёт такт подтверждения, второе нажатие не должно проскочить
      // через шаг: иначе двойной клик отвечает сразу на два вопроса.
      //
      // intro — отдельная и обязательная защёлка. Слушатель цифр висит на окне
      // с монтирования, и карточка гасится любой клавишей тоже через окно:
      // нажатие «1» во время титров запускало БЫ ОБА обработчика, и человек
      // отвечал бы на вопрос, которого не видел. Оба слушателя на window,
      // порядок — порядок регистрации, stopPropagation тут не помощник.
      if (outro || chosen || intro) return
      /*
       * Ответ обязан принадлежать ТЕКУЩЕЙ оси.
       *
       * При mode="wait" уходящая сетка живёт в DOM ещё --dur-fast и всё это
       * время кликабельна, а её панель зовёт pick() со своим значением —
       * которое такт подтверждения запишет уже в НОВУЮ ось. Быстрый клик по
       * исчезающей карточке отправлял на выдачу невозможное настроение вида
       * time=engaged. Проверка по значению, а не по таймингу: она верна
       * независимо от того, сколько длится уход.
       */
      if (!step.options.some((o) => o.value === value)) return
      playCue('select')
      setChosen(value)
    },
    [outro, chosen, intro, step],
  )

  /** Такт отыграл — принимаем ответ и двигаем шаг */
  useEffect(() => {
    if (!chosen) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = window.setTimeout(
      () => {
        const next = { ...answers, [step.key]: chosen }
        setAnswers(next)
        setBack(false)
        setHovered(null)
        setChosen(null)
        if (stepIndex < STEPS.length - 1) {
          setStepIndex(stepIndex + 1)
        } else {
          // В шов уезжает только примари: takeQuizCover валидирует одиночный
          // объект, и массив он молча отбросил бы
          const cover = board.covers[chosen]?.[0]
          if (cover) stashQuizCover(cover)
          setOutro(next as Mood)
        }
      },
      reduce ? 0 : CONFIRM_MS,
    )
    return () => window.clearTimeout(t)
  }, [chosen, answers, step.key, stepIndex, board.covers])

  /**
   * Цифры выбирают ответ напрямую. Слушатель на окне, а не на панелях: цифра
   * должна работать и когда фокус ещё нигде, то есть сразу после загрузки.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const n = Number(e.key)
      if (!Number.isInteger(n) || n < 1 || n > step.options.length) return
      e.preventDefault()
      pick(step.options[n - 1].value as AnswerValue)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [step, pick])

  /** Стрелки водят фокус по панелям шага, Home/End — по краям */
  function onPanelKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const n = step.options.length
    const to =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? (index + 1) % n
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? (index - 1 + n) % n
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? n - 1
              : -1
    if (to < 0) return
    e.preventDefault()
    panels.current[to]?.focus()
  }

  /**
   * Возврат по рельсу. Ответы ПОСЛЕ выбранной оси стираются, включая её саму:
   * иначе рельс показывал бы значения тех шагов, до которых человек ещё не
   * дошёл заново, и они читались бы как уже решённые.
   */
  function jump(index: number) {
    if (index >= stepIndex || outro) return
    setBack(true)
    setStepIndex(index)
    setHovered(null)
    setChosen(null)
    setAnswers((prev) => {
      const nextAnswers = { ...prev }
      for (let i = index; i < STEPS.length; i++) delete nextAnswers[STEPS[i].key]
      return nextAnswers
    })
  }

  /**
   * Фон держит обложку ВЫБРАННОГО ответа, потом наведённого, потом первую
   * доступную на шаге. Приоритет не косметика: в финальном такте hovered уже
   * сброшен, и без первых двух звеньев фон подменялся бы на чужую обложку
   * ровно в тот момент, когда эта же картинка должна доехать до экрана
   * ожидания. На тач-устройствах курсора нет вовсе, там основной случай —
   * последний.
   */
  // Фону нужен примари стопки. Последнее звено маппится в [0] ДО find:
  // пустой массив truthy, и .find(Boolean) по стопкам схватил бы [].
  const backdrop =
    (outro && board.covers[outro[step.key] as AnswerValue]?.[0]) ||
    (chosen && board.covers[chosen]?.[0]) ||
    (hovered && board.covers[hovered]?.[0]) ||
    step.options.map((o) => board.covers[o.value as AnswerValue]?.[0]).find(Boolean) ||
    null

  const count = board.counts?.[countKey(answers)]

  // Полка не повторяет обложки, видимые на экране прямо сейчас: тот же резкий
  // кадр дважды читался бы как поломка, а совпадение с примари деанонимировало
  // бы размытую панель. Фильтр по ТЕКУЩЕМУ шагу, а не по всем стопкам: вычет
  // всех обложек квиза морил полку голодом на небольших библиотеках.
  const onScreen = new Set(
    step.options.flatMap((o) => (board.covers[o.value as AnswerValue] ?? []).map((c) => c.appid)),
  )
  const shelfCovers = (board.shelf ?? []).filter((c) => !onScreen.has(c.appid))

  /**
   * Индекс живой створки. Уезжает в data-атрибут сетки, а не в инлайновый
   * grid-template-columns: раскладку описывает CSS, и потому она может
   * разворачиваться в колонки на телефоне и гейтиться по наличию курсора,
   * не заглядывая в JS. −1 значит «все равны».
   */
  const litValue = (outro ? (outro[step.key] as AnswerValue) : null) ?? chosen ?? hovered
  const litIndex = litValue === null ? -1 : step.options.findIndex((o) => o.value === litValue)

  /**
   * Лампа едет за живой створкой. Пишем кастомное свойство мимо React —
   * инлайновый объект с --свойством это TS2353 под strict, и в проекте для
   * такого принят setProperty (см. SpotlightCard).
   *
   * Сдвиг считается от центра: крайняя левая створка тянет свет к себе,
   * средняя оставляет его на месте. В vw, чтобы переезд читался одинаково на
   * любой ширине.
   */
  const shutterCount = step.options.length
  useEffect(() => {
    const root = scope.current
    if (!root) return
    // −1 (все равны) оставляет лампу в покое: подсветить кого-то без запроса
    // значило бы намекнуть на рекомендацию, которой нет.
    const shift =
      litIndex < 0 || shutterCount < 2 ? 0 : (litIndex / (shutterCount - 1) - 0.5) * 2 * 13
    root.style.setProperty('--lamp-shift', `${shift}vw`)
  }, [litIndex, shutterCount])

  return (
    <div
      ref={scope}
      data-key={step.key}
      // Приведённое движение получает финал СТАТИКОЙ: проигравшие приглушены,
      // победитель обведён, подпись на месте. Ни одного твина, но выбор виден.
      data-still={outro && reduce ? '' : undefined}
      // Ящик пресетов открыт — подписи створок уезжают из-под него
      data-drawer={presets && stepIndex === 0 && !outro ? '' : undefined}
      // Ровно в высоту экрана и без единого поля: створки идут от края до края.
      // svh, а не vh — иначе на мобильном Safari нижний край уезжает под
      // адресную строку. Прецедент: components/whatsnew/Cover.tsx.
      style={{ height: '100svh' }}
      className="quiz-room media-dark relative flex flex-1 flex-col overflow-hidden"
    >
      {/*
        Порядок слоёв — это порядок разметки, z-index в квизе нет вовсе.
        Снизу вверх: дыхание, свет комнаты, размытая обложка, две виньетки,
        зерно, кадр. Переставить строки местами — значит переставить слои.
      */}
      {/* Дыхание — та же анимация, что на экране ожидания: 12 с на грани
          заметности. До этого квиз стоял неподвижно до первого касания. */}
      <Ambient className="anim-breathe" />
      <RoomBed axis={step.key} reduce={reduce} />
      <ArtWash cover={backdrop ?? null} />
      {/* Виньетки: обычная всегда, затянутая включается в финале. Градиенты не
          твинятся, поэтому их две, а переезд между ними — непрозрачность. */}
      <span aria-hidden className="quiz-vignette" />
      <span aria-hidden className="quiz-vignette" data-tight />

      {/*
        СТВОРКИ. Живут в комнате, а не в кадре, и это несущее: кадр со всем
        служебным идёт следом по разметке и потому ложится ПОВЕРХ них. Ни
        одного z-index — порядок слоёв это порядок строк.
      */}
      <AnimatePresence mode="wait" custom={back} initial={false}>
        <motion.div
          key={step.key}
          custom={back}
          variants={STEP_VARIANTS}
          initial="enter"
          animate="center"
          exit="exit"
          role="group"
          aria-label={step.question}
          data-count={step.options.length}
          data-lit={litIndex >= 0 ? litIndex : undefined}
          data-shut={outro ? '' : undefined}
          className={`quiz-grid absolute inset-0 grid ${outro ? 'pointer-events-none' : ''}`}
        >
          {step.options.map((option, i) => {
            const value = option.value as AnswerValue
            const marked = chosen === value || (outro && outro[step.key] === value)
            return (
              <div key={value} data-answer data-chosen={marked ? '' : undefined}>
                {/* chosen держится и весь финальный такт (marked, не только
                    chosen): иначе створка-победитель теряла состояние в
                    момент собственной церемонии */}
                <AnswerPanel
                  value={value}
                  index={i}
                  label={option.label}
                  hint={option.hint}
                  covers={board.covers[value] ?? []}
                  count={
                    board.counts
                      ? board.counts[countKey({ ...answers, [step.key]: value } as Partial<Mood>)]
                      : undefined
                  }
                  live={hovered === value}
                  chosen={Boolean(marked)}
                  eager={stepIndex === 0}
                  onSelect={() => pick(value)}
                  onPreview={() => setHovered(value)}
                  onLeave={() => setHovered((h) => (h === value ? null : h))}
                  onKeyDown={(e) => onPanelKey(e, i)}
                  buttonRef={(el) => {
                    panels.current[i] = el
                  }}
                />
              </div>
            )
          })}
        </motion.div>
      </AnimatePresence>

      <div aria-hidden className="grain" />

      {/*
        Кадр во весь экран. Полей нет: створки — это и есть страница, а всё
        служебное лежит НА них накладкой оператора.
      */}
      {/*
        Кадр НЕ ловит указатель: под ним живые створки во весь экран, и
        накладка оператора не имеет права отнимать у них клики. Каждый
        интерактивный кусок накладки включает pointer-events обратно сам.
      */}
      <div
        data-quiz-frame
        className="pointer-events-none relative flex w-full flex-1 flex-col overflow-hidden"
      >
        {/* Смена вопроса не была озвучена ничем: таб работал, а куда именно
            попал человек — приходилось угадывать. */}
        <p aria-live="polite" className="sr-only">
          Шаг {stepIndex + 1} из {STEPS.length}. {step.question}
        </p>

        {/* Локап. data-quiz-lockup — мишень финального такта: свет уходит
            отсюда на строку настроения. */}
        {/*
          Накладка оператора: рельс, счётчик и вопрос лежат НА створках.
          pt клиренсом под фиксированную шапку — её внутренняя строка ловит
          указатель на верхних ~60px центральных 1152px, и залезать туда
          накладке нечем.
        */}
        <div data-quiz-lockup className="px-5 pt-20 md:px-10 md:pt-24">
          <div className="pointer-events-auto mb-4 md:mb-6">
            <AxisRail
              stepIndex={stepIndex}
              answers={answers}
              onJump={jump}
              trailing={
                <span className="flex items-center gap-4">
                  {stepIndex === 0 && !outro && (
                    <button
                      type="button"
                      onClick={() => setPresets((o) => !o)}
                      aria-expanded={presets}
                      className={`-my-2 shrink-0 cursor-pointer py-2 transition-colors ${
                        presets ? 'quiz-rail-on' : 'text-faint hover:text-dim'
                      }`}
                    >
                      одним тапом
                    </button>
                  )}
                  <SoundToggle />
                </span>
              }
            />
          </div>

          {/*
            Число живёт СНАРУЖИ AnimatePresence, а вопрос — внутри.

            Не вкусовщина: внутри оно пересоздавалось бы на каждом шаге вместе
            с ключом, и CountNumber терял бы память о предыдущем значении — то
            есть вместо сужения 16 → 4 → 2 каждый раз шёл бы разгон с нуля.
            Заодно это и правильнее по смыслу: число относится ко всему квизу,
            а не к отдельному вопросу, и уезжать вместе с ним ему незачем.

            Высота под вопрос зарезервирована двумя строками на телефоне и
            одной на десктопе: без этого «Сколько у тебя времени?» переносится
            там, где остальные два вопроса — нет, и панели под ним ездили бы
            вверх-вниз между шагами. Кегль стоит на обёртке, чтобы min-h в em
            считался от него, а не от базовых 16px.
          */}
          <div className="flex w-full flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-10">
            {/*
              Вопрос ВЫХОДИТ ЗА ЛЕВЫЙ КРАЙ кадра и обрезается им. Это и есть
              разница между «заголовком страницы» и титром: титр не помещается,
              он кадрирован. Отрицательный отступ съедает поле накладки, а
              обрезку даёт overflow самого кадра.
            */}
            <div className="-ml-5 flex max-w-[13ch] items-end text-[clamp(2.5rem,6.2vw,6rem)] leading-[0.86] md:-ml-10">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step.key}
                  variants={HEADING_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  {/* Вес и трекинг переехали в .quiz-title: титульность делается
                      контрастом веса ВНУТРИ строки, а ударное слово задаёт
                      содержание (см. stress в lib/quiz.ts). Разрядка осталась
                      положительной — конденсированному Освальду в верхнем
                      регистре кириллицы нужен воздух, Ш/Ы/Ж слипаются. */}
                  <SplitHeading
                    as="h1"
                    stress={step.stress}
                    className="quiz-title quiz-ab font-quiz uppercase"
                  >
                    {step.question}
                  </SplitHeading>
                </motion.div>
              </AnimatePresence>
            </div>

            {/*
              Правый якорь: один слот, два состояния, ноль рефлоу.

              Слот рендерится ВСЕГДА. Есть число бэклога — оно и есть якорь:
              сужение 162 → 47 → 12 отвечает на каждый ответ. Числа нет (гость,
              холодная библиотека, первые сотни миллисекунд до приезда доски) —
              то же место держит цифра шага 01/03: воронка строго упорядочена,
              и для гостя это единственная цифра прогресса. Раньше блок
              рендерился только с числом: у гостей правый край пустовал, а у
              остальных число приезжало с рефлоу заголовка.
            */}
            <div className="flex shrink-0 items-baseline gap-2 md:min-h-[3.5rem] md:min-w-[7ch] md:flex-col md:items-end md:justify-end md:gap-0.5">
              {count !== undefined ? (
                <div className="anim-rise flex items-baseline gap-2 md:flex-col md:items-end md:gap-0.5">
                  <CountNumber
                    value={count}
                    fromPrevious
                    duration={550}
                    className="font-mono text-base font-extrabold text-ink md:text-4xl"
                  />
                  <span className="text-xs text-faint">
                    {plural(count, 'игра', 'игры', 'игр')} в бэклоге
                    {stepIndex > 0 ? ' под это' : ''}
                  </span>
                </div>
              ) : (
                <span className="font-mono text-base font-extrabold text-ink md:text-4xl">
                  0{stepIndex + 1}
                  <span className="text-faint">/0{STEPS.length}</span>
                </span>
              )}
            </div>
          </div>
        </div>


        {outro && (
          <div data-outro className="relative mt-10 self-center text-center">
            {/*
              Единственный залп искр за весь квиз, и он приходится на
              единственный момент, который что-то завершает. Осыпать искрами
              каждый из семи ответов означало бы превратить жест в механизм —
              ровно то, чего избегает докблок самого ClickSpark.
            */}
            <ClickSpark fireOnMount fireDelay={OUTRO.sparkAt}>
              {/* Титр по центру пустоты: та строка, которую рельс собирал по
                  ходу квиза и которая встретит человека на экране ожидания.
                  Разделители — ember: это шов, пусть он и подсвечен. */}
              <p className="font-quiz text-2xl uppercase tracking-[0.04em] md:text-4xl">
                {moodCaption(outro)
                  .split(' · ')
                  .map((part, i) => (
                    <span key={part}>
                      {i > 0 && <span className="text-ember-text"> · </span>}
                      {part}
                    </span>
                  ))}
              </p>
            </ClickSpark>
          </div>
        )}

        {/*
          Полка бэклога — только на шагах после первого: там нижнего яруса нет
          вовсе и пустота была максимальной. Шаг 0 закрыт сноской пресетов,
          а плотность на нём дают сами стопки. В финальном такте полка
          притухает (см. таймлайн выше) — титр стоит над ней. Обёртка без px:
          клип по паддингу обрубал ленту за 20px до края экрана жёстким
          срезом — теперь края растворяет маска самой полки.
        */}
        {stepIndex > 0 && (
          <div data-quiz-shelf className="pointer-events-none absolute inset-x-0 bottom-0">
            <QuizShelf covers={shelfCovers} />
          </div>
        )}

        {/* Пресеты и полка делят одну нижнюю полосу кадра и НИКОГДА не
            появляются вместе: полка живёт с шага 1, пресеты только на шаге 0.
            Клиренс под эту полосу уже заложен в подписи створок. */}
        {stepIndex === 0 && !outro && presets && (
          <div className="anim-rise quiz-drawer pointer-events-auto absolute inset-x-0 bottom-0 w-full px-5 pb-5 pt-4 md:px-10 md:pb-7">
            {focus && (
              <p className="mb-3 text-xs text-dim">
                только то, что ты ни разу не запускал — выбери настроение:
              </p>
            )}

            {/*
              Скроллер на телефоне, перенос на десктопе. Правый край скроллера
              растворяется маской (.chip-rail): полукарточка, тающая в фейде, —
              весь аффорданс «дальше есть ещё», стрелок не нужно.
            */}
            <div className="chip-rail -mx-5 mt-3 flex snap-x gap-2 px-5 pb-1 md:mx-0 md:flex-wrap md:px-0">
              {VIBE_PRESETS.map((preset) => (
                <button
                  key={preset.key}
                  onClick={() => go(preset.mood)}
                  className="quiz-chip shrink-0 snap-start cursor-pointer whitespace-nowrap px-4 py-2 text-sm"
                >
                  <span className="chip-emoji">{preset.emoji}</span> {preset.label}
                </button>
              ))}
            </div>

            {/* Отдельной строкой и у правого края: это не ещё два настроения,
                а другой класс действия — рулетка и срез библиотеки. Правая
                сторона — системная: там же живёт якорь с числом. */}
            <div className="mt-3 flex flex-wrap gap-2 md:justify-end">
              <button
                onClick={() =>
                  go(
                    {
                      time: (['short', 'medium', 'long'] as const)[Math.floor(Math.random() * 3)],
                      vibe: (['chill', 'engaged'] as const)[Math.floor(Math.random() * 2)],
                      social: 'solo',
                    },
                    { roulette: true },
                  )
                }
                className="cursor-pointer rounded-full bg-ember/15 px-4 py-2 text-sm text-ember-text transition hover:bg-ember/25"
              >
                Мне повезёт
              </button>
              <button
                onClick={() => go(NEUTRAL_MOOD, { focus: 'untouched' })}
                className="cursor-pointer rounded-full bg-ember/15 px-4 py-2 text-sm text-ember-text transition hover:bg-ember/25"
              >
                Ни разу не запускал
              </button>
            </div>
          </div>
        )}

        {/* Анаморфная косая финала. Живёт на уровне кадра, потому что обязана
            вылететь за габариты панели — внутри её обрезал бы overflow. */}
        {outro && <span aria-hidden data-quiz-streak />}

        {/* Провал диммера — ПОСЛЕДНИЙ ребёнок кадра, иначе он не накроет
            подмену панелей. Пик темноты совпадает с моментом склейки. */}
        <div aria-hidden data-quiz-dip />
      </div>

      {/* Титры — абсолютно последними в разметке, то есть поверх всего без
          единого z-index. */}
      {intro && <TitleCard onDone={endIntro} />}
    </div>
  )
}

// useSearchParams требует границы Suspense, иначе next build падает на пререндере
export default function QuizPage() {
  return (
    <Suspense>
      <Quiz />
    </Suspense>
  )
}
