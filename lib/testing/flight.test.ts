import { createElement as h, type ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { flight, imageHints } from './flight'

/**
 * imageHints повторяет правило React, а не придумывает своё.
 *
 * Сторожа страниц (app/games/page.test.ts, страница патча) спрашивают у
 * imageHints, какие картинки поедут подсказкой предзагрузки с префетчем.
 * Если правило React поменяется, а помощник останется прежним, сторожа
 * будут зелёными и слепыми. Поэтому здесь те же деревья рендерит
 * настоящий React: Fizz решает о <link rel="preload" as="image"> по тому
 * же условию, что Flight о `:HL[…,"image"]` (pushImg и getChildFormatContext:
 * lazy, fetchPriority="low", data:, <picture> и <noscript> в предках).
 */

const SRC = 'https://cdn.example/a/header.jpg'
const SET = 'https://cdn.example/a/header.jpg 460w, https://cdn.example/a/header_2x.jpg 920w'

/** Серверный компонент-обёртка: flight раскрывает его, Fizz тоже */
function Wrap({ children }: { children?: ReactNode }) {
  return h('span', { className: 'card-thumb' }, children)
}

const CASES: Array<[string, ReactNode, number]> = [
  ['голый eager <img>', h('img', { src: SRC, loading: 'eager' }), 1],
  ['только srcSet', h('img', { srcSet: SET, sizes: '260px' }), 1],
  ['loading="lazy"', h('img', { src: SRC, loading: 'lazy' }), 0],
  ['fetchPriority="low"', h('img', { src: SRC, fetchPriority: 'low' }), 0],
  ['fetchPriority="high" подсказку оставляет', h('img', { src: SRC, fetchPriority: 'high' }), 1],
  ['data: вместо адреса', h('img', { src: 'data:image/png;base64,AAAA' }), 0],
  ['внутри <picture>', h('picture', { className: 'contents' }, h('img', { src: SRC, srcSet: SET })), 0],
  ['внутри <picture> через компонент', h('picture', null, h(Wrap, null, h('img', { src: SRC }))), 0],
  ['внутри <noscript>', h('noscript', null, h('img', { src: SRC })), 0],
  ['в обёртке, но не в <picture>', h(Wrap, null, h('img', { src: SRC, srcSet: SET })), 1],
  ['без адреса вовсе', h('img', { alt: '' }), 0],
]

const preloadsOf = (html: string) => html.match(/<link rel="preload" as="image"/g)?.length ?? 0

describe('imageHints — то же правило, что у React', () => {
  for (const [name, tree, want] of CASES) {
    test(name, () => {
      const real = preloadsOf(renderToString(h('div', null, tree)))
      expect(real, 'React сменил правило подсказок — поправь imageHints').toBe(want)
      expect(imageHints(flight(tree, new Map()))).toHaveLength(want)
    })
  }

  test('островок: серверная разметка в его children подсказку даёт', () => {
    function Island({ children }: { children?: ReactNode }) {
      return h('a', null, children)
    }
    const tree = h(Island, null, h('img', { src: SRC, loading: 'eager' }))
    expect(imageHints(flight(tree, new Map([[Island, 'Island']])))).toEqual([SRC])
  })
})
