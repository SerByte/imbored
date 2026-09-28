'use client'

import Link from 'next/link'
import { useState } from 'react'
import { GameCardBody } from '@/components/GameCard'
import { Eyebrow } from '@/components/Labels'
import { NeedSteam } from '@/components/NeedSteam'
import { SteamLaunch } from '@/components/SteamLaunch'
import type { GameArtUrls } from '@/lib/art'
import type { OutcomeVerdict } from '@/lib/outcome'
import { plural } from '@/lib/plural'
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
  /** «2 ч 10 мин», «не запускал», «ещё не сверяли» */
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
 * Ответ меняется оптимистично; отказ «только просмотр» (сессия по ссылке)
 * гасит кнопки и оставляет строку о входе, как у полок забаненного.
 */
export function Evenings({
  items,
  summary,
  writer,
}: {
  items: EveningItem[]
  summary: { checked: number; played: number; hours: string }
  writer: boolean
}) {
  const [verdicts, setVerdicts] = useState(() => new Map(items.map((i) => [keyOf(i), i.verdict])))
  const [denied, setDenied] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const readOnly = !writer || denied

  async function answer(item: EveningItem, verdict: OutcomeVerdict) {
    const key = keyOf(item)
    const before = verdicts.get(key) ?? null
    if (before === verdict) return
    setFailed(null)
    setVerdicts((m) => new Map(m).set(key, verdict))
    try {
      const res = await fetch('/api/outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid: item.appid, shownAt: item.shownAt, verdict }),
      })
      if (await isNeedSteam(res)) {
        setVerdicts((m) => new Map(m).set(key, before))
        setDenied(true)
        return
      }
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setVerdicts((m) => new Map(m).set(key, before))
      setFailed(key)
    }
  }

  return (
    <section id="evenings" aria-labelledby="evenings-title" className="mb-12">
      <Eyebrow className="mb-2">За три месяца</Eyebrow>
      <h2 id="evenings-title" className="font-display text-display-sm">
        Твои вечера
      </h2>
      <p className="text-dim text-sm mt-1.5 mb-4 max-w-md">
        {summary.checked > 0 ? (
          <>
            Наиграно после наших советов: <span className="text-ink tabular-nums">{summary.hours}</span>.
            Всерьёз, от пятнадцати минут, — в <span className="tabular-nums">{summary.played}</span> из{' '}
            <span className="tabular-nums">{summary.checked}</span>{' '}
            {plural(summary.checked, 'совета', 'советов', 'советов')}.
          </>
        ) : (
          'Что мы советовали и что из этого вышло. Минуты подтянутся со следующим снимком библиотеки.'
        )}
      </p>
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
              {failed === key && (
                <p role="status" className="text-[11px] text-danger">
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
