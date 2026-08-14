'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { LogoMark } from '@/components/Logo'

/**
 * Граница ошибок приложения. До этого любое исключение в серверном компоненте
 * показывало стоковый экран Next — без шапки, без языка продукта, без выхода.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex-1 flex items-center justify-center px-5 py-24">
      <div className="max-w-md w-full glass rounded-[20px] p-8 text-center flex flex-col items-center gap-5 anim-reveal">
        <LogoMark size={48} />
        <h1 className="text-2xl font-bold tracking-tight">Что-то сломалось</h1>
        <p className="text-dim text-sm leading-relaxed">
          Скорее всего, это на нашей стороне. Можно попробовать ещё раз — обычно помогает.
        </p>
        <button
          onClick={reset}
          className="w-full rounded-[14px] bg-ember text-on-ember font-semibold py-3 hover:brightness-110 transition cursor-pointer"
        >
          Попробовать снова
        </button>
        <Link href="/" className="text-sm text-dim hover:text-ink transition-colors">
          На главную
        </Link>
        {error.digest && (
          <span className="font-mono text-[11px] text-faint">код: {error.digest}</span>
        )}
      </div>
    </div>
  )
}
