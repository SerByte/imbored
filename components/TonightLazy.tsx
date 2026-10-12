'use client'

import { useEffect } from 'react'
import { lazyIsland, reportIslandFailure } from '@/components/lazyIsland'
import type { TonightButton as Tonight } from '@/components/TonightButton'

/*
 * «Сыграю вечером на ПК» (components/TonightButton) — лениво, и так, чтобы
 * не пришедший кусок не ронял страницу.
 *
 * Лениво — потому что строка нужна только своей игре и только под пальцем, а
 * /play и /daily стоят у потолка бюджета первой загрузки (bundle-budget.json).
 * Островком (components/lazyIsland), а не next/dynamic: его рантайм — ~4 КБ
 * к первой загрузке, а островок — десятки байт.
 *
 * Но кусок впервые просят, когда своя игра впервые встаёт героем, — в выдаче
 * «всё подряд» это бывает и через полчаса после загрузки. Не дошёл он
 * (моргнула сеть в том самом автобусе; деплой сменил хеш, и старый кусок
 * отвечает 404) — React.lazy внутри next/dynamic отклонялся без своей
 * границы, и вся /play становилась «Что-то сломалось» из-за необязательной
 * текстовой кнопки. Тот же провал описан у церемонии матча
 * (app/room/[id]/page.tsx), только там есть что показать вместо неё, а
 * здесь — нечего. Поэтому без границы: отказ ловит сам загрузчик и отдаёт
 * пустой компонент. Кнопки нет, страница цела; «попробовать ещё раз» тут не
 * нужно — островок помнит пустой компонент до перезагрузки, как помнил бы и
 * кнопку. До островка отказ так и не доходит, поэтому отчёт о нём шлёт сам
 * загрузчик — тем же путём и с тем же тегом, что островок
 * (reportIslandFailure): 404 куска после деплоя видно в логе, а не только
 * по пропавшей кнопке.
 *
 * И прогрев (useWarmTonight): кусок качается в простое после загрузки, из
 * того же деплоя, что и страница, — к первой своей игре он уже лежит.
 * Только там, где кнопка видна (не pointer: fine — тот же признак, что у её
 * pointer-fine:hidden): компьютеру он не нужен вовсе.
 */
const loadTonight = () => import('@/components/TonightButton').then((m) => m.TonightButton)

/** Кусок не пришёл: кнопки нет, а страница цела */
function NoTonight() {
  return null
}

/** Отказ куска — пустое место до перезагрузки и отчёт, как у любого островка */
function tonightFailed(err: unknown): typeof Tonight {
  reportIslandFailure('tonight', err)
  return NoTonight
}

export const TonightButton = lazyIsland(() => loadTonight().catch(tonightFailed), 'tonight')

/**
 * Прогрев куска «Сыграю вечером» — см. докблок выше. В простое, а без
 * requestIdleCallback (Safari) — таймером. .catch обязателен: не пришедший
 * кусок — не ошибка страницы (её поймал бы instrumentation-client как
 * unhandledrejection), а пустое место, которое и так покажет загрузчик. И
 * без отчёта: прогрев — догадка наперёд, а отказ, который человек увидит,
 * отчитает загрузчик, когда кнопку попросят на самом деле.
 */
export function useWarmTonight() {
  useEffect(() => {
    if (window.matchMedia('(pointer: fine)').matches) return
    const warm = () => {
      loadTonight().catch(() => null)
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(warm, { timeout: 15_000 })
      return () => window.cancelIdleCallback(id)
    }
    const t = window.setTimeout(warm, 4_000)
    return () => window.clearTimeout(t)
  }, [])
}
