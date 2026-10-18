import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createDb, type Db } from './db'
import {
  llmBudgetLeft,
  llmBudgetUsed,
  llmDailyCap,
  llmIpDailyLimit,
  LLM_DAILY_CAP_DEFAULT,
  LLM_IP_MIN,
  LLM_IP_SHARE,
  takeLlmBudget,
  takeLlmBudgetForIp,
} from './llmcap'
import { resetRateMemory } from './ratelimit'

const T0 = 1_760_000_000

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('llmDailyCap', () => {
  test('не задан, пуст или мусор — значение по умолчанию', () => {
    expect(llmDailyCap({})).toBe(LLM_DAILY_CAP_DEFAULT)
    // .env.example держит переменные пустыми: '' не должно молча выключать модель
    expect(llmDailyCap({ LLM_DAILY_CAP: '' })).toBe(LLM_DAILY_CAP_DEFAULT)
    expect(llmDailyCap({ LLM_DAILY_CAP: '  ' })).toBe(LLM_DAILY_CAP_DEFAULT)
    expect(llmDailyCap({ LLM_DAILY_CAP: 'много' })).toBe(LLM_DAILY_CAP_DEFAULT)
    expect(llmDailyCap({ LLM_DAILY_CAP: '-5' })).toBe(LLM_DAILY_CAP_DEFAULT)
  })

  test('число — как есть, дробь — вниз, ноль — модель выключена', () => {
    expect(llmDailyCap({ LLM_DAILY_CAP: '300' })).toBe(300)
    expect(llmDailyCap({ LLM_DAILY_CAP: '2.9' })).toBe(2)
    expect(llmDailyCap({ LLM_DAILY_CAP: '0' })).toBe(0)
  })
})

describe('takeLlmBudget', () => {
  test('пускает ровно cap вызовов за сутки, дальше — нет', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '3')
    const db = await createDb(':memory:')
    const got = []
    for (let i = 0; i < 5; i++) got.push(await takeLlmBudget(db, T0 + i))
    expect(got).toEqual([true, true, true, false, false])
    expect(await llmBudgetUsed(db, T0)).toBe(5)
    expect(await llmBudgetLeft(db, T0)).toBe(false)
  })

  test('новые сутки UTC — новый бюджет', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '1')
    const db = await createDb(':memory:')
    const day = Math.floor(T0 / 86_400) * 86_400
    expect(await takeLlmBudget(db, day + 10)).toBe(true)
    expect(await takeLlmBudget(db, day + 86_399)).toBe(false)
    expect(await takeLlmBudget(db, day + 86_400)).toBe(true)
  })

  test('ноль — не зовём и в базу не пишем', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '0')
    const db = await createDb(':memory:')
    expect(await takeLlmBudget(db, T0)).toBe(false)
    expect(await llmBudgetUsed(db, T0)).toBe(0)
    expect(await llmBudgetLeft(db, T0)).toBe(false)
  })

  // Потолки на человека пропускают при сбое базы, общий бюджет — нет: сбой
  // учёта и есть момент, когда расход не видно, а эвристика отвечает и так
  test('недоступный учёт — закрыто', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { execute: () => Promise.reject(new Error('turso down')) } as unknown as Db
    expect(await takeLlmBudget(broken, T0)).toBe(false)
    expect(await llmBudgetUsed(broken, T0)).toBeNull()
    expect(await llmBudgetLeft(broken, T0)).toBe(false)
    expect(warn).toHaveBeenCalled()
  })

  test('ключ счётчика без SteamID — forgetUser забывать нечего', async () => {
    const db = await createDb(':memory:')
    await takeLlmBudget(db, T0)
    const keys = (await db.execute('SELECT key FROM rate_limits')).rows.map((r) => String(r.key))
    expect(keys).toHaveLength(1)
    expect(keys[0]).toMatch(/^llm-daily:all:\d+$/)
  })
})

/*
 * Доля одного адреса в суточном бюджете. Без неё один скрипт с одного адреса
 * выбирал весь LLM_DAILY_CAP, и модель до полуночи UTC молчала для всех.
 */
describe('llmIpDailyLimit', () => {
  test('пять процентов бюджета, вверх, но не меньше десяти', () => {
    expect(llmIpDailyLimit({})).toBe(Math.ceil(LLM_DAILY_CAP_DEFAULT * LLM_IP_SHARE))
    expect(llmIpDailyLimit({ LLM_DAILY_CAP: '1010' })).toBe(51)
    expect(llmIpDailyLimit({ LLM_DAILY_CAP: '150' })).toBe(LLM_IP_MIN)
    expect(llmIpDailyLimit({ LLM_DAILY_CAP: '0' })).toBe(LLM_IP_MIN)
  })
})

describe('takeLlmBudgetForIp', () => {
  beforeEach(() => {
    resetRateMemory()
  })

  test('адрес выбрал долю — нет, соседний — да; отказ общий бюджет не тратит', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '100')
    const db = await createDb(':memory:')
    const share = llmIpDailyLimit()
    for (let i = 0; i < share; i++) expect(await takeLlmBudgetForIp(db, '198.51.100.1', T0 + i)).toBe(true)
    expect(await takeLlmBudgetForIp(db, '198.51.100.1', T0 + share)).toBe(false)
    expect(await takeLlmBudgetForIp(db, '198.51.100.2', T0 + share)).toBe(true)
    expect(await llmBudgetUsed(db, T0)).toBe(share + 1)
  })

  test('доля — на сутки UTC, как и общий бюджет', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '100')
    const db = await createDb(':memory:')
    const day = Math.floor(T0 / 86_400) * 86_400
    for (let i = 0; i < llmIpDailyLimit(); i++) await takeLlmBudgetForIp(db, '198.51.100.1', day + 10)
    expect(await takeLlmBudgetForIp(db, '198.51.100.1', day + 86_399)).toBe(false)
    expect(await takeLlmBudgetForIp(db, '198.51.100.1', day + 86_400)).toBe(true)
  })

  test('общий бюджет выбран — нет, хотя доля адреса цела', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '1')
    const db = await createDb(':memory:')
    expect(await takeLlmBudgetForIp(db, '198.51.100.1', T0)).toBe(true)
    expect(await takeLlmBudgetForIp(db, '198.51.100.2', T0)).toBe(false)
  })

  test('модель выключена нулём — ни доли, ни бюджета: в базу не пишем', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '0')
    const db = await createDb(':memory:')
    expect(await takeLlmBudgetForIp(db, '198.51.100.1', T0)).toBe(false)
    expect((await db.execute('SELECT COUNT(*) AS n FROM rate_limits')).rows[0].n).toBe(0)
  })

  // /privacy обещает: счётчик по адресу стирается не позже чем через двое
  // суток. Строка доли живёт до конца своих суток UTC, а не «двое суток от
  // первой записи», — иначе с суточной уборкой выходило до трёх
  test('адрес в доле лежит до конца суток UTC, когда бы ни пришёл первый вызов', async () => {
    vi.stubEnv('LLM_DAILY_CAP', '100')
    const db = await createDb(':memory:')
    const day = Math.floor(T0 / 86_400) * 86_400
    await takeLlmBudgetForIp(db, '198.51.100.1', day + 1)
    const res = await db.execute("SELECT expires_at FROM rate_limits WHERE key LIKE 'llm-ip:%'")
    expect(res.rows.map((r) => Number(r.expires_at))).toEqual([day + 86_400])
  })

  // Доля открыта при сбое учёта (checkRate), бюджет закрыт — и в сумме «нет»
  test('недоступный учёт — закрыто', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = { execute: () => Promise.reject(new Error('turso down')) } as unknown as Db
    expect(await takeLlmBudgetForIp(broken, '198.51.100.1', T0)).toBe(false)
  })
})

/**
 * Сторож дверей. Посетитель доходит до модели через подбор и портрет, и обе
 * двери обязаны брать бюджет через долю адреса: прямой takeLlmBudget из
 * запроса — ровно та дыра, которой скрипт с одного адреса выбирал сутки за
 * всех. Напрямую берут только кроны (app/api/cron, lib/newsjob, lib/pagejob):
 * адреса у них нет, а свои потолки звеньев есть.
 */
describe('takeLlmBudget из запроса', () => {
  const ROOT = path.join(__dirname, '..')
  const direct: string[] = []
  const viaIp: string[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`
      if (e.isDirectory()) {
        if (rel !== 'app/api/cron') walk(rel)
      } else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
        if (/\btakeLlmBudget\(/.test(src)) direct.push(rel)
        if (/\btakeLlmBudgetForIp\(/.test(src)) viaIp.push(rel)
      }
    }
  }
  walk('app')

  test('подбор и портрет — через долю адреса, напрямую — никто', () => {
    expect(viaIp, 'двери к модели не найдены — сторож ослеп').toEqual(
      expect.arrayContaining(['app/api/recommend/route.ts', 'app/[lang]/portrait/[steamid]/page.tsx']),
    )
    expect(direct, 'запрос берёт общий бюджет мимо доли адреса').toEqual([])
  })
})
