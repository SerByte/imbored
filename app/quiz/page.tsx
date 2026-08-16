'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { ArtWash } from '@/components/ArtWash'
import { ClickSpark } from '@/components/ClickSpark'
import { CountNumber } from '@/components/CountNumber'
import { AnswerPanel } from '@/components/quiz/AnswerPanel'
import { AxisRail } from '@/components/quiz/AxisRail'
import { QuizShelf } from '@/components/quiz/QuizShelf'
import { SplitHeading } from '@/components/SplitHeading'
import { stashQuizCover } from '@/lib/handoff'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { BLUR_REVEAL, CONFIRM_MS, DUR, EASE, OUTRO } from '@/lib/motion'
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

/** Направление задаёт возврат по рельсу: шаг возвращается оттуда, куда ушёл. */
const STEP_VARIANTS = {
  enter: (back: boolean) => ({ opacity: 0, x: back ? -24 : 24 }),
  center: { opacity: 1, x: 0, transition: { duration: DUR.base, ease: EASE } },
  exit: (back: boolean) => ({
    opacity: 0,
    x: back ? 24 : -24,
    transition: { duration: DUR.fast, ease: 'easeIn' as const },
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
  exit: { opacity: 0, transition: { duration: DUR.fast, ease: 'easeIn' as const } },
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
  const scope = useRef<HTMLDivElement>(null)
  const panels = useRef<Array<HTMLButtonElement | null>>([])

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
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = window.setTimeout(
      () => router.push(moodUrl(outro, { focus })),
      reduce ? 0 : OUTRO.navMs,
    )
    return () => window.clearTimeout(t)
  }, [outro, focus, router])

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
      const tl = gsap.timeline({ defaults: { ease: appOutEase() } })
      tl.to(
        '[data-answer]:not([data-chosen])',
        { opacity: 0, filter: `blur(${BLUR_REVEAL}px)`, duration: OUTRO.losersDur },
        OUTRO.losersAt,
      )
        .to('[data-answer][data-chosen]', { scale: 1.04, duration: OUTRO.winnerDur }, OUTRO.winnerAt)
        .to('[data-quiz-lockup]', { opacity: 0.3, duration: OUTRO.captionDur }, OUTRO.captionAt)
        .to('[data-quiz-shelf]', { opacity: 0.2, duration: OUTRO.captionDur }, OUTRO.captionAt)
        .from('[data-outro]', { opacity: 0, y: 10, duration: OUTRO.captionDur }, OUTRO.captionAt)
      return () => tl.kill()
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
      if (outro || chosen) return
      setChosen(value)
    },
    [outro, chosen],
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

  const wide = step.options.length === 3

  return (
    <div
      ref={scope}
      className="media-dark relative flex flex-1 flex-col items-center overflow-hidden px-5 pb-10 pt-24"
    >
      {/* Дыхание — та же анимация, что на экране ожидания: 12 с на грани
          заметности. До этого квиз стоял неподвижно до первого касания. */}
      <Ambient className="anim-breathe" />
      <ArtWash cover={backdrop ?? null} />
      <div aria-hidden className="grain" />

      {/*
        Страница — афиша из трёх ярусов: локап (рельс + вопрос + якорь), поле
        (панели ответов), сноска (пресеты, прижаты к низу через mt-auto).
        Ритм задан швами между ярусами, а не равномерным gap: вдох перед полем
        шире, чем шаг внутри локапа, и пустота под панелями — пауза афиши,
        а не недоделанный низ.
      */}
      <div className="relative flex w-full max-w-5xl flex-1 flex-col">
        {/* Смена вопроса не была озвучена ничем: таб работал, а куда именно
            попал человек — приходилось угадывать. */}
        <p aria-live="polite" className="sr-only">
          Шаг {stepIndex + 1} из {STEPS.length}. {step.question}
        </p>

        {/* Локап. data-quiz-lockup — мишень финального такта: свет уходит
            отсюда на строку настроения. */}
        <div data-quiz-lockup>
          <div className="mb-3">
            <AxisRail stepIndex={stepIndex} answers={answers} onJump={jump} />
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
            <div className="flex min-h-[1.9em] items-end text-[clamp(2.25rem,6.5vw,4.5rem)] leading-[0.95] md:min-h-[0.95em]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={step.key}
                  variants={HEADING_VARIANTS}
                  initial="enter"
                  animate="center"
                  exit="exit"
                >
                  {/* tracking чуть в плюс, не в минус: конденсированному
                      Освальду в верхнем регистре кириллицы нужен воздух —
                      Ш, Ы и Ж на 72px при отрицательной разрядке слипались */}
                  <SplitHeading
                    as="h1"
                    className="font-quiz font-semibold uppercase tracking-[0.015em]"
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
            className={`quiz-grid mt-6 grid w-full gap-3 md:mt-10 md:gap-4 ${
              wide ? 'md:grid-cols-3' : 'md:max-w-2xl md:grid-cols-2'
            } ${outro ? 'pointer-events-none' : ''}`}
          >
            {step.options.map((option, i) => {
              const value = option.value as AnswerValue
              const marked = chosen === value || (outro && outro[step.key] === value)
              return (
                <div key={value} data-answer data-chosen={marked ? '' : undefined}>
                  {/* chosen держится и весь финальный такт (marked, не только
                      chosen): иначе панель-победитель теряла состояние в
                      момент собственной церемонии и тускнела под скейлом */}
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
          <div data-quiz-shelf className="-mx-5 mt-10 md:mx-0 md:mt-auto">
            <QuizShelf covers={shelfCovers} />
          </div>
        )}

        {stepIndex === 0 && !outro && (
          <div className="anim-rise mt-auto w-full pt-6">
            <div className="h-px w-full bg-edge" />
            {focus ? (
              <p className="mt-5 text-xs text-dim">
                только то, что ты ни разу не запускал — выбери настроение:
              </p>
            ) : (
              /* Киккер, а не шёпот. Нарочно text-faint, не ember: сноска
                 обязана быть тише рельса и не спорить с локапом. */
              <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.3em] text-faint">
                одним тапом
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
                  className="glass glass-hover shrink-0 snap-start cursor-pointer whitespace-nowrap rounded-full px-4 py-2 text-sm"
                >
                  {preset.emoji} {preset.label}
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
      </div>
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
