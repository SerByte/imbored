'use client'

import { useState, useSyncExternalStore } from 'react'
import { useDemoSession } from '@/components/DemoBar'
import { StatusLine } from '@/components/StatusLine'
import { writerStore } from '@/lib/writer'

/**
 * «Сыграю вечером на ПК» — план на вечер с телефона (lib/eveningplan.ts).
 *
 * На телефоне у своей игры под героем нет ни запуска (steam:// там не
 * работает, SteamLaunch ведёт в магазин), ни загрузки — только строка о том,
 * где её поставить. Решение «вот в это сыграю вечером», принятое в автобусе,
 * на этом и кончалось. Нажатие пишет план (intent 'tonight'), и вечером на
 * компьютере игра ждёт строкой над «Продолжить» на /play и на главной.
 *
 * Только на тач-устройствах (pointer-fine:hidden — тот же признак, что у
 * развилки SteamLaunch): на компьютере рядом и так «Запустить» и «Поставь
 * на загрузку». И только пишущей сессии не из демо — writer именно true, а
 * не «не знаем»: обещать вечернюю строку тому, чьё нажатие не запишется
 * (вход по ссылке) или чей вечер чужой (демо), — обещать неправду.
 *
 * Кнопка после нажатия остаётся на месте, меняется только подпись: уйди она
 * — фокус упал бы в body. Что именно случилось, говорит строка статуса.
 * Вызывающий ставит key по игре: у следующего героя — свой план.
 *
 * initialDone — игра уже отложена в этом заходе (app/play, planned):
 * «Подробнее» → «Назад» монтирует кнопку заново, и без него она снова
 * звала бы «Сыграю вечером на ПК», будто плана нет, — хотя «Не то —
 * дальше» рядом уже листает героя как отложенного.
 *
 * Компонент живёт на /play и /daily, а оба стоят у потолка бюджета
 * (bundle-budget.json): страницы грузят его лениво (components/TonightLazy —
 * там же прогрев и пустое место вместо поломки, если кусок не пришёл), и
 * состояние у него одно на всё. Повторное нажатие,
 * пока первое в пути, пишет второй такой же план — безобидно: план не
 * оценка, и читается из него только самый свежий.
 */
export function TonightButton({
  name,
  onPlan,
  initialDone,
}: {
  name: string
  onPlan: () => Promise<boolean>
  initialDone?: boolean
}) {
  const writer = useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server)
  const demo = useDemoSession()
  /** null — не нажимали или запрос в пути; true — записано; false — не вышло */
  const [done, setDone] = useState<boolean | null>(initialDone || null)
  if (writer !== true || demo) return null

  async function plan() {
    if (done) return
    // Отказ гаснет до запроса: второй такой же иначе промолчал бы (StatusLine)
    setDone(null)
    setDone(await onPlan())
  }

  return (
    <div className="pointer-fine:hidden -mt-1 flex flex-col gap-1 text-xs text-faint">
      <button
        type="button"
        onClick={() => void plan()}
        aria-disabled={done === true}
        className="tap self-start hover:text-ink transition-colors cursor-pointer"
      >
        {done ? 'Отложено на вечер' : 'Сыграю вечером на ПК'}
      </button>
      <StatusLine
        text={
          done
            ? `Откроешь imbored на ПК — «${name}» будет ждать в подборке.`
            : done === false && 'Не вышло — попробуй ещё раз.'
        }
        className="text-dim"
      />
    </div>
  )
}
