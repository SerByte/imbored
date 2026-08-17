'use client'

import { useSyncExternalStore } from 'react'
import { readSound, readSoundOnServer, subscribeSound, toggleSound } from './sound'

/**
 * Тумблер звука. Состояние сигналится ФОРМОЙ, а не цветом: выключенный динамик
 * перечёркнут. Цвет как единственный носитель состояния — это провал по
 * доступности и, что практичнее, неразличимость на чёрно-белом скриншоте.
 *
 * Живёт в правом краю строки рельса — там же, где системная колонка страницы.
 * Тот же приём с -my-2 py-2, что у кнопок рельса: цель нажатия дорастает до
 * 24px, а строка остаётся набранной одиннадцатым кеглем.
 */
export function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, readSound, readSoundOnServer)

  return (
    <button
      type="button"
      onClick={toggleSound}
      aria-pressed={on}
      title="Звук"
      aria-label={on ? 'Выключить звук' : 'Включить звук'}
      className={`-my-2 shrink-0 cursor-pointer py-2 transition-colors ${
        on ? 'text-ember-text' : 'text-faint hover:text-dim'
      }`}
    >
      <svg
        width={14}
        height={14}
        viewBox="0 0 20 20"
        aria-hidden
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 7.5h3l4-3v11l-4-3H4z" />
        {on ? (
          <>
            <path d="M13.6 7.4a3.6 3.6 0 0 1 0 5.2" />
            <path d="M15.8 5.2a6.8 6.8 0 0 1 0 9.6" />
          </>
        ) : (
          <path d="M13.5 8l4 4M17.5 8l-4 4" />
        )}
      </svg>
    </button>
  )
}
