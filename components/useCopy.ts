'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Копирование в буфер с честным результатом.
 *
 * Один хук на три места, а не третья копия. Копий было две, и они уже
 * разошлись: в комнате отказ буфера обрабатывался (там же и запасной ход —
 * поле с выделяемой ссылкой), а на хабе «Совместимость» галочка «Скопировано ✓»
 * загоралась безусловно. То есть главное действие страницы врало ровно тем
 * людям, у кого оно не сработало.
 *
 * А не срабатывает оно регулярно: небезопасный origin, отказ в разрешении,
 * часть мобильных браузеров. `navigator.clipboard.writeText` возвращает промис
 * именно затем, чтобы об этом узнать, — и весь смысл хука в том, что мимо него
 * этот промис теперь не пройдёт.
 */
export function useCopy(resetMs = 1500) {
  const [copied, setCopied] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Таймер снимаем при размонтировании: без этого setCopied стреляет уже в
  // снятый компонент, если человек ушёл со страницы за полторы секунды.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const copy = useCallback(
    async (text: string) => {
      if (timer.current) clearTimeout(timer.current)
      try {
        await navigator.clipboard.writeText(text)
        setFailed(false)
        setCopied(true)
        timer.current = setTimeout(() => setCopied(false), resetMs)
      } catch {
        // Галочка гасится явно: повторное нажатие после удачного копирования
        // не должно оставить на экране одновременно «скопировано» и «не вышло».
        setCopied(false)
        setFailed(true)
      }
    },
    [resetMs],
  )

  return { copied, failed, copy }
}
