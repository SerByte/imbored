import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import { readJsonObject } from './reqbody'

const req = (body: string) => new Request('http://x/api', { method: 'POST', body, headers: { 'content-type': 'application/json' } })

describe('readJsonObject', () => {
  test('простой объект проходит как есть', async () => {
    expect(await readJsonObject(req('{"appid":620}'))).toEqual({ appid: 620 })
  })

  test('null, массив, примитив и битый JSON — пустой объект', async () => {
    for (const raw of ['null', '[]', '[1]', '7', '"строка"', 'true', '{нет', '']) {
      expect(await readJsonObject(req(raw)), raw).toEqual({})
    }
  })
})

/**
 * Сторож: тело POST в app/api разбирается только через readJsonObject.
 * Прежняя идиома с .catch(() => ({})) пропускала `null` и роняла роут в 500.
 */
describe('роуты app/api', () => {
  const ROOT = path.join(__dirname, '..', 'app', 'api')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name === 'route.ts') files.push(p)
    }
  }
  walk(ROOT)

  test('сторож видит роуты', () => {
    expect(files.length).toBeGreaterThan(10)
  })

  test('никто не зовёт req.json() напрямую', () => {
    const offenders = files.filter((f) => /\b(req|request)\.json\(/.test(readFileSync(f, 'utf8')))
    expect(offenders.map((f) => path.relative(ROOT, f))).toEqual([])
  })
})
