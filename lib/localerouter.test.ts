import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { LocaleProvider } from '../components/LocaleProvider'
import { useLocaleRouter } from '../components/useLocaleRouter'
import type { Locale } from './i18n'

const calls: Array<[string, string]> = []
const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: (href: string) => calls.push(['push', href]),
    replace: (href: string) => calls.push(['replace', href]),
    prefetch: (href: string) => calls.push(['prefetch', href]),
    refresh,
    back: () => {},
    forward: () => {},
  }),
}))

/** Отрисовать компонент с хуком и отдать роутер, который он получил */
function routerFor(locale: Locale | null): ReturnType<typeof useLocaleRouter> {
  let got: ReturnType<typeof useLocaleRouter> | null = null
  const Probe = () => {
    got = useLocaleRouter()
    return null
  }
  const probe = createElement(Probe)
  renderToStaticMarkup(locale ? createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, probe) : probe)
  if (!got) throw new Error('хук не отработал')
  return got
}

describe('useLocaleRouter', () => {
  beforeEach(() => {
    calls.length = 0
    refresh.mockClear()
  })

  test('на английском push, replace и prefetch получают /en', () => {
    const router = routerFor('en')
    router.push('/game/730')
    router.replace('/?next=%2Flibrary')
    router.prefetch('/play?time=short')
    expect(calls).toEqual([
      ['push', '/en/game/730'],
      ['replace', '/en?next=%2Flibrary'],
      ['prefetch', '/en/play?time=short'],
    ])
  })

  test('на русском и без провайдера — как было', () => {
    routerFor('ru').push('/game/730')
    routerFor(null).replace('/')
    expect(calls).toEqual([
      ['push', '/game/730'],
      ['replace', '/'],
    ])
  })

  test('уже английское, внешнее и /api не трогает, остальное — как у next/navigation', () => {
    const router = routerFor('en')
    router.push('/en/quiz')
    router.push('/api/auth/steam')
    router.refresh()
    expect(calls).toEqual([
      ['push', '/en/quiz'],
      ['push', '/api/auth/steam'],
    ])
    expect(refresh).toHaveBeenCalledOnce()
  })
})
