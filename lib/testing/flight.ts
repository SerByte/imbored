import { isValidElement, type ReactElement } from 'react'

/**
 * Страница так, как её положит в кэш ISR: серверные компоненты раскрыты до
 * разметки, у клиентских островков — пропсы целиком, вместе с массивами и
 * объектами. Ровно это Next сериализует в HTML и RSC-часть страницы, и ровно
 * от этого зависит, будет ли у перегенерации новая запись (lib/gamecache).
 *
 * Настоящий рендер тут не годится: островкам нужен живой роутер Next, а
 * renderToStaticMarkup не видит пропсов островков вовсе — а в них и ездят
 * лишние байты (веса патчей, пять ссылок арта на капсулу).
 *
 * islands — клиентские компоненты страницы с именами. Островок, которого
 * в списке нет, раскрылся бы вызовом с хуками и уронил тест: список не
 * отстанет от страницы молча.
 *
 * Модуль только для тестов: продукт его не импортирует.
 */
export function flight(node: unknown, islands: ReadonlyMap<unknown, string>): unknown {
  const walk = (n: unknown): unknown => {
    if (Array.isArray(n)) return n.map(walk)
    if (isValidElement(n)) {
      const { type, props, key } = n as ReactElement<Record<string, unknown>>
      const island = islands.get(type)
      if (island) return { island, key, props: walk(props) }
      if (typeof type === 'function') return walk((type as (p: unknown) => unknown)(props))
      // Фрагмент и ViewTransition — символы, forwardRef и memo — объекты
      const t: unknown = type
      const tag = typeof t === 'string' ? t : typeof t === 'symbol' ? String(t.description) : 'special'
      return { tag, key, props: walk(props) }
    }
    if (n !== null && typeof n === 'object') {
      return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, walk(v)]))
    }
    return n
  }
  return walk(node)
}

/** Видимый текст раскрытой страницы: строки и числа из children подряд */
export function textOf(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) {
    return textOf((node as { props: { children?: unknown } }).props.children)
  }
  return ''
}

/** Все островки раскрытой страницы с их пропсами — по имени */
export function islandsOf(node: unknown, name?: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = []
  const walk = (n: unknown): void => {
    if (Array.isArray(n)) return n.forEach(walk)
    if (n === null || typeof n !== 'object') return
    const rec = n as { island?: string; props?: Record<string, unknown> }
    if (rec.island && (!name || rec.island === name)) out.push({ island: rec.island, ...rec.props })
    Object.values(n).forEach(walk)
  }
  walk(node)
  return out
}
