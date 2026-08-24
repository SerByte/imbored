'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Ambient } from '@/components/Ambient'
import { FlapCode } from '@/components/FlapCode'
import { Spinner } from '@/components/Spinner'
import { SectionLabel } from '@/components/Labels'

/**
 * Как устроено пати — тремя шагами.
 *
 * Страница была входом в целую половину продукта и при этом не показывала,
 * что там происходит: заголовок, одна фраза, кнопка и доска, которая почти
 * всегда пуста. Человеку, который про пати ещё не знает, предлагалось
 * вообразить механику по описанию — а механика тут и есть самое интересное:
 * каждый подключает СВОЮ библиотеку, колода собирается из общих игр, матч
 * случается, когда совпали голоса всех.
 *
 * Нумерация здесь не украшение и не «01/02/03 для вида». Это настоящая
 * последовательность: без кода нечего кидать, без вошедших не из чего
 * собрать колоду, без колоды не из чего совпасть. Порядок несёт смысл —
 * значит номер имеет право стоять.
 *
 * Прежний абзац убран, а не оставлен рядом: он говорил ровно то же самое,
 * только одной строкой и без подробностей. Два объяснения одного и того же
 * рядом — это не вдвое понятнее.
 */
const STEPS = [
  { title: 'Создай комнату', hint: 'Получишь код из шести букв и ссылку на неё' },
  { title: 'Кинь ссылку своим', hint: 'Каждый подключает свою библиотеку Steam' },
  { title: 'Свайпайте вместе', hint: 'Колода из общих игр; совпадут все голоса — матч' },
]

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
      <div className="relative mx-auto w-full max-w-3xl px-5 pt-28 pb-16 flex flex-col gap-8">
      <div className="text-center flex flex-col items-center gap-5 anim-rise">
        <h1 className="font-display text-display-md">Пати</h1>
        <Link
          href="/room/new"
          className="btn-ember px-8 py-3"
        >
          Создать комнату
        </Link>
      </div>

      {/* Номер — моноширинным: это цифра, а в этом интерфейсе цифры набраны
          моноширинным везде, от кода комнаты до процента совместимости. */}
      <ol className="grid gap-4 sm:grid-cols-3 anim-rise" style={{ animationDelay: '80ms' }}>
        {STEPS.map((step, i) => (
          <li key={step.title} className="glass rounded-[20px] p-5 flex flex-col gap-1.5">
            <span className="font-mono text-xs text-ember-text">{`0${i + 1}`}</span>
            <span className="font-semibold leading-tight">{step.title}</span>
            <span className="text-sm text-dim leading-relaxed">{step.hint}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3">
        <SectionLabel className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
          Открытые пати — ищут игроков
        </SectionLabel>
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
