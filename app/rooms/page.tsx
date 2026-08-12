'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Ambient } from '@/components/Ambient'

type Listing = { id: string; memberNames: string[]; minutesAgo: number }

export default function RoomsBoardPage() {
  const [rooms, setRooms] = useState<Listing[] | null>(null)

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/rooms/public')
      if (res.ok) setRooms(((await res.json()) as { rooms: Listing[] }).rooms)
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
          className="rounded-[14px] bg-ember text-bg font-semibold px-8 py-3 hover:brightness-110 transition"
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
            <div className="h-8 w-8 rounded-full border-2 border-white/15 border-t-ember animate-spin" />
          </div>
        ) : rooms.length === 0 ? (
          <div className="glass rounded-[20px] p-6 text-center text-dim text-sm">
            Сейчас открытых комнат нет. Создай свою и включи «показывать на доске» — сюда придут.
          </div>
        ) : (
          rooms.map((r) => (
            <Link
              key={r.id}
              href={`/room/${r.id}`}
              className="glass glass-hover rounded-[20px] p-5 flex items-center justify-between gap-4"
            >
              <div>
                <div className="font-mono font-bold text-ember">{r.id}</div>
                <div className="text-sm text-dim mt-0.5">
                  {r.memberNames.join(', ')} ·{' '}
                  {r.minutesAgo < 1 ? 'только что' : `${r.minutesAgo} мин назад`}
                </div>
              </div>
              <span className="text-sm text-ink shrink-0">Подсесть →</span>
            </Link>
          ))
        )}
      </div>
      </div>
    </div>
  )
}
