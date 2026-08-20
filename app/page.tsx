'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { CinemaCollage } from '@/components/CinemaCollage'
import { ClickSpark } from '@/components/ClickSpark'
import { Magnet } from '@/components/Magnet'
import { markSessionTouched } from '@/components/SessionKeeper'
import { useSearch } from '@/components/useSearch'
import { Wordmark } from '@/components/Wordmark'
import { parseArrival, type Arrival } from '@/lib/nav'

const ERROR_TEXT: Record<string, string> = {
  auth: 'Steam не подтвердил вход. Попробуй ещё раз.',
  nokey: 'На сервере не настроен STEAM_API_KEY — попробуй демо-режим.',
  steam: 'Steam сейчас не отвечает. Подожди минуту и попробуй снова.',
  empty: 'Steam вернул пустую библиотеку для этого профиля.',
  notfound: 'Не нашли такой профиль. Проверь ссылку или ник.',
  /*
   * Текст объясняет, ЧТО подойдёт, а не констатирует, что не подошло.
   *
   * Прежняя формулировка — «Это не похоже на ссылку на Steam-профиль» —
   * буквально верна и при этом противоречит подписи поля, которая обещает
   * «или ник». Ник действительно работает, но только тот, что стоит в АДРЕСЕ
   * профиля: VANITY_RE в lib/steam — [A-Za-z0-9_-]{2,32}, потому что таковы
   * правила самого Steam. Отображаемое имя по API не ищется никак.
   *
   * Для русскоязычного сайта разрыв особенно дорогой: у человека в Steam
   * кириллическое имя, он вводит его, получает «это не похоже на ссылку» и
   * не понимает, что от него хотят — ведь ссылку он и не собирался вводить.
   * Проверено на проде: «ПриветМир» → badinput, «some_nickname_123» →
   * notfound, то есть до Steam доходит только второе.
   */
  badinput:
    'Нужна ссылка на профиль или короткое имя из её конца. По отображаемому имени Steam не ищет.',
  // /room/new редиректит сюда именно с этим кодом, когда куки не оказалось.
  // Без строки человек, пришедший по приглашению в пати, получал безликое
  // «Что-то пошло не так» вместо объяснения, что делать дальше.
  nosession: 'Сессия истекла — подключи библиотеку заново, и вернём тебя в пати.',
  // Ограничитель частоты. Формулировка без слова «лимит»: с этим кодом сюда
  // приходит не бот (бот текста не читает), а живой человек за общим адресом
  // — кафе, общежитие, мобильный оператор.
  //
  // Два ключа на один текст, и это не дубль. busy присылает редирект из
  // /api/auth/steam/return, а ratelimited — тело ответа rateLimitedResponse,
  // то есть путь ввода ника и кнопка демо. Второго ключа тут не было, и
  // упёршийся в лимит на форме получал вместо этого объяснения безликое
  // «Что-то пошло не так» — при том, что нужная формулировка лежала строкой
  // выше. Потолок в /api/connect задран как раз под общий NAT, так что
  // упирается в него именно живой человек.
  busy: 'Слишком много попыток входа с твоего адреса. Подожди пару минут и попробуй снова.',
  ratelimited: 'Слишком много попыток входа с твоего адреса. Подожди пару минут и попробуй снова.',
  // Сессия жива, а снапшота библиотеки нет: /play и /daily присылают сюда
  // именно с этим кодом. Демо тут не предлагаем — человек уже подключал свою
  // библиотеку, ему нужно её перечитать, а не увидеть чужую.
  nolibrary: 'Библиотека не прочиталась. Подключи её заново — займёт секунду.',
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

/** Параметры прибытия. Снимок адреса — через общий useSearch, там же объяснено зачем. */
function useArrival(): Arrival {
  const search = useSearch()
  return useMemo(() => parseArrival(search), [search])
}

function Landing() {
  const router = useRouter()

  /*
   * Параметры прибытия читаются ПОСЛЕ гидратации, а не через
   * useSearchParams, и это не стилистика.
   *
   * Хук в статически пререндеренном маршруте роняет весь маршрут в
   * клиентский рендер: прод отдавал по адресу imbored.cc 20 879 байт
   * разметки, в которых 232 символа видимого текста — шапка и подвал.
   * Ни заголовка, ни формы, ни кнопки «Войти через Steam». На главной
   * странице сайта до разбора ~186 КБ сжатого JS не было ничего: ни для
   * поисковика, ни для человека на медленной сети.
   *
   * Теперь в пререндер уходит вариант «пришёл сам» — полностью рабочая
   * страница, — а приглашение и код ошибки применяются кадром позже.
   */
  const arrival = useArrival()
  const joinTarget = arrival.join
  const compatTarget = arrival.compat
  /*
   * Куда вернуть после подключения, если человек пришёл сюда не сам.
   *
   * Сценарий: он смотрел выдачу на демо-библиотеке и нажал «подключить свою».
   * Возврат на /quiz означал бы переспросить три вопроса, на которые он уже
   * ответил, — настроение лежит в next вместе со строкой запроса.
   *
   * join и compat остаются главнее: приглашение в конкретную пати или на
   * конкретное сравнение — более сильное намерение, чем «вернись, где стоял».
   */
  const nextTarget = arrival.next
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<'connect' | 'demo' | null>(null)

  /*
   * Ошибка приезжает из двух мест: из адреса (предыдущий шаг увёл сюда с
   * кодом) и из ответа /api/connect. undefined означает «своей ошибки ещё
   * не было» — тогда показываем ту, что в адресе.
   *
   * Через состояние с начальным значением из адреса это не выразить:
   * начальное значение зафиксировалось бы на пререндере, когда адреса
   * ещё нет, и код ошибки не показался бы никогда.
   */
  const [ownError, setOwnError] = useState<string | null | undefined>(undefined)
  const error = ownError === undefined ? arrival.error : ownError

  /**
   * Узнаём вошедшего.
   *
   * Раньше этого не было вовсе, и в этом была настоящая причина жалобы «заебался
   * заходить через стим»: вернувшийся человек с ЖИВОЙ кукой видел ровно тот же
   * экран входа, что и незнакомец, и нажимал «Войти через Steam» — потому что
   * ничего другого ему тут не предлагали.
   *
   * null — ещё не знаем. Пока не знаем, рисуем ФОРМУ ВХОДА, а не заглушку,
   * и это изменение относительно первоначального замысла — см. ниже, у
   * самой развилки.
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

    // Предохранителя на полторы секунды здесь больше нет: он существовал
    // ровно затем, чтобы вывести человека из состояния «Секунду…», а этого
    // состояния теперь нет вовсе — до ответа рисуется форма входа.
    // Флага «компонент ещё жив» здесь намеренно нет. Он тут был и ломал ровно
    // то, ради чего всё писалось: в dev эффект монтируется дважды, ответ
    // приходил уже после снятия флага первой попытки, и карточка навсегда
    // застывала на «Секунду…». Поздний ответ у отмонтированного компонента —
    // безобидный no-op, а вот потерянный ответ виден пользователю.
  }, [])

  const target = joinTarget
    ? `/room/${joinTarget}`
    : compatTarget
      ? `/compat/${compatTarget}`
      : (nextTarget ?? '/quiz')

  // Тот же порядок приоритетов, что у target: сначала приглашение, потом
  // «вернись, где стоял», потом ничего.
  const steamHref = joinTarget
    ? `/api/auth/steam?join=${joinTarget}`
    : nextTarget
      ? `/api/auth/steam?next=${encodeURIComponent(nextTarget)}`
      : '/api/auth/steam'

  async function connect(demo: boolean) {
    setBusy(demo ? 'demo' : 'connect')
    setOwnError(null)
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
      setOwnError(data.error ?? 'steam')
    } catch {
      setOwnError('steam')
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
          {/*
            Пока сессия неизвестна — форма входа, а не заглушка «Секунду…».

            Это разворот прежнего решения, и вот чем он оплачен. Замысел был
            в том, чтобы не мигать формой вошедшему: он уже нажимал «Войти
            через Steam» и звать его туда снова — ровно та жалоба, ради
            которой карточка «С возвращением» и появилась. Но цена лежала на
            другом человеке. Страница пререндерится, ответа /api/session/touch
            на пререндере нет по определению, поэтому в разметке главной
            стояло «Секунду…» — и гость, то есть тот, кого сайт пытается
            превратить в пользователя, встречал парадную дверь заглушкой.
            Ссылка «Войти через Steam» — обычный <a href>, она работает и без
            JS; за заглушкой её не было.

            Мигание вошедшему при этом почти не выросло: предохранитель на
            полторы секунды и раньше показывал ему форму на медленной сети,
            то есть ровно в тех случаях, когда ответ и задерживается.

            Развилка без промежуточного состояния: authed — карточка
            «С возвращением», всё остальное — форма.
          */}
          {session?.authed ? (
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
                    {joinTarget ? 'Войти в пати' : compatTarget ? 'Посмотреть совместимость' : 'Подобрать игру'}
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
              if (busy !== null) return
              /*
               * Пустое поле отправляет курсор в поле, а не гасит кнопку.
               *
               * disabled={!input} стоял тут с самого начала и делал ровно
               * одну вещь: на ПЕРВОМ кадре главной самым тяжёлым элементом
               * страницы (16px/600 против 14px/400 у соседей) оказывался
               * единственный контрол, который не нажимается. Вес говорил
               * «начни отсюда», состояние отвечало «не сюда».
               *
               * Заодно это возвращало ember на парадную дверь: залитая
               * кнопка — единственное место, где фирменный цвет вообще есть
               * у гостя, и погашенная она забирала его со всей страницы.
               * По остальным двадцати семи экранам ember расставлен, и
               * главная была единственной, приходившей серой.
               *
               * Ответ на пустое нажатие видимый: фокус переезжает в поле, а
               * у поля рамка на фокусе ember-овая. Что писать — сказано в
               * placeholder, второй раз повторять текстом ошибки нечего.
               */
              if (!input) {
                inputRef.current?.focus()
                return
              }
              void connect(false)
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
              ref={inputRef}
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
                  disabled={busy !== null}
                  className="btn-fill w-full rounded-[14px] font-semibold py-3 cursor-pointer"
                >
                  {busy === 'connect' ? 'Читаю библиотеку…' : 'Подобрать игру'}
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

/*
 * Границы Suspense здесь больше нет, и это весь смысл правки: она стояла
 * ради useSearchParams внутри Landing, а пустой фолбэк вместе с бэйлаутом
 * этого хука и означал пустую разметку на проде.
 */
export default function Home() {
  return <Landing />
}
