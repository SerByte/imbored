'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { Icon } from '@/components/Icon'
import type { LibraryFilter } from '@/lib/forgotten'
import { LIBRARY_QUERY_MAX, libraryHref } from '@/lib/libraryhref'

/** Пауза после последней клавиши: запрос уходит, когда человек перестал печатать */
const DEBOUNCE_MS = 280

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
 */
export function LibrarySearch({ filter, q }: { filter: LibraryFilter; q: string }) {
  const router = useRouter()
  const [value, setValue] = useState(q)
  const [pending, startTransition] = useTransition()
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const go = (next: string) => {
    window.clearTimeout(timer.current)
    const href = libraryHref(filter, 1, next.replace(/\s+/g, ' ').trim())
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
          timer.current = window.setTimeout(() => go(next), DEBOUNCE_MS)
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
