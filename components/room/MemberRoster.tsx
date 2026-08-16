'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { RoomMemberView } from '@/lib/room'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Кто в комнате и кто где застрял.
 *
 * Опрос и раньше приносил голоса всех участников каждые 2.5 секунды — экран
 * ожидания не показывал из них ничего и спрашивал «ждём остальных» в пустоту.
 * Здесь ровно те же данные, но в виде ответа на единственный вопрос, который
 * у человека есть: почему я всё ещё тут.
 *
 * Полоса — тот же объект, что прогресс колоды в SwipeDeck (bg-track + bg-ember,
 * 0.3s, тот же EASE): человек только что смотрел на неё двадцать карт подряд.
 */
export function MemberRoster({
  members,
  deckSize,
}: {
  members: RoomMemberView[]
  deckSize: number | null
}) {
  const reduce = useReducedMotion()
  const doneCount = members.filter((m) => m.done).length

  return (
    <div className="relative glass rounded-[20px] p-5 sm:p-6 flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold tracking-tight">Кто где</h2>
        <span aria-hidden className="text-xs text-faint font-mono tabular-nums shrink-0">
          {doneCount}/{members.length}
        </span>
      </div>

      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {members.map((m) => {
            // Голосов может оказаться больше, чем карт: колода пересобирается
            // при входе нового человека, а голоса по старой уже записаны
            const shown = deckSize ? Math.min(m.votes, deckSize) : m.votes
            const pct = deckSize ? Math.min(100, (m.votes / deckSize) * 100) : 0

            return (
              <motion.li
                key={m.id}
                // MotionConfig reducedMotion="user" не отключает layout-анимации,
                // поэтому гасим их здесь же — иначе строки продолжат ездить
                layout={!reduce}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: 8 }}
                transition={{ duration: 0.3, ease: EASE }}
                className="flex items-center gap-3"
              >
                <span aria-hidden className="w-4 shrink-0 flex justify-center">
                  {m.done ? (
                    <span className="text-ok text-sm leading-none">✓</span>
                  ) : (
                    <span className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
                  )}
                </span>

                <span
                  title={m.name}
                  className={`w-[5.5rem] sm:w-40 shrink-0 truncate text-sm ${
                    m.me ? 'text-ink font-semibold' : 'text-dim'
                  }`}
                >
                  {m.name}
                  {m.me ? ' (ты)' : ''}
                </span>

                <span
                  aria-hidden
                  className="h-1 flex-1 min-w-[3rem] rounded-full bg-track overflow-hidden"
                >
                  <motion.span
                    className="block h-full rounded-full bg-ember"
                    initial={false}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.3, ease: EASE }}
                  />
                </span>

                {/*
                  .anim-pulse-dot выключается в prefers-reduced-motion, поэтому
                  «свайпает» и «готов» не имеют права держаться на движении.
                  Различает их ФОРМА — галочка против точки, — она работает
                  всегда и на любой ширине. Слово рядом это подтверждает, но
                  на мобиле уезжает: там строка и так плотная, а смысл уже несут
                  галочка и число. Полная фраза — в sr-only ниже.
                */}
                <span aria-hidden className="text-xs text-faint shrink-0 hidden sm:inline">
                  {m.done ? 'готов' : 'свайпает'}
                </span>
                <span aria-hidden className="text-xs text-faint font-mono tabular-nums shrink-0">
                  {deckSize ? `${shown}/${deckSize}` : shown}
                </span>

                <span className="sr-only">
                  {m.name}
                  {m.me ? ' (ты)' : ''}: {shown}
                  {deckSize ? ` из ${deckSize}` : ''}, {m.done ? 'закончил' : 'ещё свайпает'}
                </span>
              </motion.li>
            )
          })}
        </AnimatePresence>
      </ul>

      <p className="text-xs text-faint">Матч появится сам — обновлять не надо.</p>
    </div>
  )
}
