'use client'

import { useLocaleRouter } from '@/components/useLocaleRouter'
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { GameLink } from '@/components/GameLink'
import { Icon } from '@/components/Icon'
import { Portal } from '@/components/Portal'
import { StatusLine } from '@/components/StatusLine'
import { requestCatalogIndex, useCatalogIndex } from '@/lib/catalogindex'
import { SEARCH_QUERY_MAX, searchCatalog, searchStatus, stepActive, type SearchHit } from '@/lib/catalogsearch'
import { backdropOf, holdScroll, makeInert } from '@/lib/pagelock'

/**
 * Пауза перед тем, как скринридер услышит «Нашлось N игр». Список меняется
 * на каждой клавише, и без паузы он зачитывал бы очередь устаревших чисел —
 * по одному на букву. Глаз видит число сразу (видимая копия строки), отказ и
 * «Загружаю каталог…» звучат сразу: они не от набора.
 */
const SPEAK_AFTER_MS = 500

const EMPTY: never[] = []

/**
 * Окно «Найти игру»: поле-комбобокс и список из восьми игр каталога.
 *
 * Чанк отдельный — его грузит components/SearchLauncher по намерению, а
 * индекс каталога просит само окно при открытии (lib/catalogindex). Поиск —
 * в браузере, по каждой клавише (lib/catalogsearch).
 *
 * КОМБОБОКС ПО ШАБЛОНУ ARIA (APG, «combobox with listbox popup»). Фокус всё
 * время в поле: стрелки ведут по списку через aria-activedescendant, Enter
 * открывает выбранную игру — или первую, если не выбрана ни одна, Esc
 * сначала стирает набранное, а на пустом поле закрывает окно. Строки списка
 * — настоящие ссылки на /game/<appid> с role="option": мышью и пальцем по
 * ним переходят как по ссылке, средней кнопкой — в новую вкладку. Из обхода
 * Tab они вынуты (tabIndex −1): восемь остановок между полем и «Закрыть» —
 * не то, чего ждут от комбобокса.
 *
 * ЧТО ГОВОРИТ СКРИНРИДЕР. Число найденного и отказ — строка статуса
 * (StatusLine): она смонтирована вместе с окном и пустая, текст приходит
 * позже — когда приехал индекс или человек сделал паузу в наборе, — так что
 * область меняется, а не рождается с текстом (lib/liveregion.test.ts). Глаз
 * видит ту же строку сразу, копией с aria-hidden: виртуальный курсор не
 * читает её дважды.
 *
 * МОДАЛЬНОСТЬ — как у Lightbox: role="dialog" aria-modal, фон инертен,
 * прокрутка стоит (lib/pagelock), Tab ходит по кругу внутри окна. Фокус
 * возвращается на кнопку, которая окно открыла, — по ссылке, а не по
 * document.activeElement: Safari по клику кнопку не фокусирует, и запомнился
 * бы <body>.
 *
 * Портал обязателен: окно — fixed на весь экран, а под плавной прокруткой
 * fixed внутри содержимого цепляется к содержимому (lib/smoothfixed.test.ts).
 */
export function CatalogSearch({
  opener,
  seed = '',
  onClose,
}: {
  /** Кнопка, открывшая окно: на неё возвращается фокус */
  opener: RefObject<HTMLElement | null>
  /**
   * С чем окно открывается: набранное в подставку, пока чанк окна ехал
   * (holdKeyboard в components/SearchLauncher), — клавиатура уже стояла
   */
  seed?: string
  onClose: () => void
}) {
  const router = useLocaleRouter()
  const index = useCatalogIndex()
  // Потолок длины — как у поля: у подставки maxLength нет
  const [query, setQuery] = useState(seed.slice(0, SEARCH_QUERY_MAX))
  const [active, setActive] = useState(-1)
  const overlayRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  /** Нажатие началось на затемнении — только тогда click по нему закрывает окно */
  const pressedScrim = useRef(false)
  const id = useId()
  const listId = `${id}-list`
  const optionId = (i: number) => `${id}-opt-${i}`

  const found = useMemo(
    () => searchCatalog(index.phase === 'ready' ? index.entries : EMPTY, query),
    [index, query],
  )
  const games = found.games
  const current = active < games.length ? active : -1
  const status = searchStatus(index.phase, query, found)

  /*
   * Что слышит скринридер: от набора — после паузы, от фазы индекса — сразу.
   * Пока человек печатает, область пустая, а не со вчерашним числом: так
   * число после паузы всегда приходит изменением текста — даже то же самое,
   * что у прошлого запроса («Нашлись 2 игры» и у «portal», и у «dota»), — и
   * чужое число не прозвучит. Пустая область не звучит вовсе. Таймер ставит
   * текст из колбэка, а не телом эффекта: синхронный setState в эффекте у
   * проекта — ошибка линта.
   */
  const [settled, setSettled] = useState('')
  useEffect(() => {
    if (index.phase !== 'ready') return
    const t = window.setTimeout(() => setSettled(status), SPEAK_AFTER_MS)
    return () => window.clearTimeout(t)
  }, [index.phase, status])
  const spoken = index.phase !== 'ready' || settled === status ? status : ''

  // Индекс — при открытии окна: кнопка и страница его не просят
  useEffect(() => {
    void requestCatalogIndex()
  }, [])

  /*
   * Фокус — в поле, фон — инертный, прокрутка — на паузе; в очистке всё
   * обратно и фокус на кнопку-открывашку. Сначала фокус в поле, потом inert:
   * открывашка стоит в фоне, и инертность сбросила бы фокус с неё в <body>.
   * Порядок в очистке — как у Lightbox: в инертный узел фокус не встаёт.
   *
   * Если окно приехало чанком после нажатия, фокус в этот миг стоит в
   * подставке кнопки (holdKeyboard в components/SearchLauncher): переход
   * из поля в поле держит клавиатуру iPhone поднятой, хоть он и вне жеста, а
   * подставка уходит по своему blur — до того, как фон станет инертным.
   */
  useEffect(() => {
    inputRef.current?.focus()
    const overlay = overlayRef.current
    const children = Array.from(document.body.children).filter(
      (node): node is HTMLElement => node instanceof HTMLElement,
    )
    const releaseInert = overlay ? makeInert(backdropOf(children, overlay)) : () => {}
    const releaseScroll = holdScroll()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const back = opener.current
    return () => {
      releaseInert()
      releaseScroll()
      document.body.style.overflow = overflow
      if (back?.isConnected) back.focus({ preventScroll: true })
    }
  }, [opener])

  /*
   * Высота окна — по видимой части экрана, а не по 100dvh. Клавиатура
   * телефона dvh не уменьшает — ни на iPhone, ни в Chrome на Android по
   * умолчанию (interactive-widget=resizes-visual), — и окно ростом «в экран»
   * уходило низом под неё: поле, строка статуса и восемь строк по 44 px —
   * ~470 px, а над клавиатурой у iPhone видно ~400–450, у SE — ~290.
   * Последние строки стояли за клавиатурой, и список не листался: до
   * потолка высоты окно не дорастало. visualViewport клавиатуру знает: его
   * высота — в --vvh окна, потолок считается от неё, и список листается
   * над клавиатурой. Без visualViewport (старые браузеры) — прежний 100dvh.
   */
  useEffect(() => {
    const viewport = window.visualViewport
    const panel = panelRef.current
    if (!viewport || !panel) return
    const fit = () => panel.style.setProperty('--vvh', `${viewport.height}px`)
    fit()
    viewport.addEventListener('resize', fit)
    return () => viewport.removeEventListener('resize', fit)
  }, [])

  // Выбранная стрелками строка — в видимой части списка
  useEffect(() => {
    if (current < 0) return
    document.getElementById(optionId(current))?.scrollIntoView({ block: 'nearest' })
    // optionId — от useId, он стабилен
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  const open = (game: SearchHit) => {
    onClose()
    router.push(`/game/${game.appid}`)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      if (query) {
        setQuery('')
        setActive(-1)
      } else onClose()
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!games.length) return
      e.preventDefault()
      setActive(stepActive(current, games.length, e.key))
      return
    }
    if (e.key === 'Tab') {
      // Круг по фокусируемому внутри окна. Строки списка в него не входят
      // (tabIndex −1), поэтому [href] — только без него
      const list = Array.from(
        overlayRef.current?.querySelectorAll<HTMLElement>(
          'input, button, [href]:not([tabindex="-1"])',
        ) ?? [],
      )
      if (!list.length) return
      const at = list.indexOf(document.activeElement as HTMLElement)
      const next = e.shiftKey ? at - 1 : at + 1
      e.preventDefault()
      list[((next % list.length) + list.length) % list.length]?.focus()
    }
  }

  return (
    <Portal>
      <div
        ref={overlayRef}
        className="fixed inset-0 z-[100] flex justify-center px-safe pt-[max(1rem,env(safe-area-inset-top))] sm:pt-[12vh]"
        onKeyDown={onKeyDown}
        onPointerDown={(e) => {
          pressedScrim.current = e.target === e.currentTarget
        }}
        onClick={(e) => {
          // Закрывает только нажатие, начатое и законченное на затемнении:
          // протяжка выделения из поля наружу окно не закрывает
          if (e.target === e.currentTarget && pressedScrim.current) onClose()
          pressedScrim.current = false
        }}
      >
        <div aria-hidden className="pointer-events-none absolute inset-0 bg-black/60 backdrop-blur-sm" />
        {/* Потолок высоты — видимая часть экрана (--vvh, эффект выше) за
            вычетом отступа сверху, как у затемнения, и 1rem снизу */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Найти игру"
          className="panel-lift anim-rise relative flex max-h-[calc(var(--vvh,100dvh)-max(1rem,env(safe-area-inset-top))-1rem)] w-full max-w-xl flex-col self-start p-2 sm:max-h-[calc(var(--vvh,100dvh)-12vh-1rem)]"
        >
          <form
            role="search"
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              const game = games[current] ?? games[0]
              if (game) open(game)
            }}
          >
            <label htmlFor={`${id}-q`} className="sr-only">
              Название игры
            </label>
            <span className="relative flex-1">
              <Icon
                name="search"
                size={18}
                className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-dim"
              />
              <input
                ref={inputRef}
                id={`${id}-q`}
                type="search"
                role="combobox"
                aria-expanded={games.length > 0}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={current >= 0 ? optionId(current) : undefined}
                value={query}
                maxLength={SEARCH_QUERY_MAX}
                placeholder="Название игры"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="go"
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(-1)
                }}
                // 16 px, не меньше: Safari на iPhone приближает страницу,
                // когда фокус получает поле мельче (как у .lib-search)
                className="h-12 w-full rounded-full border border-ink/15 bg-ink/7 pr-4 pl-11 text-base font-medium text-ink placeholder:text-dim focus:border-ink/45 focus:bg-ink/10 [&::-webkit-search-cancel-button]:grayscale"
              />
            </span>
            <button type="button" aria-label="Закрыть поиск" onClick={onClose} className="btn-circle">
              <Icon name="close" size={18} />
            </button>
          </form>

          {/* Видимая копия — сразу на каждой клавише, скринридеру её
              заменяет строка статуса ниже: та ждёт паузы в наборе */}
          <p aria-hidden hidden={!status} className="px-3 pt-2 text-sm text-dim">
            {status}
          </p>
          <StatusLine text={spoken} className="sr-only" />
          {index.phase === 'failed' && (
            <div className="px-3 pt-1">
              {/* Фокус — в поле до запроса: кнопка уходит вместе с отказом,
                  и фокус с неё упал бы в <body> */}
              <button
                type="button"
                className="tap link-more"
                onClick={() => {
                  inputRef.current?.focus()
                  void requestCatalogIndex()
                }}
              >
                Попробовать снова
              </button>
            </div>
          )}

          <div
            id={listId}
            role="listbox"
            aria-label="Игры каталога"
            hidden={games.length === 0}
            className="mt-2 flex min-h-0 flex-col overflow-y-auto overscroll-contain"
          >
            {games.map((g, i) => (
              <GameLink
                key={g.appid}
                appid={g.appid}
                id={optionId(i)}
                role="option"
                aria-selected={i === current}
                tabIndex={-1}
                onMouseMove={() => {
                  if (i !== current) setActive(i)
                }}
                onClick={(e) => {
                  // В новую вкладку — окно остаётся: человек ищет дальше
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                  onClose()
                }}
                className={`flex min-h-11 items-center justify-between gap-3 rounded-(--radius-control) px-3 py-2.5 font-medium ${i === current ? 'bg-ink/10 text-ink' : 'text-dim'}`}
              >
                {/* Длинное название обрезано глазу, но не скринридеру: текст
                    строки целиком, а полное видно подсказкой */}
                <span className="truncate" title={g.name}>
                  {g.name}
                </span>
                <Icon name="arrow" size={16} className={i === current ? 'shrink-0' : 'invisible shrink-0'} />
              </GameLink>
            ))}
          </div>

          {/* Подсказка клавиш — только там, где есть клавиатура и курсор:
              на телефоне это шум. Скринридеру её заменяют роли комбобокса.
              Esc — по тому же условию, что в onKeyDown: с набранным он
              стирает, а не закрывает, и «Esc — закрыть» над запросом
              обещало то, чего нажатие не делало */}
          <p
            aria-hidden
            className="hidden px-3 pt-2 pb-1 text-xs text-dim [@media(pointer:fine)]:block"
          >
            ↑↓ — выбрать · Enter — открыть · Esc — {query ? 'стереть' : 'закрыть'}
          </p>
        </div>
      </div>
    </Portal>
  )
}
