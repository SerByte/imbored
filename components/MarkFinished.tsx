'use client'

import Link from '@/components/Link'
import { useState } from 'react'
import { useLocale } from '@/components/LocaleProvider'
import { StatusLine } from '@/components/StatusLine'
import type { CtxSource } from '@/lib/feedbackctx'
import { tr } from '@/lib/i18n'
import { quizHref } from '@/lib/presets'
import { isNeedSteam } from '@/lib/writer'

/** Узел, появившийся по нажатию, забирает фокус: нажатая кнопка ушла из DOM */
const grab = (el: HTMLElement | null) => el?.focus({ preventScroll: true })

/**
 * Строка «Пройдено» на месте кнопки — одна на обе дороги к этому состоянию:
 * только что нажатую отметку (MarkFinished ниже) и уже лежащую на полке
 * (страница игры по done из ответа владения, components/OwnedLaunch). Пока
 * это были две копии, они разошлись: сразу после нажатия строка звала
 * «Дальше — в духе X», а после перезагрузки то же состояние стояло без
 * дороги дальше.
 *
 * focus — только у нажатой: кнопка, на которой стоял фокус, ушла из DOM.
 * Строка, нарисованная при загрузке страницы, фокус не трогает — его там
 * никто не терял.
 */
export function FinishedNote({
  appid,
  name,
  follow,
  focus = false,
}: {
  appid: number
  name: string
  follow: boolean
  focus?: boolean
}) {
  const locale = useLocale()
  return (
    <span
      ref={focus ? grab : undefined}
      tabIndex={focus ? -1 : undefined}
      className="self-center text-sm text-dim outline-none"
    >
      {tr(locale, { ru: 'Пройдено — больше не предложу', en: "Finished — won't suggest it again" })}
      {follow && (
        <>
          {' · '}
          <Link href={quizHref(null, appid)} className="tap text-ember-text hover:underline">
            {tr(locale, { ru: `Дальше — в духе «${name}»`, en: `Next: more like “${name}”` })}
          </Link>
        </>
      )}
    </span>
  )
}

/**
 * «Уже прошёл» там, где игра перед глазами: «Твои вечера» в библиотеке и
 * страница игры.
 *
 * Отметить игру пройденной можно было только у героя /play — и только когда
 * героем выпадала заброшенная или знакомая. Игра, которую человек как раз
 * прошёл, стоит у него в «Твоих вечерах» с «Зацепило» и на своей странице, а
 * закрыть её там было нечем: завтра подбор снова предлагал «вернуться».
 *
 * Это тот же бан с причиной 'done', что у героя (BannedShelf кладёт его на
 * полку «Пройдено», откуда его снимают «Снова предлагать»), и правило у него
 * то же: ждёт ответа сервера, отказ звучит строкой и повторяется тем же
 * нажатием, кнопка на время запроса — aria-disabled, а не disabled (сторож
 * lib/disabledfocus.test.ts). from — откуда отметка, для снимка к оценке
 * (lib/feedbackctx): в отчёте её не спутать с ответом на подбор.
 *
 * После ответа на месте кнопки — «Пройдено» и, если follow, дорога дальше:
 * «в духе X» — квиз с затравкой (quizHref), настроение он спросит сам.
 * Фокус переезжает на эту строку: кнопка, на которой он стоял, ушла.
 *
 * Выдача /play на устройстве (lib/playcache) живёт пятнадцать минут, и
 * «Подробнее» → «Уже прошёл» здесь → «Назад» вернули бы пройденную игру
 * героем, — это помнит lib/finishlocal. Модуль грузится по нажатию, а не с
 * первой загрузкой: на /library и /game он больше ничем не нужен, а бюджет
 * веса там на пределе.
 */
export function MarkFinished({
  appid,
  name,
  from,
  onDenied,
  onDone,
  follow = false,
  className,
}: {
  appid: number
  name: string
  from: Extract<CtxSource, 'library' | 'game'>
  /** Сессия только читает (needsteam): кнопку прячет тот, кто её поставил */
  onDenied: () => void
  /**
   * Отметка записана. Для страницы, где рядом лежит то, что от неё меняется:
   * на /library — полка «Пройдено» (Evenings зовёт router.refresh). Узел
   * этой кнопки её владелец обязан держать смонтированным: на нём стоит
   * фокус, а строка «Пройдено» вместо него уронила бы его в body.
   */
  onDone?: () => void
  /** Звать «Дальше — в духе X» после отметки; где такая ссылка уже стоит рядом — нет */
  follow?: boolean
  className: string
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')
  const locale = useLocale()

  async function mark() {
    if (state === 'busy') return
    // Прежний отказ гаснет до запроса: второй такой же иначе промолчал бы
    setState('busy')
    let next: 'idle' | 'done' | 'failed' = 'failed'
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appid, action: 'banned', reason: 'done', ctx: { source: from } }),
      })
      if (await isNeedSteam(res)) {
        next = 'idle'
        onDenied()
      } else if (res.ok) {
        next = 'done'
        void import('@/lib/finishlocal').then((m) => m.rememberFinished(appid, Date.now())).catch(() => {})
      }
    } catch {
      // сеть — тот же отказ, что и пятисотка: строка ниже, кнопка на месте
    }
    setState(next)
    if (next === 'done') onDone?.()
  }

  return (
    <>
      {state === 'done' ? (
        <FinishedNote appid={appid} name={name} follow={follow} focus />
      ) : (
        <button
          type="button"
          onClick={() => void mark()}
          aria-disabled={state === 'busy'}
          title={tr(locale, {
            ru: 'Больше не предлагать. Вернуть можно в библиотеке, на полке «Пройдено»',
            en: "Don't suggest it again. You can bring it back from the “Finished” shelf in your library",
          })}
          className={className}
        >
          {/* Имя начинается с видимых слов (WCAG 2.5.3), а игра в нём — для
              полки «Твоих вечеров», где таких кнопок несколько */}
          {state === 'busy' ? (
            tr(locale, { ru: 'Отмечаю…', en: 'Marking…' })
          ) : locale === 'en' ? (
            <>
              Already finished<span className="sr-only"> “{name}”</span>
            </>
          ) : (
            <>
              Уже прошёл<span className="sr-only"> «{name}»</span>
            </>
          )}
        </button>
      )}
      {/* Отказ — та же строка, что DONE_MISS у героя /play, на обоих языках */}
      <StatusLine
        text={
          state === 'failed'
            ? tr(locale, {
                ru: `Не получилось отметить «${name}» пройденной — нажми ещё раз.`,
                en: `Couldn't mark “${name}” as finished — try again.`,
              })
            : null
        }
        className="basis-full text-sm text-danger"
      />
    </>
  )
}
