'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ClickSpark } from '@/components/ClickSpark'
import { Magnet } from '@/components/Magnet'
import { markSessionTouched } from '@/components/SessionKeeper'
import { DESTINATIONS, destinationPath } from '@/lib/destination'
import { plural } from '@/lib/plural'
import {
  getServerSessionHint,
  getSessionHint,
  rememberSession,
  subscribeSessionHint,
} from '@/lib/sessionhint'

/**
 * Касса лендинга: единственная форма страницы.
 *
 * Это прежний компонент главной целиком — форма, вход через Steam, демо,
 * узнавание вошедшего и сноска про доступ, — вынутый из-под героя без правок
 * логики. Всё, что здесь написано в комментариях, писалось по живым дефектам,
 * и переезд не повод это пересматривать.
 *
 * Что изменилось: карточка больше не первое, что видит человек. Сначала ему
 * показывают, как продукт работает, и только потом просят библиотеку. Поэтому
 * у секции есть якорь #connect, а обе кнопки героя ведут сюда.
 *
 * ФОРМА НА СТРАНИЦЕ РОВНО ОДНА. Второй <input id="steam-profile"> сломал бы и
 * label for, и уникальность id, а два «Подобрать игру» на одном экране — это
 * два разных обещания. Поэтому в герое формы нет ни в одном состоянии.
 */

const ERROR_TEXT: Record<string, string> = {
  auth: 'Steam не подтвердил вход. Попробуй ещё раз.',
  nokey: 'На сервере не настроен STEAM_API_KEY — попробуй демо-режим.',
  steam: 'Steam сейчас не отвечает. Подожди минуту и попробуй снова.',
  empty: 'Steam вернул пустую библиотеку для этого профиля.',
  notfound: 'Не нашли такой профиль. Проверь ссылку или ник.',
  badinput: 'Это не похоже на ссылку на Steam-профиль.',
  nosession: 'Сессия истекла — подключи библиотеку заново, и вернём тебя в пати.',
  ratelimited: 'Слишком много попыток подряд. Подожди немного и попробуй снова.',
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
            className="tap tap-tight text-ember-text hover:underline"
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

export function ConnectCard() {
  const router = useRouter()
  const search = useSearchParams()
  const join = search.get('join')
  const joinTarget = join && /^[A-Z0-9]{6}$/.test(join.toUpperCase()) ? join.toUpperCase() : null
  const compat = search.get('compat')
  const compatTarget = compat && /^\d{17}$/.test(compat) ? compat : null
  const next = destinationPath(search.get('next'))
  const dest = next ? DESTINATIONS[next] : null

  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<'connect' | 'demo' | null>(null)
  const [error, setError] = useState<string | null>(search.get('error'))
  /** Минуты до снятия потолка: срок называет только заголовок Retry-After */
  const [retryIn, setRetryIn] = useState<number | null>(null)
  const [session, setSession] = useState<{ authed: boolean; personaName: string | null } | null>(
    null,
  )

  const hint = useSyncExternalStore(subscribeSessionHint, getSessionHint, getServerSessionHint)
  const view = session ?? hint ?? { authed: false, personaName: null }

  useEffect(() => {
    const settle = (authed: boolean, personaName: string | null = null) => {
      setSession({ authed, personaName })
      rememberSession(authed ? { authed, personaName } : null)
    }
    markSessionTouched()
    fetch('/api/session/touch?card=1', { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) return settle(false)
        const d = (await r.json()) as { authed?: boolean; personaName?: string | null }
        settle(Boolean(d.authed), d.personaName ?? null)
      })
      .catch(() => settle(false))
  }, [])

  const steamHref = joinTarget
    ? `/api/auth/steam?join=${joinTarget}`
    : compatTarget
      ? `/api/auth/steam?compat=${compatTarget}`
      : next
        ? `/api/auth/steam?next=${encodeURIComponent(next)}`
        : '/api/auth/steam'

  const target = joinTarget
    ? `/room/${joinTarget}`
    : compatTarget
      ? `/compat/${compatTarget}`
      : (next ?? '/quiz')

  const action = joinTarget
    ? 'Войти в пати'
    : compatTarget
      ? 'Посмотреть совместимость'
      : (dest?.action ?? 'Подобрать игру')

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
        router.push(target)
        return
      }
      if (res.status === 429) {
        const wait = Number(res.headers.get('Retry-After') ?? 0)
        const min = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait / 60) : 0
        setError('ratelimited')
        setRetryIn(min || null)
        setBusy(null)
        return
      }
      setError(data.error ?? 'steam')
    } catch {
      setError('steam')
    }
    setBusy(null)
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="glass flex flex-col gap-3 rounded-[20px] p-6">
        {view.authed ? (
          <div className="flex min-h-[232px] flex-col justify-center gap-4">
            <p className="text-lg text-ink">
              С возвращением
              {view.personaName ? (
                <>
                  , <span className="font-semibold">{view.personaName}</span>
                </>
              ) : null}
              .
            </p>
            <Magnet className="block w-full">
              <ClickSpark className="block w-full">
                <button
                  type="button"
                  onClick={() => router.push(target)}
                  className="w-full cursor-pointer rounded-[14px] bg-ember py-3 font-semibold text-on-ember transition hover:brightness-110"
                >
                  {action}
                </button>
              </ClickSpark>
            </Magnet>
            {/* Вход через Steam остаётся на виду и в один клик: сменить
                аккаунт должно быть возможно, а спрятанное под раскрывашку
                «сменить аккаунт» ищут дольше, чем оно того стоит. */}
            <a
              href={steamHref}
              className="tap py-1 text-center text-sm text-dim transition-colors hover:text-ink"
            >
              Это не я — войти через Steam
            </a>
          </div>
        ) : (
          <>
            {/*
              Настоящая форма, а не инпут с onKeyDown. Даёт три вещи разом:
              Enter работает штатно (и на мобильной клавиатуре тоже), браузер
              понимает поле как поле, а скринридер объявляет его подпись.
            */}
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (input && busy === null) void connect(false)
              }}
              className="flex flex-col gap-3"
            >
              {/* Подпись есть, но не показана: место под ней съело бы карточку,
                  а placeholder подписью не является — он исчезает при вводе и
                  не читается скринридером как имя поля. */}
              <label htmlFor="steam-profile" className="sr-only">
                Ссылка на твой Steam-профиль или ник
              </label>
              <input
                id="steam-profile"
                name="profile"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ссылка на твой Steam-профиль или ник"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                autoComplete="off"
                className="w-full rounded-[14px] border border-edge bg-surface px-4 py-3 text-ink transition-colors placeholder:text-faint focus:border-ember/60"
              />
              {/* Парадная кнопка продукта: наклон к курсору + ember-залп на нажатии */}
              <Magnet className="block w-full">
                <ClickSpark className="block w-full">
                  <button
                    type="submit"
                    disabled={!input || busy !== null}
                    className="w-full cursor-pointer rounded-[14px] bg-ember py-3 font-semibold text-on-ember transition hover:brightness-110 disabled:opacity-40"
                  >
                    {busy === 'connect' ? 'Читаю библиотеку…' : action}
                  </button>
                </ClickSpark>
              </Magnet>
            </form>
            <div className="flex items-center gap-3 text-xs text-faint">
              <div className="h-px flex-1 bg-edge" />
              или
              <div className="h-px flex-1 bg-edge" />
            </div>
            <a
              href={steamHref}
              className="glass glass-hover w-full rounded-[14px] py-3 text-center text-sm text-ink"
            >
              Войти через Steam
            </a>
            <button
              onClick={() => connect(true)}
              disabled={busy !== null}
              className="tap py-1 text-sm text-dim transition-colors hover:text-ink"
            >
              {busy === 'demo' ? 'Готовлю демо…' : 'Попробовать демо без Steam'}
            </button>
            {/*
              text-dim и 12 px, а не text-faint и 11. Замерено: faint на стекле
              карточки даёт ровно 4.50:1 — порог без единого запаса. Но главное
              даже не это: faint — роль «едва заметного», а эту строку читает
              тот, кто как раз колеблется, отдавать ли свой профиль. Прятать
              ответ на этот вопрос в самый тихий токен было бы странно.
            */}
            <p className="text-xs leading-relaxed text-dim">
              Пароль не спрашиваем — вход идёт на стороне Steam. Читаем только список игр и
              наигранные часы, ничего не публикуем.{' '}
              <Link
                href="/privacy"
                className="tap tap-tight underline decoration-edge hover:text-ink"
              >
                Подробнее
              </Link>
            </p>
          </>
        )}
      </div>

      {error && error !== 'private' && (
        <p role="status" className="anim-rise text-sm text-danger">
          {error === 'ratelimited' && retryIn
            ? `Слишком много попыток подряд. Попробуй снова через ${retryIn} ${plural(retryIn, 'минуту', 'минуты', 'минут')}.`
            : (ERROR_TEXT[error] ?? 'Что-то пошло не так.')}
        </p>
      )}
      {error === 'private' && <PrivacyHelp />}
    </div>
  )
}
