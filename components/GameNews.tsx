'use client'

import { AnimatePresence, m } from 'framer-motion'
import { MotionLazy } from '@/components/motion/MotionLazy'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FeedItem } from '@/lib/db'
import { newsPath } from '@/lib/newspage'
import type { NewsBlock } from '@/lib/steamhtml'
import { NewsBody } from './NewsBody'
import { NewsDate, ScaleBadge } from './NewsMeta'
import { stripGameName } from '@/lib/patchtitle'
import { Icon } from '@/components/Icon'

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

/**
 * Задержка намерения при наведении — то же число и та же причина, что у
 * HOVER_INTENT_MS в PatchRow: без неё курсор, проехавший по списку, просит
 * тело у каждой строки, мимо которой прошёл. Импортом не взято, чтобы не тянуть
 * в бандл карточки весь клиентский модуль ленты.
 */
const HOVER_INTENT_MS = 120

export function GameNews({ items, name }: { items: FeedItem[]; name: string }) {
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

  // Провайдер анимаций — свой: на странице игры лента единственная, кому он
  // нужен (почему не в корне — components/motion/MotionLazy.tsx)
  return (
    <MotionLazy>
      <div className="flex flex-col gap-2">
        {items.map((item) => (
          <Row key={item.gid} item={item} name={name} open={open === item.gid} onToggle={setOpen} />
        ))}
      </div>
    </MotionLazy>
  )
}

function Row({
  item,
  name,
  open,
  onToggle,
}: {
  item: FeedItem
  name: string
  open: boolean
  onToggle: (gid: string | null) => void
}) {
  const [blocks, setBlocks] = useState<NewsBlock[] | null>(null)
  const [failed, setFailed] = useState(false)
  /* Ref, а не состояние: «запрос уже ушёл» на разметку не влияет, зато его
     читает обработчик наведения — раньше любой перерисовки. */
  const asked = useRef(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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

  const cancelHover = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    hoverTimer.current = null
  }, [])

  const hoverIntent = useCallback(() => {
    if (asked.current || hoverTimer.current) return
    hoverTimer.current = setTimeout(loadBody, HOVER_INTENT_MS)
  }, [loadBody])

  // Висящий таймер не должен пережить строку.
  useEffect(() => cancelHover, [cancelHover])

  return (
    <div className="panel-lift overflow-hidden">
      <button
        type="button"
        onClick={() => {
          if (!open) loadBody()
          onToggle(open ? null : item.gid)
        }}
        // Предзагрузка, как в PatchRow: курсор доезжает до строки за сотни
        // миллисекунд до нажатия, touchstart опережает click примерно на сто.
        // Наведение — через задержку намерения, касание и фокус — сразу:
        // проездом они не бывают.
        onPointerEnter={hoverIntent}
        onPointerLeave={cancelHover}
        onFocus={loadBody}
        onTouchStart={loadBody}
        aria-expanded={open}
        className="w-full text-left p-5 flex items-start gap-3 hover:bg-ink/[0.03] transition-colors"
      >
        <div className="min-w-0 flex-1 flex flex-col gap-1.5">
          {/* Название игры — заголовок всей страницы; в заголовке патча оно лишнее. */}
          <span className="text-base font-bold text-ink leading-snug">
            {stripGameName(item.title, name)}
          </span>
          <span className="flex items-center gap-3">
            <NewsDate at={item.publishedAt} />
            {item.tldr && !open && <span className="text-xs text-dim truncate">{item.tldr}</span>}
          </span>
        </div>
        <ScaleBadge scale={item.scale} />
        <span
          aria-hidden
          className="text-dim mt-1 shrink-0 transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <Icon name="down" size={16} />
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <m.div
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
              {/* Свой адрес патча — первым, оригинал — вторым: пересказ
                  есть только у нас, а Steam человек найдёт и сам. Страницей
                  патча можно поделиться, и её видит поиск. Без префетча:
                  раскрыть можно несколько строк, а переходят по одной. */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 self-start text-xs">
                <Link
                  href={newsPath(item.appid, item.gid)}
                  prefetch={false}
                  className="tap font-semibold text-ink underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
                >
                  Отдельной страницей
                </Link>
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tap text-dim hover:text-ink transition-colors"
                >
                  Оригинал в Steam
                </a>
              </div>
            </div>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  )
}
