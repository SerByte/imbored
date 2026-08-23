'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Ambient } from '@/components/Ambient'
import { CountNumber } from '@/components/CountNumber'
import { ProgressRing } from '@/components/ProgressRing'
import { Spinner } from '@/components/Spinner'
import { plural } from '@/lib/plural'
import { warmupPercent, type WarmupProgress } from '@/lib/warmup'
import { Eyebrow } from '@/components/Labels'

/**
 * Экран ожидания прогрева.
 *
 * Был сделан для /play и сделан хорошо: кольцо с процентом вместо спиннера,
 * живая строка статуса, дыхание фона. На /daily всё это время висел голый
 * спиннер с неподвижной строкой — при том что ждать там ровно столько же.
 * Теперь экран один на оба места.
 *
 * Кольцо появляется только когда объём работы известен: до первого ответа
 * /api/prepare показывать «0%» было бы враньём, поэтому там спиннер.
 */
export function WarmupScreen({
  progress,
  message,
  caption,
}: {
  progress: WarmupProgress | null
  message: string
  /**
   * Настроение одной строкой — то самое, которым закончился квиз.
   *
   * Шов между экранами. Раньше последний ответ вызывал router.push в том же
   * тике, и человек проваливался с вопроса на голый спиннер: ни один из
   * экранов не подтверждал, что его вообще услышали. Геометрический морф здесь
   * невозможен (Next сносит дерево квиза до монтирования выдачи), поэтому
   * непрерывность держится на содержании.
   *
   * Пусто на /daily и при заходе на /play напрямую — там никакого квиза не
   * было, и подпись была бы взята из воздуха.
   */
  caption?: string
}) {
  const pct = warmupPercent(progress)
  const known = progress !== null && progress.total > 0

  return (
    <div className="relative flex-1 flex flex-col items-center justify-center gap-7 px-5 overflow-hidden">
      <Ambient className="anim-breathe" />
      <div aria-hidden className="grain" />

      {/* Первое, что видно на этом экране, — то последнее, что человек здесь
          сказал. Раньше на его месте не было ничего: последний ответ квиза
          вызывал переход в том же тике, и вопрос сменялся спиннером. */}
      {caption && (
        <Eyebrow tone="faint" className="relative">
          {caption}
        </Eyebrow>
      )}

      <div className="relative">
        {known ? (
          <ProgressRing
            percent={pct}
            size={160}
            stroke={8}
            duration={600}
            label={
              <div className="flex flex-col items-center gap-0.5">
                <span
                  className="font-mono text-3xl font-extrabold text-ink"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >
                  {Math.round(pct)}%
                </span>
                <span className="text-[11px] text-faint">разобрано</span>
              </div>
            }
          />
        ) : (
          <div className="flex h-40 w-40 items-center justify-center">
            <Spinner />
          </div>
        )}
      </div>

      {/* Строка статуса меняется по ходу — подменять её встык значит терять
          единственный сигнал, что что-то вообще происходит. */}
      <div className="h-5 relative w-full max-w-sm text-center">
        {/* initial={false}: это самый первый экран после ответов, и его подпись
            приезжала в HTML с opacity:0. Пока не гидратируется — человек смотрит на
            крутящуюся дугу без единого слова о том, что происходит. Смена подписей
            по ходу прогрева продолжает перетекать как раньше. */}
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={message}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 text-dim text-sm"
          >
            {message}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* Факты о человеке вместо счётчика нашей работы.
          «Осталось разобрать 812 игр» — это отчёт сервиса о себе. Числа ниже
          считаются по снапшоту без единого байта метаданных, то есть приходят
          с первым же ответом прогрева, и говорят про того, кто ждёт. */}
      {progress?.library && progress.library.games > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="text-center"
        >
          <p className="text-sm text-dim">
            <CountNumber value={progress.library.games} className="font-mono text-ink" />{' '}
            {plural(progress.library.games, 'игра', 'игры', 'игр')} в библиотеке
          </p>
          {progress.library.untouched > 0 && (
            <p className="text-sm text-dim mt-1">
              <CountNumber
                value={progress.library.untouched}
                delay={260}
                className="font-mono text-ember-text"
              />{' '}
              из них ты не открывал ни разу
            </p>
          )}
        </motion.div>
      )}
    </div>
  )
}
