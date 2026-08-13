'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useState } from 'react'
import { GameArt } from '@/components/GameArt'
import { NewsBody } from '@/components/NewsBody'
import type { StoredNews } from '@/lib/db'
import { artCandidates } from '@/lib/art'
import { countChanges } from '@/lib/steamhtml'
import type { GameMeta } from '@/lib/types'
import { byline, changesLabel, freshness } from './format'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Строка ленты. Раскрывается на месте, а не уводит на другую страницу.
 *
 * Это бесплатно: getMajorFeed и getFeedForApps уже привозят blocks целиком, а
 * прежняя карточка выбрасывала всё после первых двух блоков и отправляла
 * читателя на /game/[appid]. Ноль дополнительных запросов — просто перестаём
 * выкидывать то, что и так загружено.
 *
 * data-wash отдаёт Stage ссылку на арт для фоновой заливки, data-live он же
 * проставляет обратно, когда строка попадает в центр экрана.
 */
export function PatchRow({
  item,
  meta,
  nowSec,
}: {
  item: StoredNews
  meta?: GameMeta
  nowSec: number
}) {
  const [open, setOpen] = useState(false)

  const name = meta?.name ?? `Игра ${item.appid}`
  const changes = countChanges(item.blocks)
  const studio = byline(meta?.developer, meta?.releaseYear)
  // Ровно тот же файл, что грузит GameArt строкой ниже: заливка размывается в
  // кашу, разрешение ей не нужно, а вот второй загрузки hero-арта на каждую
  // строку ленты телефон бы не простил.
  const wash = artCandidates(
    { appid: item.appid, art: meta?.art, headerImage: meta?.headerImage },
    'card',
  )[0]

  return (
    <article
      data-wash={wash}
      className="wn-row border-b border-rule"
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-start gap-4 py-6 text-left transition-opacity md:gap-6"
      >
        <span className="w-[92px] shrink-0 overflow-hidden rounded-[14px] border border-edge md:w-[168px]">
          <GameArt
            appid={item.appid}
            name={name}
            headerImage={meta?.headerImage}
            art={meta?.art}
            variant="card"
            sizes="(min-width: 768px) 168px, 92px"
            className="aspect-[460/215] w-full object-cover"
          />
        </span>

        <span className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-base font-bold tracking-tight md:text-xl">
              {name}
            </span>
            {studio ? <span className="text-xs text-dim">{studio}</span> : null}
          </span>

          <span className="text-sm font-medium leading-snug text-ink/90 md:text-base">
            {item.title}
          </span>

          {item.tldr ? (
            <span className="line-clamp-2 text-sm leading-relaxed text-dim">{item.tldr}</span>
          ) : null}

          <span className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-dim">
            <span>{freshness(item.publishedAt, nowSec)}</span>
            {changes > 0 ? <span>{changesLabel(changes)}</span> : null}
            {meta?.ccu ? <span>{meta.ccu.toLocaleString('ru-RU')} в игре</span> : null}
          </span>
        </span>

        <span
          aria-hidden
          className="mt-1 shrink-0 text-dim transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▾
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="mb-6 rounded-[20px] border border-edge bg-paper p-5 md:p-7">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.imageUrl}
                  alt=""
                  loading="lazy"
                  className="mb-5 w-full rounded-[14px] border border-edge object-cover"
                />
              ) : null}
              <NewsBody blocks={item.blocks} />
              <div className="mt-6 flex flex-wrap items-center gap-5 text-sm">
                <Link
                  href={`/game/${item.appid}`}
                  className="font-semibold underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
                >
                  Все патчи игры
                </Link>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-dim underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
                >
                  Оригинал в Steam
                </a>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </article>
  )
}
