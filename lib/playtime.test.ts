import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { demoLibrary, demoLibrary2 } from './demo'
import { minutesByApp } from './libdelta'
import { HIDDEN_PLAYTIME_MIN_GAMES, minutesHidden, playtimeHidden, timeHiddenStore } from './playtime'
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
    expect(code('app/play/page.tsx')).toMatch(/timeHidden && \(\s*<div[^>]*>\s*<PlaytimeHiddenNote/)
    expect(code('app/library/page.tsx')).toMatch(/timeHidden && <PlaytimeHiddenNote/)
  })

  // Пилюля квиза и строка ожидания рисуются раньше ответа сервера: признак им
  // приносит устройство. Пишут его выдача и прогрев, гасит выход
  test('признак на устройстве: пишет /play, читают квиз и строка ожидания, гасит выход', () => {
    const play = code('app/play/page.tsx')
    expect(play).toContain('timeHiddenStore.set(deal.playtimeHidden ? true : null)')
    expect(play).toContain('timeHiddenStore.set(p.library.timeHidden ? true : null)')
    expect(play).toMatch(/timeHiddenStore\.fresh\(\)\s*\?\s*'Ищу в твоей библиотеке…'/)
    expect(code('app/quiz/page.tsx')).toMatch(/timeHidden \? 'Из своей библиотеки' : 'Ни разу не запускал'/)
    expect(code('components/SignOut.tsx')).toContain('timeHiddenStore.set(null)')
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
