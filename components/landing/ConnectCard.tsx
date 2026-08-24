'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ClickSpark } from '@/components/ClickSpark'
import { Magnet } from '@/components/Magnet'
import { CONNECT_CARD_MIN_H } from '@/components/landing/ConnectFallback'
import { markSessionTouched } from '@/components/SessionKeeper'
import { DESTINATIONS, destinationPath } from '@/lib/destination'
import { plural } from '@/lib/plural'
import { VIBE_PRESETS } from '@/lib/presets'
import {
  getServerSessionHint,
  getSessionHint,
  rememberSession,
  subscribeSessionHint,
} from '@/lib/sessionhint'

/**
 * Рабочая карточка главной: единственная форма страницы, и стоит она в герое.
 *
 * Это прежний компонент главной целиком — форма, вход через Steam, демо,
 * узнавание вошедшего и сноска про доступ. Всё, что здесь написано в
 * комментариях, писалось по живым дефектам, и два переезда подряд — не повод
 * это пересматривать.
 *
 * Переездов действительно было два, и второй отменяет первый. Сначала
 * карточку убрали из-под героя вниз, в «кассу»: главная семь версий просила
 * библиотеку, не показав ни одной карточки, и порядок «сначала покажи, потом
 * проси» это чинил. Но он же и создал новую беду: человеку, который УЖЕ решил
 * (вернулся, пришёл по приглашению в пати, вернулся из Steam с ?error=), для
 * единственного действия на сайте приходилось прокручивать четыре секции. А
 * строка ошибки под формой лежала внизу страницы — то есть Steam разворачивал
 * человека на главную, и он не видел вообще ничего.
 *
 * Теперь оба порядка стоят разом: карточка в герое (доступ сразу), а рассказ о
 * продукте — ниже по прокрутке, для тех, кто ещё не решил. Кнопка героя ведёт
 * вниз, к рассказу; кнопка внизу — обратно сюда, якорем #connect.
 *
 * ФОРМА НА СТРАНИЦЕ РОВНО ОДНА. Второй <input id="steam-profile"> сломал бы и
 * label for, и уникальность id, а два «Подобрать игру» на одной странице — это
 * два разных обещания. Поэтому внизу не копия карточки, а якорь на неё.
 */

/**
 * Три пресета из пяти. Не «первые попавшиеся»: вечер после работы, полчаса
 * перед сном и пятница с друзьями — три самых разных состояния, какие вообще
 * бывают у человека, открывшего Steam. Остальные два ближе к этим трём, чем
 * они друг к другу, и в карточке были бы шумом.
 *
 * Тексты берутся из lib/presets.ts, а не переписываются здесь: второй копии
 * этих фраз в проекте быть не должно — они уже разъезжались с адресами один
 * раз (см. lib/destination.ts).
 */
const QUICK_PRESETS = VIBE_PRESETS.slice(0, 3)

/** Пресет — это обычный адрес выдачи, ровно тот же, что строит /quiz. */
function presetHref(preset: (typeof VIBE_PRESETS)[number]): string {
  return `/play?${new URLSearchParams(preset.mood as unknown as Record<string, string>).toString()}`
}

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

  /*
   * ПРЕСЕТЫ ПОКАЗЫВАЮТСЯ НЕ ВСЕГДА, И ОБА УСЛОВИЯ НЕ ФОРМАЛЬНЫЕ.
   *
   * Только вошедшему: пресет ведёт прямо на выдачу, а гостю подбирать не из
   * чего — он получил бы кнопку, которая разворачивает его обратно сюда же.
   *
   * И только когда человек пришёл САМ. Если в адресе ?join= / ?compat= /
   * ?next=, у карточки уже есть обещанное назначение, и оно напечатано строкой
   * над заголовком. Пресет рядом с ним — это вторая дверь, которая уводит
   * приглашённого в пати мимо пати.
   */
  const showPresets = !joinTarget && !compatTarget && !next

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
      {/*
        Потолок высоты общий с фолбэком — см. CONNECT_CARD_MIN_H. Коробка
        одного размера в обоих состояниях и до гидратации, иначе первый экран
        дёргается ровно в тот момент, когда в него целятся пальцем.
      */}
      <div className={`connect-card flex ${CONNECT_CARD_MIN_H} flex-col gap-3 p-6`}>
        {view.authed ? (
          <div className="flex flex-1 flex-col justify-center gap-4">
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
                <button type="button" onClick={() => router.push(target)} className="btn-ember">
                  {action}
                </button>
              </ClickSpark>
            </Magnet>

            {/*
              ПРЕСЕТЫ: ВЕРНУВШЕМУСЯ — ОДИН ТАП ДО ВЫДАЧИ.

              До них карточка вошедшего была полой: коробка держит высоту под
              гостевую форму (см. CONNECT_CARD_MIN_H), а внутри стояли три
              элемента и двести пикселей пустоты. Лечить надо было не потолок —
              он нужен, чтобы первый экран не дёргался при гидратации, — а
              содержимое.

              Ссылки, а не кнопки: адрес настоящий, и средняя кнопка мыши
              обязана открывать выдачу в новой вкладке. Логика та же, что в
              /quiz: пресет — это заранее известное состояние трёх вопросов.
            */}
            {showPresets && (
              <div className="flex flex-col gap-2">
                <p className="text-center text-xs text-faint">Или сразу:</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {QUICK_PRESETS.map((p) => (
                    <Link
                      key={p.key}
                      href={presetHref(p)}
                      className="glass glass-hover rounded-full px-4 py-2 text-sm"
                    >
                      {p.emoji} {p.label}
                    </Link>
                  ))}
                </div>
              </div>
            )}

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
              {/*
                Надзаголовок: карточка начиналась прямо с поля ввода, шестью
                элементами равного веса, и ни одна строка не говорила, что тут
                вообще происходит. Тот же моноширинный язык, что у хлопушек
                сцен ниже — первый экран и рассказ под ним говорят одним
                шрифтом.
              */}
              <p className="card-eyebrow">Доступ к библиотеке</p>

              {/* Подпись есть, но не показана: место под ней съело бы карточку,
                  а placeholder подписью не является — он исчезает при вводе и
                  не читается скринридером как имя поля. */}
              <label htmlFor="steam-profile" className="sr-only">
                Ссылка на твой Steam-профиль или ник
              </label>
              {/*
                Подсказка в поле КОРОЧЕ подписи, и это не небрежность: полная
                фраза не помещалась в поле на телефоне и обрывалась на «Steam-
                профиль и…». Обрезанная подсказка хуже короткой — она выглядит
                сломанной вёрсткой. Скринридер и label читают полный вариант.
              */}
              <input
                id="steam-profile"
                name="profile"
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ссылка на профиль или ник"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="go"
                autoComplete="off"
                className="field"
              />
              {/* Парадная кнопка продукта: наклон к курсору + ember-залп на нажатии */}
              <Magnet className="block w-full">
                <ClickSpark className="block w-full">
                  <button type="submit" disabled={!input || busy !== null} className="btn-ember">
                    {busy === 'connect' ? 'Читаю библиотеку…' : action}
                  </button>
                </ClickSpark>
              </Magnet>
            </form>
            <div className="rule-or">или</div>
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
