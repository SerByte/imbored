'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useState } from 'react'
import { GameArt } from '@/components/GameArt'
import { NewsBody } from '@/components/NewsBody'
import { DiscountEnds, PriceTag } from '@/components/PriceTag'
import type { StoredNews } from '@/lib/db'
import { artCandidates } from '@/lib/art'
import type { Discount } from '@/lib/discount'
import { countChanges } from '@/lib/steamhtml'
import type { GameMeta } from '@/lib/types'
import { byline } from '@/lib/byline'
import { changesLabel, freshness } from './format'
import { useNow } from './Now'
import { MetaLine } from '@/components/Labels'

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
 *
 * discovery включается только в общей ленте: там речь о чужих играх, и путь
 * «интересная обнова → а что это вообще за игра» обязан быть виден сразу, не
 * из-под раскрытого патча.
 */
export function PatchRow({
  item,
  meta,
  nowSec,
  discovery = false,
  discount = null,
}: {
  item: StoredNews
  meta?: GameMeta
  nowSec: number
  discovery?: boolean
  /** посчитан на сервере: срок распродажи нельзя считать в браузере, см. discountView */
  discount?: Discount | null
}) {
  const [open, setOpen] = useState(false)
  // Проп остаётся серверным значением и служит фолбэком: под провайдером
  // подпись тикает сама, вне его — как раньше
  const now = useNow(nowSec)

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
      style={{
        contentVisibility: 'auto',
        // полоска с ценой добавляет строке около сорока пикселей, и без поправки
        // документ недосчитался бы их тридцать раз — это дёргающийся скроллбар
        containIntrinsicSize: discovery ? 'auto 260px' : 'auto 220px',
      }}
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
            <span className="font-display text-display-xs">
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

          <MetaLine className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>{freshness(item.publishedAt, now)}</span>
            {changes > 0 ? <span>{changesLabel(changes)}</span> : null}
            {meta?.ccu ? <span>{meta.ccu.toLocaleString('ru-RU')} в игре</span> : null}
          </MetaLine>
        </span>

        <span
          aria-hidden
          className="mt-1 shrink-0 text-dim transition-transform duration-200"
          style={{ transform: open ? 'rotate(180deg)' : 'none' }}
        >
          ▾
        </span>
      </button>

      {/*
        Полоска живёт ВНЕ кнопки, и это не вопрос вкуса: ссылку внутрь <button>
        вложить нельзя. По той же причине вся начинка кнопки выше — только
        <span>. Отступ повторяет колонку арта: 92 + gap-4 на телефоне,
        168 + gap-6 на десктопе.
      */}
      {discovery ? (
        <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pb-6 pl-[108px] text-sm md:pl-[192px]">
          <PriceTag priceFinal={meta?.priceFinal ?? null} discount={discount} isFree={meta?.isFree} />
          <DiscountEnds discount={discount} />
          <Link
            href={`/game/${item.appid}`}
            // -my-1.5 гасит собственную высоту: палец получает свои 44 пикселя,
            // а ритм строки не меняется
            className="-my-1.5 py-1.5 font-semibold underline decoration-1 underline-offset-4 transition-opacity hover:opacity-70"
          >
            Открыть игру →
          </Link>
        </div>
      ) : null}

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
