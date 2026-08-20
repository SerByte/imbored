'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { GameArt } from '@/components/GameArt'
import { NewsBody } from '@/components/NewsBody'
import { DiscountEnds, PriceTag } from '@/components/PriceTag'
import type { FeedItem } from '@/lib/db'
import { artCandidates } from '@/lib/art'
import type { Discount } from '@/lib/discount'
import type { NewsBlock } from '@/lib/steamhtml'
import type { FeedMeta } from '@/lib/whatsnewfeed'
import { byline, changesLabel, freshness } from './format'
import { useNow } from './Now'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Сколько курсор должен постоять на строке, прежде чем считать это намерением.
 *
 * Без задержки прокрутка мышью по ленте — это запрос на каждую строку, мимо
 * которой проехал курсор: тридцать тел вместо одного, то есть ровно то, от
 * чего страница и уходила. Сто двадцать миллисекунд отсекают проезд и при этом
 * незаметны для того, кто действительно целится в строку: пока палец идёт к
 * кнопке мыши, тело уже едет.
 */
const HOVER_INTENT_MS = 120

/**
 * Строка ленты. Раскрывается на месте, а не уводит на другую страницу.
 *
 * Тело приезжает по требованию, а не вместе со страницей, и это единственное,
 * что здесь стоило дорого. Тридцать тел в разметке — это 277 КБ из 476 на
 * проде: 58 % веса страницы уходило на текст, который раскрывают у одной
 * строки из тридцати. Считать это бесплатным можно было только по запросам к
 * базе: getMajorFeed действительно привозил blocks одним запросом — и он же
 * тащил их дальше, через RSC-пейлоад, в браузер каждого посетителя.
 *
 * «По требованию» не значит «по клику»: запрос уходит на наведение курсора и
 * на касание, то есть за сотню-другую миллисекунд до самого клика. Ответ общий
 * для всех (пара appid+gid определяет патч однозначно) и кэшируется на грани,
 * так что после первого читателя он не доходит даже до функции.
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
  changes,
  discovery = false,
  discount = null,
  price = null,
}: {
  item: FeedItem
  meta?: FeedMeta
  nowSec: number
  /** правок в патче; считается на сервере — тело сюда больше не едет */
  changes: number
  discovery?: boolean
  /** посчитан на сервере: срок распродажи нельзя считать в браузере, см. discountView */
  discount?: Discount | null
  /**
   * Тоже с сервера и по той же причине. Отдельно от meta.priceFinal, потому
   * что при протухшей скидке цены НЕТ: price_final там акционное число без
   * акции. См. trustedPrice.
   */
  price?: number | null
}) {
  const [open, setOpen] = useState(false)
  const [blocks, setBlocks] = useState<NewsBlock[] | null>(null)
  const [failed, setFailed] = useState(false)
  /*
   * Ref, а не состояние: «запрос уже ушёл» не влияет на разметку, зато
   * проверяется из обработчика наведения, который срабатывает раньше любого
   * перерисовывания. Состояние здесь означало бы второй запрос на каждое
   * движение мышью по строке.
   */
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
        // Отказ здесь — это чаще всего сеть телефона в лифте, а не пустой патч.
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

  // Строка может уехать из разметки вместе со сменой вкладки ленты, пока
  // таймер ждёт: висящий setTimeout дёрнул бы setState у размонтированного.
  useEffect(() => cancelHover, [cancelHover])

  // Проп остаётся серверным значением и служит фолбэком: под провайдером
  // подпись тикает сама, вне его — как раньше
  const now = useNow(nowSec)

  const name = meta?.name ?? `Игра ${item.appid}`
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
        onClick={() => {
          loadBody()
          setOpen((v) => !v)
        }}
        // Предзагрузка. Курсор доезжает до строки за сотни миллисекунд до
        // нажатия, touchstart опережает click примерно на сто — этого хватает,
        // чтобы тело успело приехать и раскрытие выглядело мгновенным, как
        // когда оно ехало вместе со страницей.
        //
        // Наведение — через задержку намерения, остальные три — сразу: касание
        // и фокус с клавиатуры проездом не бывают.
        onPointerEnter={hoverIntent}
        onPointerLeave={cancelHover}
        onFocus={loadBody}
        onTouchStart={loadBody}
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
            <span>{freshness(item.publishedAt, now)}</span>
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

      {/*
        Полоска живёт ВНЕ кнопки, и это не вопрос вкуса: ссылку внутрь <button>
        вложить нельзя. По той же причине вся начинка кнопки выше — только
        <span>. Отступ повторяет колонку арта: 92 + gap-4 на телефоне,
        168 + gap-6 на десктопе.
      */}
      {discovery ? (
        <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 pb-6 pl-[108px] text-sm md:pl-[192px]">
          <PriceTag priceFinal={price} discount={discount} isFree={meta?.isFree} />
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
              {blocks ? (
                <NewsBody blocks={blocks} />
              ) : failed ? (
                <p className="text-sm leading-relaxed text-dim">
                  Не удалось загрузить патч. Он открывается по ссылке ниже.
                </p>
              ) : (
                /* Скелет ровно на высоту абзаца: без него панель раскрывается
                   в пустоту и тут же дёргается, когда тело приезжает. */
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
