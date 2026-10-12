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

  test('демо помнится, но только настоящим true', async () => {
    install({ [KEY]: JSON.stringify({ authed: true, personaName: 'Демо-игрок', demo: true }) })
    let m = await fresh()
    expect(m.getSessionHint()).toEqual({ authed: true, personaName: 'Демо-игрок', demo: true })

    for (const demo of ['true', 1, false, null]) {
      install({ [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша', demo }) })
      m = await fresh()
      expect(m.getSessionHint(), String(demo)).toEqual({ authed: true, personaName: 'Гоша' })
    }
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

describe('подсказка из ответа сервера', () => {
  test('демо — только настоящим true, «только просмотр» — только writer: false у не-демо', async () => {
    install({})
    const { hintFrom } = await fresh()
    expect(hintFrom({ personaName: 'Гоша', writer: true })).toEqual({ authed: true, personaName: 'Гоша' })
    expect(hintFrom({ personaName: null, demo: true, writer: true })).toEqual({
      authed: true,
      personaName: null,
      demo: true,
    })
    // демо пишет (isWriter в lib/server): «только просмотр» ему не положен ни при каком writer
    expect(hintFrom({ demo: true, writer: false })).toEqual({ authed: true, personaName: null, demo: true })
    expect(hintFrom({ writer: false })).toEqual({ authed: true, personaName: null, readOnly: true })
    // writer не пришёл — «не знаем», а не «только просмотр»
    expect(hintFrom({ personaName: 'Гоша' })).toEqual({ authed: true, personaName: 'Гоша' })
  })
})

/**
 * Сверка с ответом touch на остальных страницах (SessionKeeper).
 *
 * Вход через Steam из полосы демо возвращает прямо в выдачу, мимо главной, и
 * подсказка «демо» оставалась бы на устройстве — полоса называла бы чужой
 * собственную библиотеку человека. У touch здесь нет ни ника, ни признака
 * демо, только steamid и writer.
 */
describe('сверка подсказки с ответом touch', () => {
  const REAL = '76561197960287930'
  const DEMO = '00012345678901231'

  test('демо вошёл через Steam — признак демо и чужой ник гаснут', async () => {
    const store: Store = { [KEY]: JSON.stringify({ authed: true, personaName: 'Демо-игрок', demo: true }) }
    install(store)
    const m = await fresh()
    let woke = 0
    m.subscribeSessionHint(() => {
      woke += 1
    })
    m.settleSessionHint({ authed: true, steamid: REAL, writer: true })
    expect(m.getSessionHint()).toEqual({ authed: true, personaName: null })
    expect(JSON.parse(store[KEY])).toEqual({ authed: true, personaName: null })
    expect(woke).toBe(1)
  })

  test('подсказка не врёт — не трогаем: ник на месте, снимок тот же', async () => {
    for (const [saved, touch] of [
      [{ authed: true, personaName: 'Демо-игрок', demo: true }, { authed: true, steamid: DEMO, writer: true }],
      [{ authed: true, personaName: 'Гоша' }, { authed: true, steamid: REAL, writer: true }],
      [{ authed: true, personaName: 'Гоша', readOnly: true }, { authed: true, steamid: REAL, writer: false }],
    ] as const) {
      install({ [KEY]: JSON.stringify(saved) })
      const m = await fresh()
      const before = m.getSessionHint()
      m.settleSessionHint(touch)
      expect(m.getSessionHint(), JSON.stringify(saved)).toBe(before)
    }
  })

  test('вид входа сменился — подсказка следом', async () => {
    install({ [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша', readOnly: true }) })
    let m = await fresh()
    // вошёл по ссылке, потом через Steam (NeedSteam) — «только просмотр» снят,
    // а ник свой: тот же человек, и приветствию главной незачем его ждать
    m.settleSessionHint({ authed: true, steamid: REAL, writer: true })
    expect(m.getSessionHint()).toEqual({ authed: true, personaName: 'Гоша' })

    // в демо — ник гаснет: «Гоша» у демо-личности был бы чужим
    install({ [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша' }) })
    m = await fresh()
    m.settleSessionHint({ authed: true, steamid: DEMO, writer: true })
    expect(m.getSessionHint()).toEqual({ authed: true, personaName: null, demo: true })
  })

  /*
   * Подсказки, записанные до признака readOnly, его не знают: у сессии по
   * ссылке там лежит просто { authed, personaName }. Первая же сверка после
   * выкладки его добавит — у всех таких людей разом, — и если бы она гасила
   * при этом ник, приветствие главной у каждого прыгнуло бы на следующем
   * заходе.
   */
  test('старая подсказка сессии по ссылке получает «только просмотр» и сохраняет ник', async () => {
    const store: Store = { [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша' }) }
    install(store)
    const m = await fresh()
    m.settleSessionHint({ authed: true, steamid: REAL, writer: false })
    expect(m.getSessionHint()).toEqual({ authed: true, personaName: 'Гоша', readOnly: true })
    expect(JSON.parse(store[KEY])).toEqual({ authed: true, personaName: 'Гоша', readOnly: true })
  })

  test('гость — подсказка стирается, как это сделала бы главная', async () => {
    const store: Store = { [KEY]: JSON.stringify({ authed: true, personaName: 'Демо-игрок', demo: true }) }
    install(store)
    const m = await fresh()
    m.settleSessionHint({ authed: false })
    expect(m.getSessionHint()).toBeNull()
    expect(store[KEY]).toBeUndefined()
  })

  test('подсказки не было — не заводим: без ника она беднее той, что запишет главная', async () => {
    const store: Store = {}
    install(store)
    const m = await fresh()
    m.settleSessionHint({ authed: true, steamid: REAL, writer: true })
    expect(m.getSessionHint()).toBeNull()
    expect(store).toEqual({})
  })

  test.each([
    ['null', null],
    ['строка', 'authed'],
    ['без steamid', { authed: true, writer: true }],
    ['steamid числом', { authed: true, steamid: 76561197960287930, writer: true }],
    ['writer строкой', { authed: true, steamid: REAL, writer: 'true' }],
    ['без authed', { steamid: REAL, writer: true }],
  ])('непонятный ответ (%s) подсказку не трогает', async (_name, body) => {
    install({ [KEY]: JSON.stringify({ authed: true, personaName: 'Демо-игрок', demo: true }) })
    const m = await fresh()
    const before = m.getSessionHint()
    expect(() => m.settleSessionHint(body)).not.toThrow()
    expect(m.getSessionHint()).toBe(before)
  })

  test('SessionKeeper сверяет подсказку тем же ответом, что и признак записи', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'SessionKeeper.tsx'), 'utf8')
    expect(src).toMatch(/from '@\/lib\/sessionhint'/)
    expect(src).toMatch(/writerStore\.set\(writerFrom\(body\)\)\s*settleSessionHint\(body\)/)
  })
})

/**
 * Гость наверняка (knownGuest) — для квиза: его последний ответ вёл гостя на
 * /play, тот показывал экран прогрева и через круг до сервера (401 у
 * /api/prepare) разворачивал на лендинг. Зная, что это гость, квиз ведёт на
 * лендинг сразу (app/quiz, go). Ошибиться здесь дороже, чем промолчать:
 * вошедший, принятый за гостя, вместо выдачи попал бы на лендинг, — поэтому
 * «гость» только со слов сервера, а «не знаем» — по-старому, через /play.
 */
describe('гость наверняка', () => {
  /** window с настоящим событием storage: соседняя вкладка пишет подсказку */
  function withStorageEvents(store: Store) {
    install(store)
    const handlers: Array<(e: { key: string | null }) => void> = []
    vi.stubGlobal('window', {
      addEventListener: (type: string, h: (e: { key: string | null }) => void) => {
        if (type === 'storage') handlers.push(h)
      },
      removeEventListener: () => {},
    })
    return (key: string | null) => handlers.forEach((h) => h({ key }))
  }

  test('пока сервер не ответил — не гость, а «не знаем»', async () => {
    install({})
    const m = await fresh()
    expect(m.knownGuest()).toBe(false)
  })

  /*
   * Гость без подсказки — самый частый случай: квиз открыли сами, главная не
   * писала ничего. Сверка раньше на нём молча выходила, и квиз так и не
   * узнавал, что перед ним гость.
   */
  test('touch ответил «гость» — и без подсказки, и с ней; слушатели узнают', async () => {
    install({})
    let m = await fresh()
    let woke = 0
    m.subscribeSessionHint(() => {
      woke += 1
    })
    m.settleSessionHint({ authed: false })
    expect(m.knownGuest()).toBe(true)
    expect(woke).toBe(1)

    const store: Store = { [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша' }) }
    install(store)
    m = await fresh()
    m.settleSessionHint({ authed: false })
    expect(m.knownGuest()).toBe(true)
    expect(store[KEY]).toBeUndefined()
  })

  test('ответ без authed: false гостем не делает', async () => {
    for (const body of [null, 'authed', {}, { authed: 'false' }, { authed: 0 }, { authed: true, steamid: '76561197960287930', writer: true }]) {
      install({})
      const m = await fresh()
      m.settleSessionHint(body)
      expect(m.knownGuest(), JSON.stringify(body)).toBe(false)
    }
  })

  /*
   * Подключился на главной (ссылкой, демо) — тот же документ, и квиз после
   * этого обязан вести в выдачу, а не на лендинг: флаг гаснет с записью
   * подсказки о входе. А выход (forgetSessionHint) гостем не делает: выход
   * «везде» бывает и недоделанным — тогда по-старому, через /play.
   */
  test('вход в этом документе гасит флаг, выход его не ставит', async () => {
    install({})
    const m = await fresh()
    m.rememberGuest()
    expect(m.knownGuest()).toBe(true)
    m.rememberSession({ authed: true, personaName: 'Гоша' })
    expect(m.knownGuest()).toBe(false)
    m.forgetSessionHint()
    expect(m.knownGuest()).toBe(false)
  })

  // Кука у вкладок общая: вошёл в соседней через главную — здесь уже не гость
  test('подсказка из соседней вкладки — уже не гость', async () => {
    const store: Store = {}
    const storage = withStorageEvents(store)
    const m = await fresh()
    m.subscribeSessionHint(() => {})
    m.rememberGuest()
    expect(m.knownGuest()).toBe(true)
    store[KEY] = JSON.stringify({ authed: true, personaName: 'Гоша' })
    storage(KEY)
    expect(m.knownGuest()).toBe(false)
  })

  /*
   * Главная зовёт touch сама, и SessionKeeper после неё в том же документе
   * молчит двенадцать часов: гость, пришедший на квиз с главной (самый
   * частый путь), иначе так и остался бы «не знаем». Гость — только из
   * удачного ответа: сбой сети о сессии не говорит ничего.
   */
  test('главная отмечает гостя тем же флагом — только по ответу, не по сбою', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'landing', 'ConnectCard.tsx'), 'utf8')
    expect(src).toMatch(/if \(guest\) rememberGuest\(\)\s*else rememberSession\(next\)/)
    expect(src).toMatch(/settle\(d\.authed \? hintFrom\(d\) : null, d\.authed === false\)/)
    expect(src).toMatch(/if \(!r\.ok\) return settle\(null\)/)
    expect(src).toMatch(/\.catch\(\(\) => settle\(null\)\)/)
  })

  /** document и window с настоящими слушателями: прячем документ, уводим страницу */
  function withHiding(store: Store) {
    install(store)
    const doc = { visibilityState: 'visible' as 'visible' | 'hidden' }
    const on: Record<string, Array<() => void>> = {}
    const add = (type: string, h: () => void) => {
      ;(on[type] ??= []).push(h)
    }
    vi.stubGlobal('document', {
      addEventListener: add,
      get visibilityState() {
        return doc.visibilityState
      },
    })
    vi.stubGlobal('window', { addEventListener: add, removeEventListener: () => {} })
    return {
      count: (type: string) => on[type]?.length ?? 0,
      show() {
        doc.visibilityState = 'visible'
        on.visibilitychange?.forEach((h) => h())
      },
      hide() {
        doc.visibilityState = 'hidden'
        on.visibilitychange?.forEach((h) => h())
      },
      pagehide: () => on.pagehide?.forEach((h) => h()),
    }
  }

  /*
   * Вход через Steam подсказки не пишет: возврат ведёт в квиз (loginTarget),
   * а сверка там подсказку, которой нет, не заводит. Вошёл в соседней
   * вкладке — storage сюда не придёт, и квиз этой вкладки увёл бы вошедшего
   * на лендинг «подключать Steam». Войти где-то ещё, не спрятав этот
   * документ, почти нельзя, — поэтому спрятанному флагу больше не верим.
   */
  test('документ спрятали — снова «не знаем», и квиз об этом узнаёт', async () => {
    const page = withHiding({})
    const m = await fresh()
    let woke = 0
    m.subscribeSessionHint(() => {
      woke += 1
    })
    m.rememberGuest()
    woke = 0
    page.show()
    expect(m.knownGuest(), 'показали — флаг на месте').toBe(true)
    page.hide()
    expect(m.knownGuest()).toBe(false)
    expect(woke).toBe(1)
    // гаснет насовсем: вернулись на вкладку — флаг сам не оживает
    page.show()
    expect(m.knownGuest()).toBe(false)
  })

  // Уход в Steam и «Назад» из bfcache: память модуля цела, документ тот же
  test('pagehide — тоже: из bfcache флаг не возвращается', async () => {
    const page = withHiding({})
    const m = await fresh()
    m.rememberGuest()
    page.pagehide()
    expect(m.knownGuest()).toBe(false)
  })

  test('слежка — одна на документ и только у гостя', async () => {
    const page = withHiding({})
    const m = await fresh()
    m.rememberSession({ authed: true, personaName: 'Гоша' })
    m.forgetSessionHint()
    m.forgetGuest()
    expect(page.count('visibilitychange'), 'не гость — следить незачем').toBe(0)
    m.rememberGuest()
    m.settleSessionHint({ authed: false })
    m.rememberGuest()
    expect(page.count('visibilitychange')).toBe(1)
    expect(page.count('pagehide')).toBe(1)
  })

  /*
   * touch ответил «вошёл», а подсказки нет (вход мимо главной): завести её
   * сверке нечем, но и гостем этот документ больше не считается.
   */
  test('touch «вошёл» без подсказки гасит флаг, подсказку не заводит', async () => {
    const store: Store = {}
    install(store)
    const m = await fresh()
    m.rememberGuest()
    m.settleSessionHint({ authed: true, steamid: '76561197960287930', writer: true })
    expect(m.knownGuest()).toBe(false)
    expect(m.getSessionHint()).toBeNull()
    expect(store[KEY]).toBeUndefined()
  })

  /*
   * forgetGuest — для входов без подсказки (демо-друг в комнате). Подсказку
   * не трогает, слушателей будит, только если флаг и правда горел: лишний
   * рендер квиза на каждом скрытии вкладки ни к чему.
   */
  test('forgetGuest гасит флаг, не трогая подсказку', async () => {
    const store: Store = { [KEY]: JSON.stringify({ authed: true, personaName: 'Гоша' }) }
    install(store)
    const m = await fresh()
    let woke = 0
    m.subscribeSessionHint(() => {
      woke += 1
    })
    m.forgetGuest()
    expect(woke, 'гостем и не был — будить некого').toBe(0)
    expect(store[KEY]).toBe(JSON.stringify({ authed: true, personaName: 'Гоша' }))

    install({})
    const g = await fresh()
    g.rememberGuest()
    g.forgetGuest()
    expect(g.knownGuest()).toBe(false)
    expect(g.getSessionHint()).toBeNull()
  })

  /*
   * Каждый вход с клиента обязан погасить флаг: подсказкой (rememberSession —
   * карточка главной) или напрямую (forgetGuest — демо-друг в комнате).
   * Однажды комната входила молча, и гость, отмеченный touch из
   * SessionKeeper, после «Демо-друг (без Steam)» шёл из шапки через квиз на
   * лендинг «подключать Steam». Новый вход, забывший про флаг, должен падать
   * здесь, а не у человека.
   */
  test('каждый вход через /api/connect с клиента гасит флаг гостя', () => {
    const root = path.join(__dirname, '..')
    const callers: string[] = []
    for (const dir of ['app', 'components']) {
      const files = fs.readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
      for (const rel of files) {
        if (!/\.tsx?$/.test(rel) || /\.test\.tsx?$/.test(rel)) continue
        const file = path.join(dir, rel).split(path.sep).join('/')
        const src = fs.readFileSync(path.join(root, file), 'utf8')
        for (const hit of src.matchAll(/fetch\(\s*['"`]\/api\/connect['"`?]/g)) {
          callers.push(file)
          // Тело того же обработчика — до следующего объявления функции
          const rest = src.slice(hit.index)
          const end = rest.search(/\n\s*(?:async\s+)?function\s/)
          const body = end === -1 ? rest : rest.slice(0, end)
          expect(body, file).toMatch(/\brememberSession\(|\bforgetGuest\(\)/)
        }
      }
    }
    // Сам поиск не пустой: оба известных входа нашлись
    expect(callers).toEqual(
      expect.arrayContaining(['app/room/[id]/page.tsx', 'components/landing/ConnectCard.tsx']),
    )
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
