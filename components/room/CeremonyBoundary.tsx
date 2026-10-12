'use client'

import { Component, type ReactNode, useCallback } from 'react'
import { focusAdrift } from '@/lib/focushandoff'
import { clientErrorCode, reportClientError } from '@/lib/clienterr'
import { matchByLeader } from '@/lib/room'
import { storeLink } from '@/lib/storelink'

/** Что нужно запасному экрану матча — подмножество matchedGame комнаты */
export type CeremonyGame = {
  appid: number
  name: string
  store: string | null
  storeUrl: string | null
  /** сколько участников за; null — не знаем (смотрит не участник) */
  forCount?: number | null
}

/**
 * МАТЧ ОСТАЁТСЯ МАТЧЕМ, ДАЖЕ ЕСЛИ ЦЕРЕМОНИЯ НЕ ЗАГРУЗИЛАСЬ.
 *
 * Церемония догружается отдельным куском (next/dynamic, см. докблок у
 * MatchCeremony в app/room/[id]/page), а React.lazy внутри него своей границы
 * не имеет. Кусок не пришёл — моргнула сеть, деплой сменил хеш, — и ошибка
 * уходила в app/error.tsx: вся комната ровно в минуту матча видела «Что-то
 * сломалось». А «Попробовать снова» там не помогает: lazy помнит отказ и на
 * повторе бросает его же.
 *
 * Эта граница держит отказ при себе и показывает то, ради чего церемония и
 * существует: о чём договорились и где это взять. Без gsap и без повторного
 * import — кэш отказа у lazy и у сборщика тот же, и повтор только снова
 * упадёт. «Обновить страницу» — единственный честный повтор: новая загрузка
 * берёт куски свежего деплоя.
 *
 * Отказ не теряется: граница его проглатывает, поэтому отчёт уходит отсюда —
 * тем же путём, что у app/error.tsx (lib/clienterr).
 */
export class CeremonyBoundary extends Component<
  { game: CeremonyGame; memberCount: number; takeFocus: boolean; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: unknown) {
    reportClientError({
      kind: 'boundary',
      error,
      href: window.location.href,
      code: clientErrorCode(error),
    })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <CeremonyFallback
        game={this.props.game}
        memberCount={this.props.memberCount}
        takeFocus={this.props.takeFocus}
      />
    )
  }
}

/**
 * Запасной экран матча. Фокус — как у самой церемонии: заголовок забирает
 * его, только если матч пришёл на глазах (takeFocus) и фокус потерян —
 * комната ушла из-под него целиком.
 *
 * ref — через useCallback, как у церемонии. Колбэк, написанный прямо в
 * разметке, новый на каждом рендере, и React зовёт его заново: страница
 * перерисовывается и после матча (возврат на вкладку снимает «●» в
 * заголовке), и заголовок снова и снова отнимал бы фокус, ушедший в body.
 *
 * Заголовок — тем же правилом, что у церемонии (matchByLeader в lib/room):
 * матч, взятый лидером голосов, — не «все хотят одного и того же», и
 * запасной экран не возвращает эту неправду ровно тогда, когда церемония не
 * пришла.
 */
export function CeremonyFallback({
  game,
  memberCount,
  takeFocus,
}: {
  game: CeremonyGame
  memberCount: number
  takeFocus: boolean
}) {
  const head = useCallback(
    (el: HTMLHeadingElement | null) => {
      if (el && takeFocus && focusAdrift(document)) el.focus()
    },
    [takeFocus],
  )
  const forCount = game.forCount ?? null
  const byLeader = matchByLeader(forCount, memberCount)
  const link = storeLink(game)
  return (
    <div className="flex-1 flex items-center justify-center px-5 py-24">
      <div className="max-w-md w-full panel-lift p-8 text-center flex flex-col items-center gap-5">
        <h1 ref={head} tabIndex={-1} className="font-display text-display-sm">
          {byLeader ? 'Договорились' : 'Это матч'}: «{game.name}»
        </h1>
        <p className="text-dim text-sm leading-relaxed">
          {byLeader
            ? `Не единогласно, но ${forCount} из ${memberCount} за. Праздничный экран не загрузился — а игра выбрана, зови всех в войс.`
            : 'Праздничный экран не загрузился, но договорились вы по-настоящему — зови всех в войс.'}
        </p>
        {link && (
          <a href={link.href} target="_blank" rel="noreferrer" className="btn-ember is-block py-3">
            Открыть в {link.where}
          </a>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="tap text-sm text-dim hover:text-ink transition-colors"
        >
          Обновить страницу
        </button>
      </div>
    </div>
  )
}
