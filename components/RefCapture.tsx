'use client'

import { useEffect } from 'react'
import { captureRef } from '@/lib/track'

/**
 * Метка ?ref= общей ссылки — в память вкладки, один раз при заходе.
 *
 * Стоит в корневом лэйауте, потому что по общей ссылке приходят на любую
 * страницу: сравнение, портрет, комнату. Считывается в браузере, а не на
 * сервере: главная — статика, а personal-страницы proxy.ts не видит. Сама
 * метка никуда не уходит — только с маяками шагов воронки (lib/track.ts).
 */
export function RefCapture() {
  useEffect(() => {
    captureRef(window.location.search)
  }, [])
  return null
}
