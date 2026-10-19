import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { budgetRoute, checkBudget, prerenderedAs, type Budget } from './bundlebudget'

const K = 1024

describe('checkBudget', () => {
  const budget: Budget = { defaultKb: 500, routes: { '/play': 700, '/gone': 600 }, static: ['/'] }

  test('маршрут без своей строки получает общий потолок', () => {
    const v = checkBudget([{ route: '/privacy', firstLoadUncompressedJsBytes: 501 * K }], budget, ['/'])
    expect(v.over).toEqual([{ route: '/privacy', kb: 501, limitKb: 500 }])
  })

  test('своя строка важнее общего потолка', () => {
    const v = checkBudget([{ route: '/play', firstLoadUncompressedJsBytes: 650 * K }], budget, ['/'])
    expect(v.over).toEqual([])
  })

  test('ровно на потолке — в бюджете', () => {
    const v = checkBudget([{ route: '/play', firstLoadUncompressedJsBytes: 700 * K }], budget, ['/'])
    expect(v.over).toEqual([])
  })

  test('строка бюджета без маршрута — устаревшая', () => {
    const v = checkBudget([{ route: '/play', firstLoadUncompressedJsBytes: 1 }], budget, ['/'])
    expect(v.stale).toEqual(['/gone'])
  })

  test('статический маршрут, выпавший из пререндера, — ошибка', () => {
    const v = checkBudget([], budget, ['/about'])
    expect(v.notStatic).toEqual(['/'])
  })

  /**
   * Страницы живут в app/[lang]: Next пишет /[lang]/play, а ключи бюджета —
   * прежние. Без нормализации каждая строка бюджета стала бы «устаревшей», а
   * каждый маршрут получил бы общий потолок.
   */
  test('маршруты под [lang] сверяются с прежними ключами', () => {
    const v = checkBudget(
      [
        { route: '/[lang]/play', firstLoadUncompressedJsBytes: 701 * K },
        { route: '/[lang]', firstLoadUncompressedJsBytes: 10 * K },
        { route: '/[lang]/gone', firstLoadUncompressedJsBytes: 10 * K },
        { route: '/_not-found', firstLoadUncompressedJsBytes: 10 * K },
      ],
      budget,
      ['/ru', '/en'],
    )
    expect(v.over).toEqual([{ route: '/play', kb: 701, limitKb: 700 }])
    expect(v.stale).toEqual([])
    expect(v.rows.map((r) => r.route).sort()).toEqual(['/', '/_not-found', '/gone', '/play'])
  })

  test('главная статична, только если пререндерены оба языка', () => {
    expect(checkBudget([], budget, ['/ru', '/en']).notStatic).toEqual([])
    expect(checkBudget([], budget, ['/ru']).notStatic).toEqual(['/'])
    expect(checkBudget([], budget, ['/en']).notStatic).toEqual(['/'])
    // голый «/» больше не пререндерится вовсе — это не статика
    expect(checkBudget([], budget, ['/']).notStatic).toEqual(['/'])
    expect(checkBudget([], { ...budget, static: ['/privacy'] }, ['/ru/privacy', '/en/privacy']).notStatic).toEqual([])
  })

  test('ключ бюджета и адреса пререндера', () => {
    expect(budgetRoute('/[lang]')).toBe('/')
    expect(budgetRoute('/[lang]/game/[appid]')).toBe('/game/[appid]')
    expect(budgetRoute('/_not-found')).toBe('/_not-found')
    expect(budgetRoute('/[language]')).toBe('/[language]')
    expect(prerenderedAs('/')).toEqual(['/ru', '/en'])
    expect(prerenderedAs('/quiz')).toEqual(['/ru/quiz', '/en/quiz'])
  })
})

// Бюджет в корне репозитория читается как есть: опечатка в JSON валила бы CI
// только после полной сборки, а здесь — за миллисекунды
test('bundle-budget.json разбирается и потолки — положительные числа', () => {
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'bundle-budget.json'), 'utf8')) as Budget
  expect(b.defaultKb).toBeGreaterThan(0)
  for (const [route, limit] of Object.entries(b.routes)) {
    expect(route.startsWith('/'), route).toBe(true)
    expect(limit, route).toBeGreaterThan(0)
  }
  expect(b.static).toContain('/')
})
