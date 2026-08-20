'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
import { CinemaCollage } from '@/components/CinemaCollage'
import { ClickSpark } from '@/components/ClickSpark'
import { Magnet } from '@/components/Magnet'
import { markSessionTouched } from '@/components/SessionKeeper'
import { Wordmark } from '@/components/Wordmark'
import { DESTINATIONS, destinationPath } from '@/lib/destination'

const ERROR_TEXT: Record<string, string> = {
  auth: 'Steam не подтвердил вход. Попробуй ещё раз.',
  nokey: 'На сервере не настроен STEAM_API_KEY — попробуй демо-режим.',
  steam: 'Steam сейчас не отвечает. Подожди минуту и попробуй снова.',
  empty: 'Steam вернул пустую библиотеку для этого профиля.',
  notfound: 'Не нашли такой профиль. Проверь ссылку или ник.',
  badinput: 'Это не похоже на ссылку на Steam-профиль.',
  // /room/new редиректит сюда именно с этим кодом, когда куки не оказалось.
  // Без строки человек, пришедший по приглашению в пати, получал безликое
  // «Что-то пошло не так» вместо объяснения, что делать дальше.
  nosession: 'Сессия истекла — подключи библиотеку заново, и вернём тебя в пати.',
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
            className="text-ember-text hover:underline"
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
  /*
   * Куда человек шёл, когда его сюда развернуло.
   *
   * Пять экранов из шести разворачивали гостя МОЛЧА: нажал «Игра дня» —
   * страница подменилась лендингом, и ни слова о том, почему. Теперь
   * лендинг говорит про ТО САМОЕ место и туда же возвращает после
   * подключения.
   *
   * Адрес берётся из закрытого списка, а не из строки запроса как есть:
   * произвольный ?next= — это открытый редирект (см. lib/destination.ts).
   */
  const next = destinationPath(search.get('next'))
  const dest = next ? DESTINATIONS[next] : null
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<'connect' | 'demo' | null>(null)
  const [error, setError] = useState<string | null>(search.get('error'))

  /**
   * Узнаём вошедшего.
   *
   * Раньше этого не было вовсе, и в этом была настоящая причина жалобы «заебался
   * заходить через стим»: вернувшийся человек с ЖИВОЙ кукой видел ровно тот же
   * экран входа, что и незнакомец, и нажимал «Войти через Steam» — потому что
   * ничего другого ему тут не предлагали.
   *
   * null — ещё не знаем; пока не знаем, не рисуем ни то, ни другое.
   */
  const [session, setSession] = useState<{ authed: boolean; personaName: string | null } | null>(null)

  useEffect(() => {
    const settle = (authed: boolean, personaName: string | null = null) => {
      setSession({ authed, personaName })
    }
    // Тот же роут, что продлевает куку: заодно и продлеваем на каждом заходе
    // на главную. markSessionTouched — чтобы SessionKeeper не сходил повторно.
    markSessionTouched()
    fetch('/api/session/touch?card=1', { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) return settle(false)
        const d = (await r.json()) as { authed?: boolean; personaName?: string | null }
        settle(Boolean(d.authed), d.personaName ?? null)
      })
      // Упавший запрос — НЕ доказательство живой сессии. Показываем вход:
      // соврать кнопкой «Продолжить» тому, кто на самом деле гость, хуже.
      .catch(() => settle(false))

    // Предохранитель: если ответа нет за полторы секунды, показываем вход.
    // Без него медленная сеть оставляла бы человека наедине с «Секунду…»,
    // то есть с экраном, на котором вообще ничего нельзя сделать. Пусть
    // лучше мигнёт форма входа, чем повиснет заглушка.
    const fallback = setTimeout(() => setSession((s) => s ?? { authed: false, personaName: null }), 1500)
    return () => clearTimeout(fallback)
    // Флага «компонент ещё жив» здесь намеренно нет. Он тут был и ломал ровно
    // то, ради чего всё писалось: в dev эффект монтируется дважды, ответ
    // приходил уже после снятия флага первой попытки, и карточка навсегда
    // застывала на «Секунду…». Поздний ответ у отмонтированного компонента —
    // безобидный no-op, а вот потерянный ответ виден пользователю.
  }, [])

  /*
   * Ссылка на Steam несёт назначение тоже: без этого человек, шедший в
   * библиотеку и выбравший вход через Steam, всё равно оказывался бы на
   * /quiz — то есть обещание держала бы только одна из двух дорог.
   */
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
          <h1 className="text-display-xl leading-none">
            <Wordmark />
          </h1>
          <p className="mt-5 text-lg text-dim max-w-md mx-auto">
            {joinTarget
              ? `Тебя зовут в пати ${joinTarget} — подключи библиотеку, чтобы войти.`
              : compatTarget
                ? 'Подключи библиотеку — и увидишь ваш процент совместимости.'
                : (dest?.promise ??
                  'Скажи, сколько у тебя времени, — подберём, во что зайти прямо сейчас.')}
          </p>
        </div>

        <div className="w-full glass rounded-[20px] p-6 flex flex-col gap-3 anim-rise" style={{ animationDelay: '80ms' }}>
          {session === null ? (
            /* Пока не знаем — не показываем форму входа. Мигнуть ею вошедшему
               значит снова позвать его нажать «Войти через Steam», то есть
               ровно то, от чего эта правка избавляет. Высота держится, чтобы
               карточка не прыгала. */
            <div className="min-h-[232px] flex items-center justify-center text-sm text-faint">
              Секунду…
            </div>
          ) : session.authed ? (
            <div className="min-h-[232px] flex flex-col justify-center gap-4">
              <p className="text-lg text-ink">
                С возвращением
                {session.personaName ? (
                  <>
                    , <span className="font-semibold">{session.personaName}</span>
                  </>
                ) : null}
                .
              </p>
              <Magnet className="block w-full">
                <ClickSpark className="block w-full">
                  <button
                    type="button"
                    onClick={() => router.push(target)}
                    className="w-full rounded-[14px] bg-ember text-on-ember font-semibold py-3 hover:brightness-110 transition cursor-pointer"
                  >
                    {joinTarget
                      ? 'Войти в пати'
                      : compatTarget
                        ? 'Посмотреть совместимость'
                        : (dest?.action ?? 'Подобрать игру')}
                  </button>
                </ClickSpark>
              </Magnet>
              {/* Вход через Steam остаётся на виду и в один клик: сменить
                  аккаунт должно быть возможно, а спрятанное под раскрывашку
                  «сменить аккаунт» ищут дольше, чем оно того стоит. */}
              <a
                href={steamHref}
                className="text-sm text-dim hover:text-ink transition-colors text-center py-1"
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
            {/* Подпись есть, но не показана: место под ней съело бы первый
                экран, а placeholder подписью не является — он исчезает при
                вводе и не читается скринридером как имя поля. */}
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
              // на телефоне: без автокапитализации и автозамены (это ник или
              // URL), и с кнопкой «перейти» вместо «ввод»
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="go"
              autoComplete="off"
              className="w-full rounded-[14px] bg-surface border border-edge px-4 py-3 text-ink placeholder:text-faint focus:border-ember/60 transition-colors"
            />
            {/* Парадная кнопка продукта: наклон к курсору + ember-залп на нажатии */}
            <Magnet className="block w-full">
              <ClickSpark className="block w-full">
                <button
                  type="submit"
                  disabled={!input || busy !== null}
                  className="w-full rounded-[14px] bg-ember text-on-ember font-semibold py-3 disabled:opacity-40 hover:brightness-110 transition cursor-pointer"
                >
                  {busy === 'connect' ? 'Читаю библиотеку…' : (dest?.action ?? 'Подобрать игру')}
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
          {/*
            Первый экран просит чужой профиль и до этой строки не говорил НИ
            СЛОВА о том, что с ним будет. Продукт эту фразу знает — она есть на
            странице совместимости для гостей и развёрнуто в /privacy, — но не говорил там,
            где доверие собственно и запрашивают.

            Стоит ПОСЛЕ действий, а не перед ними: это сноска, которую читают
            колеблясь, а не условие, которое надо прочесть перед входом. И только гостю:
            вошедшему объяснять уже нечего.
          */}
          {/*
            text-dim и 12 px, а не text-faint и 11. Замерено: faint на стекле
            карточки даёт ровно 4.50:1 — порог без единого запаса, любая
            будущая правка --glass-bg уводит его под. Но главное даже не это:
            faint — роль «едва заметного», а эту строку читает тот, кто как раз
            колеблется, отдавать ли свой профиль. Прятать ответ на этот вопрос
            в самый тихий токен было бы странно.
          */}
          <p className="text-xs leading-relaxed text-dim">
            Пароль не спрашиваем — вход идёт на стороне Steam. Читаем только список игр
            и наигранные часы, ничего не публикуем.{' '}
            <Link href="/privacy" className="underline decoration-edge hover:text-ink">
              Подробнее
            </Link>
          </p>
            </>
          )}
        </div>

        {error && error !== 'private' && (
          <p className="text-sm text-danger anim-rise">{ERROR_TEXT[error] ?? 'Что-то пошло не так.'}</p>
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
