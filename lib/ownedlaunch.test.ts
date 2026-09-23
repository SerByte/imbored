import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож «Запустить только владельцу».
 *
 * steam://run у того, у кого игры нет, открывает клиент Steam с окном покупки.
 * На странице игры кнопка стояла у каждого читателя — страница общая и живёт
 * на ISR, про сессию не знает, — а в церемонии матча у каждого участника, хотя
 * колода берёт и игры «не у всех». Обратно это возвращается одной строкой
 * импорта, и ни один тест поведения этого не заметит: кнопка ведь работает.
 */

const ROOT = path.join(__dirname, '..')
const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf8')
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('кнопка запуска', () => {
  test('страница игры не рисует запуск сама — только через OwnedLaunch', () => {
    const page = code(read('app', 'game', '[appid]', 'page.tsx'))
    expect(page).not.toMatch(/<SteamLaunch\b/)
    expect(page).toMatch(/<OwnedLaunch\b/)
  })

  test('OwnedLaunch спрашивает владение и не спрашивает гостя', () => {
    const src = code(read('components', 'OwnedLaunch.tsx'))
    expect(src).toContain('/api/session/owns?appid=')
    // признак сессии — из ответа touch, а не догадка; без него запроса нет
    expect(src).toMatch(/if \(!hasSession\) return/)
    // кнопка — только на явное «да»
    expect(src).toMatch(/!owns\.owned\)\s*return null/)
  })

  test('в церемонии матча запуск — только ветка владельца', () => {
    const src = code(read('components', 'MatchCeremony.tsx'))
    const launches = [...src.matchAll(/<SteamLaunch\b/g)]
    expect(launches).toHaveLength(1)
    // сразу перед кнопкой — условие владения, и ничего между ними
    expect(src.slice(0, launches[0].index)).toMatch(/ownedByMe === true\s*\?\s*\(\s*$/)
  })

  /**
   * Развилка «запустить / открыть в магазине» — по устройству, а не по ширине.
   *
   * Стояло `hidden md:inline-block`, и ни один планшет не попадал в мобильную
   * ветку: iPad и телефон в альбоме получали мёртвую steam://run, а /play через
   * десять минут ещё и спрашивал «не зацепило?» про игру, которую никто не
   * запускал. Возвращается это одной правкой класса, и ни один тест поведения
   * этого не заметит: на десктопе кнопка работает.
   */
  test('SteamLaunch разветвляется по указателю, а не по брейкпоинту', () => {
    const src = code(read('components', 'SteamLaunch.tsx'))
    const classes = [...src.matchAll(/className=\{`([^`]*)`\}/g)].map((m) => m[1])
    expect(classes, 'две ветки: steam://run и магазин').toHaveLength(2)
    for (const cls of classes) {
      expect(cls).toMatch(/\bpointer-fine:(?:hidden|inline-block)\b/)
      expect(cls, 'ширина окна не говорит, умеет ли устройство steam://').not.toMatch(
        /\b(?:sm|md|lg|xl|2xl):/,
      )
    }
  })

  test('правило остановки под героем /play стоит на том же признаке, что и кнопка', () => {
    const src = code(read('app', 'play', 'page.tsx'))
    const at = src.indexOf('stopRuleLine(')
    expect(at).toBeGreaterThan(-1)
    const tag = src.slice(src.lastIndexOf('<motion.p', at), at)
    expect(tag).toMatch(/\bhidden pointer-fine:block\b/)
  })
})
