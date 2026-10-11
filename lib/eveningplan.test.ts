import { describe, expect, test } from 'vitest'
import { CTX_INTENTS } from './feedbackctx'
import { PLAN_INTENTS, PLAN_INTENTS_SQL, parseEveningPlan, planLine } from './eveningplan'

describe('план на вечер', () => {
  test('годный план — как есть', () => {
    const ok = { appid: 1145360, name: 'Hades', intent: 'tonight' }
    expect(parseEveningPlan(ok)).toEqual(ok)
    expect(parseEveningPlan({ ...ok, intent: 'install', extra: 1 })).toEqual({ ...ok, intent: 'install' })
  })

  test('мусор — не план', () => {
    const ok = { appid: 1145360, name: 'Hades', intent: 'install' }
    for (const raw of [
      null,
      'Hades',
      { ...ok, appid: 0 },
      // минус — кураторский пул других магазинов: steam:// к ним не относится
      { ...ok, appid: -3 },
      { ...ok, appid: 1.5 },
      { ...ok, name: '   ' },
      { ...ok, intent: 'details' },
      { ...ok, intent: undefined },
    ]) {
      expect(parseEveningPlan(raw), JSON.stringify(raw)).toBeNull()
    }
  })

  test('строка говорит словами того нажатия, которым план поставлен', () => {
    expect(planLine({ name: 'Hades', intent: 'install' })).toBe('Ставил «Hades» на загрузку')
    expect(planLine({ name: 'Hades', intent: 'tonight' })).toBe('Отложил «Hades» на вечер')
  })

  // Белый список снимка (lib/feedbackctx) обязан пускать каждый план: иначе
  // роут молча выбросил бы intent, и нажатие легло бы обычным «открыл»
  test('каждый intent плана есть в белом списке снимка, а SQL-список — тот же', () => {
    for (const i of PLAN_INTENTS) expect(CTX_INTENTS).toContain(i)
    expect(PLAN_INTENTS_SQL).toBe("'install', 'tonight'")
  })
})
