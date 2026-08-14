'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { FlapCode } from '@/components/FlapCode'
import { Spinner } from '@/components/Spinner'

type Listing = { id: string; memberNames: string[]; minutesAgo: number }

type Board = { rooms: Listing[]; fresh: Set<string> }

export default function RoomsBoardPage() {
  // Свежесть держим в состоянии рядом со списком, а не в ref: читать ref во
  // время рендера нельзя, а знать «эта строка новая» нужно именно при рендере.
  const [board, setBoard] = useState<Board | null>(null)
  const rooms = board?.rooms ?? null

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/rooms/public')
      if (!res.ok) return
      const next = ((await res.json()) as { rooms: Listing[] }).rooms
      setBoard((prev) => {
        const known = new Set(prev?.rooms.map((r) => r.id) ?? [])
        // На первой загрузке новыми считаются все — доска «прилетает» целиком.
        const fresh = new Set(next.filter((r) => !known.has(r.id)).map((r) => r.id))
        return { rooms: next, fresh }
      })
    }
    void load()
    const t = setInterval(() => void load(), 5000)
    return () => clearInterval(t)
  }, [])

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
        {rooms === null ? (
          <div className="flex justify-center py-8">
            <Spinner size={32} />
          </div>
        ) : rooms.length === 0 ? (
          <div className="glass rounded-[20px] p-6 text-center text-dim text-sm">
            Сейчас открытых комнат нет. Создай свою и включи «показывать на доске» — сюда придут.
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
                      {r.minutesAgo < 1 ? 'только что' : `${r.minutesAgo} мин назад`}
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
