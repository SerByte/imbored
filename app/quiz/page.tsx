'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { VIBE_PRESETS } from '@/lib/presets'
import type { Mood } from '@/lib/types'

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

export default function QuizPage() {
  const router = useRouter()
  const [stepIndex, setStepIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})

  const step = STEPS[stepIndex]

  function go(mood: Mood, roulette = false) {
    const q = new URLSearchParams(mood as unknown as Record<string, string>)
    if (roulette) q.set('roulette', '1')
    router.push(`/play?${q.toString()}`)
  }

  function pick(value: string) {
    const next = { ...answers, [step.key]: value }
    setAnswers(next)
    if (stepIndex < STEPS.length - 1) {
      setStepIndex(stepIndex + 1)
    } else {
      const q = new URLSearchParams(next as Record<string, string>)
      router.push(`/play?${q.toString()}`)
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
                    true,
                  )
                }
                className="rounded-full bg-ember/15 text-ember px-4 py-2 text-sm hover:bg-ember/25 transition cursor-pointer"
              >
                Мне повезёт
              </button>
            </div>
            <span className="text-xs text-dim/60">одним тапом — или ответь на три вопроса:</span>
          </div>
        )}
        <div className="flex gap-2.5">
          {STEPS.map((s, i) => (
            <span
              key={s.key}
              className={`h-2 w-2 rounded-full transition-colors ${
                i <= stepIndex ? 'bg-ember' : 'bg-white/15'
              }`}
            />
          ))}
        </div>

        <h1 key={step.key} className="text-3xl md:text-4xl font-bold tracking-tight text-center anim-rise">
          {step.question}
        </h1>

        <div
          key={`${step.key}-options`}
          className={`grid w-full gap-4 anim-rise ${step.options.length === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}
          style={{ animationDelay: '60ms' }}
        >
          {step.options.map((o) => (
            <button
              key={o.value}
              onClick={() => pick(o.value)}
              className="glass glass-hover rounded-[20px] px-6 py-8 text-left cursor-pointer"
            >
              <div className="text-xl font-semibold">{o.label}</div>
              <div className="text-sm text-dim mt-1.5">{o.hint}</div>
            </button>
          ))}
        </div>

        {stepIndex > 0 && (
          <button
            onClick={() => setStepIndex(stepIndex - 1)}
            className="text-sm text-dim hover:text-ink transition-colors"
          >
            ← Назад
          </button>
        )}
      </div>
    </div>
  )
}
