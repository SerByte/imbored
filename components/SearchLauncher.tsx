'use client'

import { useRef, useState } from 'react'
import { Icon } from '@/components/Icon'

/**
 * Кнопка «Найти игру» — лёгкий вход в поиск по каталогу.
 *
 * Стоит в шапке, то есть на КАЖДОЙ странице, и поэтому весит одну кнопку.
 * Само окно поиска (components/CatalogSearch) — поле, список, клавиатура,
 * свёртка названий — едет отдельным чанком по динамическому import(), а
 * индекс каталога — ещё позже, когда окно открылось (lib/catalogindex). В
 * первую загрузку страницы не попадает ни то, ни другое: /room/[id], /quiz,
 * /library, /daily и /explore стоят у самого потолка bundle-budget.json, и
 * окно (8.8 КБ) их бы через него перевело. Сама кнопка — 1.0 КБ к первой
 * загрузке каждой страницы (замер сборкой, без сжатия). Что статический импорт
 * окна сюда не вернётся, сторожит lib/searchlazy.test.ts — граф импортов от
 * этого файла.
 *
 * Чанк начинают грузить по намерению — наведение, касание, фокус, — а не
 * при загрузке страницы: тот, кто поиск не открывал, не платит и его.
 *
 * ОКНО МОНТИРУЕТСЯ В ТОМ ЖЕ НАЖАТИИ, ЕСЛИ ЧАНК УЖЕ ЗДЕСЬ. Поэтому компонент
 * окна лежит в состоянии, а не за React.lazy: lazy при первом показе
 * приостанавливается даже на готовом модуле, и окно вставало бы кадром позже,
 * вне жеста. А iPhone открывает клавиатуру, только если фокус в поле пришёл
 * внутри жеста пользователя: без этого человек тапал по «Найти игру», видел
 * поле — и тапал второй раз, чтобы набрать. pointerenter у касания приходит
 * раньше pointerdown и click, и чанк обычно успевает.
 *
 * Два вида: значок в шапке (как переключатель темы рядом) и строка-поле на
 * /games и 404 — там поиск по названию и есть главный ответ на «где игра».
 * Один компонент, а не два, и это про вес: 404 корневого лэйаута входит в
 * первую загрузку КАЖДОЙ страницы (граница not-found), и отдельный файл
 * строки ехал бы туда своим чанком. Замер сборкой: два файла — +1.6 КБ на
 * маршрут, один с утилитами — +1.25, один с видом строки классом
 * .search-field в globals.css — +1.0: строка утилит тоже ехала бы в этот JS.
 *
 * Значка в шапке нет на 768–1023 px: там у шапки нет на него места (замеры —
 * в components/HeaderNav.tsx). На телефоне меню уезжает в нижнюю панель и
 * места хватает, с lg — тоже.
 */

type Dialog = typeof import('./CatalogSearch').CatalogSearch

/**
 * Модуль окна — один на вкладку, общий для всех кнопок: шапка и /games
 * открывают одно и то же. Отказ загрузки забывается — следующее нажатие
 * попробует снова.
 */
let loaded: Dialog | null = null
let loading: Promise<Dialog> | null = null

function loadDialog(): Promise<Dialog> {
  loading ??= import('./CatalogSearch').then(
    (m) => (loaded = m.CatalogSearch),
    (err: unknown) => {
      loading = null
      throw err
    },
  )
  return loading
}

const warm = () => {
  if (!loaded) loadDialog().catch(() => {})
}

export function SearchLauncher({ variant = 'icon' }: { variant?: 'icon' | 'field' }) {
  const opener = useRef<HTMLButtonElement>(null)
  // Компонент окна в состоянии: есть — окно открыто (см. докблок выше)
  const [Open, setOpen] = useState<Dialog | null>(null)
  const field = variant === 'field'

  return (
    <>
      <button
        ref={opener}
        type="button"
        aria-haspopup="dialog"
        // У строки имя — её подпись; у значка подписи нет
        aria-label={field ? undefined : 'Найти игру'}
        title={field ? undefined : 'Найти игру'}
        className={
          field
            ? 'search-field'
            : 'tap btn-glass size-10 !rounded-full !p-0 text-dim hover:text-ink md:max-lg:hidden'
        }
        onPointerEnter={warm}
        onFocus={warm}
        onClick={() => {
          if (loaded) {
            const dialog = loaded
            setOpen(() => dialog)
            return
          }
          loadDialog().then(
            (dialog) => setOpen(() => dialog),
            // Чанк не доехал (связь) — окна нет, кнопка на месте: нажатие повторит
            () => {},
          )
        }}
      >
        <Icon name="search" size={field ? 18 : 17} />
        {field && 'Найти игру по названию'}
      </button>
      {Open && <Open opener={opener} onClose={() => setOpen(null)} />}
    </>
  )
}
