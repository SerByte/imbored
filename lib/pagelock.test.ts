import { afterEach, describe, expect, test } from 'vitest'
import { backdropOf, holdScroll, makeInert, registerScrollPauser, resetPageLock } from './pagelock'

afterEach(() => resetPageLock())

/** Прямой потомок <body>: содержит окно или нет, инертен или нет. */
function node(tagName: string, opts: { inert?: boolean; hasDialog?: boolean } = {}) {
  return {
    tagName,
    inert: opts.inert ?? false,
    contains: (other: unknown) => opts.hasDialog === true && other === DIALOG,
  }
}
const DIALOG = { dialog: true }

describe('фон модального окна', () => {
  test('инертным становится всё рядом с окном, кроме самого окна', () => {
    const wrapper = node('DIV')
    const header = node('HEADER')
    const nav = node('NAV')
    const skip = node('A')
    const overlay = node('DIV', { hasDialog: true })
    const bg = backdropOf([skip, header, wrapper, nav, overlay], DIALOG)
    expect(bg).toEqual([skip, header, wrapper, nav])
  })

  test('служебные узлы без содержимого не трогаются', () => {
    const bg = backdropOf([node('SCRIPT'), node('STYLE'), node('TEMPLATE'), node('NOSCRIPT'), node('DIV')], DIALOG)
    expect(bg.map((n) => n.tagName)).toEqual(['DIV'])
  })

  /**
   * Чужая инертность — не наша: снимать её при закрытии нельзя, иначе окно
   * «разморозило» бы то, что было заморожено до него.
   */
  test('уже инертный узел не берётся — и не размораживается при закрытии', () => {
    const frozen = node('DIV', { inert: true })
    const live = node('DIV')
    const release = makeInert(backdropOf([frozen, live], DIALOG))
    expect(live.inert).toBe(true)
    release()
    expect(live.inert).toBe(false)
    expect(frozen.inert).toBe(true)
  })

  test('снятие одноразовое', () => {
    const a = node('DIV')
    const release = makeInert([a])
    release()
    a.inert = true // кто-то другой заморозил после нас
    release()
    expect(a.inert).toBe(true)
  })
})

describe('пауза прокрутки', () => {
  test('первое удержание ставит паузу, последнее отпускание снимает', () => {
    const calls: boolean[] = []
    registerScrollPauser((p) => calls.push(p))
    const one = holdScroll()
    const two = holdScroll()
    expect(calls).toEqual([true])
    one()
    expect(calls).toEqual([true])
    two()
    expect(calls).toEqual([true, false])
  })

  /**
   * Очистка эффекта в строгом режиме React и размонтирование посреди анимации
   * могут отпустить дважды. Второй вызов не должен снять чужое удержание.
   */
  test('двойное отпускание не снимает чужое удержание', () => {
    const calls: boolean[] = []
    registerScrollPauser((p) => calls.push(p))
    const mine = holdScroll()
    const theirs = holdScroll()
    mine()
    mine()
    expect(calls).toEqual([true])
    theirs()
    expect(calls).toEqual([true, false])
  })

  /**
   * Смузер грузится отдельным чанком в свободную минуту браузера. Окно могли
   * открыть раньше — тогда пауза ставится в момент его прихода.
   */
  test('смузер, приехавший при открытом окне, встаёт на паузу сразу', () => {
    const release = holdScroll()
    const calls: boolean[] = []
    registerScrollPauser((p) => calls.push(p))
    expect(calls).toEqual([true])
    release()
    expect(calls).toEqual([true, false])
  })

  test('без смузера удержание ничего не ломает', () => {
    const release = holdScroll()
    expect(() => release()).not.toThrow()
  })

  test('отписка убитого смузера не снимает регистрацию нового', () => {
    const old: boolean[] = []
    const fresh: boolean[] = []
    const unregisterOld = registerScrollPauser((p) => old.push(p))
    registerScrollPauser((p) => fresh.push(p))
    unregisterOld()
    holdScroll()
    expect(old).toEqual([])
    expect(fresh).toEqual([true])
  })
})
