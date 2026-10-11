'use client'

import Link from 'next/link'
import { useRef, useState, type ReactNode } from 'react'
import { GameCardBody } from '@/components/GameCard'
import { Eyebrow } from '@/components/Labels'
import { NeedSteam } from '@/components/NeedSteam'
import { StatusLine } from '@/components/StatusLine'
import { SteamLaunch } from '@/components/SteamLaunch'
import type { GameArtUrls } from '@/lib/art'
import { latestWins } from '@/lib/latestwins'
import type { OutcomeVerdict } from '@/lib/outcome'
import { isNeedSteam } from '@/lib/writer'

/** Один совет на полке — всё уже посчитано на сервере (app/library/page.tsx) */
export type EveningItem = {
  appid: number
  shownAt: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
  /** «12 сентября» — дата совета */
  date: string
  /** «2 ч 10 мин», «5 ч за 6 нед.» (поздняя сверка), «не запускал», «ещё не сверяли» */
  played: string
  /** Сыграно заметно — только тогда есть смысл спрашивать «как тебе» */
  playedEnough: boolean
  verdict: OutcomeVerdict | null
  /** Игра сейчас в библиотеке — кнопка запускает её, а не ведёт в магазин */
  owned: boolean
  /** Магазин игры не из Steam; null — Steam */
  storeUrl: string | null
}

/** Одна игра может быть посоветована дважды — в разные окна */
const keyOf = (i: Pick<EveningItem, 'appid' | 'shownAt'>) => `${i.appid}:${i.shownAt}`

/** Чем кончился один POST ответа: denied — сессия только для чтения (needsteam) */
type Sent = 'ok' | 'denied' | 'failed'

const VERDICTS: Array<{ key: Exclude<OutcomeVerdict, 'dismissed'>; label: string }> = [
  { key: 'hooked', label: 'Зацепило' },
  { key: 'meh', label: 'Так себе' },
]

/**
 * «Твои вечера» — что сервис советовал за три месяца и что из этого вышло.
 *
 * Строки те же, что /play и /daily собирают для вопроса «как тебе?»
 * (lib/outcome.ts): сколько минут прибавилось у игры после совета. До сих
 * пор человек их не видел вовсе — они жили только в отчёте. Здесь же ответ
 * на «как тебе?» можно дать или поменять, а к игре — вернуться одним
 * нажатием.
 *
 * Ответ меняется оптимистично, а уходит по одному запросу на игру за раз
 * (lib/latestwins): два быстрых нажатия, отправленные разом, доезжали в любом
 * порядке, и база оставалась на первом. Отказ «только просмотр» (needsteam
 * от роута — права поменялись, пока страница была открыта) гасит кнопки и
 * оставляет строку о входе, как у полок забаненного. Сессии по ссылке вечера не
 * показываются вовсе: /library не читает для неё listEvenings (writer ? … в
 * app/library/page.tsx, сторож lib/ownerreads.test.ts) и этот компонент не
 * рисует — на его месте строка NeedSteam why="see".
 *
 * Подпись над полкой (lead) — готовой разметкой с сервера: сводка, поздние
 * минуты и что ещё подтянется считаются там, а текст в пропсах не весит в JS
 * маршрута.
 */
export function Evenings({
  items,
  lead,
  writer,
}: {
  items: EveningItem[]
  lead: ReactNode
  writer: boolean
}) {
  const [verdicts, setVerdicts] = useState(() => new Map(items.map((i) => [keyOf(i), i.verdict])))
  const [denied, setDenied] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const readOnly = !writer || denied
  const missed = failed === null ? undefined : items.find((i) => keyOf(i) === failed)
  // Что сервер точно принял — по ключу, поверх item.verdict из разметки. Откат
  // отказа идёт сюда, а не к прошлому нажатию: при очереди оно могло так и не
  // уехать, и откат к нему показал бы ответ, которого в базе нет
  const accepted = useRef(new Map<string, OutcomeVerdict>())
  const [send] = useState(() => latestWins<Sent>((r) => r === 'ok'))
  const acceptedOf = (item: EveningItem) => accepted.current.get(keyOf(item)) ?? item.verdict

  async function post(item: EveningItem, verdict: OutcomeVerdict): Promise<Sent> {
    // «Зацепило» → «Так себе» → «Зацепило», пока первый ответ в пути: ждущий
    // совпал с принятым, слать нечего
    if (acceptedOf(item) === verdict) return 'ok'
    try {
      const res = await fetch('/api/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: item.appid, shownAt: item.shownAt, verdict }),
      })
      if (await isNeedSteam(res)) return 'denied'
      if (!res.ok) return 'failed'
      accepted.current.set(keyOf(item), verdict)
      return 'ok'
    } catch {
      return 'failed'
    }
  }

  async function answer(item: EveningItem, verdict: OutcomeVerdict) {
    const key = keyOf(item)
    if ((verdicts.get(key) ?? null) === verdict) return
    setFailed(null)
    setVerdicts((m) => new Map(m).set(key, verdict))
    // null — прошлый ответ про эту игру ещё в пути, этот уедет следом, и итог
    // скажет тот вызов, что начал полёт
    const result = await send(key, () => post(item, verdict))
    if (result === null || result === 'ok') return
    setVerdicts((m) => new Map(m).set(key, acceptedOf(item)))
    if (result === 'denied') setDenied(true)
    else setFailed(key)
  }

  return (
    <section id="evenings" aria-labelledby="evenings-title" className="mb-12">
      <Eyebrow className="mb-2">За три месяца</Eyebrow>
      <h2 id="evenings-title" className="font-display text-display-sm">
        Твои вечера
      </h2>
      <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">{lead}</p>
      {/*
        Отказ скринридеру говорит одна строка на всю полку, а не строка под
        карточкой. Живая область стоит в разметке всегда, пустой (область,
        вставленная вместе с текстом, звучит не везде), а пустая она sr-only —
        то есть absolute. У ленты с горизонтальной прокруткой и у карточки нет
        position, и такой узел у дальней карточки выпадал бы из обрезки ленты
        за край экрана. Название игры — в самой строке: фокус остаётся на
        кнопке ответа, и «не вышло» без названия было бы ни о чём.
      */}
      <StatusLine
        text={missed ? `Не вышло — ответ про «${missed.name}» не сохранился. Попробуй ещё раз.` : null}
        className="sr-only"
      />
      <ol className="shelf-rail">
        {items.map((item) => {
          const key = keyOf(item)
          const verdict = verdicts.get(key) ?? null
          return (
            <li key={key} className="flex flex-col gap-3">
              <Link href={`/game/${item.appid}`} prefetch={false} className="game-card block">
                <GameCardBody
                  appid={item.appid}
                  name={item.name}
                  headerImage={item.headerImage}
                  art={item.art}
                  sizes="264px"
                  meta={
                    <>
                      <span className="truncate">{item.date}</span>
                      <span className="shrink-0 tabular-nums">{item.played}</span>
                    </>
                  }
                />
              </Link>
              {item.playedEnough && !readOnly && (
                <div role="group" aria-label={`Как тебе «${item.name}»?`} className="flex flex-wrap gap-2">
                  {VERDICTS.map((v) => (
                    <button
                      key={v.key}
                      type="button"
                      aria-pressed={verdict === v.key}
                      onClick={() => void answer(item, v.key)}
                      className="pill"
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
              )}
              {/* Для глаза: скринридеру отказ сказала строка над полкой */}
              {failed === key && (
                <p aria-hidden className="text-[11px] text-danger">
                  Не вышло — попробуй ещё раз
                </p>
              )}
              {item.owned && item.appid > 0 ? (
                <SteamLaunch
                  appid={item.appid}
                  label={item.playedEnough ? 'Вернуться к ней' : 'Запустить'}
                  mobileLabel="Открыть в Steam"
                  className="link-more tap self-start"
                />
              ) : (
                <a
                  href={item.storeUrl ?? `https://store.steampowered.com/app/${item.appid}/`}
                  target="_blank"
                  rel="noreferrer"
                  className="link-more tap self-start"
                >
                  В магазин
                </a>
              )}
            </li>
          )
        })}
      </ol>
      {readOnly && items.some((i) => i.playedEnough) && <NeedSteam from="/library" className="mt-4" />}
    </section>
  )
}
