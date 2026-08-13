'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import type { StoredNews } from '@/lib/db'
import { NewsBody } from './NewsBody'
import { NewsDate, ScaleBadge } from './NewsMeta'

/**
 * Клиентский островок: /game/[appid] остаётся серверным компонентом.
 * Здесь только раскрытие патча — само тело приезжает уже разобранным с сервера.
 */

const EASE = [0.22, 1, 0.36, 1] as const

export function GameNews({ items }: { items: StoredNews[] }) {
  // свежий патч раскрыт сразу: ради него сюда и приходят
  const [open, setOpen] = useState<string | null>(items[0]?.gid ?? null)

  if (!items.length) return null

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => {
        const isOpen = open === item.gid
        return (
          <div key={item.gid} className="glass rounded-[20px] overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : item.gid)}
              aria-expanded={isOpen}
              className="w-full text-left p-5 flex items-start gap-3 hover:bg-ink/[0.03] transition-colors"
            >
              <div className="min-w-0 flex-1 flex flex-col gap-1.5">
                <span className="text-base font-medium text-ink leading-snug">{item.title}</span>
                <span className="flex items-center gap-3">
                  <NewsDate at={item.publishedAt} />
                  {item.tldr && !isOpen && (
                    <span className="text-xs text-dim truncate">{item.tldr}</span>
                  )}
                </span>
              </div>
              <ScaleBadge scale={item.scale} />
              <span
                aria-hidden
                className="text-dim text-xs mt-1 shrink-0 transition-transform duration-200"
                style={{ transform: isOpen ? 'rotate(180deg)' : 'none' }}
              >
                ▾
              </span>
            </button>

            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.32, ease: EASE }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-5 flex flex-col gap-3">
                    {item.tldr && (
                      <p className="text-sm text-ink/90 leading-relaxed border-l-2 border-ember pl-3">
                        {item.tldr}
                      </p>
                    )}
                    <NewsBody blocks={item.blocks} />
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-dim hover:text-ink transition-colors self-start"
                    >
                      Оригинал в Steam
                    </a>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}
