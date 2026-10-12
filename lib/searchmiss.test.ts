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
 * Здесь — что отказ доходит до отчёта с тегом search. Что кнопка говорит о
 * нём сама, проверяется чтением исходника (lib/searchkeyboard.test.ts):
 * без DOM состояние после рендера не увидеть.
 */

// Кусок окна не пришёл — так же, как 404 чанка после деплоя
vi.mock('@/components/CatalogSearch', () => {
  throw new Error('Failed to load chunk /_next/static/chunks/old.js')
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

/** Кнопка, снятая с серверного рендера: дерево с живым обработчиком нажатия */
function launcher(): { onClick: () => void } {
  let tree: ReactElement<{ children: ReactNode[] }> | undefined
  function Probe() {
    tree = SearchLauncher({ variant: 'field' }) as ReactElement<{ children: ReactNode[] }>
    return null
  }
  renderToStaticMarkup(createElement(Probe))
  const button = tree!.props.children.find(
    (c): c is ReactElement<{ onClick: () => void }> => (c as ReactElement)?.type === 'button',
  )
  return button!.props
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.mocked(reportClientError).mockClear()
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
    const props = launcher() as unknown as { onPointerEnter: () => void }
    props.onPointerEnter()
    // даём отказу дойти; отчёта быть не должно
    await new Promise((r) => setTimeout(r, 20))
    expect(reportClientError).not.toHaveBeenCalled()
  })
})
