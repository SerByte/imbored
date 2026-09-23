'use client'

import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { Ambient } from '@/components/Ambient'
import { FlapCode } from '@/components/FlapCode'
import { NeedSteam } from '@/components/NeedSteam'
import { RoomCodeForm } from '@/components/room/RoomCodeForm'
import { Spinner } from '@/components/Spinner'
import { SectionLabel } from '@/components/Labels'
import {
  afterBoardAnswer,
  boardDelayMs,
  boardKey,
  boardStale,
  initialBoardPoll,
  onBoardVisible,
} from '@/lib/boardpoll'
import { minutesAgoLabel } from '@/lib/freshness'
import { writerStore } from '@/lib/writer'

/**
 * Как устроено пати — тремя шагами.
 *
 * Страница была входом в целую половину продукта и при этом не показывала,
 * что там происходит: заголовок, одна фраза, кнопка и доска, которая почти
 * всегда пуста. Человеку, который про пати ещё не знает, предлагалось
 * вообразить механику по описанию — а механика тут и есть самое интересное:
 * каждый подключает СВОЮ библиотеку, колода собирается из общих игр, матч
 * случается, когда совпали голоса всех.
 *
 * Нумерация здесь не украшение и не «01/02/03 для вида». Это настоящая
 * последовательность: без кода нечего кидать, без вошедших не из чего
 * собрать колоду, без колоды не из чего совпасть. Порядок несёт смысл —
 * значит номер имеет право стоять.
 *
 * Прежний абзац убран, а не оставлен рядом: он говорил ровно то же самое,
 * только одной строкой и без подробностей. Два объяснения одного и того же
 * рядом — это не вдвое понятнее.
 */
const STEPS = [
  // «символов», а не «букв»: в алфавите кода есть цифры 2–9 (room/create)
  { title: 'Создай комнату', hint: 'Получишь код из шести символов и ссылку на неё' },
  { title: 'Кинь ссылку своим', hint: 'Каждый подключает свою библиотеку Steam' },
  { title: 'Свайпайте вместе', hint: 'Колода из общих игр; совпадут все голоса — матч' },
]

type Listing = { id: string; memberNames: string[]; minutesAgo: number }

type Board = { rooms: Listing[]; fresh: Set<string> }

export default function RoomsBoardPage() {
  // Свежесть держим в состоянии рядом со списком, а не в ref: читать ref во
  // время рендера нельзя, а знать «эта строка новая» нужно именно при рендере.
  const [board, setBoard] = useState<Board | null>(null)
  const rooms = board?.rooms ?? null
  // Отдельно от board: провал запроса не должен стирать уже показанную доску,
  // а показанная доска не должна прятать сообщение о том, что она устарела.
  // Число, а не флаг: пустой доске хватает одного отказа, чтобы сказать о нём
  // вместо спиннера, а показанную объявляем устаревшей со второго подряд
  // (lib/boardpoll, boardStale) — один оборванный запрос не новость.
  const [fails, setFails] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  /*
   * Сессия по вставленной ссылке комнату не создаст — /api/room/create ответит
   * ей 403 needsteam (lib/writer). Кнопка, которая ведёт на отказ, хуже строки
   * о том, как получить право. Подсесть к открытой пати ниже она может.
   */
  const readOnly =
    useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server) === false

  /**
   * Опрос доски — цикл на setTimeout, по образцу страницы комнаты, а не
   * setInterval. Ритм — сколько ждать, когда замедлиться, когда признать доску
   * устаревшей — решает lib/boardpoll.ts и сторожит его тест; здесь он только
   * применяется.
   *
   * Следующий запрос планируется, когда вернулся предыдущий, и inFlight не
   * даёт им наложиться: интервал не ждал ответа, и медленный ответ означал два
   * запроса в полёте.
   *
   * Опрос только при видимой вкладке — та же дисциплина, что в FeedWatch и на
   * странице комнаты: доска — это «кто ищет прямо сейчас», смотреть её из
   * свёрнутого окна некому. В скрытой вкладке таймер не взводится вовсе, а
   * возвращение во вкладку сразу спрашивает свежую доску.
   *
   * Первый запрос — исключение и делается всегда, даже в фоне: ссылку на
   * /rooms открывают и фоновой вкладкой, и без него человек, переключившись,
   * упирался бы в спиннер.
   */
  useEffect(() => {
    let stopped = false
    let timer = 0
    let inFlight: AbortController | null = null
    let poll = initialBoardPoll()

    const arm = () => {
      if (stopped) return
      window.clearTimeout(timer)
      timer = window.setTimeout(() => void tick(), boardDelayMs(poll))
    }

    const tick = async (force = false) => {
      if (stopped) return
      if (inFlight) {
        arm()
        return
      }
      // Скрытая вкладка: не спрашиваем и не взводим — разбудит visibilitychange
      if (!force && document.visibilityState !== 'visible') return

      const ac = new AbortController()
      inFlight = ac
      try {
        const res = await fetch('/api/rooms/public', { signal: ac.signal })
        if (!res.ok) throw new Error(String(res.status))
        const next = ((await res.json()) as { rooms: Listing[] }).rooms
        if (stopped) return
        poll = afterBoardAnswer(poll, { ok: true, key: boardKey(next) })
        setBoard((prev) => {
          const known = new Set(prev?.rooms.map((r) => r.id) ?? [])
          // На первой загрузке новыми считаются все — доска «прилетает» целиком.
          const fresh = new Set(next.filter((r) => !known.has(r.id)).map((r) => r.id))
          return { rooms: next, fresh }
        })
      } catch {
        // Раньше здесь был ранний return без try: любой сетевой сбой отклонял
        // промис внутри void load(), board навсегда оставался null, и человек
        // смотрел на спиннер до перезагрузки страницы. Отменённый при уходе
        // со страницы запрос попадает сюда же и молча выходит по stopped.
        if (stopped) return
        poll = afterBoardAnswer(poll, { ok: false })
      } finally {
        if (inFlight === ac) inFlight = null
      }
      setFails(poll.fails)
      arm()
    }

    const onVisibility = () => {
      if (stopped) return
      if (document.visibilityState !== 'visible') {
        window.clearTimeout(timer)
        return
      }
      poll = onBoardVisible(poll)
      void tick()
    }

    void tick(true)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stopped = true
      window.clearTimeout(timer)
      inFlight?.abort()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [reloadKey])

  return (
    <div className="relative flex-1 overflow-hidden">
      <Ambient />
      <div className="relative mx-auto w-full max-w-3xl px-5 pt-28 pb-16 flex flex-col gap-8">
      <div className="text-center flex flex-col items-center gap-5 anim-rise">
        <h1 className="font-display text-display-md">Пати</h1>
        {readOnly ? (
          // Вход вернёт прямо на создание комнаты, а не на эту доску
          <NeedSteam from="/room/new" className="max-w-sm" />
        ) : (
          <Link
            href="/room/new"
            className="btn-ember px-8 py-3"
          >
            Создать комнату
          </Link>
        )}
        {/* Вход по коду — всем, и сессии по ссылке тоже: создать комнату
            она не может, а войти в чужую и голосовать — может (lib/writer) */}
        <RoomCodeForm />
      </div>

      {/* Номер — моноширинным: это цифра, а в этом интерфейсе цифры набраны
          моноширинным везде, от кода комнаты до процента совместимости. */}
      <ol className="grid gap-4 sm:grid-cols-3 anim-rise" style={{ animationDelay: '80ms' }}>
        {STEPS.map((step, i) => (
          <li key={step.title} className="glass rounded-[20px] p-5 flex flex-col gap-1.5">
            <span className="font-mono text-xs text-ember-text">{`0${i + 1}`}</span>
            <span className="font-semibold leading-tight">{step.title}</span>
            <span className="text-sm text-dim leading-relaxed">{step.hint}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col gap-3">
        <SectionLabel className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
          Открытые пати — ищут игроков
        </SectionLabel>
        {/*
          Доска уже на экране, а сервер молчит: последний снимок остаётся —
          он всё ещё полезен, — но выглядеть свежим не имеет права. Та же
          плашка в потоке, что у комнаты (room/[id], staleBadge): role="status"
          объявляет новость тому, кто не смотрит на экран.
        */}
        {rooms !== null && boardStale({ fails }) && (
          <div
            role="status"
            aria-live="polite"
            className="glass anim-rise rounded-[14px] px-4 py-2.5 text-xs leading-relaxed text-dim"
          >
            Доска не отвечает — пробую снова…
          </div>
        )}
        {rooms === null && fails > 0 ? (
          <div className="glass rounded-[20px] p-6 text-center text-dim text-sm flex flex-col items-center gap-3">
            Не получилось загрузить доску.
            {/* Сброс отказов здесь же: пока идёт повтор, на месте ошибки
                крутится спиннер, а не висит та же строка без ответа. */}
            <button
              type="button"
              onClick={() => {
                setFails(0)
                setReloadKey((n) => n + 1)
              }}
              className="tap cursor-pointer text-sm text-ember-text hover:underline"
            >
              Попробовать снова
            </button>
          </div>
        ) : rooms === null ? (
          <div className="flex justify-center py-8">
            <Spinner size={32} />
          </div>
        ) : rooms.length === 0 ? (
          <div className="glass rounded-[20px] p-6 text-center text-dim text-sm">
            {/* Совет «создай свою» тому, кто создать не может, — тупик */}
            {readOnly
              ? 'Сейчас открытых комнат нет — загляни чуть позже.'
              : 'Сейчас открытых комнат нет. Создай свою и нажми «Показать на доске» — сюда придут.'}
          </div>
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            {rooms.map((r) => (
              <motion.div
                key={r.id}
                layout
                initial={{ opacity: 0, y: -8, height: 0 }}
                animate={{ opacity: 1, y: 0, height: 'auto' }}
                exit={{ opacity: 0, x: 8, height: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                className="overflow-hidden"
              >
                <Link
                  href={`/room/${r.id}`}
                  className="glass glass-hover rounded-[20px] p-5 flex items-center justify-between gap-4"
                >
                  <div>
                    {/* Створки только для строк, появившихся на ЭТОМ тике:
                        иначе каждые 8 секунд вся доска — игровой автомат. */}
                    <FlapCode code={r.id} animate={board?.fresh.has(r.id) ?? false} />
                    {/*
                      Разделитель только при именах. Комната без участников на
                      доске возможна — она висит там до суток, — и строка
                      начиналась с висячего « · », будто имя не дорисовалось.
                      Пустой состав называем словами: это ответ на вопрос «к
                      кому я подсяду».
                    */}
                    <div className="text-sm text-dim mt-0.5">
                      {r.memberNames.length ? `${r.memberNames.join(', ')} · ` : 'пока никого · '}
                      {minutesAgoLabel(r.minutesAgo)}
                    </div>
                  </div>
                  <span className="text-sm text-ink shrink-0">Подсесть →</span>
                </Link>
              </motion.div>
            ))}
          </AnimatePresence>
        )}
      </div>
      </div>
    </div>
  )
}
