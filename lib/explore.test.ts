import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  EXPLORE_DECK,
  EXPLORE_PASS_SEC,
  EXPLORE_WAIT_MS,
  exploreDeck,
  exploreSignal,
  exploredAppids,
  putBack,
} from './explore'
import type { CandidateSource } from './types'

const c = (appid: number, source: CandidateSource, score: number) => ({ appid, source, score })

describe('exploreDeck', () => {
  test('своё и каталог по очереди, начиная с сильной головы', () => {
    const own = [c(1, 'untouched', 0.9), c(2, 'backlog', 0.5), c(3, 'comeback', 0.4)]
    const discovery = [c(10, 'new', 0.7), c(11, 'new', 0.6)]
    expect(exploreDeck(own, discovery).map((x) => x.appid)).toEqual([1, 10, 2, 11, 3])
    // Голова каталога сильнее — он первым
    const strong = [c(10, 'new', 0.95), ...discovery.slice(1)]
    expect(exploreDeck(own, strong).map((x) => x.appid)).toEqual([10, 1, 11, 2, 3])
  })

  test('кончилась одна сторона — добирает другая; длина не больше колоды', () => {
    const own = Array.from({ length: 30 }, (_, i) => c(i + 1, 'untouched', 1 - i / 100))
    expect(exploreDeck(own, []).map((x) => x.appid)).toEqual(own.slice(0, EXPLORE_DECK).map((x) => x.appid))
    expect(exploreDeck([], [c(10, 'new', 0.5)])).toHaveLength(1)
    expect(exploreDeck([], [])).toEqual([])
  })
})

describe('exploredAppids', () => {
  const NOW = 1_780_000_000

  test('приглянувшееся не возвращается никогда, «Мимо» — неделю', () => {
    const rows = [
      { appid: 1, at: NOW - 30 * 86_400, liked: true },
      { appid: 2, at: NOW - 86_400, liked: false },
      { appid: 3, at: NOW - EXPLORE_PASS_SEC - 1, liked: false },
    ]
    expect(exploredAppids(rows, NOW)).toEqual([1, 2])
  })
})

describe('putBack: отказ «Убрать» возвращает одну плитку, а не снимок полки', () => {
  const t = (appid: number) => ({ appid })
  const ids = (l: Array<{ appid: number }>) => l.map((x) => x.appid)
  // полка в момент нажатия «Убрать» на плитке 2
  const before = [t(1), t(2), t(3), t(4)]

  test('полка за время запроса не менялась — плитка встаёт на своё место', () => {
    expect(ids(putBack([t(1), t(3), t(4)], t(2), before))).toEqual([1, 2, 3, 4])
  })

  test('пока запрос шёл, «Интересно» положило новую — она остаётся', () => {
    // снимок вернул бы [1, 2, 3, 4] и стёр бы 9, хотя сервер её уже записал
    expect(ids(putBack([t(9), t(1), t(3), t(4)], t(2), before))).toEqual([9, 1, 2, 3, 4])
  })

  test('соседа убрали вторым «Убрать» — он не воскресает', () => {
    expect(ids(putBack([t(1), t(4)], t(2), before))).toEqual([1, 2, 4])
    // ушли все нижние соседи — плитка встаёт в конец
    expect(ids(putBack([t(1)], t(3), before))).toEqual([1, 3])
  })

  test('плитка уже на полке — та же полка, без второй копии', () => {
    const shelf = [t(1), t(2)]
    expect(putBack(shelf, t(2), before)).toBe(shelf)
  })
})

describe('exploreSignal: потолок ожидания колоды', () => {
  test('уход со страницы отменяет запрос', () => {
    const page = new AbortController()
    const s = exploreSignal(page.signal)
    expect(s.aborted).toBe(false)
    page.abort()
    expect(s.aborted).toBe(true)
  })

  test('повисший запрос обрывается потолком, а сигнал страницы остаётся целым', async () => {
    const page = new AbortController()
    const s = exploreSignal(page.signal, 5)
    if (!s.aborted) await new Promise((r) => s.addEventListener('abort', r, { once: true }))
    expect((s.reason as DOMException).name).toBe('TimeoutError')
    // По этой разнице страница и отличает обрыв от ухода: экран отказа — только на обрыве
    expect(page.signal.aborted).toBe(false)
  })

  test('без AbortSignal.any (Safari до 17.4) — сигнал страницы, а не исключение', () => {
    const any = AbortSignal.any
    Reflect.set(AbortSignal, 'any', undefined)
    try {
      const page = new AbortController()
      expect(exploreSignal(page.signal)).toBe(page.signal)
    } finally {
      Reflect.set(AbortSignal, 'any', any)
    }
  })

  test('потолок — с запасом над живым ответом, но не браузерные минуты', () => {
    expect(EXPLORE_WAIT_MS).toBeGreaterThanOrEqual(10_000)
    expect(EXPLORE_WAIT_MS).toBeLessThanOrEqual(30_000)
  })
})

/**
 * Страница /explore — исходником, как в lib/focushandoff.test.ts: без
 * браузера ни историю, ни повисшее соединение не увидеть, а возвращается
 * каждая поломка одной правкой.
 */
describe('страница /explore', () => {
  /** Комментарии гасятся пробелами: докблоки цитируют сами правила */
  const page = fs
    .readFileSync(path.join(__dirname, '..', 'app', '[lang]', 'explore', 'page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre: string, c: string) => pre + ' '.repeat(c.length))

  test('разворот на вход заменяет запись истории, а не добавляет новую', () => {
    // С push история была [..., /quiz, /explore, /?next=…]: «Назад» с лендинга
    // открывал /explore, тот снова получал 401 и снова уводил на лендинг, — и
    // назад дальше /explore было не уйти. Запись без сессии мертва, её не жалко
    expect(page).toMatch(/router\.replace\(bounceTo\('\/explore'\)\)/)
    expect(page).not.toMatch(/router\.push\(bounceTo\(/)
  })

  test('каждый запрос колоды — с потолком ожидания', () => {
    const calls = page.match(/fetch\('\/api\/explore'[^)]*\)/g) ?? []
    expect(calls.length, 'запросы колоды не найдены — сторож ослеп').toBeGreaterThanOrEqual(2)
    for (const c of calls) {
      expect(c, 'без потолка повисшее соединение держит «Собираю…», пока его держит браузер').toMatch(
        /signal: exploreSignal\(/,
      )
    }
  })

  test('отказ «Убрать» возвращает одну плитку, а не снимок полки', () => {
    expect(page).toMatch(/setLiked\(\(l\) => putBack\(l, card, before\)\)/)
    expect(page).not.toMatch(/setLiked\(before\)/)
  })

  /**
   * 401 на «Попробовать снова»: show уже запустил router.replace, но сигнал
   * страницы ещё цел, и finally возвращал retrying в false — строка статуса
   * получала текст отказа обратно и объявляла его под уход на вход, а
   * эффект фокуса уносил потерянный фокус на заголовок отказа.
   */
  test('повтор, упёршийся в конец сессии, не объявляет отказ под уход на вход', () => {
    const from = page.indexOf('const show = useCallback(')
    const show = page.slice(from, page.indexOf('useEffect(', from))
    expect(show, 'show не найден — сторож ослеп').toMatch(/router\.replace\(bounceTo\('\/explore'\)\)/)
    expect(show).toMatch(
      /if \(res\.status === 401\) \{[^}]*router\.replace\(bounceTo\('\/explore'\)\)\s*return 'gone'/,
    )
    const retry = page.slice(page.indexOf('const retry = async'), page.indexOf('const vote = '))
    expect(retry, 'retry не найден — сторож ослеп').toMatch(/gone = \(await show\(res, ac\.signal\)\) === 'gone'/)
    expect(retry).toMatch(/finally \{\s*if \(!ac\.signal\.aborted && !gone\) setRetrying\(false\)/)
  })

  /**
   * Где полка, говорит её имя, а не направление: с md полка стоит колонкой
   * справа, и «лежит ниже» отправляло вниз, под пустую панель.
   */
  test('конец колоды называет полку, а не сторону', () => {
    const from = page.indexOf('Колода кончилась')
    const end = page.slice(from, page.indexOf('<button', from))
    expect(end,'панель «Колода кончилась» не найдена — сторож ослеп').toContain('на полке «Приглянулось»')
    expect(end).not.toMatch(/ниже|выше|справа|слева/)
  })
})
