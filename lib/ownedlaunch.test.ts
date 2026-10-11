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

  /*
   * «Уже прошёл» рядом с «Запустить» — тот же островок и тот же ответ
   * владения, ничего в разметке ISR. Плюс два условия: сессия может писать
   * (по вставленной ссылке бан не записать — и кнопка не должна обещать
   * обратного) и у игры есть финал (у Dota 2 «пройти» нечего).
   */
  test('«Уже прошёл» на странице игры — владельцу-писателю и только у игры с финалом', () => {
    const src = code(read('components', 'OwnedLaunch.tsx'))
    const tail = src.slice(src.indexOf('!owns.owned) return null'))
    expect(tail).toMatch(/\{finishable && writer === true && \(\s*<MarkFinished\b/)
    expect(tail).toContain('from="game"')
    const page = code(read('app', 'game', '[appid]', 'page.tsx'))
    expect(page).toMatch(/<OwnedLaunch[^>]*finishable=\{!isReplayable\(meta\)\}/)
  })

  /*
   * «Дальше — в духе X» после отметки — только там, где у игры есть соседи:
   * та же полка, что прячет ссылку «Похожее на X» внизу страницы. Без неё
   * дорога вела бы к экрану «похожих не нашлось», и две ссылки одной
   * страницы спорили бы друг с другом.
   */
  test('«Дальше — в духе X» на странице игры — по той же полке соседей, что ссылка внизу', () => {
    const src = code(read('components', 'OwnedLaunch.tsx'))
    const tail = src.slice(src.indexOf('!owns.owned) return null'))
    expect(tail).toContain('follow={follow}')
    expect(tail).not.toMatch(/\sfollow\s/)
    const page = code(read('app', 'game', '[appid]', 'page.tsx'))
    expect(page).toMatch(/<OwnedLaunch[^>]*follow=\{data\.similar\.length > 0\}/)
    expect(page).toMatch(/\{data\.similar\.length > 0 && \(\s*<Link href=\{quizHref\(null, appid\)\}/)
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
    // steam://run или steam://install, магазин — и у загрузки на телефоне
    // строка вместо ссылки: магазин загрузку не начнёт
    expect(classes, 'ветки: steam://, магазин и строка про загрузку').toHaveLength(3)
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
    const tag = src.slice(src.lastIndexOf('<m.p', at), at)
    expect(tag).toMatch(/\bhidden pointer-fine:block\b/)
  })
})
