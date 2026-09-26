'use client'

import { AnimatePresence, m } from 'framer-motion'
import { MotionMax } from '@/components/motion/MotionMax'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { GameCardBody } from '@/components/GameCard'
import { NeedSteam } from '@/components/NeedSteam'
import type { GameArtUrls } from '@/lib/art'
import { Eyebrow } from '@/components/Labels'
import { plural } from '@/lib/plural'
import { isNeedSteam } from '@/lib/writer'

export type LikedGame = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

/**
 * Полка «Зашло» на /library — что подбор запомнил как понравившееся.
 *
 * Оценка «зашло» ведёт подбор: похожее поднимается выше, пауза после «не то»
 * снимается (lib/recommend). До сих пор человек не видел, что именно сервис
 * запомнил, и не мог забрать нажатое по ошибке. Здесь видит и может.
 *
 * Устроена как полки забаненного (components/BannedShelf) и по тем же
 * причинам: плитка уходит сразу, router.refresh() догоняет «Подбор
 * попадает в N%»; сбой откатывает полку целиком; фокус переезжает на соседнюю
 * кнопку, а с последней — на строку «пусто». Отдельный компонент, а не третья
 * полка BannedShelf: там сторож читает подписи кнопок (lib/bannedshelf.test),
 * а здесь действие другое — не «вернуть», а «забыть».
 *
 * writer — может ли сессия писать (isWriter в lib/server). Сессия по ссылке
 * видит полку, но без кнопок — со строкой о входе через Steam.
 */
export function LikedShelf({ games, writer }: { games: LikedGame[]; writer: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState(games)
  const [failed, setFailed] = useState<number | null>(null)
  const [denied, setDenied] = useState(false)
  /** Хоть одну оценку уже сняли — пустая полка тогда говорит об этом, а не исчезает */
  const [touched, setTouched] = useState(false)
  const [, startTransition] = useTransition()
  const readOnly = !writer || denied

  // Фокус — как у BannedShelf: цель в ref, ставится эффектом после рендера
  const pendingFocus = useRef<number | 'heading' | 'empty' | null>(null)
  const buttons = useRef(new Map<number, HTMLButtonElement>())
  const heading = useRef<HTMLHeadingElement>(null)
  const emptyLine = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const target = pendingFocus.current
    if (target === null) return
    pendingFocus.current = null
    const el =
      target === 'empty' ? emptyLine.current : target === 'heading' ? heading.current : buttons.current.get(target)
    el?.focus()
  })

  async function unlike(appid: number) {
    const before = items
    const at = items.findIndex((g) => g.appid === appid)
    const neighbour = items[at + 1] ?? items[at - 1]
    setFailed(null)
    setTouched(true)
    pendingFocus.current = neighbour ? neighbour.appid : 'empty'
    setItems((prev) => prev.filter((g) => g.appid !== appid))
    try {
      const res = await fetch('/api/unlike', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appid }),
      })
      if (await isNeedSteam(res)) {
        // Не «попробуй ещё раз»: не получится. Кнопок больше нет — фокус на заголовок
        pendingFocus.current = 'heading'
        setItems(before)
        setDenied(true)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      startTransition(() => router.refresh())
    } catch {
      // Откат целиком: порядок полки задаёт сервер
      pendingFocus.current = appid
      setItems(before)
      setFailed(appid)
    }
  }

  if (items.length === 0 && !touched) return null

  if (items.length === 0) {
    return (
      <section className="mb-12">
        <p ref={emptyLine} tabIndex={-1} role="status" className="text-dim text-sm">
          Оценок «зашло» больше нет — подбор будет судить по библиотеке и новым ответам.
        </p>
      </section>
    )
  }

  return (
    <section aria-labelledby="shelf-liked" className="mb-12">
      <Eyebrow className="mb-2">Зашло</Eyebrow>
      <h2 id="shelf-liked" ref={heading} tabIndex={-1} className="font-display text-display-sm">
        <span className="tabular-nums text-ember-text">{items.length}</span>{' '}
        {plural(items.length, 'игру', 'игры', 'игр')} подбор помнит как «зашло»
      </h2>
      <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
        По ним он учится твоему вкусу: похожее — выше, пауза после «не то» снимается. Нажал по
        ошибке или вкус поменялся — убери.
      </p>
      {readOnly && <NeedSteam from="/library" className="mb-4" />}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {/* layout — фича domMax, её догружает MotionMax */}
        <MotionMax>
          <AnimatePresence mode="popLayout" initial={false}>
            {items.map((g) => (
              <m.div
                key={g.appid}
                layout
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ duration: 0.22 }}
                className="flex flex-col"
              >
                <Link href={`/game/${g.appid}`} className="game-card block">
                  <GameCardBody
                    appid={g.appid}
                    name={g.name}
                    headerImage={g.headerImage}
                    art={g.art}
                    sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                  />
                </Link>
                {!readOnly && (
                  // Своё имя у каждой кнопки: видимый текст один на всю полку
                  <button
                    type="button"
                    ref={(el) => {
                      if (el) buttons.current.set(g.appid, el)
                      else buttons.current.delete(g.appid)
                    }}
                    onClick={() => unlike(g.appid)}
                    aria-label={`Убрать «${g.name}» из «зашло»`}
                    className="pill mt-3 self-start"
                  >
                    Убрать
                  </button>
                )}
                {failed === g.appid && (
                  <p role="status" className="px-3 pb-3 text-[11px] text-danger">
                    Не вышло — попробуй ещё раз
                  </p>
                )}
              </m.div>
            ))}
          </AnimatePresence>
        </MotionMax>
      </div>
    </section>
  )
}
