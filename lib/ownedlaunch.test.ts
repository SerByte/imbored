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
    // Уже пройденной — слово, а не кнопка второй раз (бит done из того же
    // ответа владения): иначе после перезагрузки «Уже прошёл» возвращалась,
    // хотя игра лежит на полке «Пройдено», и каждое нажатие писало новый бан.
    // Слово — та же строка, что после нажатия (FinishedNote), с той же
    // дорогой дальше и без захвата фокуса: своя копия разметки здесь уже
    // теряла «Дальше — в духе X» (lib/markfinished.test.ts)
    expect(tail).toMatch(
      /\{finishable &&\s*writer === true &&\s*\(owns\.done \? \(\s*<FinishedNote appid=\{appid\} name=\{name\} follow=\{follow\} \/>\s*\) : \(\s*<MarkFinished\b/,
    )
    expect(tail, 'своя копия строки «Пройдено» вернулась в OwnedLaunch').not.toContain('Пройдено — больше не предложу')
    expect(src).toContain('done: d.done === true')
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
    // «Продолжить» запускают в двух местах: строкой под героем и с экрана
    // выгорания («Просто продолжить «X»» — под пальцем «Открыть «X» в
    // Steam»). Второе забыли при переводе на ветку нажатия, и магазинное
    // касание там закрывало план на вечер, как настоящий запуск
    expect(play, 'запуск «Продолжить» с общим intent launch вернулся').not.toMatch(/ctxOf\(null, 'continue', 'launch'\)/)
    expect([...play.matchAll(/ctxOf\(null, 'continue', launchIntent\(via\)\)/g)]).toHaveLength(2)

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
   * «Поставь на загрузку» или «Сыграю вечером на ПК» у героя, а потом «Не то
   * — дальше» — посмотреть, что ещё есть. Пропуск («Просто не сейчас»,
   * «пропустить») закрывает план (closesPlan), и обещание «будет ждать в
   * подборке» умирало через секунду после того, как дано. Отложенного в этом
   * заходе героя «дальше» листает, как сессия по ссылке: без вопроса о
   * причине и без записи — ни пропуска, ни паузы на сутки-трое, прячущей
   * игру как раз до вечера. Помнится только записанный план.
   */
  test('«Не то — дальше» у только что отложенного героя план не закрывает', () => {
    const play = code(read('app', 'play', 'page.tsx'))
    expect(play).toMatch(
      /if \(r\.ok && writesPlan\(action, ctx\?\.intent\)\) setPlanned\(\(a\) => \(a\.includes\(appid\) \? a : \[\.\.\.a, appid\]\)\)/,
    )
    // закрытый план (запустил с героя) память отпускает: «не то» после
    // запуска — снова ответ с причиной
    expect(play).toMatch(
      /if \(r\.ok && closesPlan\(action, reason, ctx\?\.intent\)\) \{\s*setPlan\([^\n]*\)\s*setPlanned\(\(a\) => \(a\.includes\(appid\) \? a\.filter\(\(x\) => x !== appid\) : a\)\)\s*\}/,
    )
    expect(play).toMatch(/if \(readOnly \|\| planned\.includes\(pick\.appid\)\) \{\s*advance\(index\)\s*return\s*\}\s*setAskReason\(true\)/)
    // оба нажатия плана идут через sendFeedback — и попадают в память выше
    expect(play).toMatch(/sendFeedback\(pick\.appid, 'opened', undefined, ctxOf\(pick, heroFrom, 'install'\)\)/)
    expect(play).toMatch(/onPlan=\{\(\) => sendFeedback\(pick\.appid, 'opened', undefined, ctxOf\(pick, heroFrom, 'tonight'\)\)\}/)
  })

  /*
   * Память об отложенных — не только этого монтирования. «Подробнее» →
   * «Назад» и перезагрузка возвращают ту же выдачу из записи на устройстве
   * (lib/playcache), но на новом монтировании, и память, жившая в ref,
   * пустела: «Не то — дальше» у героя, отложенного минуту назад, снова
   * спрашивал причину, а «Просто не сейчас» закрывал план. Поэтому список —
   * состояние: его видит эффект записи выдачи (ref, тронутый после «Сыграю
   * вечером», до записи не доходил, если следующим нажатием было ⓘ), и
   * восстановленная выдача приносит его обратно. И «Сыграю вечером» у
   * отложенного героя после «Назад» не зовёт отложить его второй раз.
   */
  test('отложенные на вечер переживают «Подробнее» → «Назад» вместе с выдачей', () => {
    const play = code(read('app', 'play', 'page.tsx'))
    expect(play).not.toMatch(/\bplannedHere\b/)
    expect(play).toMatch(/const \[planned, setPlanned\] = useState<number\[\]>\(\[\]\)/)
    // запись выдачи несёт список и пишется заново, когда он меняется
    const at = play.indexOf('playCacheStore.set({')
    const write = play.slice(at, play.indexOf('useEffect(', at))
    expect(write).toMatch(/liked: \[\.\.\.liked\],\s*planned,\s*\}\)/)
    expect(write).toMatch(/\}, \[[^\]]*\bplanned\b[^\]]*\]\)/)
    // восстановленная выдача приносит его обратно — той же дверью, что и «Зашло»
    const apply = play.slice(play.indexOf('const applyDeal = useCallback('), at)
    expect(apply).toMatch(/back\?: \{ index: number; at: number; liked: number\[\]; planned: number\[\] \}/)
    expect(apply).toMatch(/if \(back\) \{\s*setLiked\(new Set\(back\.liked\)\)\s*setPlanned\(back\.planned\)\s*\}/)
    expect(play).toMatch(/applyDeal\(back\.deal, back\)/)
    // «Сыграю вечером» у отложенного героя встаёт уже нажатой
    expect(play).toMatch(/<TonightButton\s+key=\{pick\.appid\}\s+initialDone=\{planned\.includes\(pick\.appid\)\}/)
    const tonight = code(read('components', 'TonightButton.tsx'))
    expect(tonight).toMatch(/useState<boolean \| null>\(initialDone \|\| null\)/)
  })

  /*
   * «Сыграю вечером» приезжает отдельным куском, и впервые его просят, когда
   * своя игра встаёт героем, — иногда через полчаса после загрузки. Не
   * пришёл — React.lazy без своей границы уводил всю страницу в
   * app/error.tsx. Поэтому загрузчик ловит отказ сам, а кусок прогревается.
   */
  test('«Сыграю вечером»: не пришедший кусок — пустое место, а не поломка страницы', () => {
    const lazy = code(read('components', 'TonightLazy.tsx'))
    expect(lazy).toMatch(/lazyIsland\(\(\) => loadTonight\(\)\.catch\(/)
    expect(lazy).toMatch(/loadTonight\(\)\.catch\(\(\) => null\)/)
    for (const page of [['app', 'play', 'page.tsx'], ['app', 'daily', 'page.tsx']]) {
      const src = code(read(...page))
      expect(src, page.join('/')).toContain("import { TonightButton, useWarmTonight } from '@/components/TonightLazy'")
      expect(src, page.join('/')).toMatch(/\buseWarmTonight\(\)/)
      expect(src, `${page.join('/')}: кусок в обход загрузчика`).not.toContain("import('@/components/TonightButton')")
    }
  })

  /*
   * «Вернуться к ней» / «Запустить» в «Твоих вечерах» — тоже запуск сайта.
   * У игры плана он пишется так же, как со страницы игры (слот plan) и
   * закрывает план; у остальных — по-прежнему ничего: это своя игра, и вкус
   * от каждого нажатия на полке не должен меняться. onLaunch, а не onClick:
   * «Открыть в Steam» под пальцем — магазин, и план он не закрывает.
   */
  test('«Твои вечера» пишут запуск только игре живого плана, и только настоящий', () => {
    const src = code(read('components', 'Evenings.tsx'))
    const launch = src.slice(src.indexOf('<SteamLaunch'), src.indexOf('/>', src.indexOf('<SteamLaunch')))
    // план своей игры, а не один самый свежий: живых бывает несколько
    expect(launch).toMatch(/onLaunch=\{plans\.includes\(item\.appid\) \? \(\) => closePlan\(item\.appid\) : undefined\}/)
    expect(launch).not.toMatch(/\bonClick=/)
    expect(src).toContain("ctx: { source: 'library', slot: 'plan', intent: 'launch' }")
    const page = code(read('app', 'library', 'page.tsx'))
    expect(page).toMatch(
      /writer && !isDemoId\(steamid\)\s*\? livePlanAppids\(db, steamid, nowSec\(\)\)\.catch\(\(\) => new Set<number>\(\)\)\s*: new Set<number>\(\)/,
    )
    expect(page).not.toMatch(/\blatestEveningPlan\(/)
    expect(page).toMatch(/<Evenings[^>]*plans=\{eveningPlans\}/)
  })

  // Запуск со страницы игры пишется только по плану: без него это не совет,
  // а своя игра, и исход совета ему заводить не с чего
  test('OwnedLaunch пишет запуск только по биту plan', () => {
    const src = code(read('components', 'OwnedLaunch.tsx'))
    expect(src).toMatch(/onLaunch=\{\s*owns\.plan\s*\?/)
    expect(src).toContain("ctx: { slot: 'plan', intent: 'launch' }")
  })

  /*
   * Заход — вкладка, а не настроение. «Изменить настроение» ведёт через квиз
   * на /play с другим ключом: выдачу не вернуть, и список отложенных
   * начинался пустым — а первая новая выдача записывала пустой поверх
   * единственной записи. Своя игра, отложенная минуту назад, приходила
   * героем снова, и «Не то — дальше» → «Просто не сейчас» закрывал план.
   * Отложенные из свежей записи ждут первую новую выдачу (heldOver) и
   * сливаются в список, только если она того же человека.
   */
  test('отложенные на вечер переживают и смену настроения', () => {
    const play = code(read('app', 'play', 'page.tsx'))
    const run = play.slice(play.indexOf('async function run()'), play.indexOf('if (warmIsFresh(mark, viewer, Date.now()))'))
    // одни и те же баны и для выдачи, и для списка без неё
    expect(run).toMatch(/const back = restoreDeal\(entry, \{ key: cacheKey, viewer, nowMs: Date\.now\(\), banned \}\)/)
    expect(run).toMatch(/heldOver\.current = back \? null : heldPlanned\(entry, \{ nowMs: Date\.now\(\), banned \}\)/)
    const apply = play.slice(play.indexOf('const applyDeal = useCallback('), play.indexOf('playCacheStore.set({'))
    expect(apply).toMatch(
      /\} else if \(heldOver\.current\) \{\s*const held = heldOver\.current\s*heldOver\.current = null\s*if \(held\.viewer === deal\.viewer\) setPlanned\(/,
    )
  })

  /*
   * План закрывают и не на /play: «Запустить» со страницы игры (бит plan),
   * из «Твоих вечеров», запуск и «Не сегодня» у «Игры дня». «Поставь на
   * загрузку» → ⓘ «Подробнее» → «Запустить» → «Назад» возвращал героя
   * отложенным: «Не то — дальше» молча листал, и ответ про игру, которую
   * на деле запустили, терялся. Записанное закрытие вычёркивает игру из
   * записи выдачи (lib/planforget) — лёгким модулем, а не разбором выдачи
   * (lib/lightsplit.test.ts), — а /play читает запись из хранилища, а не из
   * памяти вкладки, где модуль выдачи держит прежнюю копию.
   */
  test('план, закрытый не на /play, выдача на устройстве забывает', () => {
    const owned = code(read('components', 'OwnedLaunch.tsx'))
    const onLaunch = owned.slice(owned.indexOf('owns.plan'), owned.indexOf(': undefined', owned.indexOf('owns.plan')))
    expect(onLaunch).toMatch(/if \(await isNeedSteam\(r\)\) writerStore\.set\(false\)\s*else if \(r\.ok\) forgetPlanned\(appid\)/)

    const evenings = code(read('components', 'Evenings.tsx'))
    const close = evenings.slice(evenings.indexOf('const closePlan ='), evenings.indexOf('async function answer('))
    expect(close).toMatch(/if \(await isNeedSteam\(r\)\) setDenied\(true\)\s*else if \(r\.ok\) forgetPlanned\(appid\)/)

    // у «Игры дня» — тем же правилом, что сервер: магазин под пальцем и «Зашло» план не закрывают
    const daily = code(read('app', 'daily', 'page.tsx'))
    const send = daily.slice(daily.indexOf('async function sendFeedback('), daily.indexOf('export default function DailyPage'))
    expect(send).toMatch(/else if \(r\.ok && closesPlan\(action, reason, ctx\.intent\)\) forgetPlanned\(appid\)/)

    for (const src of [owned, evenings, daily]) {
      expect(src).toContain("import { forgetPlanned } from '@/lib/planforget'")
    }
    const play = code(read('app', 'play', 'page.tsx'))
    expect(play).toMatch(/const entry = playCacheStore\.fresh\(\)/)
    expect(play).not.toMatch(/playCacheStore\.get\(\)/)
  })
})
