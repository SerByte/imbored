import fs from 'node:fs'
import path from 'node:path'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type * as Mod from './sessionhint'

/**
 * Подсказка живёт в localStorage, а туда пишет кто угодно — руками из консоли,
 * расширением, соседней вкладкой. Поэтому проверяем не «сохраняется ли», а
 * «что будет, если там мусор»: главная не имеет права падать из-за строки в
 * хранилище.
 */

type Store = Record<string, string>

function install(store: Store, opts: { throws?: boolean } = {}) {
  const ls = {
    getItem: (k: string) => {
      if (opts.throws) throw new Error('заблокировано')
      return Object.hasOwn(store, k) ? store[k] : null
    },
    setItem: (k: string, v: string) => {
      if (opts.throws) throw new Error('заблокировано')
      store[k] = v
    },
    removeItem: (k: string) => {
      if (opts.throws) throw new Error('заблокировано')
      delete store[k]
    },
  }
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} })
}

/** Свежий модуль на каждый случай: снимок кэшируется в области модуля. */
async function fresh(): Promise<typeof Mod> {
  vi.resetModules()
  return import('./sessionhint')
}

const KEY = 'imbored.session-hint'

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('подсказка о прошлом входе', () => {
  test('пустое хранилище — подсказки нет', async () => {
    install({})
    const m = await fresh()
    expect(m.getSessionHint()).toBeNull()
  })

  test('сохранённый вход читается вместе с ником', async () => {
    install({ [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша' }) })
    const m = await fresh()
    expect(m.getSessionHint()).toEqual({ authed: true, personaName: 'Гоша' })
  })

  /**
   * Каждая строка ниже когда-то могла бы прилететь из хранилища. Ни одна не
   * должна кинуть исключение: это первый рендер главной, и падение здесь —
   * белый экран вместо сайта.
   */
  test.each([
    ['не JSON', 'вообще не json'],
    ['обрезанный JSON', '{"authed":tr'],
    ['пустая строка', ''],
    ['null', 'null'],
    ['массив', '[1,2,3]'],
    ['число', '42'],
    ['строка', '"да"'],
    ['без поля authed', '{"personaName":"Гоша"}'],
    ['authed строкой', '{"authed":"true"}'],
    ['authed нулём', '{"authed":0}'],
    ['гость', '{"authed":false,"personaName":"Гоша"}'],
  ])('мусор в хранилище (%s) — подсказки нет и без исключения', async (_name, raw) => {
    install({ [KEY]: raw })
    const m = await fresh()
    expect(() => m.getSessionHint()).not.toThrow()
    expect(m.getSessionHint()).toBeNull()
  })

  test('ник не строкой — вход признаём, ник отбрасываем', async () => {
    install({ [KEY]: JSON.stringify({ authed: true, personaName: { toString: 'ой' } }) })
    const m = await fresh()
    expect(m.getSessionHint()).toEqual({ authed: true, personaName: null })
  })

  /**
   * Приватный режим Safari и выключенные куки: localStorage существует, но
   * бросает на любом обращении. Подсказки не будет — и это правильный исход,
   * человек увидит вход. Неправильный исход — исключение.
   */
  test('хранилище бросает — подсказки нет, но и падения нет', async () => {
    install({}, { throws: true })
    const m = await fresh()
    expect(() => m.getSessionHint()).not.toThrow()
    expect(m.getSessionHint()).toBeNull()
    expect(() => m.rememberSession({ authed: true, personaName: 'Гоша' })).not.toThrow()
    expect(() => m.forgetSessionHint()).not.toThrow()
  })

  /**
   * Требование useSyncExternalStore, а не вкусовщина: если getSnapshot отдаёт
   * каждый раз новый объект, React считает, что значение менялось, и рендерит
   * снова — бесконечно. Проверка стоит тут, потому что регрессия выглядела бы
   * как «главная зависла», а причина была бы в одной строке этого файла.
   */
  test('снимок сохраняет ссылку, пока значение не менялось', async () => {
    install({ [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша' }) })
    const m = await fresh()
    expect(m.getSessionHint()).toBe(m.getSessionHint())
  })

  test('снимок меняет ссылку, когда значение сменилось', async () => {
    install({})
    const m = await fresh()
    const before = m.getSessionHint()
    m.rememberSession({ authed: true, personaName: 'Гоша' })
    expect(m.getSessionHint()).not.toBe(before)
    expect(m.getSessionHint()).toEqual({ authed: true, personaName: 'Гоша' })
  })

  /**
   * Снимок сервера обязан быть null всегда: разметка статическая, и первый
   * рендер клиента должен совпасть с ней, иначе гидратация ругается.
   */
  test('на сервере подсказки нет никогда', async () => {
    install({ [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша' }) })
    const m = await fresh()
    expect(m.getServerSessionHint()).toBeNull()
  })

  test('гостя не запоминаем — запись стирается', async () => {
    const store: Store = { [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша' }) }
    install(store)
    const m = await fresh()
    m.rememberSession({ authed: false, personaName: null })
    expect(m.getSessionHint()).toBeNull()
    expect(store[KEY]).toBeUndefined()
  })

  test('выход стирает подсказку и будит подписчиков', async () => {
    const store: Store = {}
    install(store)
    const m = await fresh()
    let woke = 0
    m.subscribeSessionHint(() => { woke += 1 })
    m.rememberSession({ authed: true, personaName: 'Гоша' })
    expect(store[KEY]).toBeDefined()
    m.forgetSessionHint()
    expect(store[KEY]).toBeUndefined()
    expect(m.getSessionHint()).toBeNull()
    expect(woke).toBe(2)
  })

  test('отписка действительно отписывает', async () => {
    install({})
    const m = await fresh()
    let woke = 0
    const off = m.subscribeSessionHint(() => { woke += 1 })
    off()
    m.rememberSession({ authed: true, personaName: 'Гоша' })
    expect(woke).toBe(0)
  })
})

/**
 * Подсказка переживает перезагрузку — значит её обязан кто-то гасить, и гасит
 * ровно одно место. Если эта строка когда-нибудь уедет при рефакторинге,
 * поломка будет выглядеть так: человек нажал «Выйти», его увело на главную, и
 * главная встретила его «С возвращением, ...». Тест дешевле, чем такой отчёт.
 */
describe('выход гасит подсказку', () => {
  test('SignOut зовёт forgetSessionHint', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'SignOut.tsx'), 'utf8')
    expect(src, 'подсказку надо импортировать').toMatch(/from '@\/lib\/sessionhint'/)
    expect(src, 'и обязательно позвать до ухода со страницы').toContain('forgetSessionHint()')
  })
})
