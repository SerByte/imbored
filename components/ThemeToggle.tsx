'use client'

import { useSyncExternalStore } from 'react'

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
      className="tap rounded-full glass glass-hover p-2 cursor-pointer text-dim hover:text-ink"
    >
      {theme === 'dark' ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  )
}
