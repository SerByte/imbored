import { afterEach, describe, expect, test, vi } from 'vitest'
import { forgetPlanned, PLAY_DEAL_KEY } from './planforget'

/**
 * План закрыт не на /play — запись выдачи на устройстве больше не держит
 * игру отложенной. Модуля выдачи (lib/playcache) этот файл не грузит
 * нарочно: страница игры, /library и /daily его не везут, и правка обязана
 * работать без него — по ключу в sessionStorage. Как её видит /play после
 * «Назад», проверяет lib/playcache.test.ts.
 */

function fakeStorage(seed: Record<string, string> = {}) {
  const data: Record<string, string> = { ...seed }
  const area = {
    getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
    setItem: vi.fn((k: string, v: string) => {
      data[k] = v
    }),
    removeItem: (k: string) => {
      delete data[k]
    },
  }
  return { data, area }
}

/** Запись как её пишет /play — разбирать её здесь незачем, важны поля вокруг списка */
const RECORD = { v: 2, key: 'medium.chill.solo||||', viewer: '76561197960287930', at: 1, hero: 20, liked: [10], planned: [20, 30] }

describe('forgetPlanned', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('вычёркивает игру из отложенных, остальное в записи не трогает', () => {
    const s = fakeStorage({ [PLAY_DEAL_KEY]: JSON.stringify(RECORD), other: '1' })
    vi.stubGlobal('sessionStorage', s.area)

    forgetPlanned(20)

    expect(JSON.parse(s.data[PLAY_DEAL_KEY])).toEqual({ ...RECORD, planned: [30] })
    expect(s.data.other).toBe('1')
  })

  /*
   * Строка плана над «Продолжить» — тот же закрытый план: /play убирает её
   * сам, едва закрытие записано, и после «Назад» она не звала бы запустить
   * то, что уже запустили. Даже когда игра отложена не на /play и в списке
   * её нет. План другой игры остаётся.
   */
  test('строку плана закрытой игры запись тоже забывает, чужую — нет', () => {
    const deal = { picks: [{ appid: 10 }], plan: { appid: 1145360, name: 'Hades', intent: 'install' } }
    const s = fakeStorage({ [PLAY_DEAL_KEY]: JSON.stringify({ ...RECORD, deal }) })
    vi.stubGlobal('sessionStorage', s.area)

    forgetPlanned(30)
    expect(JSON.parse(s.data[PLAY_DEAL_KEY])).toEqual({ ...RECORD, planned: [20], deal })

    forgetPlanned(1145360)
    expect(JSON.parse(s.data[PLAY_DEAL_KEY])).toEqual({ ...RECORD, planned: [20], deal: { ...deal, plan: null } })
  })

  /*
   * Запуск со страницы игры пишется по биту plan у любой игры с живым планом
   * — и у той, что отложена не на /play («Игра дня», вчерашний вечер). Её нет
   * ни в списке, ни строкой плана, и хранилище будить незачем.
   */
  test('нет записи, нет в ней игры — хранилище не пишется', () => {
    const empty = fakeStorage()
    vi.stubGlobal('sessionStorage', empty.area)
    forgetPlanned(20)
    expect(empty.area.setItem).not.toHaveBeenCalled()
    expect(empty.data).toEqual({})

    const other = fakeStorage({ [PLAY_DEAL_KEY]: JSON.stringify({ ...RECORD, deal: { plan: null } }) })
    vi.stubGlobal('sessionStorage', other.area)
    forgetPlanned(1145360)
    expect(other.area.setItem).not.toHaveBeenCalled()
  })

  test('чужая запись остаётся как есть: её не узнает и /play', () => {
    for (const raw of ['{', 'null', '"planned"', JSON.stringify({ ...RECORD, planned: 'all' }), JSON.stringify([20])]) {
      const s = fakeStorage({ [PLAY_DEAL_KEY]: raw })
      vi.stubGlobal('sessionStorage', s.area)
      expect(() => forgetPlanned(20)).not.toThrow()
      expect(s.data[PLAY_DEAL_KEY], raw).toBe(raw)
    }
  })

  test('хранилище бросает (приватный режим) — не бросает и она', () => {
    vi.stubGlobal('sessionStorage', {
      getItem: () => {
        throw new Error('SecurityError')
      },
    })
    expect(() => forgetPlanned(20)).not.toThrow()
    // и там, где хранилища нет вовсе
    vi.stubGlobal('sessionStorage', undefined)
    expect(() => forgetPlanned(20)).not.toThrow()
  })
})
