import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { isChunkLoadError } from './clienterr'

/**
 * Сторож экранов ошибки: не пришедший кусок кода лечится только перезагрузкой.
 *
 * Отказ чанка — моргнула сеть, деплой сменил хеши под старой вкладкой —
 * помнят и React.lazy (components/room/CeremonyBoundary: «lazy помнит
 * отказ»), и сборщик. «Попробовать снова» (retry) перерисовывает тот же lazy,
 * и он бросает тот же отказ; «На главную» — клиентский переход, который на
 * главной монтирует тот же кусок снова. Человек жал обе кнопки и получал тот
 * же экран — помогало только обновить страницу руками, а этого экран не
 * предлагал. Так и было с плавной прокруткой главной (components/
 * SmoothScroll): её кусок не пришёл — и вся главная, с единственной карточкой
 * входа, стояла экраном «Что-то сломалось».
 *
 * Главную от этого бережёт lazyIsland (lib/smoothlazy.test.ts). Здесь —
 * страховка для остальных кусков на next/dynamic: экран узнаёт отказ чанка
 * и предлагает то, что поможет, — перезагрузку.
 */

const { reload } = vi.hoisted(() => ({ reload: vi.fn() }))

vi.mock('@/lib/clienterr', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/clienterr')>()),
  reportClientError: vi.fn(),
}))
// Эффект отчёта в серверном рендере и так не идёт; при прямом вызове
// компонента (ниже, ради onClick) хуку нужна заглушка
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  useEffect: () => {},
  // язык аварийного экрана — из адреса (app/global-error.tsx); при прямом
  // вызове компонента хук отдаёт снимок браузера как есть
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
  // язык границы app/[lang]/error.tsx — из контекста (useLocale). Значение
  // берётся из того гнезда контекста, куда его кладёт react-dom/server
  // (_currentValue2: первое гнездо — у клиентского react-dom); при прямом
  // вызове компонента там значение по умолчанию — русский, как без провайдера
  useContext: (context: { _currentValue2: unknown }) => context._currentValue2,
}))

afterEach(() => {
  reload.mockClear()
  vi.unstubAllGlobals()
})

/** Так отказ чанка называет Turbopack — имя и текст из его рантайма */
function turbopackChunk(): Error {
  const err = new Error('Failed to load chunk /_next/static/chunks/0f3a9c.js from module 41234')
  err.name = 'ChunkLoadError'
  return err
}

describe('isChunkLoadError', () => {
  test('узнаёт отказ чанка у Turbopack, webpack и у браузеров', () => {
    expect(isChunkLoadError(turbopackChunk())).toBe(true)
    // webpack: то же имя, свой текст
    expect(isChunkLoadError(Object.assign(new Error('Loading chunk 712 failed.'), { name: 'ChunkLoadError' }))).toBe(
      true,
    )
    // голый import() без обёртки сборщика: Chrome, Firefox, Safari
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://imbored.cc/x.js'))).toBe(
      true,
    )
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error('Loading CSS chunk 9 failed.'))).toBe(true)
  })

  test('обычное исключение — не отказ чанка', () => {
    expect(isChunkLoadError(new TypeError('Cannot read properties of undefined (reading "appid")'))).toBe(false)
    expect(isChunkLoadError(new Error('chunk of text'))).toBe(false)
    expect(isChunkLoadError('Failed to load chunk')).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})

/** Кнопка экрана по её подписи — в дереве, которое вернул сам компонент */
function findButton(node: ReactNode, label: RegExp): ReactElement<{ onClick: () => void }> | null {
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = findButton(n, label)
      if (hit) return hit
    }
    return null
  }
  if (!isValidElement<{ children?: ReactNode; onClick?: () => void }>(node)) return null
  if (node.type === 'button' && label.test(renderToStaticMarkup(node))) return node as ReactElement<{ onClick: () => void }>
  return findButton(node.props.children, label)
}

describe('экраны ошибки и отказ чанка', () => {
  const screens = [
    ['app/[lang]/error.tsx', () => import('@/app/[lang]/error')],
    ['app/global-error.tsx', () => import('@/app/global-error')],
  ] as const

  test.each(screens)('%s: отказ чанка — «Обновить страницу», и кнопка перезагружает', async (_, load) => {
    vi.stubGlobal('window', { location: { reload, href: 'https://imbored.cc/' } })
    const { default: Screen } = await load()
    const retry = vi.fn()
    const props = { error: turbopackChunk(), retry }
    expect(renderToStaticMarkup(createElement(Screen, props))).toContain('Обновить страницу')

    const tree = (Screen as (p: typeof props) => ReactNode)(props)
    const button = findButton(tree, /Обновить страницу/)
    expect(button, 'кнопки перезагрузки нет').not.toBeNull()
    button!.props.onClick()
    expect(reload, 'retry перерисует тот же lazy, и он бросит тот же отказ').toHaveBeenCalledTimes(1)
    expect(retry).not.toHaveBeenCalled()
  })

  test.each(screens)('%s: обычная ошибка — прежнее «Попробовать снова» через retry', async (_, load) => {
    vi.stubGlobal('window', { location: { reload, href: 'https://imbored.cc/' } })
    const { default: Screen } = await load()
    const retry = vi.fn()
    const props = { error: new TypeError('boom'), retry }
    const html = renderToStaticMarkup(createElement(Screen, props))
    expect(html).toContain('Попробовать снова')
    expect(html).not.toContain('Обновить страницу')

    const button = findButton((Screen as (p: typeof props) => ReactNode)(props), /Попробовать снова/)
    button!.props.onClick()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(reload).not.toHaveBeenCalled()
  })
})

/**
 * Граница под корневым layout берёт язык из его провайдера: на /en экран и
 * обе его кнопки — по-английски, «На главную» ведёт на английскую главную.
 */
describe('граница ошибок на языке страницы', () => {
  test('под провайдером en — по-английски, без кириллицы', async () => {
    vi.stubGlobal('window', { location: { reload, href: 'https://imbored.cc/en/play' } })
    const { default: Screen } = await import('@/app/[lang]/error')
    const { LocaleProvider } = await import('@/components/LocaleProvider')
    const en = (error: Error) =>
      renderToStaticMarkup(
        createElement(LocaleProvider, { locale: 'en' } as ComponentProps<typeof LocaleProvider>, createElement(Screen, { error, retry: vi.fn() })),
      )
    const stale = en(turbopackChunk())
    expect(stale).toContain('Something broke')
    expect(stale).toContain('Reload page')
    expect(stale).toContain('href="/en"')
    expect(stale).not.toMatch(/[А-Яа-яЁё]/)
    const plain = en(new TypeError('boom'))
    expect(plain).toContain('Try again')
    expect(plain).toContain('Back to home')
    expect(plain).not.toMatch(/[А-Яа-яЁё]/)
  })
})

/**
 * Аварийный экран стоит вместо корневого layout, и языка из сегмента у него
 * нет — он берёт его из адреса в браузере (app/global-error.tsx).
 */
describe('аварийный экран на языке адреса', () => {
  test('на /en/… — по-английски, со ссылкой на английскую главную', async () => {
    vi.stubGlobal('window', { location: { reload, href: 'https://imbored.cc/en/play', pathname: '/en/play' } })
    const { default: Screen } = await import('@/app/global-error')
    const html = renderToStaticMarkup(createElement(Screen, { error: turbopackChunk(), retry: vi.fn() }))
    expect(html).toContain('lang="en"')
    expect(html).toContain('Reload the page')
    expect(html).toContain('href="/en"')
    expect(html).not.toContain('Обновить страницу')
  })

  test('на русском адресе — по-русски, как было', async () => {
    vi.stubGlobal('window', { location: { reload, href: 'https://imbored.cc/play', pathname: '/play' } })
    const { default: Screen } = await import('@/app/global-error')
    const html = renderToStaticMarkup(createElement(Screen, { error: new TypeError('boom'), retry: vi.fn() }))
    expect(html).toContain('lang="ru"')
    expect(html).toContain('Попробовать снова')
    expect(html).toContain('href="/"')
  })
})
