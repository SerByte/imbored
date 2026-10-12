'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Icon } from '@/components/Icon'
import type { LibraryFilter } from '@/lib/forgotten'
import { LIBRARY_QUERY_MAX, libraryHref } from '@/lib/libraryhref'

/** Пауза после последней клавиши: запрос уходит, когда человек перестал печатать */
const DEBOUNCE_MS = 500

/** С какой длины запрос уходит сам, по паузе. Enter отправляет любой */
const MIN_TYPED = 2

/**
 * Поле поиска над стеной /library.
 *
 * Сама стена остаётся серверной (см. докблок у чипсов в app/library): поле
 * лишь переписывает ?q= в адресе, и страница перерисовывается с отобранной
 * полкой. Без JS это обычная GET-форма на тот же адрес — Enter ищет так же.
 *
 * router.replace, а не push: каждая буква в истории превратила бы «Назад» в
 * стирание запроса по символу. scroll: false — по той же причине, что у чипсов:
 * поле стоит экраном ниже героя, и прыжок к верху страницы уносил бы из-под
 * пальцев и поле, и найденное.
 *
 * Поле переживает перерисовку: оно — клиентский островок на том же месте
 * дерева, поэтому фокус и набранное не сбрасываются, пока сервер отвечает.
 *
 * КАЖДЫЙ ЗАПРОС — ЦЕЛАЯ СТРАНИЦА. /library force-dynamic, и replace
 * перерисовывает её всю: десяток чтений базы разом и метаданные по всей
 * библиотеке, у коллекционера — тысячи строк. Это тот же счёт, из-за которого
 * у чипсов нет префетча (их комментарий в app/library/page.tsx), только тут
 * он платится на каждой паузе в наборе. Поэтому запрос уходит реже:
 *  - пауза — полсекунды, а не 280 мс: чем она короче, тем чаще запрос уходит
 *    посреди слова, а каждый такой — целая страница;
 *  - тот же запрос второй раз не уходит. Сверка — с последним отправленным
 *    (sent) после нормализации: пробел в конце, набрал и стёр до прежнего —
 *    это прежний запрос, и страница уже его показывает;
 *  - одна буква по паузе — ещё не поиск: под «a» подходит полбиблиотеки, а
 *    платится полная перерисовка. Пока в поле меньше MIN_TYPED знаков, полка
 *    целая — и если стёр до одной буквы, она тоже возвращается целой. Enter
 *    отправляет как есть: это уже просьба, а не пауза.
 */
export function LibrarySearch({ filter, q }: { filter: LibraryFilter; q: string }) {
  const router = useRouter()
  const [value, setValue] = useState(q)
  const [pending, startTransition] = useTransition()
  const timer = useRef<number | undefined>(undefined)

  /*
   * Запрос в адресе может смениться не отсюда: «Сбросить поиск» под стеной —
   * обычная ссылка без ?q=. Поле при этом держало бы старое «portal» над уже
   * полной полкой. Поэтому чужой q переписывает поле, а свой — нет: эхо
   * собственного запроса пришло бы нормализованным («portal » → «portal»)
   * и съело бы пробел, который человек только что набрал. Свой — это
   * последний отправленный (sent). Сверка во время рендера, а не в эффекте:
   * react-hooks/set-state-in-effect у проекта — ошибка, и лишнего кадра со
   * старым текстом так тоже нет.
   */
  const [sent, setSent] = useState(q)
  const [seenQ, setSeenQ] = useState(q)
  const [foreign, setForeign] = useState(0)
  if (q !== seenQ) {
    setSeenQ(q)
    if (q !== sent) {
      setSent(q)
      setValue(q)
      setForeign((n) => n + 1)
    }
  }

  /*
   * Чужой q гасит и отложенную отправку. Таймер держит go из того рендера,
   * где его завели, — со старым sent и старым набранным: набрал «portalxy»
   * и в те же полсекунды нажал «Сбросить поиск» или «Назад» — поле уже
   * пустое, а таймер отправил бы «portalxy» поверх сброса. Сброс отменён, и
   * пришедший q совпал бы с sent: стена отобрана, а поле так и стоит пустым.
   * Эхо собственного запроса таймер не трогает — иначе пропали бы буквы,
   * набранные уже после отправки. Гасит cleanup эффекта по счётчику чужих q
   * (и размонтирование), а не сам рендер: в рендере побочных действий нет.
   */
  useEffect(() => () => window.clearTimeout(timer.current), [foreign])

  /*
   * Полка для отправки — последняя показанная, а не та, при которой завели
   * таймер. Чипс переносит свой q (libraryHref), чужим для поля он не
   * считается, и таймер живёт дальше; со старой полкой в замыкании нажатый
   * в те же полсекунды чипс откатился бы назад вместе с запросом.
   */
  const shelf = useRef(filter)
  useEffect(() => {
    shelf.current = filter
  }, [filter])

  const go = (next: string, typed = false) => {
    window.clearTimeout(timer.current)
    const norm = next.replace(/\s+/g, ' ').trim()
    const query = typed && norm.length < MIN_TYPED ? '' : norm
    if (query === sent) return
    setSent(query)
    const href = libraryHref(shelf.current, 1, query)
    startTransition(() => router.replace(href, { scroll: false }))
  }

  return (
    <form
      role="search"
      action="/library"
      method="get"
      onSubmit={(e) => {
        e.preventDefault()
        go(value)
      }}
      className="lib-search"
      data-pending={pending || undefined}
    >
      {filter !== 'all' && <input type="hidden" name="state" value={filter} />}
      <label htmlFor="library-q" className="sr-only">
        Найти в библиотеке
      </label>
      <Icon name="search" size={18} className="text-dim" />
      <input
        id="library-q"
        name="q"
        type="search"
        value={value}
        maxLength={LIBRARY_QUERY_MAX}
        placeholder="Найти в библиотеке"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        onChange={(e) => {
          const next = e.target.value
          setValue(next)
          window.clearTimeout(timer.current)
          timer.current = window.setTimeout(() => go(next, true), DEBOUNCE_MS)
        }}
        onKeyDown={(e) => {
          // Esc очищает поле — и полку вместе с ним, как крестик type="search"
          if (e.key === 'Escape' && value) {
            e.preventDefault()
            setValue('')
            go('')
          }
        }}
      />
    </form>
  )
}
