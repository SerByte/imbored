'use client'

import { AnimatePresence, m } from 'framer-motion'
import { MotionMax } from '@/components/motion/MotionMax'
import { useLocale } from '@/components/LocaleProvider'
import { useLocaleRouter } from '@/components/useLocaleRouter'
import { useEffect, useRef, useState, useTransition } from 'react'
import { GameCardBody } from '@/components/GameCard'
import { GameLink } from '@/components/GameLink'
import { NeedSteam } from '@/components/NeedSteam'
import { StatusLine } from '@/components/StatusLine'
import type { GameArtUrls } from '@/lib/art'
import { Eyebrow } from '@/components/Labels'
import { lp, pl, tr } from '@/lib/i18n'
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
 * Полки выводятся из пропа, а не из копии в состоянии (как у LikedShelf):
 * router.refresh() зовёт не только эта полка. «Уже прошёл» в «Твоих
 * вечерах» на этой же странице (components/Evenings) обещает «вернуть можно
 * в библиотеке, на полке «Пройдено»» — а копия, снятая с первой разметки,
 * новой игры не видела, и вернуть её было не с чего до перезагрузки.
 *
 * writer — может ли сессия писать (isWriter в lib/server); страница знает
 * это сама, из той же сессии, по которой строит полки. Сессии по вставленной
 * ссылке скрытое не показывается вовсе: /library не читает для неё listBanned
 * (writer ? … в app/library/page.tsx, сторож lib/ownerreads.test.ts), полка
 * приходит пустой и не рисуется, а на странице вместо неё строка NeedSteam
 * why="see". Ветка «без кнопок» (readOnly) остаётся защитой и для отказа
 * needsteam от роута — на случай, если права поменялись, пока страница была
 * открыта: кнопки гаснут, вместо них строка о входе через Steam.
 */
export function BannedShelf({ games, writer }: { games: BannedGame[]; writer: boolean }) {
  const router = useLocaleRouter()
  const locale = useLocale()
  /*
   * Снятое — множеством поверх пропа. Плитка уходит сразу, до ответа, а
   * сервер присылает полку без неё только после router.refresh(): до тех пор
   * её прячет это множество.
   */
  const [removed, setRemoved] = useState<ReadonlySet<number>>(() => new Set())
  /*
   * Сервер прислал полки заново — снятое, которого в них больше нет,
   * забываем: прятать там уже нечего, а игра, снятая и отмеченная снова
   * («Снова предлагать» здесь, потом «Уже прошёл» в «Твоих вечерах»), иначе
   * так и не встала бы обратно на полку. Снятое, которое сервер ещё отдаёт
   * (чужой refresh обогнал запрос), остаётся спрятанным. Прошлый проп — в
   * состоянии, а не в эффекте: так React подстраивает состояние под новый
   * проп без кадра, в котором видно старое.
   */
  const [seen, setSeen] = useState(games)
  if (seen !== games) {
    setSeen(games)
    const present = new Set(games.map((g) => g.appid))
    setRemoved((prev) =>
      [...prev].every((id) => present.has(id)) ? prev : new Set([...prev].filter((id) => present.has(id))),
    )
  }
  const items = games.filter((g) => !removed.has(g.appid))
  const [failed, setFailed] = useState<number | null>(null)
  const [denied, setDenied] = useState(false)
  /**
   * Хоть одну плитку уже вернули — пустая полка тогда говорит «всё
   * вернулось», а не исчезает. Своим флагом, а не размером removed: снятое
   * забывается, как только сервер пришлёт полку без него.
   */
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

  const restore = (appid: number) =>
    setRemoved((prev) => {
      const next = new Set(prev)
      next.delete(appid)
      return next
    })

  async function unban(appid: number) {
    const from = items.find((g) => g.appid === appid)
    setFailed(null)
    setTouched(true)
    pendingFocus.current = focusAfter(appid)
    setRemoved((prev) => new Set(prev).add(appid))
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
        pendingFocus.current = { shelf: from?.done ? 'done' : 'hidden' }
        restore(appid)
        setDenied(true)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
      startTransition(() => router.refresh())
    } catch {
      // Плитка встаёт на своё место сама: порядок задаёт сервер (проп), и
      // угадывать его на клиенте — способ разъехаться с ним. Откатывается
      // только она: соседняя, вернутая тем временем успешно, не воскресает.
      // Фокус — обратно на ту же кнопку, рядом с ней строка про сбой
      pendingFocus.current = { appid }
      restore(appid)
      setFailed(appid)
    }
  }

  if (items.length === 0 && !touched) return null

  const hidden = items.filter((g) => !g.done)
  const done = items.filter((g) => g.done)

  /*
   * ОТКАЗ СКРИНРИДЕРУ ГОВОРИТ СТРОКА ПОЛОК, А НЕ ПЛИТКИ.
   *
   * Плитка уходит сразу, а отказ возвращает её откатом — то есть монтирует
   * заново, и живая область внутри плитки рождалась бы вместе с текстом
   * отказа: такую скринридер объявляет не везде (components/StatusLine).
   * Эта строка стоит первой в обоих вариантах разметки ниже — и в «всё
   * вернулось», и в полках, — и React держит её одним узлом, даже когда
   * последняя плитка ушла и вернулась. Название игры — в ней же: фокус
   * вернётся на кнопку плитки, а «не вышло» без названия было бы ни о чём.
   */
  const missed = failed === null ? undefined : items.find((g) => g.appid === failed)
  const miss = (
    <StatusLine
      text={
        missed
          ? tr(locale, {
              ru: `Не вышло — «${missed.name}» осталась на полке. Попробуй ещё раз.`,
              en: `Didn't work — “${missed.name}” is still on the shelf. Try again.`,
            })
          : null
      }
      className="sr-only"
    />
  )

  /*
   * Всё вернули — полка не исчезает молча, а говорит об этом. Строка же
   * держит фокус: иначе после последней плитки он упал бы в body. И держится
   * она и после router.refresh(), который пришлёт проп уже пустым: решает
   * touched, а не проп.
   *
   * Живой области на ней нет намеренно: строка рождается вместе со своим
   * текстом, и объявляет её не роль, а фокус, который на неё переезжает.
   */
  if (items.length === 0) {
    return (
      <>
        {miss}
        <section className="mb-12">
          <p ref={emptyLine} tabIndex={-1} className="text-dim text-sm">
            {tr(locale, { ru: 'Всё вернулось в подбор.', en: "Everything's back in your picks." })}
          </p>
        </section>
      </>
    )
  }

  const tiles = (list: BannedGame[], shelf: Shelf) => (
    /* Та же лестница, что у полки «запечатанного»: пять колонок с 768 px
       давали обложку мельче, чем на телефоне. */
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      {/* layout — фича domMax, её догружает MotionMax */}
      <MotionMax>
        <AnimatePresence mode="popLayout" initial={false}>
          {list.map((g) => (
            <m.div
              key={g.appid}
              layout
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.22 }}
              className="flex flex-col"
            >
              {/* Ссылка и кнопка — соседи, а не вложенные: интерактив внутри
                  интерактива не кликается и не читается скринридером */}
              <GameLink appid={g.appid} className="game-card block">
                <GameCardBody
                  appid={g.appid}
                  name={g.name}
                  headerImage={g.headerImage}
                  art={g.art}
                  sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                  // Обесцвечено только скрытое: пройденное — не изгнанное
                  dim={shelf === 'hidden'}
                />
              </GameLink>
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
                    shelf === 'done'
                      ? tr(locale, { ru: `Снова предлагать «${g.name}»`, en: `Suggest “${g.name}” again` })
                      : tr(locale, { ru: `Вернуть «${g.name}» в подбор`, en: `Put “${g.name}” back into picks` })
                  }
                  className="pill mt-3 self-start"
                >
                  {/* Слова глоссария, не шире русских: пилюля стоит под плиткой
                      в пять колонок */}
                  {shelf === 'done'
                    ? tr(locale, { ru: 'Снова предлагать', en: 'Suggest again' })
                    : tr(locale, { ru: 'Вернуть в подбор', en: 'Back into picks' })}
                </button>
              )}
              {/* Для глаза: скринридеру отказ уже сказала строка полок (miss) */}
              {failed === g.appid && (
                <p aria-hidden className="px-3 pb-3 text-[11px] text-danger">
                  {tr(locale, { ru: 'Не вышло — попробуй ещё раз', en: "Didn't work — try again" })}
                </p>
              )}
            </m.div>
          ))}
        </AnimatePresence>
      </MotionMax>
    </div>
  )

  return (
    <>
      {miss}
      <div className="flex flex-col gap-12 mb-12">
        {readOnly && <NeedSteam from={lp(locale, '/library')} />}

        {hidden.length > 0 && (
          <section aria-labelledby="shelf-hidden">
            <Eyebrow className="mb-2">{tr(locale, { ru: 'Скрытые', en: 'Hidden' })}</Eyebrow>
            <h2
              id="shelf-hidden"
              ref={(el) => {
                headings.current.hidden = el
              }}
              tabIndex={-1}
              className="font-display text-display-sm"
            >
              <span className="tabular-nums text-ember-text">{hidden.length}</span>{' '}
              {pl(locale, hidden.length, {
                ru: ['игру больше не предлагаем', 'игры больше не предлагаем', 'игр больше не предлагаем'],
                en: ['game we no longer suggest', 'games we no longer suggest'],
              })}
            </h2>
            <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
              {tr(locale, {
                ru: 'Их правда нет ни в подборе, ни в игре дня, ни в пати. Передумаешь — верни обратно.',
                en: "They're really gone from your picks, the game of the day and parties. Change your mind? Bring them back.",
              })}
            </p>
            {tiles(hidden, 'hidden')}
          </section>
        )}

        {done.length > 0 && (
          <section aria-labelledby="shelf-done">
            <Eyebrow className="mb-2">{tr(locale, { ru: 'Пройдено', en: 'Finished' })}</Eyebrow>
            <h2
              id="shelf-done"
              ref={(el) => {
                headings.current.done = el
              }}
              tabIndex={-1}
              className="font-display text-display-sm"
            >
              <span className="tabular-nums text-ember-text">{done.length}</span>{' '}
              {pl(locale, done.length, {
                ru: ['игра пройдена', 'игры пройдены', 'игр пройдено'],
                en: ['game finished', 'games finished'],
              })}
            </h2>
            <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
              {tr(locale, {
                ru: 'Их не предлагаем не потому, что не понравились: они пройдены. Захочешь перепройти — верни.',
                en: "We don't suggest them because you finished them, not because you didn't like them. Want to replay one? Bring it back.",
              })}
            </p>
            {tiles(done, 'done')}
          </section>
        )}
      </div>
    </>
  )
}
