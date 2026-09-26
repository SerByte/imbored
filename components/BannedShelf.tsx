'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { GameCardBody } from '@/components/GameCard'
import { NeedSteam } from '@/components/NeedSteam'
import type { GameArtUrls } from '@/lib/art'
import { Eyebrow } from '@/components/Labels'
import { plural } from '@/lib/plural'
import { isNeedSteam } from '@/lib/writer'

export type BannedGame = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
  /** Убрана кнопкой «Уже прошёл», а не «больше не показывать» (listBanned) */
  done: boolean
}

type Shelf = 'hidden' | 'done'

/** Куда поставить фокус после того, как плитка с кнопкой ушла */
type FocusTarget = { appid: number } | { shelf: Shelf } | 'empty'

/**
 * Полки забаненного: скрытое и пройденное.
 *
 * Живут на /library и существуют ради одного: бан — единственное необратимое
 * действие во всём продукте. Он вырезает игру из fetchDiscoveryPool навсегда,
 * а нажимают его сгоряча. Сервис, который обещает слушать, обязан показывать,
 * что именно он услышал, и уметь это отменить.
 *
 * ПОЛОК ДВЕ, потому что причин две. «Уже прошёл» на /play пишет тот же бан, но
 * игра не разонравилась — она кончилась. Раньше всё лежало одной кучей под
 * «Чистилище / Ты выгнал N», обесцвеченным, с советом «если передумал, верни
 * обратно»: пять любимых пройденных игр читались как пять изгнанных. А слово
 * «Чистилище» на портрете значит совсем другое — нераспакованное. Теперь
 * пройденное лежит в цвете и возвращается словами «Снова предлагать», а
 * «Скрытые» — тем же словом, каким их зовёт /privacy.
 *
 * Клиентский островок на серверной странице: плитка удаляется сразу, а
 * router.refresh() догоняет числа в шапке. Ждать круга до сервера, чтобы
 * увидеть результат нажатия, здесь незачем — операция идемпотентна.
 *
 * writer — может ли сессия писать (isWriter в lib/server); страница знает
 * это сама, из той же сессии, по которой строит полки. Сессия по вставленной
 * ссылке видит, что убрано, но вернуть не может: кнопок нет, вместо них
 * строка о входе через Steam. Отказ needsteam от роута — на случай, если
 * права поменялись, пока страница была открыта, — ведёт туда же.
 */
export function BannedShelf({ games, writer }: { games: BannedGame[]; writer: boolean }) {
  const router = useRouter()
  const [items, setItems] = useState(games)
  const [failed, setFailed] = useState<number | null>(null)
  const [denied, setDenied] = useState(false)
  /** Хоть одну плитку уже вернули — пустая полка тогда говорит «всё вернулось», а не исчезает */
  const [touched, setTouched] = useState(false)
  const [, startTransition] = useTransition()
  const readOnly = !writer || denied

  /*
   * ФОКУС НЕ ТЕРЯЕТСЯ ВМЕСТЕ С ПЛИТКОЙ.
   *
   * Кнопка, на которой стоял фокус, уходит из DOM вместе со своей плиткой, и
   * фокус падал в body: к следующей игре с клавиатуры приходилось идти с
   * начала страницы. Теперь он переезжает на соседнюю кнопку той же полки, а
   * если полка опустела — на заголовок другой или на строку «всё вернули».
   *
   * Цель лежит в ref и ставится эффектом после рендера: в момент нажатия
   * соседняя кнопка ещё может не существовать (откат после сбоя возвращает
   * плитку только следующим рендером).
   */
  const pendingFocus = useRef<FocusTarget | null>(null)
  const buttons = useRef(new Map<number, HTMLButtonElement>())
  const headings = useRef<Record<Shelf, HTMLHeadingElement | null>>({ hidden: null, done: null })
  const emptyLine = useRef<HTMLParagraphElement>(null)

  useEffect(() => {
    const target = pendingFocus.current
    if (!target) return
    pendingFocus.current = null
    const el =
      target === 'empty'
        ? emptyLine.current
        : 'appid' in target
          ? buttons.current.get(target.appid)
          : headings.current[target.shelf]
    el?.focus()
  })

  /** Куда уйти фокусу, когда плитка appid покинет полку */
  function focusAfter(appid: number): FocusTarget {
    const gone = items.find((g) => g.appid === appid)
    const shelf = gone?.done ? 'done' : 'hidden'
    const same = items.filter((g) => g.done === gone?.done)
    const at = same.findIndex((g) => g.appid === appid)
    const neighbour = same[at + 1] ?? same[at - 1]
    if (neighbour) return { appid: neighbour.appid }
    const other: Shelf = shelf === 'done' ? 'hidden' : 'done'
    return items.some((g) => g.appid !== appid) ? { shelf: other } : 'empty'
  }

  async function unban(appid: number) {
    const before = items
    setFailed(null)
    setTouched(true)
    pendingFocus.current = focusAfter(appid)
    setItems((prev) => prev.filter((g) => g.appid !== appid))
    try {
      const res = await fetch('/api/unban', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ appid }),
      })
      if (await isNeedSteam(res)) {
        // Не «попробуй ещё раз»: не получится. Плитка возвращается на место,
        // кнопки прячутся, и строка над полками объясняет почему. Кнопок
        // больше нет — фокус на заголовок той полки, откуда нажимали
        const from = before.find((g) => g.appid === appid)
        pendingFocus.current = { shelf: from?.done ? 'done' : 'hidden' }
        setItems(before)
        setDenied(true)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      startTransition(() => router.refresh())
    } catch {
      // Откат целиком, а не вставка одной плитки: порядок на полке задаёт
      // сервер, и угадывать его на клиенте — способ разъехаться с ним.
      // Фокус — обратно на ту же кнопку, рядом с ней строка про сбой
      pendingFocus.current = { appid }
      setItems(before)
      setFailed(appid)
    }
  }

  if (items.length === 0 && !touched) return null

  const hidden = items.filter((g) => !g.done)
  const done = items.filter((g) => g.done)

  /*
   * Всё вернули — полка не исчезает молча, а говорит об этом. Строка же
   * держит фокус: иначе после последней плитки он упал бы в body. И держится
   * она и после router.refresh(): полки живут в своём состоянии, а не в
   * пропе, который сервер пришлёт уже пустым.
   */
  if (items.length === 0) {
    return (
      <section className="mb-12">
        <p ref={emptyLine} tabIndex={-1} role="status" className="text-dim text-sm">
          Всё вернулось в подбор.
        </p>
      </section>
    )
  }

  const tiles = (list: BannedGame[], shelf: Shelf) => (
    /* Та же лестница, что у полки «запечатанного»: пять колонок с 768 px
       давали обложку мельче, чем на телефоне. */
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <AnimatePresence mode="popLayout" initial={false}>
        {list.map((g) => (
          <motion.div
            key={g.appid}
            layout
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.22 }}
            className="flex flex-col"
          >
            {/* Ссылка и кнопка — соседи, а не вложенные: интерактив внутри
                интерактива не кликается и не читается скринридером */}
            <Link href={`/game/${g.appid}`} className="game-card block">
              <GameCardBody
                appid={g.appid}
                name={g.name}
                headerImage={g.headerImage}
                art={g.art}
                sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                // Обесцвечено только скрытое: пройденное — не изгнанное
                dim={shelf === 'hidden'}
              />
            </Link>
            {!readOnly && (
              /*
                У каждой кнопки своё имя. Видимый текст один на всю полку, и
                скринридер зачитывал список из пяти одинаковых «Вернуть в
                подбор», не говоря, какая к какой игре.
              */
              <button
                type="button"
                ref={(el) => {
                  if (el) buttons.current.set(g.appid, el)
                  else buttons.current.delete(g.appid)
                }}
                onClick={() => unban(g.appid)}
                aria-label={
                  shelf === 'done' ? `Снова предлагать «${g.name}»` : `Вернуть «${g.name}» в подбор`
                }
                className="pill mt-3 self-start"
              >
                {shelf === 'done' ? 'Снова предлагать' : 'Вернуть в подбор'}
              </button>
            )}
            {failed === g.appid && (
              <p role="status" className="px-3 pb-3 text-[11px] text-danger">
                Не вышло — попробуй ещё раз
              </p>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )

  return (
    <div className="flex flex-col gap-12 mb-12">
      {readOnly && <NeedSteam from="/library" />}

      {hidden.length > 0 && (
        <section aria-labelledby="shelf-hidden">
          <Eyebrow className="mb-2">Скрытые</Eyebrow>
          <h2
            id="shelf-hidden"
            ref={(el) => {
              headings.current.hidden = el
            }}
            tabIndex={-1}
            className="font-display text-display-sm"
          >
            <span className="tabular-nums text-ember-text">{hidden.length}</span>{' '}
            {plural(hidden.length, 'игру', 'игры', 'игр')} больше не предлагаем
          </h2>
          <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
            Их правда нет ни в подборе, ни в игре дня, ни в пати. Передумаешь — верни обратно.
          </p>
          {tiles(hidden, 'hidden')}
        </section>
      )}

      {done.length > 0 && (
        <section aria-labelledby="shelf-done">
          <Eyebrow className="mb-2">Пройдено</Eyebrow>
          <h2
            id="shelf-done"
            ref={(el) => {
              headings.current.done = el
            }}
            tabIndex={-1}
            className="font-display text-display-sm"
          >
            <span className="tabular-nums text-ember-text">{done.length}</span>{' '}
            {plural(done.length, 'игра пройдена', 'игры пройдены', 'игр пройдено')}
          </h2>
          <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
            Их не предлагаем не потому, что не понравились: они пройдены. Захочешь перепройти —
            верни.
          </p>
          {tiles(done, 'done')}
        </section>
      )}
    </div>
  )
}
