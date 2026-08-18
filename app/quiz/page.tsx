'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { SpotlightCard } from '@/components/SpotlightCard'
import { VIBE_PRESETS } from '@/lib/presets'
import type { Focus } from '@/lib/recommend'
import type { Mood } from '@/lib/types'

const EASE = [0.22, 1, 0.36, 1] as const

/** Направление задаёт «Назад»: шаг возвращается оттуда, куда ушёл. */
const STEP_VARIANTS = {
  enter: (back: boolean) => ({ opacity: 0, x: back ? -24 : 24 }),
  center: { opacity: 1, x: 0, transition: { duration: 0.28, ease: EASE } },
  exit: (back: boolean) => ({
    opacity: 0,
    x: back ? 24 : -24,
    transition: { duration: 0.2, ease: 'easeIn' as const },
  }),
}

type Step = {
  key: 'time' | 'vibe' | 'social'
  question: string
  options: Array<{ value: string; label: string; hint: string }>
}

const STEPS: Step[] = [
  {
    key: 'time',
    question: 'Сколько у тебя времени?',
    options: [
      { value: 'short', label: 'Меньше часа', hint: 'быстрая катка и спать' },
      { value: 'medium', label: 'Пара часов', hint: 'нормально посидеть' },
      { value: 'long', label: 'Весь вечер', hint: 'можно и утонуть' },
    ],
  },
  {
    key: 'vibe',
    question: 'Какой вайб?',
    options: [
      { value: 'chill', label: 'Расслабиться', hint: 'без стресса и потных ладоней' },
      { value: 'engaged', label: 'Напрячься', hint: 'думать, потеть, побеждать' },
    ],
  },
  {
    key: 'social',
    question: 'Один или с кем-то?',
    options: [
      { value: 'solo', label: 'Один', hint: 'только я и игра' },
      { value: 'friends', label: 'С друзьями', hint: 'нужен мультиплеер или кооп' },
    ],
  },
]

/** Настроение по умолчанию для входов, где спрашивать про него нечего */
const NEUTRAL_MOOD: Mood = { time: 'medium', vibe: 'chill', social: 'solo' }

function Quiz() {
  const router = useRouter()
  const search = useSearchParams()
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [back, setBack] = useState(false)

  const step = STEPS[stepIndex]
  // Приходит с /library («Разгрести →») и живёт до самого /play. Не настроение,
  // а отдельная ось — как roulette у «Мне повезёт»
  const focus: Focus | null = search.get('from') === 'untouched' ? 'untouched' : null

  function go(mood: Mood, opts: { roulette?: boolean; focus?: Focus } = {}) {
    const q = new URLSearchParams(mood as unknown as Record<string, string>)
    if (opts.roulette) q.set('roulette', '1')
    const from = opts.focus ?? focus
    if (from) q.set('from', from)
    router.push(`/play?${q.toString()}`)
  }

  function pick(value: string) {
    const next = { ...answers, [step.key]: value }
    setAnswers(next)
    setBack(false)
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1)
    } else {
      go(next as unknown as Mood)
    }
  }

  return (
    <div className="relative flex-1 flex flex-col items-center justify-center px-5 py-24 overflow-hidden">
      <Ambient />
      <div className="relative w-full max-w-2xl flex flex-col items-center gap-10">
        {stepIndex === 0 && (
          <div className="w-full flex flex-col items-center gap-3 anim-rise">
            <div className="flex flex-wrap justify-center gap-2">
              {VIBE_PRESETS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => go(p.mood)}
                  className="glass glass-hover rounded-full px-4 py-2 text-sm cursor-pointer"
                >
                  {p.emoji} {p.label}
                </button>
              ))}
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
                className="rounded-full bg-ember/15 text-ember-text px-4 py-2 text-sm hover:bg-ember/25 transition cursor-pointer"
              >
                Мне повезёт
              </button>
              <button
                onClick={() => go(NEUTRAL_MOOD, { focus: 'untouched' })}
                className="rounded-full bg-ember/15 text-ember-text px-4 py-2 text-sm hover:bg-ember/25 transition cursor-pointer"
              >
                Ни разу не запускал
              </button>
            </div>
            <span className="text-xs text-faint">
              {focus
                ? 'только то, что ты ни разу не запускал — выбери настроение:'
                : 'одним тапом — или ответь на три вопроса:'}
            </span>
          </div>
        )}
        <div className="flex gap-2.5">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={`h-2 w-2 rounded-full transition-colors ${
                i <= stepIndex ? 'bg-ember' : 'bg-track'
              }`}
            />
          ))}
        </div>

        {/* Шаги едут в сторону движения: вперёд — влево, «Назад» — вправо.
            Раньше шаг просто перемонтировался и появлялся на том же месте. */}
        <AnimatePresence mode="wait" custom={back}>
          <motion.div
            key={step.key}
            custom={back}
            variants={STEP_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            className="w-full flex flex-col items-center gap-10"
          >
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-center">
              {step.question}
            </h1>

            <div
              className={`grid w-full gap-4 ${step.options.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
            >
              {step.options.map((o) => (
                <SpotlightCard
                  key={o.value}
                  onClick={() => pick(o.value)}
                  className="rounded-[20px] px-6 py-8 text-left"
                >
                  <div className="text-xl font-semibold">{o.label}</div>
                  <div className="text-sm text-dim mt-1.5">{o.hint}</div>
                </SpotlightCard>
              ))}
            </div>
          </motion.div>
        </AnimatePresence>

        {stepIndex > 0 && (
          <button
            onClick={() => {
              setBack(true)
              setStepIndex(stepIndex - 1)
            }}
            className="text-sm text-dim hover:text-ink transition-colors cursor-pointer"
          >
            ← Назад
          </button>
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
