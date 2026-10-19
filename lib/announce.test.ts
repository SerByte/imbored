import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { freshLine, liveLineOn, playLine, type PlayEvent } from './announce'

describe('playLine', () => {
  test('каждая смена героя называет игру, которая теперь на экране', () => {
    const events: PlayEvent[] = [
      { kind: 'reveal', name: 'Balatro' },
      { kind: 'restore', name: 'Balatro' },
      { kind: 'next', name: 'Balatro' },
      { kind: 'pick', name: 'Balatro' },
      { kind: 'reshape', name: 'Balatro' },
      { kind: 'seed', name: 'Balatro', seed: 'Hades' },
      { kind: 'refresh', name: 'Balatro' },
    ]
    for (const e of events) expect(playLine(e), e.kind).toContain('«Balatro»')
    // и строки разные: по звуку надо отличить «дальше» от «пересобрал»
    expect(new Set(events.map((e) => playLine(e))).size).toBe(events.length)
  })

  test('«Как «X», но…» называет и затравку, и игру на экране', () => {
    expect(playLine({ kind: 'seed', name: 'Dead Cells', seed: 'Hades' })).toBe(
      'Похожие на «Hades». Первая игра: «Dead Cells»',
    )
  })

  test('бан говорит и что ушло, и что пришло на его место', () => {
    const line = playLine({ kind: 'ban', name: 'Dota 2', done: false, next: 'Terraria' })
    expect(line).toContain('«Dota 2» больше не покажу')
    expect(line).toContain('Следующая игра: «Terraria»')
  })

  /*
   * Бан ждёт сервера, и к ответу на экране мог стоять другой герой, экран
   * выгорания или ожидания. Там «Следующая игра: …» назвала бы не то, что
   * видно, а молчание оставило бы необратимое действие без подтверждения.
   */
  test('бан без героя на виду говорит только, что записано', () => {
    expect(playLine({ kind: 'ban', name: 'Dota 2', done: false })).toBe('«Dota 2» больше не покажу')
    expect(playLine({ kind: 'ban', name: 'Portal 2', done: true })).toBe('«Portal 2» отмечена пройденной')
  })

  test('«Уже прошёл» — не «больше не покажу»: игра кончилась, а не разонравилась', () => {
    const line = playLine({ kind: 'ban', name: 'Portal 2', done: true, next: 'Hades' })
    expect(line).toContain('«Portal 2» отмечена пройденной')
    expect(line).not.toContain('больше не покажу')
  })

  test('вопрос о причине говорит, что ответ необязателен', () => {
    expect(playLine({ kind: 'ask' })).toBe('Почему не то? Выбери причину или пропусти')
  })

  /*
   * Экран ошибки подменяет экран ожидания целиком, и единственная говорившая
   * область (строка прогресса WarmupScreen) уходит вместе с ним. Отказ звучит
   * областью страницы — и целиком: заголовок без абзаца не говорит, что делать.
   */
  test('отказ называет и что случилось, и что делать', () => {
    expect(
      playLine({ kind: 'fail', title: 'Библиотека не доехала', text: 'Steam не отдал список игр.' }),
    ).toBe('Библиотека не доехала. Steam не отдал список игр.')
  })
})

/**
 * Английская версия /play: те же события, те же правила — название игры в
 * каждой строке и строки, различимые на слух. Шаблоны целые, не склейка.
 */
describe('playLine по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/

  test('каждая смена героя называет игру, и строки разные', () => {
    const events: PlayEvent[] = [
      { kind: 'reveal', name: 'Balatro' },
      { kind: 'restore', name: 'Balatro' },
      { kind: 'next', name: 'Balatro' },
      { kind: 'pick', name: 'Balatro' },
      { kind: 'reshape', name: 'Balatro' },
      { kind: 'seed', name: 'Balatro', seed: 'Hades' },
      { kind: 'refresh', name: 'Balatro' },
    ]
    const lines = events.map((e) => playLine(e, 'en'))
    for (const [i, line] of lines.entries()) {
      expect(line, events[i].kind).toContain('“Balatro”')
      expect(line, events[i].kind).not.toMatch(CYRILLIC)
    }
    expect(new Set(lines).size).toBe(events.length)
  })

  test('точные строки', () => {
    expect(playLine({ kind: 'reveal', name: 'Hades' }, 'en')).toBe('Found a game: “Hades”')
    expect(playLine({ kind: 'restore', name: 'Hades' }, 'en')).toBe('Picks from your last visit. On screen: “Hades”')
    expect(playLine({ kind: 'next', name: 'Hades' }, 'en')).toBe('Next game: “Hades”')
    expect(playLine({ kind: 'pick', name: 'Hades' }, 'en')).toBe('Now on screen: “Hades”')
    expect(playLine({ kind: 'reshape', name: 'Hades' }, 'en')).toBe('Picks rebuilt. First game: “Hades”')
    expect(playLine({ kind: 'seed', name: 'Dead Cells', seed: 'Hades' }, 'en')).toBe(
      'Similar to “Hades”. First game: “Dead Cells”',
    )
    expect(playLine({ kind: 'refresh', name: 'Hades' }, 'en')).toBe('Picks refreshed. First game: “Hades”')
    expect(playLine({ kind: 'ask' }, 'en')).toBe("What's off? Pick a reason or skip")
  })

  test('бан: что ушло, что пришло, и «Уже прошёл» — не «больше не покажу»', () => {
    expect(playLine({ kind: 'ban', name: 'Dota 2', done: false, next: 'Terraria' }, 'en')).toBe(
      "Won't show “Dota 2” again. Next game: “Terraria”",
    )
    expect(playLine({ kind: 'ban', name: 'Dota 2', done: false }, 'en')).toBe("Won't show “Dota 2” again")
    const done = playLine({ kind: 'ban', name: 'Portal 2', done: true, next: 'Hades' }, 'en')
    expect(done).toBe('“Portal 2” marked as finished. Next game: “Hades”')
    expect(done).not.toContain("Won't show")
  })

  test('отказ — заголовок и абзац как пришли', () => {
    expect(
      playLine({ kind: 'fail', title: "Your library didn't come through", text: "Steam didn't send the game list." }, 'en'),
    ).toBe("Your library didn't come through. Steam didn't send the game list.")
  })

  test('по умолчанию — русский, как раньше', () => {
    expect(playLine({ kind: 'next', name: 'Hades' })).toBe(playLine({ kind: 'next', name: 'Hades' }, 'ru'))
  })
})

describe('freshLine', () => {
  test('новая строка идёт как есть', () => {
    expect(freshLine('Следующая игра: «A»', 'Следующая игра: «B»')).toBe('Следующая игра: «B»')
    expect(freshLine('', 'Подобрал игру: «A»')).toBe('Подобрал игру: «A»')
  })

  test('повтор подряд меняет узел, не меняя слов', () => {
    const line = 'Следующая игра: «A»'
    const second = freshLine(line, line)
    expect(second).not.toBe(line)
    expect(second.trim()).toBe(line)
    // третий повтор снова отличается от второго — и так сколько угодно раз
    expect(freshLine(second, line)).toBe(line)
  })
})

/**
 * Русское название на /en — своим lang="ru": иначе английский голос читает
 * кириллицу по буквам. Латинское и русская страница — та же строка как есть.
 */
describe('liveLineOn', () => {
  const html = (node: ReactNode) => renderToStaticMarkup(createElement('p', { role: 'status' }, node))

  test('на /en русские названия — под lang="ru", остальное — голосом страницы', () => {
    const line = playLine({ kind: 'ban', name: 'Смута', done: false, next: 'Одни из нас™: Часть II' }, 'en')
    expect(html(liveLineOn('en', line))).toBe(
      '<p role="status">Won&#x27;t show “<span lang="ru">Смута</span>” again. Next game: “<span lang="ru">Одни из нас™: Часть II</span>”</p>',
    )
    expect(html(liveLineOn('en', playLine({ kind: 'seed', name: 'Смута', seed: 'Hades' }, 'en')))).toBe(
      '<p role="status">Similar to “Hades”. First game: “<span lang="ru">Смута</span>”</p>',
    )
  })

  test('латинское название и строка без названия — та же строка, без пометок', () => {
    const line = playLine({ kind: 'next', name: 'Hades' }, 'en')
    expect(liveLineOn('en', line)).toBe(line)
    expect(liveLineOn('en', playLine({ kind: 'ask' }, 'en'))).toBe(playLine({ kind: 'ask' }, 'en'))
  })

  test('повтор freshLine переживает пометку: слова те же, узел другой', () => {
    const line = playLine({ kind: 'next', name: 'Смута' }, 'en')
    const again = freshLine(line, line)
    expect(html(liveLineOn('en', again))).not.toBe(html(liveLineOn('en', line)))
    expect(html(liveLineOn('en', again))).toContain('<span lang="ru">Смута</span>')
  })

  test('на русской странице — строка как есть, одним текстовым узлом', () => {
    const line = playLine({ kind: 'next', name: 'Смута' })
    expect(liveLineOn('ru', line)).toBe(line)
  })
})
