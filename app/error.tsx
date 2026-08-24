'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { LogoMark } from '@/components/Logo'

/**
 * Граница ошибок приложения. До этого любое исключение в серверном компоненте
 * показывало стоковый экран Next — без шапки, без языка продукта, без выхода.
 *
 * Самого корневого layout и template эта граница НЕ касается — там работает
 * app/global-error.tsx, заведённый рядом.
 *
 * retry, а НЕ reset, и это починка, а не переименование. reset чистит
 * состояние границы и перерисовывает детей БЕЗ повторного запроса — то есть из
 * того же payload, который только что упал. А этот экран заводился именно под
 * исключения в СЕРВЕРНЫХ компонентах: единственная кнопка экрана
 * выглядела нажатой и не делала ничего. retry запрашивает содержимое заново
 * (docs/error.md: «will try to re-fetch and re-render») и стабилен с Next 16.3.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex-1 flex items-center justify-center px-5 py-24">
      <div className="max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col items-center gap-5 anim-reveal">
        <LogoMark size={48} />
        <h1 className="font-display text-display-sm">Что-то сломалось</h1>
        <p className="text-dim text-sm leading-relaxed">
          Скорее всего, это на нашей стороне. Можно попробовать ещё раз — обычно помогает.
        </p>
        <button
          onClick={() => retry()}
          className="btn-ember is-block py-3"
        >
          Попробовать снова
        </button>
        <Link href="/" className="tap text-sm text-dim hover:text-ink transition-colors">
          На главную
        </Link>
        {error.digest && (
          <span className="font-mono text-[11px] text-faint">код: {error.digest}</span>
        )}
      </div>
    </div>
  )
}
