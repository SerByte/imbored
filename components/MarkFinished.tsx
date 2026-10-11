'use client'

import Link from 'next/link'
import { useState } from 'react'
import { StatusLine } from '@/components/StatusLine'
import type { CtxSource } from '@/lib/feedbackctx'
import { quizHref } from '@/lib/presets'
import { isNeedSteam } from '@/lib/writer'

/** Узел, появившийся по нажатию, забирает фокус: нажатая кнопка ушла из DOM */
const grab = (el: HTMLElement | null) => el?.focus({ preventScroll: true })

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
  follow = false,
  className,
}: {
  appid: number
  name: string
  from: Extract<CtxSource, 'library' | 'game'>
  /** Сессия только читает (needsteam): кнопку прячет тот, кто её поставил */
  onDenied: () => void
  /** Звать «Дальше — в духе X» после отметки; где такая ссылка уже стоит рядом — нет */
  follow?: boolean
  className: string
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'failed'>('idle')

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
  }

  return (
    <>
      {state === 'done' ? (
        <span ref={grab} tabIndex={-1} className="self-center text-sm text-dim outline-none">
          Пройдено — больше не предложу
          {follow && (
            <>
              {' · '}
              <Link href={quizHref(null, appid)} className="tap text-ember-text hover:underline">
                Дальше — в духе «{name}»
              </Link>
            </>
          )}
        </span>
      ) : (
        <button
          type="button"
          onClick={() => void mark()}
          aria-disabled={state === 'busy'}
          title="Больше не предлагать. Вернуть можно в библиотеке, на полке «Пройдено»"
          className={className}
        >
          {/* Имя начинается с видимых слов (WCAG 2.5.3), а игра в нём — для
              полки «Твоих вечеров», где таких кнопок несколько */}
          {state === 'busy' ? (
            'Отмечаю…'
          ) : (
            <>
              Уже прошёл<span className="sr-only"> «{name}»</span>
            </>
          )}
        </button>
      )}
      <StatusLine
        text={state === 'failed' ? `Не получилось отметить «${name}» пройденной — нажми ещё раз.` : null}
        className="basis-full text-sm text-danger"
      />
    </>
  )
}
