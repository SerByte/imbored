import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  HIDDEN_POLL_CAP_MS,
  HIDDEN_POLL_MS,
  hiddenPollDelay,
  nextPollStep,
  STALE_AFTER_FAILS,
} from './roompoll'

/**
 * Сторож фонового опроса. Скрытая вкладка спрашивает сервер только в одном
 * состоянии и только ограниченное время — иначе вкладка, забытая на ночь,
 * снова крутила бы запросы до утра, ради чего фон и молчал.
 */
describe('опрос скрытой вкладки', () => {
  test('без ожидания фон молчит, как раньше', () => {
    // свайпающему из фона нечего узнать: без его голосов матча не будет
    expect(hiddenPollDelay({ waiting: false, hiddenForMs: 0 })).toBeNull()
    expect(hiddenPollDelay({ waiting: false, hiddenForMs: 5 * 60_000 })).toBeNull()
  })

  test('ждущий спрашивает не чаще раза в минуту', () => {
    expect(HIDDEN_POLL_MS, 'фон чаще минуты — это видимый опрос, только невидимый').toBeGreaterThanOrEqual(60_000)
    expect(hiddenPollDelay({ waiting: true, hiddenForMs: 0 })).toBe(HIDDEN_POLL_MS)
    expect(hiddenPollDelay({ waiting: true, hiddenForMs: 59 * 60_000 })).toBe(HIDDEN_POLL_MS)
  })

  test('час скрытия — потолок: дальше вкладка спит до возвращения', () => {
    expect(HIDDEN_POLL_CAP_MS, 'потолок растянулся — вкладку снова забудут на ночь').toBeLessThanOrEqual(60 * 60_000)
    expect(hiddenPollDelay({ waiting: true, hiddenForMs: HIDDEN_POLL_CAP_MS })).toBeNull()
    expect(hiddenPollDelay({ waiting: true, hiddenForMs: 10 * 60 * 60_000 })).toBeNull()
  })
})

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

/**
 * Сторож догрузок комнаты: скрытая вкладка ничего, кроме самого опроса, не спрашивает.
 *
 * Фоновый опрос ждущей вкладки (hiddenPollDelay) меняет состояние комнаты
 * прямо в фоне: новый участник и новый раунд двигают ключ колоды, чужие
 * голоса — ключ лайков. Эффект, который по такому сдвигу сразу идёт на
 * сервер, превращает минутный опрос в пачку запросов, которых никто не
 * увидит. С колодой хуже: 429 или обрыв фонового GET /deck выставляли
 * deckFailed, эффект по нему не повторяет, и вернувшийся человек видел
 * «Не получилось загрузить игры» вместо колоды.
 *
 * Логику эффекта в чистую функцию не вынести — она в порядке ранних return
 * и ref-ключей, — поэтому разметка читается как текст: каждый эффект, который
 * зовёт loadDeck или loadLikes, обязан выйти по !visible ДО того, как тронет
 * свой ключ, и держать visible в зависимостях — иначе возвращение на вкладку
 * его не перезапустит. Исключение одно и названо дословно: самая первая
 * колода (deckKey ещё пуст) грузится и в фоне — ссылку открыли из чата в
 * фоновой вкладке, и вернувшийся должен увидеть колоду, а не спиннер.
 *
 * Эффект ищется по любому вызову загрузчика, а не только по «void loadDeck()»:
 * голый loadDeck() линтер пропускает (no-floating-promises не включён), как и
 * обёртку в async-IIFE. В зависимостях стоит «loadDeck]», а не «loadDeck(»,
 * так что лишнего фильтр не цепляет.
 */
describe('догрузки комнаты ждут видимой вкладки', () => {
  const ROOT = path.join(__dirname, '..')
  /** Комментарии гасятся: докблоки страницы цитируют сами правила */
  const room = fs
    .readFileSync(path.join(ROOT, 'app', 'room', '[id]', 'page.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  /** Вызов useEffect(...) целиком — до парной скобки, строки пропускаются */
  function effects(code: string): string[] {
    const out: string[] = []
    for (const m of code.matchAll(/\buseEffect\(/g)) {
      let depth = 0
      let q: string | null = null
      for (let j = m.index + 'useEffect'.length; j < code.length; j++) {
        const c = code[j]
        if (q) {
          if (c === q && code.charCodeAt(j - 1) !== 92) q = null
          continue
        }
        if (c === '"' || c === "'" || c === '`') q = c
        else if (c === '(') depth++
        else if (c === ')' && --depth === 0) {
          out.push(code.slice(m.index, j + 1))
          break
        }
      }
    }
    return out
  }

  const loaders = effects(room).filter((e) => /\bload(Deck|Likes)\(/.test(e))

  /** Единственная разрешённая оговорка к выходу по !visible — первая колода */
  const FIRST_DECK = "!visible && deckKey.current !== ''"

  /**
   * Где эффект выходит по скрытой вкладке: условие раннего return, в котором
   * !visible стоит отдельным слагаемым «или» (выход при любом прочем), либо
   * ровно оговорка первой колоды — и только у эффекта колоды. -1 — не выходит.
   */
  function hiddenBail(e: string): number {
    for (const m of e.matchAll(/if \(([^)]*)\) return/g)) {
      const cond = m[1].replace(/\s+/g, ' ').trim()
      const plain = cond.split('||').some((part) => part.trim() === '!visible')
      const firstDeck = cond === FIRST_DECK && e.includes('deckKey.current = deckWant')
      if (plain || firstDeck) return m.index
    }
    return -1
  }

  test('эффекты догрузки найдены — сторож не ослеп', () => {
    // колода, её самолечение и лайки
    expect(loaders.length).toBeGreaterThanOrEqual(3)
    expect(loaders.some((e) => e.includes('deckKey.current = deckWant'))).toBe(true)
    expect(loaders.some((e) => e.includes('healKey.current = deckWant'))).toBe(true)
    expect(loaders.some((e) => e.includes('likesKey.current = votesKey'))).toBe(true)
  })

  test('скрытая вкладка выходит раньше, чем тронет ключ, и возвращение перезапускает эффект', () => {
    for (const e of loaders) {
      const head = e.split('\n').slice(0, 3).join(' ').replace(/\s+/g, ' ')
      const bail = hiddenBail(e)
      expect(bail, `эффект грузит и в скрытой вкладке: ${head}`).toBeGreaterThan(-1)
      const key = e.search(/\b\w+Key\.current = /)
      expect(key, `ключ не найден: ${head}`).toBeGreaterThan(-1)
      expect(bail, `ключ взводится до проверки видимости: ${head}`).toBeLessThan(key)
      const deps = e.match(/\[([^\]]*)\]\s*,?\s*\)$/)
      expect(deps?.[1] ?? '', `visible не в зависимостях: ${head}`).toMatch(/\bvisible\b/)
    }
  })

  test('оговорка первой колоды — только у эффекта колоды и только при пустом ключе', () => {
    const deck = loaders.find((e) => e.includes('deckKey.current = deckWant'))!
    expect(deck.replace(/\s+/g, ' ')).toContain(`if (${FIRST_DECK}) return`)
    // самолечение и лайки выходят из скрытой вкладки без оговорок
    for (const e of loaders.filter((x) => x !== deck)) {
      expect(e.replace(/\s+/g, ' ')).not.toContain(FIRST_DECK)
    }
  })

  /*
   * Колоду нового раунда скрытая вкладка не грузит — значит, пусто на руках
   * там не значит «отсвайпал». Без deckSize в аргументах ожидания deckBehind
   * (lib/room) слеп, и двое ждущих в скрытых вкладках висели бы на «ждём
   * остальных», видя друг друга «ещё свайпает».
   */
  test('ожидание знает серверный размер колоды — отставшая колода не «ждёт остальных»', () => {
    const waitArgs = room.match(/const waitArgs = \{([^}]*)\}/)
    expect(waitArgs, 'waitArgs не найден').not.toBeNull()
    expect(waitArgs![1]).toMatch(/\bdeckSize:\s*state\?\.room\.deckSize\b/)
    expect(room).toMatch(/\bwaitsInBackground\(waitArgs\)/)
    expect(room).toMatch(/\bawaitingOthers\(\{\s*\.\.\.waitArgs\b/)
  })
})
