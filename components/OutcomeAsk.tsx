'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState } from 'react'
import { Portal } from '@/components/Portal'
import { dayKey } from '@/lib/daily'
import { createLocalStore } from '@/lib/localstore'
import { EASE } from '@/lib/motion'
import { outcomeQuestion, parseOutcomeAsk, type OutcomeAsk as Ask, type OutcomeVerdict } from '@/lib/outcome'
import { isNeedSteam, writerStore } from '@/lib/writer'

/**
 * День (dayKey, московский), когда вопрос уже показывали на этом устройстве.
 * Раз в сутки — обещание, а не пожелание: вопрос после каждого захода на
 * /play превратил бы подбор в анкету.
 */
const askedStore = createLocalStore('imbored.outcome.asked', (raw) =>
  typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null,
)

/**
 * «Как тебе «X»?» — после того, как снапшот показал, что в посоветованную
 * игру действительно играли (lib/outcome.ts).
 *
 * Вопрос не про запуск, а про часы: «Не зацепило?» (StopAsk) спрашивает через
 * десять минут после нажатия, этот — через дни, когда Steam уже знает, сколько
 * человек провёл в игре. Ответ ложится в outcomes.verdict, «Зацепило» — ещё и
 * в оценки, как у StopAsk.
 *
 * Плавающая плашка там же, где StopAsk и WarmStrip, и уступает обоим: paused —
 * на экране вопрос важнее этого. Не чаще раза в сутки на устройстве: день
 * отмечается, когда вопрос ПОКАЗАН, а не когда на него ответили, — уйти молча
 * тоже ответ «не сегодня». Сессии только для чтения не спрашиваем вовсе.
 */
export function OutcomeAsk({
  paused = false,
  onShown,
  onDone,
}: {
  paused?: boolean
  /** Показан ли вопрос сейчас — странице, чтобы убрать плашку прогрева */
  onShown?: (shown: boolean) => void
  /**
   * Ответили — плашка уходит вместе с нажатой кнопкой, и фокус без присмотра
   * упал бы в body. Страница отдаёт его туда, где идёт действие.
   */
  onDone?: () => void
}) {
  const [ask, setAsk] = useState<Ask | null>(null)

  /*
   * Спросить сервер — только когда вопросу есть место: пока на экране StopAsk,
   * ждём. Флага «уже спрашивали» здесь нет намеренно: в разработке React
   * монтирует эффект дважды, и первый, отменённый, оставил бы страницу без
   * второго (тот же довод у прогрева на /play). Повтор гасит askedStore:
   * показанный вопрос отмечает день.
   */
  useEffect(() => {
    if (paused) return
    if (writerStore.get() === false) return
    const today = dayKey(Math.floor(Date.now() / 1000))
    if (askedStore.get() === today) return
    const ac = new AbortController()
    void fetch('/api/outcome', { signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ask?: unknown } | null) => {
        const got = parseOutcomeAsk(d?.ask)
        if (!got) return
        askedStore.set(today)
        setAsk(got)
      })
      // Вопрос — не то, ради чего стоит показывать сбой: нет ответа — нет вопроса
      .catch(() => {})
    return () => ac.abort()
  }, [paused])

  const shown = ask !== null && !paused
  useEffect(() => {
    onShown?.(shown)
  }, [shown, onShown])

  const answer = (verdict: OutcomeVerdict) => {
    if (!ask) return
    setAsk(null)
    onDone?.()
    void fetch('/api/outcome', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appid: ask.appid, shownAt: ask.shownAt, verdict }),
    })
      .then(async (r) => {
        // needsteam — не сбой, а права: страница узнаёт, что сессия только
        // читает, и больше не предлагает записывать
        if (await isNeedSteam(r)) writerStore.set(false)
      })
      // Ответ потерялся — спросим в другой день: строка осталась без ответа
      .catch(() => {})
  }

  return (
    <Portal>
      {/* Та же живая строка, что у StopAsk: плашка появляется без действия
          человека, и скринридер без неё о вопросе не узнал бы */}
      <p role="status" className="sr-only">
        {shown && ask ? `${outcomeQuestion(ask)} Вопрос внизу экрана` : ''}
      </p>
      <AnimatePresence>
        {shown && ask && (
          <motion.div
            key={`${ask.appid}:${ask.shownAt}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.28, ease: EASE }}
            className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] md:bottom-6 z-40 flex justify-center px-safe pointer-events-none"
          >
            <section
              aria-label="Как тебе игра?"
              className="panel-lift p-4 w-full max-w-xl flex flex-col gap-3 pointer-events-auto"
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm">{outcomeQuestion(ask)}</p>
                <button
                  type="button"
                  onClick={() => answer('dismissed')}
                  className="rounded-full px-3 py-1.5 text-xs text-faint hover:text-ink transition-colors cursor-pointer"
                >
                  Закрыть
                </button>
              </div>
              <p className="-mt-2 text-xs text-dim">Часы — из Steam. Ответ поможет подбирать точнее.</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => answer('hooked')}
                  className="rounded-full bg-ember/15 text-ember-text px-4 py-2 text-sm cursor-pointer hover:bg-ember/20 transition-colors"
                >
                  Зацепило
                </button>
                <button
                  type="button"
                  onClick={() => answer('meh')}
                  className="rounded-full glass glass-hover px-4 py-2 text-sm cursor-pointer"
                >
                  Так себе
                </button>
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  )
}
