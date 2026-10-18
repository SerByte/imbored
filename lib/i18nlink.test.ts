import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import Link from '../components/Link'
import { LocaleProvider } from '../components/LocaleProvider'
import type { Locale } from './i18n'

/**
 * Ссылки — только через components/Link.tsx (docs/i18n.md).
 *
 * next/link ставит адрес как есть, и на английской странице ссылка '/play'
 * увела бы человека на русскую. Забытый импорт ничем себя не выдаёт: сборка
 * зелёная, русская версия работает, а английская молча меняет язык на
 * первом же клике. Поэтому сторож — на исходниках, а не на поведении.
 *
 * Значения из next/link (Link, useLinkStatus) берутся из @/components/Link.
 * Типы — можно: `import type { LinkProps } from 'next/link'` ничего не рисует.
 * Тесты тоже можно: они подменяют next/link (vi.mock) и тем проверяют саму
 * ссылку.
 */

const ROOT = path.join(__dirname, '..')
const ALLOWED = new Set(['components/Link.tsx'])

function sources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) sources(rel, out)
    else if (/\.(ts|tsx|mts|js|jsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(rel)
  }
  return out
}

/** Импорты и реэкспорты next/link, кроме чисто типовых */
function valueImportsOfNextLink(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found: string[] = []
  const stmt = /\b(import|export)\s+(type\s+)?([^;'"]*?)\s*from\s*['"]next\/link['"]/g
  for (const m of code.matchAll(stmt)) {
    if (m[2]) continue // import type … / export type …
    const names = m[3].match(/\{([^}]*)\}/)?.[1]
    const onlyTypes =
      names !== undefined &&
      !m[3].replace(/\{[^}]*\}/, '').replace(/[\s,]/g, '') &&
      names
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .every((s) => s.startsWith('type '))
    if (!onlyTypes) found.push(m[0])
  }
  // Голый import 'next/link' и динамический import('next/link')
  for (const m of code.matchAll(/\bimport\s*\(?\s*['"]next\/link['"]/g)) found.push(m[0])
  return found
}

describe('ссылки на языке', () => {
  test('разбор понимает, что такое типовой импорт', () => {
    expect(valueImportsOfNextLink(`import Link from 'next/link'`)).toHaveLength(1)
    expect(valueImportsOfNextLink(`import { useLinkStatus } from "next/link"`)).toHaveLength(1)
    expect(valueImportsOfNextLink(`import Link, { type LinkProps } from 'next/link'`)).toHaveLength(1)
    expect(valueImportsOfNextLink(`export { useLinkStatus } from 'next/link'`)).toHaveLength(1)
    expect(valueImportsOfNextLink(`const L = await import('next/link')`)).toHaveLength(1)
    expect(valueImportsOfNextLink(`import type { LinkProps } from 'next/link'`)).toEqual([])
    expect(valueImportsOfNextLink(`import { type LinkProps } from 'next/link'`)).toEqual([])
    expect(valueImportsOfNextLink(`// import Link from 'next/link'`)).toEqual([])
    expect(valueImportsOfNextLink(`import Link from '@/components/Link'`)).toEqual([])
  })

  test('next/link импортирует только components/Link.tsx', () => {
    const offenders: string[] = []
    let seen = 0
    for (const dir of ['app', 'components', 'lib']) {
      for (const file of sources(dir)) {
        seen++
        if (ALLOWED.has(file)) continue
        const hits = valueImportsOfNextLink(fs.readFileSync(path.join(ROOT, file), 'utf8'))
        if (hits.length) offenders.push(`${file}: ${hits.join('; ')}`)
      }
    }
    expect(seen, 'исходники не найдены — сторож ослеп').toBeGreaterThan(100)
    expect(offenders, 'импортируй Link и useLinkStatus из @/components/Link').toEqual([])
  })

  /**
   * То же для переходов в коде: router.push('/game/730') на /en уводил на
   * русскую карточку — поиск в шапке по Enter, лендинг после входа, «Выйти».
   * useRouter — только через components/useLocaleRouter.ts.
   */
  test('useRouter из next/navigation берёт только components/useLocaleRouter.ts', () => {
    const offenders: string[] = []
    const stmt = /\bimport\s*\{[^}]*\buseRouter\b[^}]*\}\s*from\s*['"]next\/navigation['"]/
    let seen = 0
    for (const dir of ['app', 'components', 'lib']) {
      for (const file of sources(dir)) {
        if (file === 'components/useLocaleRouter.ts') continue
        const code = fs
          .readFileSync(path.join(ROOT, file), 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        if (/\buseLocaleRouter\(\)/.test(code)) seen++
        if (stmt.test(code)) offenders.push(file)
      }
    }
    expect(seen, 'переходы в коде не найдены — сторож ослеп').toBeGreaterThan(10)
    expect(offenders, 'бери useLocaleRouter из @/components/useLocaleRouter').toEqual([])
    const own = fs.readFileSync(path.join(ROOT, 'components', 'useLocaleRouter.ts'), 'utf8')
    expect(own).toMatch(stmt)
    expect(own).toMatch(/push: \(href, options\) => router\.push\(lp\(locale, href\), options\)/)
  })

  test('сама ссылка берёт next/link — иначе исключение выше ничего не значит', () => {
    const src = fs.readFileSync(path.join(ROOT, 'components', 'Link.tsx'), 'utf8')
    expect(valueImportsOfNextLink(src).length).toBeGreaterThan(0)
    expect(src).toMatch(/lp\(locale,/)
  })
})

describe('components/Link', () => {
  const html = (locale: Locale | null, href: Parameters<typeof Link>[0]['href']) => {
    const link = createElement(Link, { href }, 'x')
    return renderToStaticMarkup(locale ? createElement(LocaleProvider, { locale } as ComponentProps<typeof LocaleProvider>, link) : link)
  }

  test('на английском внутренний адрес получает /en', () => {
    expect(html('en', '/play?time=short')).toContain('href="/en/play?time=short"')
    expect(html('en', '/')).toContain('href="/en"')
    expect(html('en', { pathname: '/game/730', query: { from: 'x' } })).toContain('href="/en/game/730?from=x"')
  })

  test('на русском и без провайдера — как было', () => {
    expect(html('ru', '/play')).toContain('href="/play"')
    expect(html(null, '/play')).toContain('href="/play"')
  })

  test('внешнее, /api и уже английское не трогает', () => {
    expect(html('en', 'https://store.steampowered.com/app/620/')).toContain('href="https://store.steampowered.com/app/620/"')
    expect(html('en', '/api/auth/steam')).toContain('href="/api/auth/steam"')
    expect(html('en', '/en/quiz')).toContain('href="/en/quiz"')
  })
})
