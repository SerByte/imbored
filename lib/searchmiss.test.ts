import { createElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { reportClientError } from '@/lib/clienterr'
import { SearchLauncher } from '@/components/SearchLauncher'

/**
 * «Найти игру», когда кусок окна не пришёл.
 *
 * Окно поиска едет отдельным чанком (components/SearchLauncher), и после
 * деплоя старая вкладка просит кусок прежней сборки — 404 на каждое нажатие,
 * пока страницу не перезагрузят. Нажатие при этом не делало ничего видимого
 * и слышимого, а отчёта об отказе не было: островки (components/lazyIsland)
 * шлют его с тегом, а этот загрузчик написан руками и остался в стороне.
 *
 * Здесь — что отказ доходит до отчёта с тегом search и что просьба обновить
 * страницу гаснет, как только поиск снова работает. Как кнопка говорит об
 * отказе (подпись, строка под значком), проверяется чтением исходника
 * (lib/searchkeyboard.test.ts): без DOM разметку после рендера не увидеть,
 * поэтому здесь видны не кадры, а сами вызовы setState.
 */

/**
 * Кусок окна: пока chunk.ok ложно, не приходит — так же, как 404 чанка после
 * деплоя; потом связь возвращается. Фабрика зовётся заново на каждый import(),
 * пока модуль не загрузился, — ровно как повторный запрос чанка в браузере.
 */
const chunk = vi.hoisted(() => ({ ok: false }))
vi.mock('@/components/CatalogSearch', () => {
  if (!chunk.ok) throw new Error('Failed to load chunk /_next/static/chunks/old.js')
  return { CatalogSearch: function CatalogSearch() {} }
})

/**
 * Все вызовы setState кнопки по порядку. Серверный рендер обновления после
 * рендера молча выбрасывает, поэтому сеттер оборачивается: настоящий useState
 * остаётся под ним, и рендер не замечает подмены. setMissed — это булевы,
 * setOpen — объект окна или null.
 */
const sets = vi.hoisted(() => [] as unknown[])
vi.mock('react', async (importOriginal) => {
  const react = await importOriginal<typeof import('react')>()
  return {
    ...react,
    useState: ((init: unknown) => {
      const [value, set] = react.useState(init)
      return [
        value,
        (next: unknown) => {
          sets.push(next)
          set(next)
        },
      ]
    }) as typeof react.useState,
  }
})
vi.mock('@/lib/clienterr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clienterr')>()),
  reportClientError: vi.fn(),
}))

/** Ровно то, чего касается подставка клавиатуры (holdKeyboard) */
function fakePage() {
  const children: unknown[] = []
  const input = () => {
    const el = {
      style: { cssText: '' },
      value: '',
      setAttribute() {},
      addEventListener() {},
      focus() {},
      remove() {
        children.splice(children.indexOf(el), 1)
      },
      get isConnected() {
        return children.includes(el)
      },
    }
    return el
  }
  vi.stubGlobal('document', { createElement: input, body: { append: (el: unknown) => children.push(el) } })
  vi.stubGlobal('window', { location: { href: 'https://imbored.cc/games' } })
}

type Props = { onClick: () => void; onFocus: () => void; onPointerEnter: () => void }

/** Кнопка, снятая с серверного рендера: дерево с живыми обработчиками */
function launcher(variant: 'icon' | 'field' = 'field'): Props {
  let tree: ReactElement<{ children: ReactNode[] }> | undefined
  function Probe() {
    tree = SearchLauncher({ variant }) as ReactElement<{ children: ReactNode[] }>
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  const button = tree!.props.children.find(
    (c): c is ReactElement<Props> => (c as ReactElement)?.type === 'button',
  )
  return button!.props
}

/** Вызовы setMissed — булевы среди всех setState кнопки */
const missed = () => sets.filter((v) => typeof v === 'boolean')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(reportClientError).mockClear()
  sets.length = 0
})

describe('кусок окна поиска не пришёл', () => {
  test('нажатие отчитывается об отказе с тегом search — как островки', async () => {
    fakePage()
    launcher().onClick()
    await vi.waitFor(() => expect(reportClientError).toHaveBeenCalledTimes(1))
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'boundary', island: 'search', href: 'https://imbored.cc/games' }),
    )
    // В отчёт — само отклонение import() (vitest заворачивает отказ фабрики в
    // свою ошибку, браузер — в ChunkLoadError) и код, как на экране ошибки
    const { error, code } = vi.mocked(reportClientError).mock.calls[0][0]
    expect(error).toBeInstanceOf(Error)
    expect(code).toMatch(/^c[0-9a-z]{7}$/)
  })

  /*
   * Прогрев (наведение, фокус) — догадка, а не нажатие: его отказ человек не
   * видел, и отчёт о нём шёл бы с каждой страницы, где мышь прошла мимо
   * шапки. Тот же довод у «Сыграю вечером» (components/TonightLazy).
   */
  test('отказ прогрева в отчёт не идёт', async () => {
    fakePage()
    const props = launcher()
    props.onPointerEnter()
    // даём отказу дойти; отчёта быть не должно
    await new Promise((r) => setTimeout(r, 20))
    expect(reportClientError).not.toHaveBeenCalled()
  })
})

/*
 * Отказ — не приговор: связь моргнула и вернулась, или окно привезла другая
 * кнопка (шапка и /games делят один модуль). Просьба «обнови страницу» гасла
 * только на медленном пути нажатия, а фокус, вернувшийся на кнопку после
 * отказа, сам запускал прогрев — и тот привозил окно. Следующее нажатие шло
 * быстрым путём: окно открывалось, а кнопка под ним так и просила обновить
 * страницу — до перезагрузки. Порядок тестов здесь — порядок событий: модуль
 * окна один на вкладку, и после первого приезда он уже загружен.
 */
describe('поиск снова работает — просьба обновить страницу гаснет', () => {
  test('отказ нажатия, потом фокус на кнопке привозит окно — строка отказа гаснет сама', async () => {
    fakePage()
    chunk.ok = false
    const props = launcher('icon')
    props.onClick()
    await vi.waitFor(() => expect(missed()).toEqual([false, true]))
    // связь вернулась; фокус, вернувшийся на кнопку, — тот же прогрев
    chunk.ok = true
    props.onFocus()
    await vi.waitFor(() => expect(missed()).toEqual([false, true, false]))
  })

  test('окно уже здесь: нажатие гасит прежний отказ раньше, чем открывает окно', () => {
    fakePage()
    launcher('field').onClick()
    // быстрый путь синхронный — без await, в том же нажатии
    expect(sets).toHaveLength(2)
    expect(sets[0]).toBe(false)
    expect(sets[1]).toEqual({ Dialog: expect.any(Function), seed: '' })
  })

  test('наведение на другую кнопку, когда окно уже здесь, гасит её прежний отказ', async () => {
    fakePage()
    launcher('icon').onPointerEnter()
    await vi.waitFor(() => expect(missed()).toEqual([false]))
    // а нового import() нет: и отчёта, и подставки
    expect(reportClientError).not.toHaveBeenCalled()
  })
})
