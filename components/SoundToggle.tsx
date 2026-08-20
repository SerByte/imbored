'use client'

import { useSyncExternalStore } from 'react'
import { isSoundOn, setSoundOn, soundOffSnapshot, subscribeSound } from '@/lib/quizsound'

/**
 * Тумблер звука квиза. По умолчанию ВЫКЛЮЧЕН.
 *
 * Источник правды — lib/quizsound.ts, а не состояние React: тот же приём, что у
 * ThemeToggle с атрибутом на <html>. Через useSyncExternalStore серверный
 * снимок отдаёт «выключено» — ровно то, что рендерит сервер, — и расхождения
 * при гидратации не возникает даже у того, кто звук уже включал.
 *
 * Компонент НИЧЕГО не воспроизводит и ничего не импортирует из lib/quizaudio.
 * Он владеет только фактом «звук разрешён»; когда заводить контекст и какие
 * голоса играть, решает страница квиза — там же, где случаются жесты.
 */
export function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, isSoundOn, soundOffSnapshot)

  return (
    <button
      type="button"
      onClick={() => setSoundOn(!on)}
      aria-pressed={on}
      className="tap inline-flex cursor-pointer items-center gap-1.5 text-xs text-faint transition-colors hover:text-ink"
    >
      <svg
        aria-hidden
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M11 5 6 9H2v6h4l5 4V5Z" />
        {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m17 9 4 6m0-6-4 6" />}
      </svg>
      {on ? 'Звук вкл.' : 'Звук выкл.'}
    </button>
  )
}
