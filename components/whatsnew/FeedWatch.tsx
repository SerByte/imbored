'use client'

import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import {
  afterProbe,
  countFresh,
  type FeedHead,
  initialPollState,
  nextDelayMs,
  onVisible,
  probeFeedHead,
  shouldProbe,
} from '@/lib/feedpoll'
import { Portal } from '@/components/Portal'
import { plural } from '@/lib/plural'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * «N новых обновлений» — и лента не дёргается сама.
 *
 * Подставлять новые строки молча нельзя: у строк contentVisibility: 'auto'
 * (PatchRow), то есть высота непрорисованных — оценка, и вставка сверху
 * сдвигает текст под курсором на непредсказуемую величину. Плюс раскрытый
 * патчноут — это состояние, которого на сервере нет. Поэтому решение остаётся
 * за человеком, а до клика меняется ровно одна плашка.
 *
 * Базовая линия — серверный проп keys, а не клиентское состояние «что я уже
 * видел». Это важнее, чем кажется: после router.refresh() страница приезжает
 * с новыми keys, счётчик схлопывается в ноль сам, и чистить нечего. А если
 * обновление не доехало — keys те же, плашка на месте, число верное. Ни
 * оптимистичной записи, ни гонки, ни эффекта-уборщика.
 */
export function FeedWatch({
  keys,
  tailAt,
  showPopular,
}: {
  /** Ключи `appid:gid` строк, которые сервер только что отрисовал */
  keys: string[]
  /** Время самой старой отрисованной записи — см. countFresh */
  tailAt: number
  showPopular: boolean
}) {
  const [head, setHead] = useState<FeedHead | null>(null)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const reduced = useReducedMotion()

  useEffect(() => {
    let cancelled = false
    let timer = 0
    let s = initialPollState(Date.now())

    const tick = async () => {
      if (cancelled || s.stopped || document.visibilityState !== 'visible') return
      const r = await probeFeedHead({ feed: showPopular ? 'popular' : 'mine' })
      if (cancelled) return
      s = afterProbe(s, r.kind === 'ok', Date.now())
      if (r.kind === 'ok') setHead(r.head)
      if (r.kind === 'stop') {
        s = { ...s, stopped: true }
        return
      }
      schedule()
    }

    const schedule = () => {
      clearTimeout(timer)
      if (s.stopped) return
      timer = window.setTimeout(() => void tick(), nextDelayMs(s))
    }

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        clearTimeout(timer)
        return
      }
      s = onVisible(s, Date.now())
      // Вернулись во вкладку — вот ради этого всё и затевалось: если срок
      // вышел, спрашиваем сразу, а не досиживаем остаток интервала
      if (shouldProbe(s, { visible: true, nowMs: Date.now() })) void tick()
      else schedule()
    }

    document.addEventListener('visibilitychange', onVisibility)
    // Первый опрос по расписанию, а не сразу: страницу только что отрисовал
    // сервер, спрашивать «что нового» через ноль секунд после этого не о чем.
    // Побочно это убирает и void tick() из тела эффекта, на который ругается
    // react-hooks/set-state-in-effect (см. app/room/[id]/page.tsx).
    schedule()

    return () => {
      cancelled = true
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [showPopular])

  const known = new Set(keys)
  const n = head ? countFresh(known, tailAt, head.items) : 0
  // Steam подключили в соседней вкладке: лента меняется целиком, и разность
  // множеств посчитала бы «новым» весь новый набор. Числу здесь верить нельзя.
  const flipped = head ? head.showPopular !== showPopular : false

  if (!n && !flipped) return null

  const label = flipped
    ? 'Лента обновилась'
    : `${n} ${plural(n, 'новое обновление', 'новых обновления', 'новых обновлений')}`

  /* Тост висит под шапкой и обязан остаться на экране при прокрутке. Под
     плавной прокруткой fixed внутри содержимого уезжает вместе с ним —
     см. components/Portal.tsx. */
  return (
    <Portal>
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-20 z-40 flex justify-center px-5"
      >
        <AnimatePresence initial={false}>
          <motion.button
            type="button"
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: reduced ? 0 : 0.28, ease: EASE }}
            disabled={pending}
            onClick={() => {
              // Прокрутка наверх — не украшение. Новые строки встают ВЫШЕ места
              // чтения, а высота непрорисованных строк — оценка (см. докблок).
              // Человек нажал «покажи новые» — везём его к ним.
              window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' })
              startTransition(() => router.refresh())
            }}
            className="pointer-events-auto flex items-center gap-2 rounded-full border border-rule bg-bg/90 px-4 py-2 text-sm font-semibold text-ink shadow-lg backdrop-blur transition-opacity hover:opacity-80 disabled:opacity-60"
          >
            <span aria-hidden className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
            {pending ? 'Обновляю…' : label}
          </motion.button>
        </AnimatePresence>
      </div>
    </Portal>
  )
}
