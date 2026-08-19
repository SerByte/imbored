'use client'

import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useRef, useState } from 'react'
import type { FeedItem } from '@/lib/db'
import type { NewsBlock } from '@/lib/steamhtml'
import { NewsBody } from './NewsBody'
import { NewsDate, ScaleBadge } from './NewsMeta'

/**
 * Клиентский островок: /game/[appid] остаётся серверным компонентом.
 *
 * Тело патча сюда НЕ передаётся и приезжает по требованию — тем же путём и с
 * того же роута, что в ленте «Что нового» (см. components/whatsnew/PatchRow).
 * Замер на проде, Cyberpunk 2077: страница весила 102 КБ, из них 69 КБ —
 * инлайновые скрипты, то есть сериализованные пропсы этого самого островка, а
 * видимого текста на странице 6.5 КБ. Тело свежего патча лежало в разметке
 * ДВАЖДЫ: один раз отрисованным, второй — в полезной нагрузке.
 */

const EASE = [0.22, 1, 0.36, 1] as const

export function GameNews({ items }: { items: FeedItem[] }) {
  /*
   * Свёрнуто всё, и это разворот прежнего решения.
   *
   * Стояло `useState(items[0]?.gid)` с объяснением «свежий патч раскрыт сразу:
   * ради него сюда и приходят». Для ленты патчей это правда, а сюда приходят
   * из поиска по вопросу из заголовка страницы — «стоит ли играть». Замер на
   * той же карточке Cyberpunk: раскрытая первая запись занимала 3642px при
   * высоте страницы 6862px — ОДНА запись из пяти давала 53% страницы, тогда
   * как остальные четыре укладываются в 118–156px каждая. Ссылку «Подобрать
   * игру под настроение» это уводило на 96% глубины.
   *
   * В свёрнутом виде строка показывает заголовок, дату, масштаб и tldr —
   * ровно то, что нужно, чтобы решить, разворачивать ли.
   */
  const [open, setOpen] = useState<string | null>(null)

  if (!items.length) return null

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <Row key={item.gid} item={item} open={open === item.gid} onToggle={setOpen} />
      ))}
    </div>
  )
}

function Row({
  item,
  open,
  onToggle,
}: {
  item: FeedItem
  open: boolean
  onToggle: (gid: string | null) => void
}) {
  const [blocks, setBlocks] = useState<NewsBlock[] | null>(null)
  const [failed, setFailed] = useState(false)
  /* Ref, а не состояние: «запрос уже ушёл» на разметку не влияет, зато его
     читает обработчик наведения — раньше любой перерисовки. */
  const asked = useRef(false)

  const loadBody = useCallback(() => {
    if (asked.current) return
    asked.current = true
    setFailed(false)
    fetch(`/api/news?appid=${item.appid}&gid=${encodeURIComponent(item.gid)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { blocks?: unknown }) => {
        if (!Array.isArray(d.blocks)) throw new Error('shape')
        setBlocks(d.blocks as NewsBlock[])
      })
      .catch(() => {
        // Снимаем отметку: следующее раскрытие обязано попробовать снова.
        asked.current = false
        setFailed(true)
      })
  }, [item.appid, item.gid])

  return (
    <div className="glass rounded-[20px] overflow-hidden">
      <button
        type="button"
        onClick={() => {
          if (!open) loadBody()
          onToggle(open ? null : item.gid)
        }}
        // Наведение опережает нажатие на те самые двести миллисекунд, за
        // которые скелет успевает мелькнуть. На тач-экранах не срабатывает и
        // не должно: там за это отвечает сам onClick.
        onMouseEnter={loadBody}
        aria-expanded={open}
        className="w-full text-left p-5 flex items-start gap-3 hover:bg-ink/[0.03] transition-colors"
      >
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          <span className="text-base font-medium text-ink leading-snug">{item.title}</span>
          <span className="flex items-center gap-3">
            <NewsDate at={item.publishedAt} />
            {item.tldr && !open && <span className="text-xs text-dim truncate">{item.tldr}</span>}
          </span>
        </div>
        <ScaleBadge scale={item.scale} />
        <span
          aria-hidden
          className="text-dim text-xs mt-1 shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▾
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
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
              {blocks ? (
                <NewsBody blocks={blocks} />
              ) : failed ? (
                <p className="text-sm leading-relaxed text-dim">
                  Не удалось загрузить патч. Он открывается по ссылке ниже.
                </p>
              ) : (
                /* Скелет ровно на высоту абзаца: без него панель раскрывается
                   в пустоту и дёргается, когда тело приезжает. */
                <div aria-hidden className="flex flex-col gap-2.5">
                  {[92, 100, 78].map((w, i) => (
                    <span
                      key={i}
                      className="h-3.5 animate-pulse rounded-full bg-ink/10"
                      style={{ width: `${w}%` }}
                    />
                  ))}
                </div>
              )}
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
}
