'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Тихо догревает метаданные библиотеки и обновляет страницу, когда появились
 * новые данные. Нужен там, где пользователь может оказаться в обход экрана
 * подбора — например зайти сразу в библиотеку, где без метаданных не будет обложек.
 */
export function WarmCatalog({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const started = useRef(false)

  useEffect(() => {
    if (!enabled || started.current) return
    started.current = true
    let cancelled = false
    ;(async () => {
      // Несколько шагов: один вызов греет пачку, дальше добираем остаток
      for (let step = 0; step < 6 && !cancelled; step++) {
        const res = await fetch('/api/prepare', { method: 'POST' }).catch(() => null)
        if (!res?.ok) return
        const { remaining } = (await res.json().catch(() => ({ remaining: 0 }))) as {
          remaining?: number
        }
        if (!remaining) break
      }
      if (!cancelled) router.refresh()
    })()
    return () => {
      cancelled = true
    }
  }, [enabled, router])

  return null
}
