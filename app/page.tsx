'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useState } from 'react'
import { CinemaCollage } from '@/components/CinemaCollage'
import { ClickSpark } from '@/components/ClickSpark'
import { Magnet } from '@/components/Magnet'
import { Wordmark } from '@/components/Wordmark'

const ERROR_TEXT: Record<string, string> = {
  auth: 'Steam не подтвердил вход. Попробуй ещё раз.',
  nokey: 'На сервере не настроен STEAM_API_KEY — попробуй демо-режим.',
  steam: 'Steam сейчас не отвечает. Подожди минуту и попробуй снова.',
  empty: 'Steam вернул пустую библиотеку для этого профиля.',
  notfound: 'Не нашли такой профиль. Проверь ссылку или ник.',
  badinput: 'Это не похоже на ссылку на Steam-профиль.',
}

function PrivacyHelp() {
  return (
    <div className="glass rounded-[20px] p-5 text-sm leading-relaxed anim-rise">
      <p className="font-semibold text-ink mb-2">Библиотека скрыта настройками Steam</p>
      <p className="text-dim">
        Steam по умолчанию прячет список игр даже при публичном профиле. Открой его — это меняется
        одной настройкой:
      </p>
      <ol className="list-decimal list-inside text-dim mt-3 space-y-1.5">
        <li>
          Зайди в{' '}
          <a
            href="https://steamcommunity.com/my/edit/settings"
            target="_blank"
            rel="noreferrer"
            className="text-ember hover:underline"
          >
            настройки приватности Steam
          </a>
        </li>
        <li>
          «Доступ к игровой информации» → <span className="text-ink">Открытый</span>
        </li>
        <li>Сними галочку «Всегда скрывать общее время игры»</li>
        <li>Вернись сюда и попробуй снова</li>
      </ol>
    </div>
  )
}

function Landing() {
  const router = useRouter()
  const search = useSearchParams()
  const join = search.get('join')
  const joinTarget = join && /^[A-Z0-9]{6}$/.test(join.toUpperCase()) ? join.toUpperCase() : null
  const compat = search.get('compat')
  const compatTarget = compat && /^\d{17}$/.test(compat) ? compat : null
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<'connect' | 'demo' | null>(null)
  const [error, setError] = useState<string | null>(search.get('error'))

  async function connect(demo: boolean) {
    setBusy(demo ? 'demo' : 'connect')
    setError(null)
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(demo ? { demo: true } : { input }),
      })
      const data = (await res.json()) as { ok?: boolean; error?: string }
      if (data.ok) {
        router.push(
          joinTarget ? `/room/${joinTarget}` : compatTarget ? `/compat/${compatTarget}` : '/quiz',
        )
        return
      }
      setError(data.error ?? 'steam')
    } catch {
      setError('steam')
    }
    setBusy(null)
  }

  return (
    <div className="media-dark relative flex-1 flex items-center justify-center px-5 py-24 overflow-hidden">
      <CinemaCollage />

      <div className="relative w-full max-w-xl flex flex-col items-center text-center gap-8">
        <div className="anim-rise">
          <h1 className="text-6xl md:text-7xl leading-none">
            <Wordmark />
          </h1>
          <p className="mt-5 text-lg text-dim max-w-md mx-auto">
            {joinTarget
              ? `Тебя зовут в пати ${joinTarget} — подключи библиотеку, чтобы войти.`
              : compatTarget
                ? 'Подключи библиотеку — и увидишь ваш процент совместимости.'
                : 'Скажи, сколько у тебя времени, — подберём, во что зайти прямо сейчас.'}
          </p>
        </div>

        <div className="w-full glass rounded-[20px] p-6 flex flex-col gap-3 anim-rise" style={{ animationDelay: '80ms' }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && input && connect(false)}
            placeholder="Ссылка на твой Steam-профиль или ник"
            className="w-full rounded-[14px] bg-white/5 border border-edge px-4 py-3 text-ink placeholder:text-dim/70 outline-none focus:border-ember/60 transition-colors"
          />
          {/* Парадная кнопка продукта: наклон к курсору + ember-залп на нажатии */}
          <Magnet className="block w-full">
            <ClickSpark className="block w-full">
              <button
                onClick={() => connect(false)}
                disabled={!input || busy !== null}
                className="w-full rounded-[14px] bg-ember text-bg font-semibold py-3 disabled:opacity-40 hover:brightness-110 transition cursor-pointer"
              >
                {busy === 'connect' ? 'Читаю библиотеку…' : 'Подобрать игру'}
              </button>
            </ClickSpark>
          </Magnet>
          <div className="flex items-center gap-3 text-xs text-dim/70">
            <div className="h-px flex-1 bg-edge" />
            или
            <div className="h-px flex-1 bg-edge" />
          </div>
          <a
            href={joinTarget ? `/api/auth/steam?join=${joinTarget}` : '/api/auth/steam'}
            className="w-full rounded-[14px] glass glass-hover py-3 text-sm text-ink text-center"
          >
            Войти через Steam
          </a>
          <button
            onClick={() => connect(true)}
            disabled={busy !== null}
            className="text-sm text-dim hover:text-ink transition-colors py-1"
          >
            {busy === 'demo' ? 'Готовлю демо…' : 'Попробовать демо без Steam'}
          </button>
        </div>

        {error && error !== 'private' && (
          <p className="text-sm text-red-400/90 anim-rise">{ERROR_TEXT[error] ?? 'Что-то пошло не так.'}</p>
        )}
        {error === 'private' && <PrivacyHelp />}
      </div>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense>
      <Landing />
    </Suspense>
  )
}
