'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { FlapCode } from '@/components/FlapCode'
import { Spinner } from '@/components/Spinner'
import { minutesAgoLabel } from '@/lib/freshness'

type Listing = { id: string; memberNames: string[]; minutesAgo: number }

type Board = { rooms: Listing[]; fresh: Set<string> }

export default function RoomsBoardPage() {
  // Свежесть держим в состоянии рядом со списком, а не в ref: читать ref во
  // время рендера нельзя, а знать «эта строка новая» нужно именно при рендере.
  const [board, setBoard] = useState<Board | null>(null)
  const rooms = board?.rooms ?? null
  // Отдельно от board: провал запроса не должен стирать уже показанную доску,
  // а показанная доска не должна прятать сообщение о том, что она устарела.
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true

    const load = async () => {
      try {
        const res = await fetch('/api/rooms/public')
        if (!res.ok) throw new Error(String(res.status))
        const next = ((await res.json()) as { rooms: Listing[] }).rooms
        if (!alive) return
        setFailed(false)
        setBoard((prev) => {
          const known = new Set(prev?.rooms.map((r) => r.id) ?? [])
          // На первой загрузке новыми считаются все — доска «прилетает» целиком.
          const fresh = new Set(next.filter((r) => !known.has(r.id)).map((r) => r.id))
          return { rooms: next, fresh }
        })
      } catch {
        // Раньше здесь был ранний return без try: любой сетевой сбой отклонял
        // промис внутри void load(), board навсегда оставался null, и человек
        // смотрел на спиннер до перезагрузки страницы.
        if (alive) setFailed(true)
      }
    }

    void load()

    /*
     * Опрос только при видимой вкладке — та же дисциплина, что уже принята в
     * FeedWatch и на странице комнаты. Фоновая вкладка опрашивала доску вечно,
     * а доска — это «кто ищет прямо сейчас»: смотреть её из свёрнутого окна
     * некому.
     *
     * Восемь секунд вместо пяти: ответ теперь кэшируется на краю пятью
     * секундами, и более частый опрос всё равно попадал бы в тот же кэш.
     * Створки FlapCode задержку маскируют.
     */
    let timer: ReturnType<typeof setInterval> | null = null
    const stop = () => {
      if (timer !== null) clearInterval(timer)
      timer = null
    }
    const start = () => {
      if (timer === null) timer = setInterval(() => void load(), 8000)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        void load()
        start()
      } else stop()
    }

    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      alive = false
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reloadKey])

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto w-full max-w-2xl px-5 pt-28 pb-16 flex flex-col gap-8">
      <div className="text-center flex flex-col items-center gap-4 anim-rise">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Пати</h1>
        <p className="text-dim text-sm max-w-md">
          Собери свою комнату и скинь ссылку друзьям — или подсядь к открытой пати, которая ищет
          игроков.
        </p>
        <Link
          href="/room/new"
          className="rounded-[14px] bg-ember text-on-ember font-semibold px-8 py-3 hover:brightness-110 transition"
        >
          Создать комнату
        </Link>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-dim flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
          Открытые пати — ищут игроков
        </h2>
        {rooms === null && failed ? (
          <div className="glass rounded-[20px] p-6 text-center text-dim text-sm flex flex-col items-center gap-3">
            Не получилось загрузить доску.
            <button
              type="button"
              onClick={() => setReloadKey((n) => n + 1)}
              className="rounded-[14px] bg-ember/15 text-ember-text font-medium px-5 py-2 cursor-pointer hover:bg-ember/25 transition"
            >
              Попробовать снова
            </button>
          </div>
        ) : rooms === null ? (
          <div className="flex justify-center py-8">
            <Spinner size={32} />
          </div>
        ) : rooms.length === 0 ? (
          <div className="glass rounded-[20px] p-6 text-center text-dim text-sm">
            Сейчас открытых комнат нет. Создай свою и нажми «Показать на доске» — сюда придут.
          </div>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {rooms.map((r) => (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, x: 8, height: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <Link
                  href={`/room/${r.id}`}
                  className="glass glass-hover rounded-[20px] p-5 flex items-center justify-between gap-4"
                >
                  <div>
                    {/* Створки только для строк, появившихся на ЭТОМ тике:
                        иначе каждые 5 секунд вся доска — игровой автомат. */}
                    <FlapCode code={r.id} animate={board?.fresh.has(r.id) ?? false} />
                    <div className="text-sm text-dim mt-0.5">
                      {r.memberNames.join(', ')} ·{' '}
                      {minutesAgoLabel(r.minutesAgo)}
                    </div>
                  </div>
                  <span className="text-sm text-ink shrink-0">Подсесть →</span>
                </Link>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
      </div>
    </div>
  )
}
