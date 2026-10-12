'use client'

import { useLayoutEffect, useSyncExternalStore } from 'react'
import { syncThemeColor } from '@/lib/themecolor'
import { Icon } from './Icon'

/** Тот же ключ читает скрипт темы в app/layout.tsx (сторож — lib/themecolor.test.ts) */
export const STORAGE_KEY = 'imbored-theme'

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

/**
 * Сохранённая светлая — на <html>, если атрибут туда ещё никто не поставил.
 * true — поставили сейчас: обвязку браузера пора перекрасить.
 *
 * Обычно его ставит скрипт темы в app/layout.tsx, ещё при разборе документа.
 * Но есть документ, где скрипт не исполняется вовсе: notFound() без Suspense
 * над ним (/game/<нет такой>, /pick/<истёк>, патч, которого нет). Статус 404
 * Next держит тем, что отдаёт пустую оболочку <html id="__next_error__">, а
 * корневой лэйаут вместе со страницей 404 рисует уже браузер — createRoot, не
 * гидратация (next/dist/client/app-index.js). <script>, созданный React на
 * клиенте, не исполняется никогда; в dev об этом и пишет «Encountered a
 * script tag». Тот, кто выбрал светлую, получал по мёртвой ссылке тёмную
 * страницу и «тёмный» значок темы.
 *
 * Хранилище — функцией: в приватном режиме бросает уже само обращение к
 * localStorage, и оно обязано стоять внутри try, как в скрипте темы.
 */
export function applyStoredTheme(
  root: { dataset: DOMStringMap },
  storage: () => Pick<Storage, 'getItem'>,
): boolean {
  if (root.dataset.theme) return false
  try {
    if (storage().getItem(STORAGE_KEY) !== 'light') return false
  } catch {
    return false
  }
  root.dataset.theme = 'light'
  return true
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, readTheme, serverTheme)

  /*
   * Тема для документа, который нарисовал браузер (applyStoredTheme выше).
   * Переключатель — в шапке корневого лэйаута, то есть монтируется и там. Эффект
   * разметки, а не обычный: идёт до первой отрисовки, тёмного кадра нет. Там,
   * где скрипт темы отработал, атрибут уже стоит, и это пустая операция.
   *
   * Значок догоняет сам: подписка на атрибут ставится позже этого эффекта, но
   * useSyncExternalStore после коммита сверяет снимок ещё раз и перерисует
   * кнопку светлой.
   */
  useLayoutEffect(() => {
    if (applyStoredTheme(document.documentElement, () => localStorage)) syncThemeColor()
  }, [])

  function toggle() {
    const next = theme === 'dark' ? 'light' : 'dark'
    // Пишем в DOM — подписка выше сама пересчитает состояние.
    if (next === 'light') document.documentElement.dataset.theme = 'light'
    else delete document.documentElement.dataset.theme
    // Адресная строка — вслед за шапкой: над обычной страницей она сменила
    // цвет вместе с темой, над кино-зоной осталась тёмной (lib/themecolor)
    syncThemeColor()
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
