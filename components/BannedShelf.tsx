'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { GameArt } from '@/components/GameArt'
import type { GameArtUrls } from '@/lib/art'
import { Eyebrow } from '@/components/Labels'

export type BannedGame = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

/**
 * Полка забаненного.
 *
 * Живёт на /library и существует ради одного: бан — единственное необратимое
 * действие во всём продукте. Он вырезает игру из fetchDiscoveryPool навсегда,
 * а нажимают его сгоряча. Сервис, который обещает слушать, обязан показывать,
 * что именно он услышал, и уметь это отменить.
 *
 * Клиентский островок на серверной странице: плитка удаляется сразу, а
 * router.refresh() догоняет числа в шапке. Ждать круга до сервера, чтобы
 * увидеть результат нажатия, здесь незачем — операция идемпотентна.
 */
export function BannedShelf({ games }: { games: BannedGame[] }) {
  const router = useRouter()
  const [items, setItems] = useState(games)
  const [failed, setFailed] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  async function unban(appid: number) {
    const before = items
    setFailed(null)
    setItems((prev) => prev.filter((g) => g.appid !== appid))
    try {
      const res = await fetch('/api/unban', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appid }),
      })
      if (!res.ok) throw new Error(String(res.status))
      startTransition(() => router.refresh())
    } catch {
      // Откат целиком, а не вставка одной плитки: порядок на полке задаёт
      // сервер, и угадывать его на клиенте — способ разъехаться с ним
      setItems(before)
      setFailed(appid)
    }
  }

  if (items.length === 0) return null

  return (
    <section className="mb-12">
      <Eyebrow className="mb-2">Чистилище</Eyebrow>
      <h2 className="font-display text-display-sm">
        Ты выгнал <span className="font-mono text-ember-text">{items.length}</span>
      </h2>
      <p className="text-dim text-sm mt-1.5 mb-4">
        Мы их правда больше не показываем — ни в подборе, ни в игре дня, ни в пати. Если передумал,
        верни обратно.
      </p>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <AnimatePresence mode="popLayout" initial={false}>
          {items.map((g) => (
            <motion.div
              key={g.appid}
              layout
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.22 }}
              className="glass rounded-[14px] overflow-hidden flex flex-col"
            >
              {/* Ссылка и кнопка — соседи, а не вложенные: интерактив внутри
                  интерактива не кликается и не читается скринридером */}
              <Link href={`/game/${g.appid}`} className="block">
                <GameArt
                  appid={g.appid}
                  name={g.name}
                  headerImage={g.headerImage}
                  art={g.art}
                  sizes="(min-width: 768px) 20vw, 50vw"
                  className="w-full aspect-[460/215] object-cover grayscale"
                />
                <div className="p-3 pb-2 text-sm font-semibold leading-tight truncate">{g.name}</div>
              </Link>
              <button
                type="button"
                onClick={() => unban(g.appid)}
                className="mt-auto mx-3 mb-3 rounded-[10px] glass glass-hover px-3 py-1.5 text-xs text-dim hover:text-ink transition"
              >
                Вернуть в подбор
              </button>
              {failed === g.appid && (
                <p role="status" className="px-3 pb-3 text-[11px] text-danger">
                  Не вышло — попробуй ещё раз
                </p>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}
