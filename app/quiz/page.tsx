'use client'

import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { AnimatePresence, motion } from 'motion/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { ArtWash } from '@/components/ArtWash'
import { ClickSpark } from '@/components/ClickSpark'
import { CountNumber } from '@/components/CountNumber'
import { AnswerPanel } from '@/components/quiz/AnswerPanel'
import { AxisRail } from '@/components/quiz/AxisRail'
import { SplitHeading } from '@/components/SplitHeading'
import { stashQuizCover } from '@/lib/handoff'
import { NEUTRAL_MOOD } from '@/lib/mood'
import { plural } from '@/lib/plural'
import { VIBE_PRESETS } from '@/lib/presets'
import { type AnswerValue, countKey, moodCaption, STEPS } from '@/lib/quiz'
import { type QuizBoard, quizBoard } from '@/lib/quizcovers'
import type { Focus } from '@/lib/recommend'
import type { Mood } from '@/lib/types'

gsap.registerPlugin(useGSAP)

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Такт подтверждения нажатия перед сменой шага.
 *
 * Чуть меньше --dur-fast: за это время волосок успевает развернуться, а глиф —
 * загореться, и человек видит, что его нажатие принято. Раньше подтверждения не
 * было вовсе: первые два ответа просто подменяли экран, и единственная церемония
 * доставалась третьему.
 */
const CONFIRM_MS = 150

/**
 * Сколько длится финальный такт до ухода на /play.
 *
 * Ровно столько же ждёт таймер навигации, и таймер этот СПЕЦИАЛЬНО живёт вне
 * gsap: если анимация не отработает (скрытая вкладка, задушенный rAF, сбой
 * плагина), человек всё равно должен уехать на выдачу, а не остаться на
 * замершем квизе. Та же логика, по которой .anim-page-in оставлен без
 * fill-mode: анимация может только добавить проявление, но не может запереть.
 */
const OUTRO_MS = 640

/** Направление задаёт возврат по рельсу: шаг возвращается оттуда, куда ушёл. */
const STEP_VARIANTS = {
  enter: (back: boolean) => ({ opacity: 0, x: back ? -24 : 24 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.28, ease: EASE } },
  exit: (back: boolean) => ({
    opacity: 0,
    x: back ? 24 : -24,
    transition: { duration: 0.2, ease: 'easeIn' as const },
  }),
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

  /** Уход на выдачу. Живёт отдельно от анимации — см. докблок OUTRO_MS. */
  useEffect(() => {
    if (!outro) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const t = window.setTimeout(() => router.push(moodUrl(outro, { focus })), reduce ? 0 : OUTRO_MS)
    return () => window.clearTimeout(t)
  }, [outro, focus, router])

  /**
   * Финальный такт: невыбранные панели уходят в размытие, выбранная делает шаг
   * вперёд, ответы собираются в одну строку. Эта же строка и обложка этого же
   * ответа встретят человека на экране ожидания — шов между экранами держится
   * на содержании и на картинке, а не на геометрии: App Router сносит дерево
   * квиза до монтирования выдачи, и общий layoutId между маршрутами невозможен.
   */
  useGSAP(
    () => {
      if (!outro) return
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
      const tl = gsap.timeline({ defaults: { ease: 'power3.out' } })
      tl.to(
        '[data-answer]:not([data-chosen])',
        { opacity: 0, filter: 'blur(10px)', duration: 0.24 },
        0,
      )
        .to('[data-answer][data-chosen]', { scale: 1.04, duration: 0.4 }, 0.1)
        .from('[data-outro]', { opacity: 0, y: 10, duration: 0.3 }, 0.2)
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
          const cover = board.covers[chosen]
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

  // Фон держит обложку наведённого ответа, а без наведения — первую доступную
  // на шаге. На тач-устройствах курсора нет вовсе, и второй случай там основной.
  const backdrop =
    (hovered && board.covers[hovered]) ||
    step.options.map((o) => board.covers[o.value as AnswerValue]).find(Boolean) ||
    null

  const count = board.counts?.[countKey(answers)]

  const wide = step.options.length === 3

  return (
    <div
      ref={scope}
      className="media-dark relative flex flex-1 flex-col items-center overflow-hidden px-5 pb-16 pt-24"
    >
      {/* Дыхание — та же анимация, что на экране ожидания: 12 с на грани
          заметности. До этого квиз стоял неподвижно до первого касания. */}
      <Ambient className="anim-breathe" />
      <ArtWash cover={backdrop ?? null} />
      <div aria-hidden className="grain" />

      <div className="relative flex w-full max-w-5xl flex-col gap-8">
        <AxisRail stepIndex={stepIndex} answers={answers} onJump={jump} />

        {/* Смена вопроса не была озвучена ничем: таб работал, а куда именно
            попал человек — приходилось угадывать. */}
        <p aria-live="polite" className="sr-only">
          Шаг {stepIndex + 1} из {STEPS.length}. {step.question}
        </p>

        {/*
          Число живёт СНАРУЖИ AnimatePresence, а вопрос — внутри.

          Не вкусовщина: внутри оно пересоздавалось бы на каждом шаге вместе с
          ключом, и CountNumber терял бы память о предыдущем значении — то есть
          вместо сужения 16 → 4 → 2 каждый раз шёл бы разгон с нуля. Заодно это
          и правильнее по смыслу: число относится ко всему квизу, а не к
          отдельному вопросу, и уезжать вместе с ним ему незачем.

          Высота под вопрос зарезервирована двумя строками на телефоне и одной
          на десктопе: без этого «Сколько у тебя времени?» переносится там, где
          остальные два вопроса — нет, и панели под ним ездили бы вверх-вниз
          между шагами. Кегль стоит на обёртке, чтобы min-h в em считался от
          него, а не от базовых 16px.
        */}
        <div className="flex w-full flex-col gap-2 md:flex-row md:items-end md:justify-between md:gap-10">
          <div className="order-last flex min-h-[1.9em] items-end text-[clamp(2rem,6.5vw,4.5rem)] leading-[0.95] md:order-first md:min-h-[0.95em]">
            <AnimatePresence mode="wait" custom={back}>
              <motion.div
                key={step.key}
                custom={back}
                variants={STEP_VARIANTS}
                initial="enter"
                animate="center"
                exit="exit"
              >
                <SplitHeading as="h1" className="font-quiz font-semibold uppercase tracking-tight">
                  {step.question}
                </SplitHeading>
              </motion.div>
            </AnimatePresence>
          </div>

          {count !== undefined && (
            <div className="order-first flex shrink-0 items-baseline gap-2 md:order-last md:flex-col md:items-end md:gap-0.5">
              <CountNumber
                value={count}
                fromPrevious
                duration={520}
                className="font-mono text-xl font-extrabold text-ink md:text-4xl"
              />
              <span className="text-xs text-faint">
                {plural(count, 'игра', 'игры', 'игр')} в бэклоге
                {stepIndex > 0 ? ' под это' : ''}
              </span>
            </div>
          )}
        </div>

        <AnimatePresence mode="wait" custom={back}>
          <motion.div
            key={step.key}
            custom={back}
            variants={STEP_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            role="group"
            aria-label={step.question}
            className={`grid w-full gap-3 md:gap-4 ${
              wide ? 'md:grid-cols-3' : 'md:max-w-2xl md:grid-cols-2'
            } ${outro ? 'pointer-events-none' : ''}`}
          >
            {step.options.map((option, i) => {
              const value = option.value as AnswerValue
              const marked = chosen === value || (outro && outro[step.key] === value)
              return (
                <div key={value} data-answer data-chosen={marked ? '' : undefined}>
                  <AnswerPanel
                    value={value}
                    index={i}
                    label={option.label}
                    hint={option.hint}
                    cover={board.covers[value] ?? null}
                    live={hovered === value}
                    chosen={chosen === value}
                    eager={stepIndex === 0}
                    onSelect={() => pick(value)}
                    onPreview={() => setHovered(value)}
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
          <div data-outro className="relative self-start">
            {/*
              Единственный залп искр за весь квиз, и он приходится на
              единственный момент, который что-то завершает. Осыпать искрами
              каждый из семи ответов означало бы превратить жест в механизм —
              ровно то, чего избегает докблок самого ClickSpark.
            */}
            <ClickSpark fireOnMount fireDelay={450}>
              <p className="font-quiz text-lg uppercase tracking-wide md:text-xl">
                {moodCaption(outro)}
              </p>
            </ClickSpark>
          </div>
        )}

        {stepIndex === 0 && !outro && (
          <div className="anim-rise w-full">
            <div className="h-px w-full bg-edge" />
            <p className="mt-5 text-xs text-faint">
              {focus
                ? 'только то, что ты ни разу не запускал — выбери настроение:'
                : 'или одним тапом:'}
            </p>

            {/*
              Скроллер, а не перенос. Семь чипов во flex-wrap давали рваные три
              ряда на десктопе и пять на телефоне — блок из ярлыков весил больше
              самого вопроса, ради которого страница существует.
            */}
            <div className="-mx-5 mt-3 flex snap-x gap-2 overflow-x-auto px-5 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
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

            {/* Отдельной строкой: это не ещё два настроения, а другой класс
                действия — рулетка и срез библиотеки. В общем потоке они
                вставали случайными местами и читались как случайно раскрашенные. */}
            <div className="mt-3 flex flex-wrap gap-2">
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
