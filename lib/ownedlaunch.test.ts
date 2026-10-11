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

  /*
   * План на вечер (lib/eveningplan.ts) стоит на той же развилке с двух
   * сторон: «Сыграю вечером на ПК» — там, где запустить нельзя, а строка
   * плана с «Запустить» на /play — там, где можно. Перепутай признак — и
   * компьютер получит кнопку «на ПК», а телефон строку без кнопки.
   */
  test('план на вечер: «Сыграю вечером» — под пальцем, строка с запуском — под мышью', () => {
    const tonight = code(read('components', 'TonightButton.tsx'))
    expect(tonight).toMatch(/className="pointer-fine:hidden\b/)
    expect(tonight, 'обещание только тому, чьё нажатие запишется').toMatch(/writer !== true \|\| demo\) return null/)

    const play = code(read('app', 'play', 'page.tsx'))
    const at = play.indexOf('{planLine(planRow)}')
    expect(at).toBeGreaterThan(-1)
    // строка плана — LaunchRow с fineOnly, а fineOnly — это тот самый признак
    expect(play.slice(play.lastIndexOf('<LaunchRow', at), at)).toMatch(/\bfineOnly\b/)
    expect(play).toMatch(/fineOnly \? ' hidden pointer-fine:block' : ''/)
  })

  /*
   * «Открыть в Steam» у своей под пальцем пишется запуском (исход совета), но
   * с intent 'store': он открывает магазин, а не игру, и план на вечер не
   * закрывает. Жмут его как раз после «Сыграю вечером на ПК». Вернётся
   * общий intent 'launch' — и ни один тест поведения не заметит: кнопка
   * работает, а план молча умирает через секунду после того, как поставлен.
   */
  test('ветка нажатия доходит до снимка: магазин под пальцем — intent store', () => {
    const launch = code(read('components', 'SteamLaunch.tsx'))
    expect(launch).toContain("onClick?.('steam')")
    expect(launch).toContain("onClick?.('store')")

    const play = code(read('app', 'play', 'page.tsx'))
    expect(play).toMatch(/const launchIntent = \(via: LaunchVia\): CtxIntent => \(via === 'store' \? 'store' : 'launch'\)/)
    // герой и «Продолжить» — обе ветки SteamLaunch, обе пишут по ветке
    expect(play).toMatch(/onClick=\{\(via\) =>\s*void sendFeedback\(pick\.appid, 'launched', undefined, ctxOf\(pick, heroFrom, launchIntent\(via\)\)\)/)
    expect(play).toMatch(/sendFeedback\(cont\.appid, 'launched', undefined, ctxOf\(null, 'continue', launchIntent\(via\)\)\)/)
    expect(play, 'запуск своей с общим intent launch вернулся').not.toMatch(/ctxOf\(pick, heroFrom, 'launch'\)/)

    const daily = code(read('app', 'daily', 'page.tsx'))
    expect(daily).toMatch(/onClick=\{\(via\) =>[\s\S]{0,240}ctxOf\(hero, via === 'store' \? 'store' : 'launch'\)/)
  })

  /*
   * Строка плана на /play уходит, едва запуск (или бан, или пропуск)
   * записан, — тем же правилом, что у сервера (closesPlan): иначе она
   * переживала бы уход в записи выдачи. И не стоит рядом с той же игрой
   * героем или «Продолжить» (planBeside).
   */
  test('строка плана на /play: не дублирует экран и уходит вместе с планом', () => {
    const play = code(read('app', 'play', 'page.tsx'))
    expect(play).toMatch(/const planRow = roulette \? null : planBeside\(plan, \[pick\.appid, cont\?\.appid\]\)/)
    expect(play).toMatch(/if \(r\.ok && closesPlan\(action, reason, ctx\?\.intent\)\) \{\s*setPlan\(\(p\) => \(p\?\.appid === appid \? null : p\)\)/)
    // кнопка строки уходит вместе с ней — фокус заранее к герою, а не в body
    const row = play.slice(play.indexOf('{planRow && ('), play.indexOf('{planLine(planRow)}'))
    expect(row).toMatch(/onLaunch=\{\(\) => \{\s*focusHero\(true\)/)
  })

  /*
   * «Сыграю вечером» приезжает отдельным куском, и впервые его просят, когда
   * своя игра встаёт героем, — иногда через полчаса после загрузки. Не
   * пришёл — React.lazy без своей границы уводил всю страницу в
   * app/error.tsx. Поэтому загрузчик ловит отказ сам, а кусок прогревается.
   */
  test('«Сыграю вечером»: не пришедший кусок — пустое место, а не поломка страницы', () => {
    const lazy = code(read('components', 'TonightLazy.tsx'))
    expect(lazy).toMatch(/dynamic\(\(\) => loadTonight\(\)\.catch\(/)
    expect(lazy).toMatch(/loadTonight\(\)\.catch\(\(\) => null\)/)
    for (const page of [['app', 'play', 'page.tsx'], ['app', 'daily', 'page.tsx']]) {
      const src = code(read(...page))
      expect(src, page.join('/')).toContain("import { TonightButton, useWarmTonight } from '@/components/TonightLazy'")
      expect(src, page.join('/')).toMatch(/\buseWarmTonight\(\)/)
      expect(src, `${page.join('/')}: кусок в обход загрузчика`).not.toContain("import('@/components/TonightButton')")
    }
  })

  // Запуск со страницы игры пишется только по плану: без него это не совет,
  // а своя игра, и исход совета ему заводить не с чего
  test('OwnedLaunch пишет запуск только по биту plan', () => {
    const src = code(read('components', 'OwnedLaunch.tsx'))
    expect(src).toMatch(/onLaunch=\{\s*owns\.plan\s*\?/)
    expect(src).toContain("ctx: { slot: 'plan', intent: 'launch' }")
  })
})
