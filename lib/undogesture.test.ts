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
 * кнопкой «Вернуть «X»» у колоды (на телефоне — над ней).
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
  const play = flat(read('app/[lang]/play/page.tsx'))
  const daily = flat(read('app/[lang]/daily/page.tsx'))

  test('/play: нажатое сердце снимает «Зашло» через lib/unlike из куска героя, отказ — строкой под героем', () => {
    expect(play).toContain(flat('const heartOn = liked.has(pick.appid)'))
    // Не пришёл кусок (деплой сменил хеш, а вкладка старая) — не мёртвое
    // нажатие: та же строка под героем говорит, что делать
    expect(play).toContain(
      flat("if (heartOn) return void heroTail().then((t) => t.undoLike('play', pick, setLiked, setHeroMiss), () => setHeroMiss('Обнови страницу'))"),
    )
    // Кусок — тот, что уже грузит «Сыграю вечером»: своего загрузчика /play не заводит
    expect(play).not.toContain(flat("import('@/lib/unlike')"))
    expect(play).not.toMatch(/from'@\/lib\/unlike'/)
    const lazy = flat(read('components/TonightLazy.tsx'))
    expect(lazy).toContain(flat("export const heroTail = () => import('@/components/HeroTail')"))
    expect(lazy).toContain(flat('const loadTonight = () => heroTail().then((m) => m.TonightButton)'))
    const tail = flat(read('components/HeroTail.ts'))
    expect(tail).toContain(flat("export { inTurn, sendLike, undoLike } from '@/lib/unlike'"))
  })

  test('кусок героя отдаёт /play ту же очередь, что едет на /daily сразу', async () => {
    const { heroTail } = await import('@/components/TonightLazy')
    const tail = await heroTail()
    const unlike = await import('@/lib/unlike')
    // Один модуль на вкладку: «Зашло» с /daily и снятие с /play — одна очередь
    expect(tail.inTurn).toBe(unlike.inTurn)
    expect(tail.sendLike).toBe(unlike.sendLike)
    expect(tail.undoLike).toBe(unlike.undoLike)
    expect(typeof tail.TonightButton).toBe('function')
  })

  test('/daily: нажатое сердце снимает «Зашло», отказ — строкой под кнопками героя', () => {
    // Язык страницы — в отказ: иначе строка «Не вышло снять…» на /en по-русски
    expect(daily).toContain(flat("liked.has(hero.appid) ? void undoLike('daily', hero, setLiked, setRerollMiss, locale) : like()"))
    // «Зацепило» при горящем сердце его не снимает: like() молчит на повтор,
    // его зовёт и ответ на вопрос после запуска
    expect(daily).toMatch(/constlike=\(intent\?:CtxIntent\)=>\{forgetLaunch\(hero\.appid\)if\(liked\.has\(hero\.appid\)\)return/)
    expect(daily).toContain(flat("like('ask')"))
  })

  test('имя кнопки не меняется с нажатием, обратимость — в подсказке', () => {
    for (const [file, code, on] of [
      ['app/[lang]/play/page.tsx', play, 'heartOn'],
    ] as const) {
      expect(code, file).toContain(flat('aria-pressed={' + on + '}'))
      expect(code, file).toContain(flat('title={' + on + " ? '" + PRESSED_TITLE + "' : 'Зашло'}"))
      expect(code, file).toContain(flat('<span className="sr-only">Зашло</span>'))
    }
    // /daily говорит на языке страницы (tr): русская ветка — те же слова
    const on = 'liked.has(hero.appid)'
    expect(daily).toContain(flat('aria-pressed={' + on + '}'))
    expect(daily).toContain(flat('ru: ' + on + " ? '" + PRESSED_TITLE + "' : 'Зашло',"))
    expect(daily).toContain(flat('en: ' + on + " ? 'Liked it — tap to undo' : 'Liked it',"))
    expect(daily).toContain(flat(`<span className="sr-only">{tr(locale, { ru: 'Зашло', en: 'Liked it' })}</span>`))
  })

  /*
   * «Зашло» уходит через sendLike из lib/unlike, а не голым sendFeedback
   * страницы: там оно встаёт в очередь записей игры и запоминает строку,
   * которую легло, — её одну и снимает второе нажатие сердца того же героя
   * ('play' или 'daily'), а не прежние «зашло» игры, которых сердце не
   * показывало. Голая отправка снова снимала бы нечего — или, без строки,
   * пришлось бы снимать всё.
   */
  test('каждое «зашло» уходит в очереди записей игры и со своей строкой — снятие его не обгонит', () => {
    // /play: одна отправка — в sendLike, из куска героя; не пришёл кусок —
    // уходит сразу (send вторым аргументом then), и снимать тогда нечем:
    // undoLike едет тем же куском
    expect(play.match(/sendFeedback\([\w.]+,'liked'/g)).toHaveLength(1)
    expect(play).toContain(flat("const send = () => sendFeedback(appid, 'liked', undefined, ctx)"))
    expect(play).toContain(flat("void heroTail().then((t) => t.sendLike('play', appid, { mood, ctx }), send)"))
    // и сердце, и «Зацепило» в «Не зацепило?» — через неё
    expect(play).toContain(flat('sendLike(pick.appid, ctxOf(pick, heroFrom))'))
    expect(play).toContain(flat("sendLike(stopDue.appid, ctxOf(asked, undefined, 'ask'))"))
    // /daily: like() — единственная отправка, сразу через lib/unlike
    expect(daily).not.toMatch(/sendFeedback\([\w.]+,'liked'/)
    expect(daily.match(/sendLike\(/g)).toHaveLength(1)
    expect(daily).toContain(flat("void sendLike('daily', hero.appid, { ctx: ctxOf(hero, intent) })"))
  })
})

describe('«Мимо» в колоде /explore возвращается', () => {
  const page = read('app/[lang]/explore/page.tsx')
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

  /*
   * «Вернуть «X»» на телефоне — НАД колодой, а не под ней.
   *
   * Под колодой на телефоне — нижняя панель, и строку там держал бюджет
   * высоты карты (40 px в .deck-stack телефонного блока globals.css). Бюджет
   * работал только на высоких экранах: ниже ~760 px svh карта упирается в пол
   * 380, и строка уходила под панель — замер после «Мимо»: 672–693 при верхе
   * панели 614 на 390×664 (Safari iPhone с панелями), 675–696 при 617 на
   * 375×667 (iPhone SE), 696–717 при 690 на 360×740. Не хватало его и там,
   * где высоты хватало: уже 390 px вступление встаёт в четыре строки (карта
   * на 23 px ниже), а у иконки на домашнем экране панель выше на
   * safe-area-inset-bottom — 757–778 при верхе 760 на 390×844.
   *
   * Верх колоды — сразу под заголовком, 245 px от верха страницы на ширине
   * 390 и больше, 268 уже, — так что строка над ней видна без прокрутки
   * везде, где без прокрутки достаётся и сам «Мимо» (портретные телефоны
   * из замеров). Где «Мимо» и так ниже края — 320×568, 375×548, телефон
   * боком уже 768 (667×375, 740×360), — прокрутка к нему уносит строку под
   * шапку сайта; так было и со строкой под колодой. Чтобы кнопки голоса не
   * прыгали под пальцем, карта, пока строка видна, короче ровно на её ряд —
   * приём «Пустить обратно» в комнате (lib/roomclient.test.ts). Правило
   * укорачивания — :has(> .skip-undo), и строка обязана быть прямым
   * ребёнком колонки: обёртка вокруг неё выключила бы его молча.
   * Прежний тест закреплял строку под колодой и бюджет за неё — его место
   * заняли проверки ниже.
   */
  test('на телефоне «Вернуть» стоит над колодой, с md — под ней: одна кнопка, порядок разметки — порядок глаза', () => {
    const col = code.slice(code.indexOf('className="explore-deck'), code.indexOf('(liked.length>0||shelfTouched)'))
    expect(col, 'колонка колоды не найдена — сторож ослеп').not.toBe('')
    const phone = col.indexOf(flat(`{undoButton && <p className="skip-undo mb-3 flex justify-center md:hidden">{undoButton}</p>}`))
    const desk = col.indexOf(flat(`{undoButton && <p className="mt-4 text-center max-md:hidden">{undoButton}</p>}`))
    expect(phone, 'строка над колодой на телефоне').toBeGreaterThan(-1)
    expect(desk, 'строка под колодой с md').toBeGreaterThan(-1)
    // Над колодой и над «Колода кончилась»: последняя карта тоже бывает
    // промахом, и кнопка не переезжает, когда колода уходит. С md — под обеими
    expect(phone).toBeLessThan(col.indexOf('{top?('))
    // Прямой ребёнок колонки — сразу за её открывающим тегом (погашенный
    // комментарий JSX остаётся «{}»): на этом держится :has(> .skip-undo)
    // в globals.css. Обёртка — div, motion для появления — выключила бы
    // укорачивание карты молча, и кнопки голоса съезжали бы на 33 px вниз
    // под палец после каждого «Мимо»; остальные проверки этого не видят
    expect(col, 'строка — прямой ребёнок колонки: на этом держится :has(> .skip-undo)').toMatch(
      /^className="explore-deck[^"]*">(\{\})*\{undoButton&&<pclassName="skip-undo/,
    )
    expect(desk).toBeGreaterThan(col.indexOf('ref={deckEnd}'))
    expect(desk).toBeGreaterThan(col.indexOf(flat('<StatusLine text={said}')))
    // Кнопка одна на оба места: тот же обработчик, то же имя, тот же обрез
    expect(code.match(/onClick=\{\(e\)=>undo\(/g)).toHaveLength(1)
    const btn = code.slice(code.indexOf('constundoButton=lastSkip&&('), code.indexOf('</button>)', code.indexOf('constundoButton=')))
    expect(btn).toContain(flat(`onClick={(e) => undo(e.detail === 0)}`))
    expect(btn).toContain('max-w-full')
    // Подпись — на языке страницы (tr), одним шаблоном на язык
    expect(btn).toContain(
      flat('<span className="min-w-0 truncate">{tr(locale, { ru: `Вернуть «${lastSkip.name}»`, en: `Bring back “${lastSkip.name}”` })}</span>'),
    )
  })

  /*
   * Обрез имени работает, только если колонке есть куда быть уже текста.
   * На телефоне она — неявная auto сетки и без min-w-0 не уже содержимого:
   * «Вернуть «Warhammer 40,000: Dawn of War - Definitive Edition»» в одну
   * строку раздвигало её до 444 px на экране в 360, и карта уезжала за
   * правый край. Так было и со строкой под колодой — у той же колонки.
   */
  test('длинное имя в «Вернуть» обрезается, а не раздвигает колонку колоды за край экрана', () => {
    const cls = page.match(/<div className="(explore-deck[^"]*)">/)?.[1].split(' ') ?? []
    expect(cls, 'колонка колоды не найдена — сторож ослеп').toContain('explore-deck')
    expect(cls).toContain('min-w-0')
  })

  test('пока строка над колодой, карта короче ровно на её ряд — низ карты и кнопки голоса не сдвигаются ни на какой высоте', () => {
    const css = fs.readFileSync(path.join(ROOT, 'app/globals.css'), 'utf8')
    const rule = (sel: string) => {
      const re = new RegExp(`\\n {2}${sel} \\{\\s*--deck-h: clamp\\((\\d+)px, 100svh - (\\d+)px, (\\d+)px\\);`)
      const m = re.exec(css)
      expect(m, `${sel} не найдено — сторож ослеп`).not.toBeNull()
      // Оба правила — в телефонном блоке: на планшете и компьютере панели нет
      expect(css.lastIndexOf('@media (max-width: 767px) {', m!.index)).toBeGreaterThan(css.lastIndexOf('\n}\n', m!.index))
      return m!.slice(1).map(Number)
    }
    const base = rule('\\.deck-stack')
    const shown = rule('\\.explore-deck:has\\(> \\.skip-undo\\) \\.deck-stack')
    expect(base).toEqual([380, 380, 600])
    // 33 = ряд строки (21: text-sm 14 × 1.5, флекс без строчного «хвоста»)
    // и mb-3 (12) — и с пола, и с формулы, и с потолка. Поправка в одной
    // формуле не работала бы ниже 760 px svh, где обе карты стоят на полу
    expect([base[0] - shown[0], shown[1] - base[1], base[2] - shown[2]]).toEqual([33, 33, 33])
  })

  /*
   * Сетка страницы на телефоне не растягивается: она flex-1 и на высоком
   * экране выше содержимого, а ряды auto делили остаток поровну — верх колоды
   * стоял ниже заголовка на gap-8 и долю остатка и двигался от любой перемены
   * колонки или числа рядов. Замер на 390×844: кнопки голоса 648–708, после
   * первого «Интересно» (полка встаёт третьим рядом) — 629–689, на 19 px под
   * пальцем; так же они прыгали и от прежней строки «Вернуть» под колодой.
   * С рядами по содержимому они стоят на 629–689 на всём пути: «Мимо»,
   * «Интересно», строка над колодой и обратно.
   */
  test('кнопки голоса не прыгают под пальцем: ряды телефонной сетки — по содержимому', () => {
    expect(page).toMatch(/<div className="flex-1 [^"]*\bgrid\b[^"]*\bmax-md:content-start\b/)
  })
})
