import { afterEach, describe, expect, test, vi } from 'vitest'
import { createDb } from './db'
import {
  enBackfillDailyCap,
  enBackfillLeft,
  LLM_EN_BACKFILL_DAILY_DEFAULT,
  takeEnBackfillBudget,
} from './enbackfill'
import { llmBudgetUsed } from './llmcap'

const NOW = 1_700_000_000

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('доля английского догона', () => {
  test('переменная читается по правилам LLM_DAILY_CAP', () => {
    expect(enBackfillDailyCap({})).toBe(LLM_EN_BACKFILL_DAILY_DEFAULT)
    expect(enBackfillDailyCap({ LLM_EN_BACKFILL_DAILY: '' })).toBe(400)
    expect(enBackfillDailyCap({ LLM_EN_BACKFILL_DAILY: 'много' })).toBe(400)
    expect(enBackfillDailyCap({ LLM_EN_BACKFILL_DAILY: '-5' })).toBe(400)
    expect(enBackfillDailyCap({ LLM_EN_BACKFILL_DAILY: '0' })).toBe(0)
    expect(enBackfillDailyCap({ LLM_EN_BACKFILL_DAILY: ' 25.9 ' })).toBe(25)
  })

  test('доля берётся перед общим бюджетом и тратит его только при согласии', async () => {
    const db = await createDb(':memory:')
    vi.stubEnv('LLM_EN_BACKFILL_DAILY', '2')
    expect(await takeEnBackfillBudget(db, NOW)).toBe('ok')
    expect(await takeEnBackfillBudget(db, NOW)).toBe('ok')
    expect(await enBackfillLeft(db, NOW)).toBe(false)
    // третий — отказ доли, и общий бюджет он не тратит
    expect(await takeEnBackfillBudget(db, NOW)).toBe('share')
    expect(await llmBudgetUsed(db, NOW)).toBe(2)
    // назавтра доля новая
    expect(await enBackfillLeft(db, NOW + 86_400)).toBe(true)
  })

  test('выбран общий бюджет — это capped, как у остальных дверей', async () => {
    const db = await createDb(':memory:')
    vi.stubEnv('LLM_DAILY_CAP', '1')
    expect(await takeEnBackfillBudget(db, NOW)).toBe('ok')
    expect(await takeEnBackfillBudget(db, NOW)).toBe('capped')
    expect(await enBackfillLeft(db, NOW)).toBe(false)
  })

  test('ноль — догон выключен, учёт не трогается', async () => {
    const db = await createDb(':memory:')
    vi.stubEnv('LLM_EN_BACKFILL_DAILY', '0')
    expect(await takeEnBackfillBudget(db, NOW)).toBe('share')
    expect(await enBackfillLeft(db, NOW)).toBe(false)
    expect(await llmBudgetUsed(db, NOW)).toBe(0)
  })

  test('сбой учёта — закрыто, без исключения', async () => {
    const db = await createDb(':memory:')
    await db.execute('DROP TABLE rate_limits')
    expect(await takeEnBackfillBudget(db, NOW)).toBe('share')
    expect(await enBackfillLeft(db, NOW)).toBe(false)
  })
})
