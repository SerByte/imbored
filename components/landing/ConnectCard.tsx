'use client'

import Link from '@/components/Link'
import { useSearchParams } from 'next/navigation'
import { useLocale } from '@/components/LocaleProvider'
import { rememberLocale } from '@/components/LocaleSwitch'
import { useLocaleRouter } from '@/components/useLocaleRouter'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ClickSpark } from '@/components/ClickSpark'
import { Eyebrow } from '@/components/Labels'
import { Magnet } from '@/components/Magnet'
import { PrivacyHelp } from '@/components/PrivacyHelp'
import {
  AccessNote,
  CONNECT_CARD_MIN_H,
  PASSWORD_NOTE_ID,
} from '@/components/landing/ConnectFallback'
import { LinkHelp, LinkHelpToggle, toggleLinkHelp } from '@/components/landing/LinkHelp'
import { destinationUrl } from '@/lib/destination'
import { destinationFor } from '@/lib/destinationtext'
import { pl, tr, withLang, type Locale } from '@/lib/i18n'
import { lastMoodStore, pickHrefNow, pickHrefServer, QUIZ_HREF } from '@/lib/lastmood'
import { lastMoodCaptionNowFor, lastMoodCaptionServer } from '@/lib/lastmoodcaption'
import { presetHref, presetLabel, VIBE_PRESETS } from '@/lib/presets'
import { langOn } from '@/lib/textlang'
import {
  getServerSessionHint,
  getSessionHint,
  hintFrom,
  rememberGuest,
  rememberSession,
  subscribeSessionHint,
  type SessionHint,
} from '@/lib/sessionhint'
import { markSessionTouched } from '@/lib/sessiontouch'
import { writerFrom, writerStore } from '@/lib/writer'
import { forgetPrewarm } from '@/lib/warmup'
import { announceReadOnly } from '@/lib/readonlynote'
import { liveDefault, liveLineFrom } from '@/lib/liveline'

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
 * Тексты и адреса берутся из lib/presets.ts, а не переписываются здесь: второй
 * копии этих фраз в проекте быть не должно — они уже разъезжались с адресами
 * один раз (см. lib/destination.ts). Адрес — presetHref, тот же, что строит
 * /quiz: своя сборка строки здесь потеряла бы у «нет сил» ось lean.
 */
const QUICK_PRESETS = VIBE_PRESETS.slice(0, 3)

/** Коды отказа, которые приходят в ?error= и из /api/connect */
type ErrorCode = 'auth' | 'nokey' | 'steam' | 'empty' | 'notfound' | 'badinput' | 'nosession' | 'ratelimited' | 'private'

const ERROR_TEXT_RU: Record<ErrorCode, string> = {
  auth: 'Steam не подтвердил вход. Попробуй ещё раз.',
  nokey: 'На сервере не настроен STEAM_API_KEY — попробуй демо-режим.',
  steam: 'Steam сейчас не отвечает. Подожди минуту и попробуй снова.',
  empty: 'Steam вернул пустую библиотеку для этого профиля.',
  notfound: 'Не нашли такой профиль. Проверь ссылку, ник или код друга.',
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
    'Нужна ссылка на профиль, короткое имя из её конца или код друга. По отображаемому имени Steam не ищет.',
  nosession: 'Сессия истекла — подключи библиотеку заново, и вернём тебя в пати.',
  ratelimited: 'Слишком много попыток подряд. Подожди немного и попробуй снова.',
  /*
    У `private` есть ещё и подробная панель ниже — здесь короткая строка,
    которая видна не сходя с места и говорит, что случилось. Панель отвечает на
    «что теперь делать», строка — на «почему ничего не произошло».
  */
  private: 'Steam прячет твою библиотеку. Это меняется одной настройкой — как, написано ниже.',
}

/*
 * Те же отказы по-английски и с теми же решениями: badinput объясняет, что
 * подойдёт (ссылка, ник из её конца — по-английски это «custom URL» — или код
 * друга), а не констатирует, что не подошло.
 */
const ERROR_TEXT_EN: Record<ErrorCode, string> = {
  auth: 'Steam didn’t confirm the sign-in. Try again.',
  nokey: 'STEAM_API_KEY isn’t set on the server — try the demo.',
  steam: 'Steam isn’t responding right now. Wait a minute and try again.',
  empty: 'Steam returned an empty library for this profile.',
  notfound: 'We couldn’t find that profile. Check the link, custom URL or friend code.',
  badinput:
    'We need a profile link, the custom URL from its end, or a friend code. Steam doesn’t search by display name.',
  nosession: 'Your session expired — connect your library again and we’ll take you back to the party.',
  ratelimited: 'Too many tries in a row. Wait a bit and try again.',
  /*
    Не «Steam is hiding your library»: так по-английски названа панель
    PrivacyHelp прямо под строкой, и одна фраза читалась бы дважды подряд.
    Как и в русском, здесь — что случилось с играми, в панели — что делать.
  */
  private: 'Your game list is hidden on Steam. One setting changes that — see how below.',
}

/** Строка отказа на языке страницы; чужой код — общее «что-то пошло не так» */
function errorText(locale: Locale, error: string): string {
  const texts: Record<string, string | undefined> = locale === 'en' ? ERROR_TEXT_EN : ERROR_TEXT_RU
  return texts[error] ?? tr(locale, { ru: 'Что-то пошло не так.', en: 'Something went wrong.' })
}

export function ConnectCard() {
  const router = useLocaleRouter()
  const locale = useLocale()
  const search = useSearchParams()
  const join = search.get('join')
  const joinTarget = join && /^[A-Z0-9]{6}$/.test(join.toUpperCase()) ? join.toUpperCase() : null
  const compat = search.get('compat')
  const compatTarget = compat && /^\d{17}$/.test(compat) ? compat : null
  // Адрес целиком, с настроением квиза у выдачи (destinationUrl), — его везёт
  // вход и в него же ведёт кнопка. Тексты карточки — по месту назначения.
  const next = destinationUrl(search.get('next'))
  // Тексты места — на языке страницы; адрес — с языком или без, место одно
  const dest = destinationFor(next, locale)

  const [input, setInput] = useState('')
  /** go — уходит главная кнопка вошедшего; connect и demo — запрос в /api/connect */
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(search.get('error'))
  /** Минуты до снятия потолка: срок называет только заголовок Retry-After */
  const [retryIn, setRetryIn] = useState<number | null>(null)
  /*
   * Ошибочно само поле — только когда отказ про введённое. «Steam не
   * отвечает» или потолок попыток к нему отношения не имеют, и пометка
   * «неверное значение» там увела бы человека править правильную ссылку.
   */
  const inputError = error === 'badinput' || error === 'notfound'
  /*
   * Каким путём пришёл последний отказ — от этого зависит, что проверяет
   * «Я открыл — проверить» в панели private (PrivacyHelp). Отказ в адресе
   * (?error=private) — это возврат из Steam, и проверка — снова вход через
   * Steam. Отправка поля переводит в 'form': проверка — та же ссылка ещё раз,
   * поле после отказа не очищается.
   */
  const [lastTry, setLastTry] = useState<'steam' | 'form'>('steam')
  /**
   * Проверка из панели идёт. Панель на это время остаётся на месте: кнопка,
   * которую нажали, стоит в ней, и пропади панель вместе с ошибкой — фокус
   * упал бы в body (по той же причине сама кнопка на это время aria-disabled,
   * а не disabled). Строка ошибки при этом гаснет и загорается снова: живая
   * область перечитает «Steam прячет…», и повторный отказ будет услышан.
   */
  const [rechecking, setRechecking] = useState(false)
  const [session, setSession] = useState<SessionHint | null>(null)
  /** Живая строка вошедшего — до ответа touch дверь по умолчанию (lib/liveline) */
  const [live, setLive] = useState(liveDefault(locale))

  const hint = useSyncExternalStore(subscribeSessionHint, getSessionHint, getServerSessionHint)
  const view: SessionHint = session ?? hint ?? { authed: false, personaName: null }
  const demo = view.authed && view.demo === true
  /** Вошёл по ссылке на профиль: смотреть можно, сохранять — после входа через Steam */
  const readOnly = view.authed && !demo && view.readOnly === true

  /*
   * ПОЛЕ ДЛЯ ССЫЛКИ ЕСТЬ И У ВОШЕДШЕГО.
   *
   * Раньше вошедший его не получал вовсе, и из этого выросли две петли. Демо:
   * человеку понравилось, он хочет свою библиотеку, на этом устройстве Steam
   * не открыт — а главная говорит «С возвращением, Демо-игрок» и ведёт в
   * подбор по демо. Поле «ссылка или ник» существует ровно для такого случая,
   * и спрятано оно было ровно от него. И «Подключить заново» с экранов без
   * библиотеки: главная отвечала тем же приветствием, кнопка вела в подбор,
   * подбор — к тому же отказу.
   *
   * Демо видит поле сразу: это не его библиотека, и сказать об этом надо
   * прямо. Обычному вошедшему оно за строкой «Сменить библиотеку» — сменить
   * профиль бывает нужно, но не каждый визит. Адрес ?reconnect=1
   * (reconnectHref в lib/destination) раскрывает строку сразу: по нему
   * приходят как раз за этим.
   *
   * Поле в разметке по-прежнему одно — ProfileForm внизу файла, — а ветки
   * вошедшего и гостя взаимоисключающие, так что id="steam-profile" в
   * документе не задваивается (сторож lib/landingdoor.test.ts).
   */
  const [formOpen, setFormOpen] = useState(search.get('reconnect') === '1')
  /**
   * Раскрыли нажатием — поле получает фокус. Раскрытое адресом — нет: фокус
   * без действия человека уводит скринридер посреди чтения страницы.
   */
  const [focusField, setFocusField] = useState(false)
  const formShown = demo || formOpen

  /*
   * Куда ведёт главная кнопка, когда назначения в адресе нет: туда же, куда
   * «Подобрать» в шапке (components/PickLink), — в выдачу под прошлое
   * настроение, если оно свежее, иначе в квиз. Раньше здесь стоял /quiz, и
   * две одинаково названные двери одного экрана вели по-разному: шапка сразу
   * давала игру, парадная кнопка — снова три вопроса.
   *
   * Подпись настроения стоит рядом с кнопкой по той же причине, по какой /play
   * показывает её рядом с «Изменить настроение»: выдача мимо квиза не должна
   * быть молчаливой подменой.
   */
  const remembered = useSyncExternalStore(lastMoodStore.subscribe, pickHrefNow, pickHrefServer)
  // Снимок — одна функция на язык (lastMoodCaptionNowFor), а не новая на рендер
  const moodLine = useSyncExternalStore(
    lastMoodStore.subscribe,
    lastMoodCaptionNowFor(locale),
    lastMoodCaptionServer,
  )

  useEffect(() => {
    /*
     * guest — сервер ответил «гость», а не сбой (knownGuest в lib/sessionhint).
     * SessionKeeper после главной в том же документе молчит, и гость,
     * пришедший отсюда на квиз — самый частый путь, — узнаётся только здесь:
     * квиз поведёт его прямо сюда, мимо экрана прогрева /play.
     */
    const settle = (next: SessionHint | null, guest = false) => {
      setSession(next ?? { authed: false, personaName: null })
      if (guest) rememberGuest()
      else rememberSession(next)
    }
    markSessionTouched()
    fetch('/api/session/touch?card=1', { method: 'POST' })
      .then(async (r) => {
        if (!r.ok) return settle(null)
        const d = (await r.json()) as {
          authed?: boolean
          personaName?: string | null
          demo?: boolean
          writer?: boolean
          live?: unknown
        }
        settle(d.authed ? hintFrom(d) : null, d.authed === false)
        // Ответ — данные, а не текст: слова строки собираются здесь, на языке страницы
        setLive(liveLineFrom(d.live, locale))
        // SessionKeeper на главной молчит, так что признак записи берём здесь
        writerStore.set(writerFrom(d))
      })
      .catch(() => settle(null))
  }, [locale])

  /*
   * Язык входа — в самом адресе (withLang): возврат из Steam ведёт на
   * страницу того же языка (app/api/auth/steam), а без lang=en его нёс бы
   * только Referer, который режут расширения и настройки браузера.
   */
  const steamHref = withLang(
    joinTarget
      ? `/api/auth/steam?join=${joinTarget}`
      : compatTarget
        ? `/api/auth/steam?compat=${compatTarget}`
        : next
          ? `/api/auth/steam?next=${encodeURIComponent(next)}`
          : '/api/auth/steam',
    locale,
  )

  const target = joinTarget
    ? `/room/${joinTarget}`
    : compatTarget
      ? `/compat/${compatTarget}`
      : (next ?? remembered)

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

  // «Войти в комнату» — тем же словом, что кнопка на экране приглашения:
  // одно действие под двумя именами читается как два разных
  const action = joinTarget
    ? tr(locale, { ru: 'Войти в комнату', en: 'Join the room' })
    : compatTarget
      ? tr(locale, { ru: 'Посмотреть совместимость', en: 'See compatibility' })
      : (dest?.action ?? tr(locale, { ru: 'Подобрать игру', en: 'Find a game' }))

  /*
   * Приглашённый попадает в комнату сразу, а не ещё одним нажатием.
   *
   * Раньше отсюда уходил только переход на /room/X, и там человека встречал
   * тот же экран приглашения — «Подключи свою библиотеку», — под которым
   * нужно было нажать третью кнопку. Библиотека к этому моменту уже
   * подключена, то есть экран врал, и часть людей решала, что вход не
   * сработал. Возврат из Steam делает то же на сервере (auth/steam/return).
   *
   * Отказ входа не держит: комнаты нет, она уже договорилась или сеть
   * моргнула — страница комнаты покажет это сама и предложит войти вручную.
   */
  async function go() {
    if (joinTarget) {
      await fetch(`/api/room/${joinTarget}/join`, { method: 'POST' }).catch(() => null)
    }
    router.push(target)
  }

  async function connect(asDemo: boolean) {
    setBusy(asDemo ? 'demo' : 'connect')
    setError(null)
    if (!asDemo) setLastTry('form')
    try {
      const res = await fetch('/api/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(asDemo ? { demo: true } : { input }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        personaName?: string | null
        demo?: boolean
        writer?: boolean
      }
      if (data.ok) {
        // Вход по ссылке — только просмотр: разовая записка об этом всплывёт
        // уже на странице, куда поведёт go() (components/ReadOnlyNote)
        if (writerFrom(data) === false && data.demo !== true) announceReadOnly()
        // Переход клиентский, документ тот же: признак записи прежней сессии
        // остался бы в памяти и соврал бы на следующей странице (lib/writer)
        writerStore.set(writerFrom(data))
        // И подсказка о входе — новая: из демо ушли в свою библиотеку, и
        // «Ты в демо-режиме» на следующем заходе было бы уже неправдой
        rememberSession(hintFrom(data))
        // Прогрев, начатый квизом прежнего входа (lib/warmup), — про другую
        // библиотеку: квиз нового не начал бы своего, пока тот свежий, и /play
        // показал бы стену прежнего человека
        forgetPrewarm()
        // Вошёл с английской версии — и «/» дальше ведёт на неё: с сессией ни
        // страна, ни язык браузера главную не меняют (lib/homelocale.ts),
        // решает кука
        if (locale !== 'ru') rememberLocale(locale)
        await go()
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

  /** Отправка поля — одна на обе ветки: пустое поле и идущий запрос не шлют ничего */
  function submitProfile() {
    if (input && busy === null) void connect(false)
  }

  /** «Я открыл — проверить» после отказа по ссылке: та же ссылка ещё раз */
  function recheckProfile() {
    if (!input || busy !== null) return
    setRechecking(true)
    void connect(false).finally(() => setRechecking(false))
  }

  /*
   * Проверять повтором поля можно, только пока ссылка в нём: стёр — проверка
   * идёт входом через Steam, а не кнопкой, которая ничего не шлёт.
   */
  const recheckByForm = lastTry === 'form' && input !== ''

  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      {/*
        Потолок высоты общий с фолбэком — см. CONNECT_CARD_MIN_H. Коробка
        одного размера в обоих состояниях и до гидратации, иначе первый экран
        дёргается ровно в тот момент, когда в него целятся пальцем.
      */}
      <div className={`connect-card flex ${CONNECT_CARD_MIN_H} flex-col gap-4`}>
        {/*
          ОДНА ОБЁРТКА НА ОБЕ ВЕТКИ — РАДИ #connect-error.
          Строка ошибки стоит под полем у обоих, и раньше каждая ветка
          рисовала её у себя: у вошедшего — внутри колонки, у гостя — прямо в
          карточке. Разные предки — разные узлы, и смена view.authed (подсказка
          сессии, потом ответ touch) рожала живую область заново, уже с
          текстом, — ровно то, от чего она отрисована всегда (см. её
          комментарий ниже). Теперь у неё одно место: средний ребёнок этой
          обёртки, между двумя тернарниками, — и React держит тот же узел. И
          тег снова стоит прямо в разметке, а не в константе: сторож
          lib/liveregion.test.ts видит его и проверит, что он не ветвь.

          Обёртка меняет только класс. Вошедшему это прежняя колонка по
          центру со своим gap-4; гостю — contents: его строки остаются
          детьми самой карточки, с её зазором (на низком экране он у
          .connect-card свой, 0.5rem), и раскладка гостя не сдвигается ни на
          пиксель — по ней считан CONNECT_CARD_MIN_H.
        */}
        <div className={view.authed ? 'flex flex-1 flex-col justify-center gap-4' : 'contents'}>
          {view.authed ? (
            <>
              {/*
                Демо называет себя прямо. Прежнее «С возвращением, Демо-игрок»
                читалось как вход в свою библиотеку — и человек не понимал,
                почему подбор предлагает чужие игры и куда вставить свою ссылку.
              */}
              {demo && (
                <div>
                  <p className="text-xl font-extrabold tracking-[-0.02em] text-ink">
                    {tr(locale, { ru: 'Ты в демо-режиме.', en: 'You’re in demo mode.' })}
                  </p>
                  <p className="mt-1 max-w-md text-sm leading-relaxed text-dim">
                    {tr(locale, {
                      ru: 'Подбор идёт по чужой витрине. Вставь ссылку на свой профиль — и он пойдёт по твоей библиотеке.',
                      en: 'Picks come from someone else’s library. Paste your profile link and they’ll come from yours.',
                    })}
                  </p>
                </div>
              )}
              {!demo && (
                <div>
                  <p className="text-xl font-extrabold tracking-[-0.02em] text-ink">
                    {tr(locale, { ru: 'С возвращением', en: 'Welcome back' })}
                    {/* Ник из Steam — данные: русский на /en — lang="ru", как у
                        ников портрета и совместимости (langOn) */}
                    {view.personaName ? (
                      <>
                        , <span lang={langOn(locale, view.personaName)} className="font-semibold">{view.personaName}</span>
                      </>
                    ) : null}
                    .
                  </p>
                  {/*
                    Вход по ссылке — только просмотр, и об этом говорится здесь,
                    до первого нажатия, а не спрятанными потом кнопками. Вход
                    через Steam стоит в строке — тихая дверь внизу в этом случае
                    убрана, чтобы не звать дважды. Строка добавляет карточке
                    высоту только этой сессии (см. CONNECT_CARD_MIN_H).
                  */}
                  {readOnly && <ReadOnlyLine steamHref={steamHref} />}
                  {/*
                    Живая строка (lib/liveline): «как тебе?», готовая игра дня
                    или дверь в «Твои вечера». Место держится с первого кадра,
                    а текст — в одну строку с многоточием: ответ сервера
                    меняет слова, но не высоту карточки.
                  */}
                  {!readOnly && (
                    <p className="mt-1 max-w-md text-sm text-dim">
                      <Link
                        href={live.href}
                        prefetch={false}
                        className="tap tap-tight inline-flex max-w-full items-baseline gap-1.5 transition-colors hover:text-ink"
                      >
                        <span className="min-w-0 truncate">{live.text}</span>
                        <span aria-hidden>→</span>
                      </Link>
                    </p>
                  )}
                </div>
              )}
              <Magnet className="block w-full sm:w-auto sm:self-start">
                <ClickSpark className="block w-full sm:w-auto">
                  {/*
                    busy — пока уходит вход в комнату: второй клик слал бы его
                    дважды. Гасит его обработчик, а кнопка выключена через
                    aria-disabled: disabled выбросил бы фокус в body (см.
                    rechecking выше)
                  */}
                  <button
                    type="button"
                    onClick={() => {
                      if (busy !== null) return
                      setBusy('go')
                      void go()
                    }}
                    aria-disabled={busy !== null}
                    data-busy={busy === 'go' ? '' : undefined}
                    className="btn-ember is-block px-8 text-base sm:w-auto"
                  >
                    {action}
                  </button>
                </ClickSpark>
              </Magnet>

              {/*
                Подпись прошлого настроения — только когда кнопка ведёт в
                выдачу мимо квиза. С назначением в адресе кнопка ведёт туда, и
                настроение к ней отношения не имеет.
              */}
              {showPresets && moodLine && (
                <p className="-mt-2 text-xs text-dim">
                  {moodLine} ·{' '}
                  <Link
                    href={QUIZ_HREF}
                    className="tap tap-tight underline decoration-edge hover:text-ink"
                  >
                    {tr(locale, { ru: 'Изменить', en: 'Change' })}
                  </Link>
                </p>
              )}

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

                Раскрытое поле пресеты убирает: человек пришёл сменить
                библиотеку, и три двери в подбор по старой рядом с ним — шум,
                который к тому же вытолкнул бы карточку за её потолок.
              */}
              {showPresets && !formShown && (
                <div className="flex flex-col gap-2">
                  <Eyebrow>{tr(locale, { ru: 'Или сразу', en: 'Or jump right in' })}</Eyebrow>
                  <div className="flex flex-wrap gap-2">
                    {QUICK_PRESETS.map((p) => (
                      <Link key={p.key} href={presetHref(p)} className="pill">
                        {presetLabel(p, locale)}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {formShown && (
                <ProfileForm
                  value={input}
                  onChange={setInput}
                  invalid={inputError}
                  busy={busy}
                  autoFocus={focusField}
                  submit={tr(locale, { ru: 'Подключить', en: 'Connect' })}
                  primary={false}
                  onSubmit={submitProfile}
                />
              )}
            </>
          ) : (
            <>
              {/*
                Надзаголовок: карточка начиналась прямо с поля ввода, шестью
                элементами равного веса, и ни одна строка не говорила, что тут
                вообще происходит. Тот же моноширинный язык, что у хлопушек
                сцен ниже — первый экран и рассказ под ним говорят одним
                шрифтом.
              */}
              <ProfileForm
                value={input}
                onChange={setInput}
                invalid={inputError}
                busy={busy}
                autoFocus={false}
                submit={action}
                primary
                onSubmit={submitProfile}
              />
            </>
          )}
          {/*
            СТРОКА ОШИБКИ ЕСТЬ И У `private`, И ЭТО ПОЧИНКА ЗАМЕРЕННОГО ДЕФЕКТА.
            Раньше этот случай был из строки исключён: считалось, что подробная
            панель ниже говорит всё сама. Замер показал, что не говорит — панель
            уходит за нижний край на 145 px на телефоне и на 174 на десктопе, а в
            ВИДИМОЙ части карточки не оставалось ни одного признака, что вход не
            удался. То есть Steam разворачивал человека обратно, и он видел ровно ту
            же карточку, что и до попытки.

            Это тот самый дефект, ради которого карточку когда-то и перенесли в
            первый экран (см. докблок наверху файла) — просто у одного состояния из
            девяти он уцелел.
          */}
          {/*
            Абзац отрисован всегда, пустым, — меняется только текст. Живая
            область, вставленная в DOM уже с содержимым, звучит не во всех
            связках (VoiceOver в Safari промолчит), и «Не нашли такой профиль»
            мог не прозвучать вовсе. Пустой — sr-only: в потоке он дал бы лишний
            зазор колонки. Он же описание поля (aria-describedby у #steam-profile).
          */}
          {/*
            Строка ошибки стоит СРАЗУ ПОД ПОЛЕМ, внутри карточки, а не после неё.
            После карточки она уезжала за её потолок (CONNECT_CARD_MIN_H): у гостя на
            десктопе карточка 168 px в коробке 244, и «Не нашли такой профиль»
            печаталось в 117 px под полем — через ссылки входа и сноску про доступ,
            отдельно от того, к чему относится.
          */}
          <p
            id="connect-error"
            role="status"
            className={error ? 'anim-rise text-sm text-danger' : 'sr-only'}
          >
            {error
              ? error === 'ratelimited' && retryIn
                ? tr(locale, {
                    ru: `Слишком много попыток подряд. Попробуй снова через ${retryIn} ${pl(locale, retryIn, MINUTES)}.`,
                    en: `Too many tries in a row. Try again in ${retryIn} ${pl(locale, retryIn, MINUTES)}.`,
                  })
                : errorText(locale, error)
              : ''}
          </p>
          {view.authed ? (
            <>
              {/*
                Две тихие двери одной строкой: сменить библиотеку ссылкой и войти
                через Steam. Столбиком они выталкивали карточку за её потолок
                (CONNECT_CARD_MIN_H): на телефоне пресеты и так встают в три
                ряда, и замер дал 402 px против 392, а с подписью настроения —
                426. Карточка вошедшего появляется уже после гидратации, и
                каждый лишний пиксель в ней сдвигает первый экран под пальцем.

                Вход через Steam остаётся на виду и в один клик: сменить аккаунт
                должно быть возможно, а спрятанное под раскрывашку «сменить
                аккаунт» ищут дольше, чем оно того стоит.
              */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
                {!demo && (
                  <button
                    type="button"
                    aria-expanded={formOpen}
                    onClick={() => {
                      setFocusField(!formOpen)
                      setFormOpen(!formOpen)
                    }}
                    className="tap py-1 text-sm text-dim transition-colors hover:text-ink active:text-ember-text"
                  >
                    {tr(locale, { ru: 'Сменить библиотеку', en: 'Switch library' })}
                  </button>
                )}
                {!readOnly && (
                  <a
                    href={steamHref}
                    className="tap py-1 text-sm text-dim transition-colors hover:text-ink active:text-ember-text"
                  >
                    {tr(locale, { ru: 'Войти через Steam', en: 'Sign in with Steam' })}
                  </a>
                )}
              </div>
            </>
          ) : (
            <>
              {/*
                Две другие двери — строкой под пилюлей, как «Войти» под формой
                стримингового героя: вход через Steam и демо. Раньше между ними
                и полем стояла «или»-линейка и третья кнопка во всю ширину —
                первый экран говорил тремя одинаково громкими голосами.

                Подпись двери Steam — первая фраза сноски ниже: «пароль вводишь
                на сайте Steam, мы его не видим». Глазом она стоит прямо под
                ссылкой, а скринридеру её отдаёт aria-describedby — вместе с
                именем двери, а не отдельной строкой после демо.
              */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px] font-bold">
                <a
                  href={steamHref}
                  aria-describedby={PASSWORD_NOTE_ID}
                  className="tap py-1 text-ink transition-colors hover:text-dim"
                >
                  {tr(locale, { ru: 'Войти через Steam', en: 'Sign in with Steam' })}
                </a>
                <span aria-hidden className="text-faint">
                  ·
                </span>
                {/* Повтор гасит обработчик, а не disabled: отказ демо (потолок,
                    сеть) оставляет карточку, и фокус обязан остаться здесь */}
                <button
                  onClick={() => {
                    if (busy !== null) return
                    void connect(true)
                  }}
                  aria-disabled={busy !== null}
                  className="tap py-1 text-dim transition-colors hover:text-ink active:text-ember-text"
                >
                  {/* По-английски — «Try the demo», а не «Demo without Steam» глоссария:
                      ряд дверей гостя замерен, и на 360 px полная фраза роняла его в
                      две строки, а карточку — за потолок CONNECT_CARD_MIN_H. Рядом
                      с «Sign in with Steam» «без Steam» и так понятно */}
                  {busy === 'demo'
                    ? tr(locale, { ru: 'Готовлю демо…', en: 'Loading demo…' })
                    : tr(locale, { ru: 'Демо без Steam', en: 'Try the demo' })}
                </button>
              </div>
              {/* Сноска общая с фолбэком — подмена при гидратации не меняет в ней ни слова */}
              <AccessNote />
            </>
          )}
        </div>
      </div>

      {(error === 'private' || rechecking) && (
        <PrivacyHelp
          {...(recheckByForm
            ? { onRetry: recheckProfile, retrying: busy === 'connect' }
            : { retryHref: steamHref })}
        />
      )}
    </div>
  )
}

type Busy = 'go' | 'connect' | 'demo' | null

/**
 * Строка «вход по ссылке — только просмотр» с дверью в Steam посреди фразы.
 * Своим компонентом: по-английски дверь стоит в другом месте фразы, и ветка
 * по языку здесь не ложится тернарником в ветку вошедшего, где её искал бы
 * сторож раскладки (lib/landingdoor.test.ts делит карточку по «) : (»).
 */
function ReadOnlyLine({ steamHref }: { steamHref: string }) {
  if (useLocale() === 'en') {
    return (
      <p className="mt-1 max-w-md text-sm leading-relaxed text-dim">
        Signed in with a link, so it’s view-only: ratings and launches aren’t saved.{' '}
        <a href={steamHref} className="tap tap-tight text-ember-text hover:underline">
          Sign in with Steam
        </a>{' '}
        so we can remember them.
      </p>
    )
  }
  return (
    <p className="mt-1 max-w-md text-sm leading-relaxed text-dim">
      Вход по ссылке — только просмотр: оценки и запуски не сохраняются.{' '}
      <a href={steamHref} className="tap tap-tight text-ember-text hover:underline">
        Войти через Steam
      </a>
      , чтобы сервис запоминал.
    </p>
  )
}

/** Минуты до снятия потолка попыток — формы слова для pl() */
const MINUTES: Parameters<typeof pl>[2] = { ru: ['минуту', 'минуты', 'минут'], en: ['minute', 'minutes'] }

/**
 * Подсказка в поле по-английски. Строку поля делят подсказка и «Where’s
 * that?» (.join-field в globals.css: счёт там — на русскую пару). Замер
 * шрифтом страницы: «Where’s that?» на 18 px шире «Где взять?» (80 против
 * 62), подсказка на 17 уже русской (184.5 против 201.8 при 16 px), и
 * запас до края поля на 360 px — 11.5 px против русских 12.2. Длиннее
 * «Profile link or friend code» сюда ничего не встанет.
 */
const PLACEHOLDER_EN = 'Profile link or friend code'

/**
 * Поле для ссылки на профиль — одно на карточку.
 *
 * Им пользуются обе ветки: гость подключается, вошедший (демо или «Подключить
 * другую библиотеку») меняет библиотеку. Разметка общая, чтобы id и подпись
 * поля существовали в исходнике ровно один раз, — сторож lib/landingdoor
 * считает именно исходник.
 *
 * primary — у гостя кнопка формы и есть парадная кнопка карточки. У
 * вошедшего парадная уже стоит выше (его назначение), и вторая залитая рядом
 * читалась бы как второе обещание — поэтому стеклянная.
 */
function ProfileForm({
  value,
  onChange,
  invalid,
  busy,
  autoFocus,
  submit,
  primary,
  onSubmit,
}: {
  value: string
  onChange: (v: string) => void
  invalid: boolean
  busy: Busy
  autoFocus: boolean
  submit: string
  primary: boolean
  onSubmit: () => void
}) {
  const locale = useLocale()
  // Кнопка — nowrap в пилюле поля: английская подпись занятой кнопки не шире
  // русской (128 px против 160 при 16 px), «Reading your library…» было бы шире
  const label = busy === 'connect' ? tr(locale, { ru: 'Читаю библиотеку…', en: 'Reading library…' }) : submit
  /** «Где взять?» раскрыта (LinkHelp). Закрыта, пока о ней не попросили */
  const [helpOpen, setHelpOpen] = useState(false)
  return (
    <>
      {/*
        Настоящая форма, а не инпут с onKeyDown. Даёт три вещи разом: Enter
        работает штатно (и на мобильной клавиатуре тоже), браузер понимает поле
        как поле, а скринридер объявляет его подпись.
      */}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit()
        }}
        className="join"
      >
        {/* Подпись есть, но не показана: место под ней съело бы карточку,
            а placeholder подписью не является — он исчезает при вводе и
            не читается скринридером как имя поля. */}
        <label htmlFor="steam-profile" className="sr-only">
          {tr(locale, {
            ru: 'Ссылка, ник или код друга в Steam',
            en: 'Steam profile link, custom URL or friend code',
          })}
        </label>
        {/*
          «Где взять?» — в строке поля, а не строкой под ней: закрытая
          подсказка не имеет права добавить карточке ни пикселя (см.
          LinkHelp и .join-field). Кнопка после поля и в обходе: Tab с поля
          ведёт прямо к ней, а type="button" не даёт ей отправить форму.
        */}
        <div className="join-field">
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
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={tr(locale, { ru: 'Ссылка, ник или код друга', en: PLACEHOLDER_EN })}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            autoComplete="off"
            autoFocus={autoFocus}
            aria-invalid={invalid}
            aria-describedby="connect-error"
          />
          <LinkHelpToggle
            open={helpOpen}
            onToggle={() => setHelpOpen(toggleLinkHelp(helpOpen))}
          />
        </div>
        {primary ? (
          /* Парадная кнопка продукта: наклон к курсору + ember-залп на нажатии */
          <Magnet className="block w-full sm:w-auto">
            <ClickSpark className="block w-full sm:w-auto">
              {/*
                data-busy отдельно от выключения: форма выключает кнопку и
                когда поле пустое, и когда идёт запрос, а это два разных
                состояния. Выключенная ЖДЁТ ввода, занятая РАБОТАЕТ — и
                выглядеть они обязаны по-разному (см. .btn-ember[data-busy]).

                И выключаются они по-разному. Пустое поле — disabled: фокус в
                этот момент в поле, а кнопке без ввода и правда не место в
                обходе. Запрос — aria-disabled: нажатая кнопка обязана
                удержать фокус, disabled уронил бы его в body. Второй запрос
                гасит onSubmit (submitProfile — по busy).
              */}
              <button
                type="submit"
                disabled={!value}
                aria-disabled={busy !== null}
                data-busy={busy === 'connect' ? '' : undefined}
                className="btn-ember is-block whitespace-nowrap px-6 sm:w-auto"
              >
                {label}
              </button>
            </ClickSpark>
          </Magnet>
        ) : (
          /* Выключается так же, как парадная выше: поле — disabled, запрос — aria-disabled */
          <button
            type="submit"
            disabled={!value}
            aria-disabled={busy !== null}
            className="btn-glass w-full whitespace-nowrap disabled:opacity-60 aria-disabled:opacity-60 sm:w-auto"
          >
            {label}
          </button>
        )}
      </form>
      {/* Сразу под пилюлей: шаги читаются рядом с полем, для которого они */}
      <LinkHelp open={helpOpen} />
    </>
  )
}
