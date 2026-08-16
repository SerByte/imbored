'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Ambient } from '@/components/Ambient'
import { ArtWash } from '@/components/ArtWash'
import { CountNumber } from '@/components/CountNumber'
import { ProgressRing } from '@/components/ProgressRing'
import { Spinner } from '@/components/Spinner'
import { plural } from '@/lib/plural'
import type { QuizCover } from '@/lib/quizart'
import { warmupPercent, type WarmupProgress } from '@/lib/warmup'

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
  cover,
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
  /**
   * Обложка последнего ответа квиза — та самая, которую человек разглядывал
   * секунду назад. Доезжает сюда через sessionStorage (см. lib/handoff.ts),
   * а не адресом: настроение — контракт между экранами, картинка — украшение.
   */
  cover?: QuizCover | null
}) {
  const pct = warmupPercent(progress)
  const known = progress !== null && progress.total > 0

  return (
    /*
     * С обложкой экран становится кино-зоной — по общему правилу «экраны с
     * игровым артом всегда тёмные»: контраст текста поверх произвольной обложки
     * иначе не гарантируется. Побочно это достраивает тёмный коридор
     * квиз → ожидание → выдача. Без обложки (на /daily и при прямом заходе на
     * /play) всё остаётся как было, на цветах темы.
     */
    <div
      className={`relative flex-1 flex flex-col items-center justify-center gap-7 px-5 overflow-hidden ${
        cover ? 'media-dark' : ''
      }`}
    >
      <Ambient className="anim-breathe" />
      {cover && <ArtWash cover={cover} />}
      <div aria-hidden className="grain" />

      {/* Первое, что видно на этом экране, — то последнее, что человек здесь
          сказал. Раньше на его месте не было ничего: последний ответ квиза
          вызывал переход в том же тике, и вопрос сменялся спиннером. */}
      {caption && (
        <p className="relative text-xs uppercase tracking-[0.12em] text-faint">{caption}</p>
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
        <AnimatePresence mode="wait">
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
