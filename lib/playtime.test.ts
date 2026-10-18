import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { demoLibrary, demoLibrary2 } from './demo'
import { minutesByApp } from './libdelta'
import {
  HIDDEN_PLAYTIME_MIN_GAMES,
  minutesHidden,
  playedShort,
  playedWords,
  playtimeHidden,
  timeHiddenStore,
} from './playtime'
import { hiddenLibrary } from './testing/hiddenlibrary'

const NOW = 1_780_000_000

describe('playtimeHidden', () => {
  test('20 игр, у всех нули — время скрыто', () => {
    expect(playtimeHidden(hiddenLibrary())).toBe(true)
  })

  test('меньше десяти игр с нулями — правда про нули, а не галочка', () => {
    expect(playtimeHidden(hiddenLibrary(HIDDEN_PLAYTIME_MIN_GAMES - 1))).toBe(false)
    expect(playtimeHidden(hiddenLibrary(HIDDEN_PLAYTIME_MIN_GAMES))).toBe(true)
    expect(playtimeHidden([])).toBe(false)
  })

  test('одна минута хоть в одной игре — время открыто', () => {
    const lib = hiddenLibrary()
    lib[7] = { ...lib[7], playtimeForever: 1 }
    expect(playtimeHidden(lib)).toBe(false)
  })

  // Нулевые две недели не требуются: ненулевые при нуле за всё время —
  // противоречие, которое само говорит о скрытом времени
  test('минуты за две недели при нуле за всё время признак не снимают', () => {
    const lib = hiddenLibrary()
    lib[0] = { ...lib[0], playtime2Weeks: 90 }
    expect(playtimeHidden(lib)).toBe(true)
  })

  test('демо-библиотеки под признак не попадают', () => {
    expect(playtimeHidden(demoLibrary(NOW))).toBe(false)
    expect(playtimeHidden(demoLibrary2(NOW))).toBe(false)
  })

  // Прежние снимки живут минутами по appid — правило обязано быть тем же
  test('по минутам прежнего снимка — тот же ответ', () => {
    const opened = hiddenLibrary()
    opened[3] = { ...opened[3], playtimeForever: 1 }
    for (const games of [
      hiddenLibrary(),
      hiddenLibrary(HIDDEN_PLAYTIME_MIN_GAMES - 1),
      opened,
      demoLibrary(NOW),
      [],
    ]) {
      expect(minutesHidden(minutesByApp(games))).toBe(playtimeHidden(games))
    }
  })
})

/**
 * Строка «Похоже, Steam скрывает твоё время…» берёт шаг из PrivacyHelp, а не
 * пишет свою копию: название галочки — слово из чужого интерфейса, и если
 * Steam его поменяет, правка должна быть одна.
 */
describe('строка о скрытом времени', () => {
  const ROOT = path.join(__dirname, '..')
  const code = (rel: string) =>
    fs
      .readFileSync(path.join(ROOT, rel), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

  test('название галочки Steam в коде — ровно один раз', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`
        if (e.isDirectory()) walk(rel)
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(rel)
      }
    }
    for (const dir of ['app', 'components', 'lib']) walk(dir)
    const hits = files.flatMap((f) =>
      code(f).includes('Всегда скрывать общее время игры') ? [f] : [],
    )
    expect(hits).toEqual(['components/PrivacyHelp.tsx'])
  })

  test('/play и /library показывают строку при скрытом времени', () => {
    expect(code('app/[lang]/play/page.tsx')).toMatch(/timeHidden && \(\s*<div[^>]*>\s*<PlaytimeHiddenNote/)
    expect(code('app/[lang]/library/page.tsx')).toMatch(/timeHidden && <PlaytimeHiddenNote/)
  })

  // Пилюля квиза и строка ожидания рисуются раньше ответа сервера: признак им
  // приносит устройство. Пишут его выдача и прогрев, гасит выход
  test('признак на устройстве: пишет /play, читают квиз и строка ожидания, гасит выход', () => {
    const play = code('app/[lang]/play/page.tsx')
    expect(play).toContain('timeHiddenStore.set(deal.playtimeHidden ? true : null)')
    expect(play).toContain('timeHiddenStore.set(p.library.timeHidden ? true : null)')
    expect(play).toMatch(/timeHiddenStore\.fresh\(\)\s*\?\s*'Ищу в твоей библиотеке…'/)
    expect(code('app/[lang]/quiz/page.tsx')).toMatch(/timeHidden \? 'Из своей библиотеки' : 'Ни разу не запускал'/)
    expect(code('components/SignOut.tsx')).toContain('timeHiddenStore.set(null)')
  })
})

/**
 * «0 ч» рядом с непустой полосой — неправда: игру запускали, просто меньше
 * получаса. /library это уже знала, а портрет и /compat — шеринговые
 * страницы — писали ноль, и на /compat «0 ч | 0 ч» читалось «никто не играл».
 */
describe('playedShort', () => {
  test('меньше получаса — минуты, а не «0 ч»', () => {
    expect(playedShort(20)).toBe('20 мин')
    expect(playedShort(1)).toBe('1 мин')
    expect(playedShort(29)).toBe('29 мин')
  })

  test('от получаса — округлённые часы, как раньше', () => {
    expect(playedShort(30)).toBe('1 ч')
    expect(playedShort(6000)).toBe('100 ч')
    // тысячи — с разрядами, как у прежней подписи через toLocaleString
    expect(playedShort(1234 * 60)).toBe(`${(1234).toLocaleString('ru-RU')} ч`)
  })

  test('ноль — честные «0 ч»: игра в пересечении есть, но её не запускали', () => {
    expect(playedShort(0)).toBe('0 ч')
  })

  /**
   * /library держала своё правило по месту и уже разошлась: «1234 ч» без
   * разрядов против «1 234 ч» портрета. Одно правило — одна функция.
   */
  test('портрет, /compat и плитки /library подписывают часы через неё, а не «{hours} ч»', () => {
    const ROOT = path.join(__dirname, '..')
    const portrait = fs.readFileSync(path.join(ROOT, 'app/[lang]/portrait/[steamid]/page.tsx'), 'utf8')
    const compat = fs.readFileSync(path.join(ROOT, 'app/[lang]/compat/[steamid]/page.tsx'), 'utf8')
    const library = fs.readFileSync(path.join(ROOT, 'app/[lang]/library/page.tsx'), 'utf8')
    // Вторым аргументом страница передаёт свой язык (playedShort(minutes, locale)) —
    // сторож про то, ЧЕМ подписаны часы, а не про то, на каком языке
    expect(portrait).toMatch(/\{playedShort\(g\.minutes(?:,\s*\w+)?\)\}/)
    expect(portrait).not.toMatch(/g\.hours\.toLocaleString\('ru-RU'\)\} ч/)
    expect(compat).toMatch(/playedShort\(m(?:,\s*\w+)?\)/)
    expect(library).toMatch(/\{playedShort\(g\.playtimeForever(?:,\s*\w+)?\)\}/)
    expect(library).not.toMatch(/`\$\{hours\} ч`/)
    expect(library).not.toMatch(/\} мин`/)
  })
})

/**
 * Итог прозой над строками playedShort: порог обязан быть тем же, иначе над
 * «20 мин | 5 мин» стоит «Вместе в них — 0 часов».
 */
describe('playedWords', () => {
  test('меньше получаса — минуты со склонением', () => {
    expect(playedWords(25)).toBe('25 минут')
    expect(playedWords(1)).toBe('1 минута')
    expect(playedWords(22)).toBe('22 минуты')
    expect(playedWords(29)).toBe('29 минут')
  })

  test('от получаса — округлённые часы, тысячи с разрядами', () => {
    expect(playedWords(30)).toBe('1 час')
    expect(playedWords(3 * 60)).toBe('3 часа')
    expect(playedWords(1235 * 60)).toBe(`${(1235).toLocaleString('ru-RU')} часов`)
  })

  test('ноль — «0 часов»: общие игры есть, их не запускали', () => {
    expect(playedWords(0)).toBe('0 часов')
  })
})

describe('timeHiddenStore', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // Значение из чужих рук: всё, кроме настоящего true, — «не знаем»
  test('хранится только true; мусор и false — null', () => {
    const data: Record<string, string> = {}
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (Object.hasOwn(data, k) ? data[k] : null),
      setItem: (k: string, v: string) => {
        data[k] = v
      },
      removeItem: (k: string) => {
        delete data[k]
      },
    })
    timeHiddenStore.set(true)
    expect(timeHiddenStore.fresh()).toBe(true)
    for (const raw of ['false', '"true"', '1', '{"hidden":true}', '{не json']) {
      data['imbored.time-hidden'] = raw
      expect(timeHiddenStore.fresh(), raw).toBeNull()
    }
    timeHiddenStore.set(true)
    timeHiddenStore.set(null)
    expect(data).toEqual({})
    expect(timeHiddenStore.fresh()).toBeNull()
  })
})

/** Английская версия: те же пороги, сокращения из глоссария, разряды по-английски */
describe('playedShort и playedWords по-английски', () => {
  const CYRILLIC = /[А-Яа-яЁё]/

  test('playedShort: «min» и «h», тысячи через запятую', () => {
    expect(playedShort(20, 'en')).toBe('20 min')
    expect(playedShort(29, 'en')).toBe('29 min')
    expect(playedShort(30, 'en')).toBe('1 h')
    expect(playedShort(6000, 'en')).toBe('100 h')
    expect(playedShort(1234 * 60, 'en')).toBe('1,234 h')
    expect(playedShort(0, 'en')).toBe('0 h')
  })

  test('playedWords: одна минута и один час — в единственном, ноль — во множественном', () => {
    expect(playedWords(1, 'en')).toBe('1 minute')
    expect(playedWords(25, 'en')).toBe('25 minutes')
    expect(playedWords(30, 'en')).toBe('1 hour')
    expect(playedWords(3 * 60, 'en')).toBe('3 hours')
    expect(playedWords(1235 * 60, 'en')).toBe('1,235 hours')
    expect(playedWords(0, 'en')).toBe('0 hours')
  })

  test('ни одной русской буквы и не шире русской подписи в колонке', () => {
    for (const m of [0, 1, 20, 29, 30, 90, 6000, 1234 * 60, 99_999 * 60]) {
      expect(playedShort(m, 'en'), String(m)).not.toMatch(CYRILLIC)
      expect(playedWords(m, 'en'), String(m)).not.toMatch(CYRILLIC)
      expect(playedShort(m, 'en').length, String(m)).toBeLessThanOrEqual(playedShort(m).length)
    }
  })

  test('явный ru — та же строка, что без языка', () => {
    for (const m of [0, 1, 25, 30, 1234 * 60]) {
      expect(playedShort(m, 'ru')).toBe(playedShort(m))
      expect(playedWords(m, 'ru')).toBe(playedWords(m))
    }
  })
})
