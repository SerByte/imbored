import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { DYNAMIC_SECTIONS, navPrefetch } from './nav'

/**
 * Сторож префетча навигации.
 *
 * Шапка, нижняя панель и подвал стоят на каждой странице, и любая их ссылка на
 * динамический раздел без prefetch={false} будит функцию этого раздела на
 * каждом просмотре любой страницы (почему это дорого — lib/nav,
 * DYNAMIC_SECTIONS).
 *
 * Ломается двумя путями, и оба молчат: раздел становится динамическим, а в
 * список его не вписали, — или в навигацию добавляют новую ссылку без
 * prefetch. Первое ловится сверкой списка со страницами, второе — разбором
 * ссылок в файлах навигации.
 */

const ROOT = path.join(__dirname, '..')

/** Файлы, чья разметка стоит на каждой странице сайта. */
const CHROME = [
  'app/layout.tsx',
  'components/HeaderNav.tsx',
  'components/MobileNav.tsx',
  'components/Footer.tsx',
]

/**
 * Полка разделов главной (сцена «Что здесь ещё есть») — не обвязка, но
 * главная — самая посещаемая страница сайта, и четыре из шести её карточек
 * ведут в динамические разделы. Сторож смотрел только на обвязку, и полка
 * будила /compat, /library, /portrait и /whatsnew у каждого, кто докрутил до
 * пятой сцены, — гостю ради редиректов, по которым он не пойдёт.
 */
const HIGH_TRAFFIC = ['components/landing/scenes/Repertoire.tsx']

/**
 * Страницы в ISR, куда приходят из поиска и по ссылкам, — пять тысяч
 * карточек игр, патчи, хаб и жанры. Не обвязка, но каждая из них — чья-то
 * первая страница, и ссылка на динамический раздел без prefetch={false}
 * будит его функцию на каждом таком заходе. Так было у моста «Что нового»
 * внизу патча: ~530 патчей в индексе, и каждый докрученный до низа звал
 * /whatsnew (MISS и private, no-store на проде).
 *
 * Проверяются только буквальные адреса: вычисляемые здесь — это сами
 * карточки игр и патчей (gameHref, newsPath), статические страницы, которым
 * префетч ничего не стоит.
 */
const ISR_PAGES = [
  'app/game/[appid]/page.tsx',
  'app/game/[appid]/news/[gid]/page.tsx',
  'app/games/page.tsx',
  'app/games/[tag]/page.tsx',
]

/** Код без комментариев: объяснение правки не должно попадать под проверку. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\}/g, '').replace(/^\s*\/\/[^\n]*/gm, '')
}

/** Разделы верхнего уровня, чья страница объявлена force-dynamic. */
function forceDynamicSections(): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(path.join(ROOT, 'app'), { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('(') || e.name.startsWith('[')) continue
    const page = path.join(ROOT, 'app', e.name, 'page.tsx')
    if (!fs.existsSync(page)) continue
    if (/export const dynamic = ['"]force-dynamic['"]/.test(code(fs.readFileSync(page, 'utf8')))) {
      out.push(`/${e.name}`)
    }
  }
  return out.sort()
}

describe('navPrefetch', () => {
  test('динамический раздел — без префетча, статический — по умолчанию Next', () => {
    expect(navPrefetch('/library')).toBe(false)
    expect(navPrefetch('/whatsnew')).toBe(false)
    expect(navPrefetch('/daily')).toBeUndefined()
    expect(navPrefetch('/rooms')).toBeUndefined()
    expect(navPrefetch('/')).toBeUndefined()
  })

  test('хвост адреса раздел не меняет, соседний префикс своим не считается', () => {
    expect(navPrefetch('/library?state=untouched')).toBe(false)
    expect(navPrefetch('/compat/76561198000000000')).toBe(false)
    expect(navPrefetch('/portrait#top')).toBe(false)
    expect(navPrefetch('/libraryx')).toBeUndefined()
  })
})

describe('навигация не будит динамические разделы', () => {
  test('список динамических разделов совпадает со страницами', () => {
    expect(
      [...DYNAMIC_SECTIONS].sort(),
      'раздел стал динамическим (или перестал) — поправь DYNAMIC_SECTIONS в lib/nav.ts',
    ).toEqual(forceDynamicSections())
  })

  test('у каждой ссылки навигации на динамический раздел выключен префетч', () => {
    const offenders: string[] = []
    let links = 0
    for (const file of [...CHROME, ...HIGH_TRAFFIC]) {
      const src = code(fs.readFileSync(path.join(ROOT, file), 'utf8'))
      // Тег целиком: [^>] тянется через переводы строк, а стрелок в атрибутах
      // ссылок навигации нет
      for (const m of src.matchAll(/<Link\b([^>]*)>/g)) {
        links++
        const attrs = m[1]
        const literal = attrs.match(/\bhref="([^"]+)"/)?.[1]
        const hasPrefetch = /\bprefetch=/.test(attrs)
        if (literal !== undefined) {
          if (navPrefetch(literal) === false && !hasPrefetch) offenders.push(`${file}: ${literal}`)
        } else if (!/\bprefetch=\{navPrefetch\(/.test(attrs)) {
          // Адрес вычисляется — значит, решать за него обязан navPrefetch
          offenders.push(`${file}: <Link${attrs.slice(0, 60)}…>`)
        }
      }
    }
    expect(links, 'разбор не нашёл ни одной ссылки — сторож ослеп').toBeGreaterThan(4)
    expect(
      offenders,
      'ссылка навигации на динамический раздел префетчится — поставь prefetch={navPrefetch(href)}',
    ).toEqual([])
  })

  test('страницы в ISR не префетчат динамические разделы буквальными ссылками', () => {
    const offenders: string[] = []
    let literals = 0
    for (const file of ISR_PAGES) {
      const src = code(fs.readFileSync(path.join(ROOT, file), 'utf8'))
      expect(src, `${file}: страница перестала быть ISR — поправь список`).toMatch(/export const revalidate = /)
      for (const m of src.matchAll(/<Link\b([^>]*)>/g)) {
        const literal = m[1].match(/\bhref="([^"]+)"/)?.[1]
        if (literal === undefined) continue
        literals++
        if (navPrefetch(literal) === false && !/\bprefetch=/.test(m[1])) offenders.push(`${file}: ${literal}`)
      }
    }
    expect(literals, 'разбор не нашёл ни одной буквальной ссылки — сторож ослеп').toBeGreaterThan(3)
    expect(offenders, 'ссылка со страницы в ISR будит динамический раздел — поставь prefetch={navPrefetch(href)}').toEqual([])
  })
})
