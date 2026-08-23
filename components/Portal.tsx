'use client'

import { useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

/**
 * Слой, который обязан висеть на экране, а не на содержимом страницы.
 *
 * Появился вместе с плавной прокруткой. ScrollSmoother двигает содержимое
 * трансформом, а трансформ создаёт новый containing block — и `position: fixed`
 * внутри него перестаёт означать «относительно экрана». Оверлей просмотра
 * кадра, плавающая плашка прогрева и тост ленты патчей начали бы уезжать
 * вместе с прокруткой, причём молча: увидеть это можно, только прокрутив
 * страницу с открытым оверлеем.
 *
 * Правило закреплено сторожем lib/smoothfixed.test.ts, и он смотрит на файл:
 * либо разметка рендерится снаружи обёртки, либо в ней есть портал.
 */

/**
 * «Мы уже на клиенте?» — через useSyncExternalStore, а не через состояние в
 * эффекте. document.body на сервере не существует, а рендер портала при первом
 * клиентском проходе разошёлся бы с серверной разметкой; но `setState` в
 * эффекте ради этого — лишний проход рендера и прямой запрет линтера
 * (react-hooks/set-state-in-effect). Тот же приём уже применён в
 * lib/sessionhint.ts: серверный снимок отличается от клиентского, и React
 * знает об этом сам.
 *
 * Подписка пустая намеренно: значение меняется ровно один раз — при переходе с
 * сервера на клиент, — и уведомлять о нём некому.
 */
const subscribe = () => () => {}
const onClient = () => true
const onServer = () => false

export function Portal({ children }: { children: React.ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, onClient, onServer)
  if (!mounted) return null
  return createPortal(children, document.body)
}
