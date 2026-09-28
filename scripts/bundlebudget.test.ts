import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { checkBudget, type Budget } from './bundlebudget'

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
