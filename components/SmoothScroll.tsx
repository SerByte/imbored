'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'

/**
 * ПЛАВНАЯ ПРОКРУТКА ГЛАВНОЙ — лёгкий вход.
 *
 * Монтируется только в app/page.tsx: закреплённые сцены есть только у
 * главной. Раньше вход стоял в корневом лэйауте, и чанк смузера догружался
 * на каждой странице — /privacy, /game, /play, — где закреплять было нечего.
 *
 * Сам смузер (gsap, ScrollTrigger, ScrollSmoother) живёт в SmoothScrollImpl и
 * едет отдельным чанком. Раньше он стоял здесь статическим импортом и клал
 * около 57 КБ br в начальный набор скриптов КАЖДОЙ страницы: замер живых
 * чанков /privacy — 28% всего модульного JS страницы, то есть гость с поиска
 * на /game качал и разбирал gsap до того, как страница оживала. Платил и тот,
 * у кого включено «уменьшить движение»: настройку спрашивал useGSAP, то есть
 * уже после того, как код скачан и разобран.
 *
 * Теперь порядок обратный: сначала вопрос, потом загрузка. При «уменьшить
 * движение» чанк не запрашивается вовсе. Иначе — в первую свободную минуту
 * браузера, чтобы разбор gsap не спорил с гидратацией за главный поток. До
 * этого момента страница прокручивается нативно — ровно так, как она
 * прокручивается без смузера вообще, а он и задуман необязательным.
 *
 * ПОЗДНИЙ СТАРТ СМУЗЕР ПЕРЕНОСИТ ШТАТНО. ScrollSmoother.create сам
 * пересобирает под свою обёртку ScrollTrigger'ы, заведённые до него
 * (node_modules/gsap/src/ScrollSmoother.js, existingScrollTriggers). И это не
 * новый режим, а прежний: сцены главной и до правки заводились раньше смузера —
 * этот компонент стоит в разметке главной после сцен, а эффекты соседа,
 * стоящего раньше, срабатывают первыми.
 *
 * Обёртка `#smooth-wrapper > #smooth-content` по-прежнему стоит в
 * app/layout.tsx всегда: без смузера она безвредна, а смузер главной без неё
 * не заведётся. Что вход не вернётся в лэйаут и что gsap не въедет в него
 * через чей-нибудь статический импорт, сторожит lib/smoothlazy.test.ts.
 *
 * ssr: false — рендерится только после проверки в эффекте, на сервере ему
 * делать нечего.
 */
const SmoothScrollImpl = dynamic(
  () => import('./SmoothScrollImpl').then((m) => m.SmoothScrollImpl),
  { ssr: false },
)

/**
 * Сколько ждать свободной минуты браузера, прежде чем грузить всё равно. На
 * занятой странице — главная с лентой и сценами — свободное время может не
 * наступать долго, а смузер без потолка приезжал бы когда повезёт.
 */
const IDLE_TIMEOUT_MS = 2000

export function SmoothScroll() {
  const [wanted, setWanted] = useState(false)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    // requestIdleCallback есть не во всех браузерах — там хватает таймера:
    // главное, чтобы загрузка не встала в один кадр с гидратацией
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(() => setWanted(true), { timeout: IDLE_TIMEOUT_MS })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(() => setWanted(true), 200)
    return () => window.clearTimeout(id)
  }, [])

  return wanted ? <SmoothScrollImpl /> : null
}
