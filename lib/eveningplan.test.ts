import { describe, expect, test } from 'vitest'
import { CTX_INTENTS } from './feedbackctx'
import { PLAN_INTENTS, PLAN_INTENTS_SQL, closesPlan, parseEveningPlan, planBeside, planLine } from './eveningplan'

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

  /*
   * «Открыть в Steam» у своей на телефоне — 'launched' с intent 'store':
   * страница магазина, а не игра. Жмут его как раз после «Сыграю вечером на
   * ПК» — поставить на загрузку из приложения Steam, — и план, закрытый этим
   * касанием, обманул бы обещание «вечером будет ждать». С базой правило
   * сверяет lib/db.test.ts.
   */
  test('план закрывают запуск, бан и пропуск; магазин под пальцем и бросок рулетки — нет', () => {
    expect(closesPlan('launched')).toBe(true)
    expect(closesPlan('launched', null, 'launch')).toBe(true)
    expect(closesPlan('launched', null, 'store')).toBe(false)
    expect(closesPlan('banned')).toBe(true)
    expect(closesPlan('skipped')).toBe(true)
    expect(closesPlan('skipped', 'notnow')).toBe(true)
    expect(closesPlan('skipped', 'spin')).toBe(false)
    expect(closesPlan('liked')).toBe(false)
    expect(closesPlan('opened', null, 'details')).toBe(false)
  })

  /*
   * Поставленную на загрузку запускают из клиента Steam, мимо нас: план
   * стоит, а наигранное за две недели делает её «Продолжить». Две строки об
   * одной игре подряд — сбой на вид (то же правило, что у pickContinue).
   */
  test('строки плана нет, когда его игра уже на экране — героем или «Продолжить»', () => {
    const plan = { appid: 1145360, name: 'Hades', intent: 'install' } as const
    expect(planBeside(plan, [620, 570])).toBe(plan)
    expect(planBeside(plan, [620, undefined])).toBe(plan)
    expect(planBeside(plan, [1145360, 570])).toBeNull()
    expect(planBeside(plan, [620, 1145360])).toBeNull()
    expect(planBeside(null, [620])).toBeNull()
  })

  // Белый список снимка (lib/feedbackctx) обязан пускать каждый план: иначе
  // роут молча выбросил бы intent, и нажатие легло бы обычным «открыл»
  test('каждый intent плана есть в белом списке снимка, а SQL-список — тот же', () => {
    for (const i of PLAN_INTENTS) expect(CTX_INTENTS).toContain(i)
    expect(PLAN_INTENTS_SQL).toBe("'install', 'tonight'")
  })
})
