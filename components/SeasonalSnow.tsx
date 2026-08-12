'use client'

import dynamic from 'next/dynamic'

/**
 * Декабрьская пасхалка на «Игре дня».
 *
 * Два гейта, и оба обязательны:
 *
 * 1. Месяц. Снег включается только в декабре — вне декабря компонент не
 *    рендерится, значит next/dynamic никогда не дёргает свой чанк и three
 *    (~150 КБ gzip) не скачивается. Это единственная причина, по которой такую
 *    тяжёлую зависимость вообще можно себе позволить.
 * 2. prefers-reduced-motion. Снег — это непрерывное движение по всему экрану,
 *    ровно то, на что жалуются вестибулярно чувствительные пользователи.
 *    Выключаем целиком, а не замедляем.
 *
 * ssr: false — компонент лезет в WebGL, на сервере ему делать нечего.
 */
const PixelSnow = dynamic(() => import('@/components/PixelSnow'), { ssr: false })

export function SeasonalSnow() {
  const isDecember = new Date().getMonth() === 11
  if (!isDecember) return null

  if (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    return null
  }

  return (
    <div aria-hidden className="absolute inset-0 pointer-events-none">
      <PixelSnow
        variant="square"
        density={0.25}
        speed={0.6}
        flakeSize={0.012}
        pixelResolution={150}
        direction={200}
        brightness={0.9}
        depthFade={9}
      />
    </div>
  )
}
