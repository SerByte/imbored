import { afterEach, describe, expect, test, vi } from 'vitest'
import { createDb, type Db } from './db'
import { llmBudgetLeft, llmBudgetUsed, llmDailyCap, LLM_DAILY_CAP_DEFAULT, takeLlmBudget } from './llmcap'

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
