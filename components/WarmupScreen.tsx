'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Ambient } from '@/components/Ambient'
import { ProgressRing } from '@/components/ProgressRing'
import { Spinner } from '@/components/Spinner'
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
}: {
  progress: WarmupProgress | null
  message: string
}) {
  const pct = warmupPercent(progress)
  const known = progress !== null && progress.total > 0

  return (
    <div className="relative flex-1 flex flex-col items-center justify-center gap-7 px-5 overflow-hidden">
      <Ambient className="anim-breathe" />
      <div aria-hidden className="grain" />

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
    </div>
  )
}
