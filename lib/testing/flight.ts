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

/**
 * Картинки, которые Flight превратит в подсказку предзагрузки
 * (`:HL[…,"image"]` в RSC-части страницы), — по src, а без него по srcSet.
 *
 * Подсказка едет и с ПРЕФЕТЧЕМ страницы, и браузер исполняет её на той
 * странице, где стоит ссылка: префетч /games из шапки качал обложки хаба
 * на /support, на каждой карточке игры и на каждом патче. Поэтому
 * страница, на которую ведут ссылки с чужих страниц, обязана отдавать
 * подсказку только той картинке, что действительно нужна ей самой, —
 * а лучше никакой.
 *
 * Условие — то же, что у React (getChildFormatContext, case "img", в
 * react-server-dom-turbopack-server): подсказки нет у loading="lazy", у
 * fetchPriority="low", у src/srcSet вида data: и у картинки внутри
 * <picture> или <noscript>. Островки обходятся тоже: их собственный вывод
 * Flight не рендерит, а вот серверная разметка, переданная им в children
 * (капсула внутри <Link>), идёт через тот же рендер — и подсказку даёт.
 * Совпадение с настоящим React держит lib/testing/flight.test.ts.
 */
export function imageHints(tree: unknown): string[] {
  const out: string[] = []
  const isData = (v: unknown) => typeof v === 'string' && /^data:/i.test(v)
  const walk = (n: unknown, scoped: boolean): void => {
    if (Array.isArray(n)) return n.forEach((x) => walk(x, scoped))
    if (n === null || typeof n !== 'object') return
    const rec = n as { tag?: unknown; props?: Record<string, unknown> }
    if (typeof rec.tag === 'string' && rec.props) {
      const p = rec.props
      const src = p.src
      const srcSet = p.srcSet
      if (
        rec.tag === 'img' &&
        !scoped &&
        p.loading !== 'lazy' &&
        p.fetchPriority !== 'low' &&
        Boolean(src || srcSet) &&
        (src == null || typeof src === 'string') &&
        (srcSet == null || typeof srcSet === 'string') &&
        !isData(src) &&
        !isData(srcSet)
      ) {
        out.push(String(src ?? srcSet))
      }
      walk(p, scoped || rec.tag === 'picture' || rec.tag === 'noscript')
      return
    }
    Object.values(n).forEach((v) => walk(v, scoped))
  }
  walk(tree, false)
  return out
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

/**
 * className первого элемента с этим тегом в раскрытой странице, обходом в
 * порядке разметки; undefined — такого тега нет. Для h1 героя и подобных
 * единичных элементов, чей класс и есть проверяемое поведение.
 */
export function classOfTag(node: unknown, tag: string): string | undefined {
  let cls: string | undefined
  const walk = (n: unknown): void => {
    if (cls !== undefined || n === null || typeof n !== 'object') return
    const rec = n as { tag?: string; props?: { className?: unknown } }
    if (rec.tag === tag) {
      cls = String(rec.props?.className ?? '')
      return
    }
    Object.values(n).forEach(walk)
  }
  walk(node)
  return cls
}
