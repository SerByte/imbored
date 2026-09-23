'use client'

import { AnimatePresence, motion } from 'motion/react'
import { Portal } from '@/components/Portal'
import { EASE } from '@/lib/motion'

/**
 * «Не зацепило «X»?» — вторая половина правила остановки (lib/launchmemo.ts).
 *
 * Человек запустил игру с /play и спустя десять минут вернулся на вкладку.
 * Чаще всего это и есть ответ: зацепившая игра не отпускает к браузеру. Раньше
 * он находил перед собой ту же карточку, как будто ничего не было, и чтобы
 * получить другую, должен был сам догадаться нажать «Не то — дальше» у игры,
 * в которую только что играл. Теперь продукт спрашивает первым — теми же
 * причинами, что и у пропуска, — и выполняет обещание строки под кнопками:
 * «возвращайся, дадим другую».
 *
 * Плавающая плашка, а не полоса над героем, по той же причине, что у
 * WarmStrip: шапка fixed, а вопрос обязан быть виден, где бы ни стояла
 * прокрутка. Ничего не решает сам: уйти молча — «Закрыть».
 */
export function StopAsk({
  game,
  reasons,
  onReason,
  onHooked,
  onClose,
}: {
  game: { appid: number; name: string } | null
  reasons: ReadonlyArray<{ key: string; label: string }>
  onReason: (key: string) => void
  onHooked: () => void
  onClose: () => void
}) {
  return (
    <Portal>
      <AnimatePresence>
        {game && (
          <motion.div
            key={game.appid}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-6 z-40 flex justify-center px-safe pointer-events-none"
          >
            <section
              aria-label="Не зацепило?"
              className="glass rounded-[20px] p-4 w-full max-w-xl flex flex-col gap-3 pointer-events-auto"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm">
                  Не зацепило <span className="text-ember-text">«{game.name}»</span>?
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-full px-3 py-1.5 text-xs text-faint hover:text-ink transition-colors cursor-pointer"
                >
                  Закрыть
                </button>
              </div>
              <p className="-mt-2 text-xs text-dim">Так бывает. Скажи, что не так, — дадим другую.</p>
              <div className="flex flex-wrap items-center gap-2">
                {reasons.map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => onReason(r.key)}
                    className="rounded-full glass glass-hover px-4 py-2 text-sm cursor-pointer"
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={onHooked}
                  className="rounded-full bg-ember/15 text-ember-text px-4 py-2 text-sm cursor-pointer hover:bg-ember/20 transition-colors"
                >
                  Зацепило
                </button>
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  )
}
