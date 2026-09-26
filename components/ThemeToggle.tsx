'use client'

import { useSyncExternalStore } from 'react'
import { Icon } from './Icon'

const STORAGE_KEY = 'imbored-theme'

/**
 * Источник правды — атрибут data-theme на <html>, а не состояние React.
 *
 * Так было и раньше по факту: скрипт в app/layout.tsx ставит этот атрибут ещё
 * при разборе документа, до того как React вообще просыпается. Компонент же
 * держал вторую копию правды в useState и синхронизировал её двумя эффектами —
 * один читал localStorage при монтировании (setState прямо в эффекте, то есть
 * лишний каскад рендеров), второй писал обратно в DOM.
 *
 * useSyncExternalStore убирает обе копии: читаем прямо из DOM, а серверный
 * снимок отдаём тёмный — ровно то, что рендерит сервер. React специально
 * обрабатывает этот хук при гидратации, поэтому расхождения не возникает даже
 * у тех, кто сидит на светлой.
 */
function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  return () => observer.disconnect()
}

function readTheme(): 'dark' | 'light' {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
}

/** Сервер про localStorage не знает — там тема всегда базовая, тёмная. */
function serverTheme(): 'dark' | 'light' {
  return 'dark'
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme)

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    // Пишем в DOM — подписка выше сама пересчитает состояние.
    if (next === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    localStorage.setItem(STORAGE_KEY, next)
  }

  return (
    <button
      onClick={toggle}
      title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      aria-label="Переключить тему"
      className="tap btn-glass size-10 !rounded-full !p-0 text-dim hover:text-ink"
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
    </button>
  )
}
