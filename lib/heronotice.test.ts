import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'

/**
 * Строка над заголовком главной (components/landing/HeroNotice) — после
 * «Удалить всё обо мне».
 *
 * Кнопка удаления уводит на главную (components/ForgetMe), а там человек —
 * уже гость. Без строки он видел бы обычный лендинг и не знал, сработало ли:
 * удаление необратимо, и «а точно удалилось?» — первый вопрос после него.
 */

const search = vi.hoisted(() => ({ params: new URLSearchParams() }))
vi.mock('next/navigation', () => ({ useSearchParams: () => search.params }))

const { HeroNotice } = await import('@/components/landing/HeroNotice')

const render = (query: string) => {
  search.params = new URLSearchParams(query)
  return renderToStaticMarkup(createElement(HeroNotice))
}

beforeEach(() => {
  search.params = new URLSearchParams()
})

describe('HeroNotice после удаления', () => {
  test('?forgot=1 — говорит, что всё удалено и входы погашены', () => {
    const html = render('forgot=1')
    expect(html).toContain('всё, что imbored о тебе хранил, удалено')
    expect(html).toContain('входы на всех устройствах погашены')
  })

  test('без метки — прежнее поведение: гостю, пришедшему сам, пусто', () => {
    expect(render('')).toBe('')
    expect(render('forgot=0')).toBe('')
  })

  test('метка удаления важнее приглашения: строка о пати не перебивает «удалено»', () => {
    expect(render('forgot=1&join=ABC234')).not.toContain('пати')
  })
})
