import { describe, expect, test } from 'vitest'
import { nextPollStep, STALE_AFTER_FAILS } from './roompoll'

/**
 * Сторож решения опроса комнаты.
 *
 * Проверяется одна вещь, стоившая живой комнаты: ЧТО ИМЕННО останавливает
 * опрос. Пятисотка не останавливает — иначе комната застывает на последнем
 * снимке и молча врёт. Замерено до починки: ноль запросов за шестнадцать
 * секунд после единственного отказа.
 */
describe('решение опроса комнаты', () => {
  test('пятисотка НЕ останавливает опрос', () => {
    const step = nextPollStep({ ok: false, gone: false }, 0)
    expect(step.stop, 'временный отказ остановил опрос — комната застынет навсегда').toBe(false)
    expect(step.slow, 'после отказа следующий тик обязан быть реже').toBe(true)
  })

  test('только 404 терминален среди отказов', () => {
    expect(nextPollStep({ ok: false, gone: true }, 0).stop).toBe(true)
    expect(nextPollStep({ ok: false, gone: false }, 7).stop).toBe(false)
  })

  test('матч терминален, обычное состояние — нет', () => {
    expect(nextPollStep({ ok: true, status: 'matched' }, 0).stop).toBe(true)
    expect(nextPollStep({ ok: true, status: 'voting' }, 0).stop).toBe(false)
  })

  test('признак устаревания зажигается со второго отказа, а не с первого', () => {
    expect(STALE_AFTER_FAILS).toBe(2)
    expect(nextPollStep({ ok: false, gone: false }, 0).stale, 'первый промах — обычная жизнь сети').toBe(
      false,
    )
    expect(nextPollStep({ ok: false, gone: false }, 1).stale).toBe(true)
  })

  test('успех гасит признак и обнуляет счёт отказов', () => {
    const step = nextPollStep({ ok: true, status: 'voting' }, 9)
    expect(step.stale, 'связь вернулась, а плашка осталась бы висеть').toBe(false)
    expect(step.fails).toBe(0)
    expect(step.slow, 'сервер отвечает — темп возвращается к обычному').toBe(false)
  })

  /**
   * Терминальный исход обязан ГАСИТЬ признак: иначе на экране «такой комнаты
   * нет» под ним висела бы плашка «пробую снова», обещающая то, чего уже не
   * будет.
   */
  test('терминальные исходы не оставляют обещания повтора', () => {
    expect(nextPollStep({ ok: false, gone: true }, 5).stale).toBe(false)
    expect(nextPollStep({ ok: true, status: 'matched' }, 5).stale).toBe(false)
  })
})
