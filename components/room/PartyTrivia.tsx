'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useState } from 'react'
import { GameArt } from '@/components/GameArt'
import type { TriviaQuestion } from '@/lib/trivia'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Викторина на время ожидания.
 *
 * Три правила громкости, и они механические, а не «на глаз»:
 *
 * 1. Здесь никогда нет bg-ember. Максимум — bg-ember/15 на раскрытом ответе.
 *    Всё остальное на экране громче, поэтому блок не может выиграть внимание
 *    у ростера и тем более у церемонии матча.
 * 2. Арт всегда в rounded-[14px] с рамкой — это радиус КНОПКИ. Обложка читается
 *    как контрол; в rounded-[20px] она стала бы героем и перебила бы всё вокруг.
 * 3. Блок свёрнут по умолчанию и сворачивается сам, когда в комнате происходит
 *    настоящее — кто-то зашёл или появилось почти-совпадение.
 *
 * Последнее — не украшение. Экран ожидания существует, потому что кто-то ещё
 * не доcвайпал; человек, залипший в викторину, не сидит в войсе и не торопит
 * друга. Поэтому реальное событие всегда забирает внимание обратно.
 */
export function PartyTrivia({
  roomId,
  interruptKey,
  interruptNote,
}: {
  roomId: string
  /** меняется, когда в комнате случилось настоящее */
  interruptKey: string
  interruptNote: string
}) {
  const [open, setOpen] = useState(false)
  const [round, setRound] = useState(0)
  const [questions, setQuestions] = useState<TriviaQuestion[] | null>(null)
  const [at, setAt] = useState(0)
  const [chosen, setChosen] = useState<number | null>(null)
  const [score, setScore] = useState(0)
  const [seenKey, setSeenKey] = useState(interruptKey)
  const [interrupted, setInterrupted] = useState(false)

  // Состояние, производное от пропсов, — во время рендера, как в GameArt:
  // эффект здесь дал бы лишний кадр с раскрытой панелью поверх новости
  if (seenKey !== interruptKey) {
    setSeenKey(interruptKey)
    if (open) {
      setOpen(false)
      setInterrupted(true)
    }
  }

  const load = useCallback(
    async (r: number) => {
      const res = await fetch(`/api/room/${roomId}/trivia?round=${r}`)
      if (!res.ok) {
        setQuestions([])
        return
      }
      const data = (await res.json()) as { round: number; questions: TriviaQuestion[] }
      setQuestions(data.questions)
      setAt(0)
      setChosen(null)
      setScore(0)
    },
    [roomId],
  )

  // Нечего показать — блока нет вовсе. Пустая викторина хуже её отсутствия
  if (questions !== null && questions.length === 0 && !open) return null

  const q = questions?.[at]
  const done = questions !== null && at >= questions.length && questions.length > 0

  return (
    <div className="relative mt-auto">
      <button
        onClick={() => {
          // Загрузка висит на клике, а не на эффекте: вопросы нужны ровно
          // тогда, когда панель раскрыли, и это событие, а не синхронизация
          if (!open && questions === null) void load(round)
          setOpen(!open)
          setInterrupted(false)
        }}
        aria-expanded={open}
        aria-controls="trivia-body"
        className="w-full glass glass-hover rounded-[20px] px-5 py-4 flex items-center justify-between gap-3 text-left cursor-pointer"
      >
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">Пока ждём — маленькая викторина</span>
          <span className="text-xs text-faint">
            {interrupted ? interruptNote : 'Про ваши библиотеки. На матч не влияет.'}
          </span>
        </span>
        <span className="text-sm text-dim shrink-0">{open ? 'Свернуть ▴' : 'Играть ▾'}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id="trivia-body"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="glass rounded-[20px] mt-3 p-5 flex flex-col gap-4">
              {questions === null && <p className="text-sm text-faint">Придумываю вопросы…</p>}

              {questions !== null && questions.length === 0 && (
                <p className="text-sm text-faint">
                  Вопросы кончились — каталог у нас пока небогатый. Зато свайпать можно дальше.
                </p>
              )}

              {q && (
                <>
                  <p id="trivia-q" className="text-sm font-medium">
                    {q.prompt}
                  </p>

                  {q.image && (
                    <GameArt
                      appid={q.image.appid}
                      name=""
                      headerImage={q.image.headerImage}
                      art={q.image.art}
                      sizes="(max-width: 640px) 100vw, 560px"
                      className="w-full aspect-[460/215] object-cover rounded-[14px] border border-edge"
                    />
                  )}

                  <div
                    role="group"
                    aria-labelledby="trivia-q"
                    className={`grid gap-2 ${q.options.length > 2 ? 'grid-cols-2' : 'sm:grid-cols-2'}`}
                  >
                    {q.options.map((o, i) => {
                      const revealed = chosen !== null
                      const right = i === q.answer
                      return (
                        <button
                          key={o.label}
                          disabled={revealed}
                          onClick={() => {
                            setChosen(i)
                            if (right) setScore((s) => s + 1)
                          }}
                          className={
                            !revealed
                              ? 'rounded-[14px] glass glass-hover px-4 py-3 text-sm text-left cursor-pointer transition-colors'
                              : right
                                ? 'rounded-[14px] bg-ember/15 text-ember-text border border-edge px-4 py-3 text-sm text-left'
                                : 'rounded-[14px] bg-surface text-faint px-4 py-3 text-sm text-left'
                          }
                        >
                          {o.label}
                        </button>
                      )
                    })}
                  </div>

                  {chosen !== null && (
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p role="status" aria-live="polite" className="text-xs text-faint">
                        {chosen === q.answer ? 'Ага.' : `Не-а — ${q.options[q.answer].label}.`}
                        {q.reveal ? ` ${q.reveal}` : ''}
                      </p>
                      <button
                        onClick={() => {
                          setAt((n) => n + 1)
                          setChosen(null)
                        }}
                        className="rounded-[14px] glass glass-hover px-4 py-2 text-sm cursor-pointer shrink-0"
                      >
                        Дальше →
                      </button>
                    </div>
                  )}
                </>
              )}

              {done && (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-faint">
                    <span className="font-mono tabular-nums">{score}</span> из{' '}
                    <span className="font-mono tabular-nums">{questions.length}</span>. Ну, время
                    прошло.
                  </p>
                  <button
                    onClick={() => {
                      const next = round + 1
                      setRound(next)
                      setQuestions(null)
                      void load(next)
                    }}
                    className="rounded-[14px] glass glass-hover px-4 py-2 text-sm cursor-pointer"
                  >
                    Ещё раунд
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
