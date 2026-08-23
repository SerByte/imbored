'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Portal } from '@/components/Portal'

/**
 * Состояние догрева поверх уже показанной выдачи.
 *
 * Появилась вместе с расцепкой прогрева и выдачи: раньше человек ждал полный
 * разбор библиотеки (до трёх минут) на отдельном экране, теперь карточки
 * приходят после первого круга, а остальное догревается под ними. Раз ожидание
 * перестало быть экраном, оно обязано остаться хотя бы честно видимым — иначе
 * получится, что мы молча показали выдачу по четверти каталога.
 *
 * Плавающая плашка, а не полоса под шапкой: шапка fixed, и любая привязка к её
 * высоте — константа, которая разъедется при первой же правке навигации. Тот же
 * приём уже выбран для FeedWatch на /whatsnew, и второй язык для той же мысли
 * заводить незачем.
 *
 * Ничего не подменяет само: обновление выдачи — только по нажатию. Карточка,
 * которую человек в этот момент читает, не имеет права смениться под рукой.
 */
export function WarmStrip({
  state,
  remaining,
  onRefresh,
  onDismiss,
}: {
  state: 'off' | 'running' | 'ready'
  remaining: number
  onRefresh: () => void
  onDismiss: () => void
}) {
  /* Плашка висит над выдачей и обязана остаться на экране при прокрутке —
     значит портал, см. Portal.tsx. */
  return (
    <Portal>
      <AnimatePresence>
        {state !== 'off' && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
          className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-6 z-40 flex justify-center px-5 pointer-events-none"
        >
          <div className="glass rounded-full pl-4 pr-2 py-2 flex items-center gap-3 text-xs pointer-events-auto">
            {state === 'running' ? (
              <>
                {/* Волосок, а не спиннер: это фоновая работа, и она не должна
                    выглядеть как что-то, чего ждут */}
                <span aria-hidden className="relative block h-[2px] w-10 overflow-hidden rounded-full bg-track">
                  <motion.span
                    className="absolute inset-y-0 w-1/2 rounded-full bg-ember"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
                  />
                </span>
                <span className="text-dim">
                  Дочитываю библиотеку
                  {remaining > 0 && (
                    <>
                      {' · '}
                      <span className="font-mono">{remaining}</span>
                    </>
                  )}
                </span>
              </>
            ) : (
              <>
                <span className="text-dim">Каталог дочитан</span>
                <button
                  type="button"
                  onClick={onRefresh}
                  className="rounded-full bg-ember text-on-ember font-semibold px-3 py-1 hover:brightness-110 transition"
                >
                  Обновить выдачу
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Скрыть"
              className="rounded-full px-2 py-1 text-faint hover:text-ink transition"
            >
              ✕
            </button>
          </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  )
}
