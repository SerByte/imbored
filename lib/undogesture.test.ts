import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test } from 'vitest'

/**
 * Сторож отмены ошибочного жеста на месте.
 *
 * «Зашло» у героя /play и /daily — тумблер (aria-pressed), но второе нажатие
 * не делало ничего: ошибочное сердце снималось только с полки /library.
 * «Мимо» в колоде /explore прятало карту на неделю без обратного хода.
 * Теперь первое снимается тем же нажатием (lib/unlike), второе возвращается
 * кнопкой «Вернуть «X»» под колодой.
 *
 * Логика записи проверена в lib/unlike.test.ts; здесь — что страницы ею
 * пользуются. Браузера в тестах нет, поэтому разметка и обработчики
 * читаются из исходников, как в lib/focushandoff.test.ts: возвращается
 * поломка одной правкой — «if (liked.has(…)) return», голой отправкой
 * «зашло» мимо очереди, таймером на кнопке отмены.
 */

const ROOT = path.join(__dirname, '..')

/** Комментарии гасятся: докблоки цитируют то, что здесь ищется */
const read = (rel: string) =>
  fs
    .readFileSync(path.join(ROOT, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** Без пробелов и переносов: форматтер вправе переложить строки */
const flat = (src: string) => src.replace(/\s+/g, '')

/** Подсказка нажатого сердца — одна на обе страницы */
const PRESSED_TITLE = 'Зашло — нажми, чтобы снять'

describe('«Зашло» у героя снимается тем же нажатием', () => {
  const play = flat(read('app/play/page.tsx'))
  const daily = flat(read('app/daily/page.tsx'))

  test('/play: нажатое сердце снимает «Зашло» через lib/unlike из куска героя, отказ — строкой под героем', () => {
    expect(play).toContain(flat('const heartOn = liked.has(pick.appid)'))
    // Не пришёл кусок (деплой сменил хеш, а вкладка старая) — не мёртвое
    // нажатие: та же строка под героем говорит, что делать
    expect(play).toContain(
      flat("if (heartOn) return void heroTail().then((t) => t.undoLike(pick, setLiked, setHeroMiss), () => setHeroMiss('Обнови страницу'))"),
    )
    // Кусок — тот, что уже грузит «Сыграю вечером»: своего загрузчика /play не заводит
    expect(play).not.toContain(flat("import('@/lib/unlike')"))
    expect(play).not.toMatch(/from'@\/lib\/unlike'/)
    const lazy = flat(read('components/TonightLazy.tsx'))
    expect(lazy).toContain(flat("export const heroTail = () => import('@/components/HeroTail')"))
    expect(lazy).toContain(flat('const loadTonight = () => heroTail().then((m) => m.TonightButton)'))
    const tail = flat(read('components/HeroTail.ts'))
    expect(tail).toContain(flat("export { inTurn, undoLike } from '@/lib/unlike'"))
  })

  test('кусок героя отдаёт /play ту же очередь, что едет на /daily сразу', async () => {
    const { heroTail } = await import('@/components/TonightLazy')
    const tail = await heroTail()
    const unlike = await import('@/lib/unlike')
    // Один модуль на вкладку: «Зашло» с /daily и снятие с /play — одна очередь
    expect(tail.inTurn).toBe(unlike.inTurn)
    expect(tail.undoLike).toBe(unlike.undoLike)
    expect(typeof tail.TonightButton).toBe('function')
  })

  test('/daily: нажатое сердце снимает «Зашло», отказ — строкой под кнопками героя', () => {
    expect(daily).toContain(flat('liked.has(hero.appid) ? void undoLike(hero, setLiked, setRerollMiss) : like()'))
    // «Зацепило» при горящем сердце его не снимает: like() молчит на повтор,
    // его зовёт и ответ на вопрос после запуска
    expect(daily).toMatch(/constlike=\(intent\?:CtxIntent\)=>\{forgetLaunch\(hero\.appid\)if\(liked\.has\(hero\.appid\)\)return/)
    expect(daily).toContain(flat("like('ask')"))
  })

  test('имя кнопки не меняется с нажатием, обратимость — в подсказке', () => {
    for (const [file, code, on] of [
      ['app/play/page.tsx', play, 'heartOn'],
      ['app/daily/page.tsx', daily, 'liked.has(hero.appid)'],
    ] as const) {
      expect(code, file).toContain(flat('aria-pressed={' + on + '}'))
      expect(code, file).toContain(flat('title={' + on + " ? '" + PRESSED_TITLE + "' : 'Зашло'}"))
      expect(code, file).toContain(flat('<span className="sr-only">Зашло</span>'))
    }
  })

  test('каждое «зашло» уходит в очереди записей игры — снятие его не обгонит', () => {
    // /play: одна отправка — в sendLike, через inTurn из куска героя; не
    // пришёл кусок — уходит сразу (send вторым аргументом then)
    expect(play.match(/sendFeedback\([\w.]+,'liked'/g)).toHaveLength(1)
    expect(play).toContain(flat("const send = () => sendFeedback(appid, 'liked', undefined, ctx)"))
    expect(play).toContain(flat('void heroTail().then((t) => t.inTurn(appid, send), send)'))
    // и сердце, и «Зацепило» в «Не зацепило?» — через неё
    expect(play).toContain(flat('sendLike(pick.appid, ctxOf(pick, heroFrom))'))
    expect(play).toContain(flat("sendLike(stopDue.appid, ctxOf(asked, undefined, 'ask'))"))
    // /daily: like() — единственная отправка, и она в очереди
    expect(daily.match(/sendFeedback\([\w.]+,'liked'/g)).toHaveLength(1)
    expect(daily).toContain(flat("void inTurn(hero.appid, () => sendFeedback(hero.appid, 'liked', undefined, ctxOf(hero, intent)))"))
  })
})

describe('«Мимо» в колоде /explore возвращается', () => {
  const page = read('app/explore/page.tsx')
  const code = flat(page)
  const deck = read('components/SwipeDeck.tsx')

  test('вернуть можно только последнее «Мимо»: «Интересно» и новая колода гасят кнопку', () => {
    expect(code).toContain(flat(`setLastSkip(yes ? null : (cards.find((c) => c.appid === card.appid) ?? null))`))
    const show = code.slice(code.indexOf('constshow=useCallback('), code.indexOf('useEffect(()=>{'))
    expect(show).toContain('setLastSkip(null)')
  })

  test('отмена возвращает карту наверх тем же номером и снова пускает голос по ней', () => {
    const at = code.indexOf('constundo=(keyboard:boolean)=>{')
    expect(at, 'undo не найден — сторож ослеп').toBeGreaterThan(-1)
    // Тело — до следующего хука: после undo в файле стоит эффект экрана отказа
    const body = code.slice(at, code.indexOf('useEffect(', at))
    // Без этого второй голос по вернувшейся карте отбросил бы votedIds
    expect(body).toContain('votedIds.current.delete(card.appid)')
    expect(body).toContain('setCards((cs)=>[card,...cs])')
    expect(body).toContain('setVoted((v)=>v-1)')
    // Сервер отмену не пишет: последний свайп перекроет «Мимо» сам (listExploreLiked)
    expect(body).not.toContain('fetch(')
    // Без таймера: кнопка ждёт того, кто идёт к ней Tab'ом (WCAG 2.2.1)
    expect(code).not.toMatch(/setTimeout\([^;]*setLastSkip/)
  })

  /*
   * Отмену сервер не пишет: «Мимо» перекрывает следующий голос по той же
   * игре — если он и в базе ляжет последним. Голая отправка без ожидания
   * этого не обещает: «Мимо» → «Вернуть» → «Интересно», пока первая запись
   * ещё едет, и «Мимо» ложится второй. Очередь записей игры (inTurn) — та
   * же, что держит «Зашло» и его снятие.
   */
  test('голос колоды и «Убрать» с полки уходят в очереди записей игры', () => {
    expect(code).toContain(flat("import { inTurn } from '@/lib/unlike'"))
    const vote = code.slice(code.indexOf('constvote=('), code.indexOf('constundo='))
    expect(vote).toContain(flat("void inTurn(card.appid, () => fetch('/api/feedback',"))
    // Ни одной записи фидбека мимо очереди: обе — голос и «Убрать»
    expect(code.match(/fetch\('\/api\/feedback'/g)).toHaveLength(2)
    expect(code.match(/inTurn\(card\.appid,\(\)=>fetch\('\/api\/feedback'/g)).toHaveLength(2)
  })

  test('о вернувшейся карте говорит строка, которая стоит всегда', () => {
    expect(code).toContain(flat(`<StatusLine text={said} className="sr-only" />`))
    expect(code).not.toContain(flat(`{lastSkip && <StatusLine`))
    // Та же карта, вернутая второй раз, — тот же текст: голос гасит строку
    const vote = code.slice(code.indexOf('constvote=('), code.indexOf('constundo='))
    expect(vote).toContain("setSaid('')")
  })

  test('с клавиатуры фокус встаёт на «Мимо» вернувшейся карты', () => {
    expect(code).toContain("if(keyboard)pendingFocus.current='deck'")
    expect(code).toContain(flat(`target === 'deck' ? document.querySelector<HTMLElement>('.deck-stack button')`))
    expect(code).toContain(flat(`<SwipeDeck key={undone}`))
    // Первая кнопка стопки — «Мимо» верхней карты: у задних карт кнопок нет
    const stack = deck.slice(deck.indexOf('className="deck-stack'))
    expect(stack.indexOf('<button')).toBe(-1)
    const top = deck.slice(deck.indexOf('function TopCard('), deck.indexOf('export function SwipeDeck('))
    expect(top.indexOf('ref={noRef}')).toBeGreaterThan(-1)
    expect(top.indexOf('ref={noRef}')).toBeLessThan(top.indexOf('ref={yesRef}'))
  })
})
