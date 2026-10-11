import fs from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { StatusLine } from '../components/StatusLine'

/**
 * Сторож живых областей: область стоит в DOM раньше своего текста.
 *
 * Скринридер объявляет ИЗМЕНЕНИЕ содержимого живой области (role="status",
 * role="alert", aria-live), а не её появление. Область, вставленная в DOM уже
 * с текстом, звучит не во всех связках: VoiceOver в Safari молчит, NVDA —
 * через раз. Правило было записано словами в четырёх местах (ConnectCard,
 * WarmupScreen, SwipeDeck, /play) и держалось на памяти — аудит нашёл ещё
 * тринадцать мест, где область монтировалась условием вместе с сообщением.
 * Молчали при этом именно отказы: «Голос не ушёл — карточка вернулась»,
 * «Связь потеряна — комната не обновляется», «Не вышло — попробуй ещё раз»
 * у полок, ошибка входа в комнату. Человек со скринридером их не слышал — а
 * в пати по голосу он дальше и действует.
 *
 * Лечение — components/StatusLine: абзац стоит всегда, условие переехало
 * внутрь, на текст.
 *
 * ПРАВИЛО. Открывающий тег живой области — и <StatusLine>, который сам ею
 * является, — не стоит ветвью условия: сразу после `&&`, `||`, `??`, `?` или
 * `:` тернарника. Скобка и переносы строк между ними не в счёт, и смотрим мы
 * на код перед тегом, а не на строку: условие, растянутое на две строки
 * (`pending.length === 0 &&` / `leaderMiss === 'stale' && (` в RoomWaiting),
 * построчный поиск `&& ($` пропускал бы.
 *
 * ГРАНИЦА. Сторож видит условие, на котором стоит сама область, и не видит
 * условного предка: StatusLine внутри `{open && <div>…</div>}` законна, если
 * div появляется раньше текста (оверлей ролика есть до отказа ролика), и
 * незаконна, если вместе с ним, — а это знает только автор. Так было с
 * разбором ответа в PartyTrivia: область стояла в ряду с «Дальше», а ряд
 * появлялся тем же рендером, что и разбор. Так же с ранним return и с key у
 * предка. Поэтому строка, которую видит глаз в месте, где ей не прожить
 * дольше события (плитка полки уходит и возвращается откатом, ряд викторины
 * рождается с ответом), говорит скринридеру через объявление уровнем выше —
 * см. полки и PartyTrivia.
 *
 * Ниже ещё два сторожа того же обещания «область меняет текст — скринридер
 * слышит»: повторный отказ гаснет в начале попытки (REPEAT), а строка отказа
 * полок /library стоит на одном месте в обеих разметках.
 */

const ROOT = path.join(__dirname, '..')

/**
 * Комментарии гасятся пробелами: докблоки цитируют само правило (`role="status"
 * объявляет новость…`), а номера строк и позиции остаются настоящими. `//`
 * после двоеточия — адрес в строке, а не комментарий.
 */
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre: string, c: string) => pre + ' '.repeat(c.length))

/** Конец открывающего тега — с учётом вложенных {} и строк внутри атрибутов (как в tap.test.ts). */
function tagEnd(src: string, i: number): number {
  let depth = 0
  let q: string | null = null
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (q) {
      if (c === q && src.charCodeAt(j - 1) !== 92) q = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      q = c
      continue
    }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return j
  }
  return -1
}

/** Живая область: роль с объявлением, aria-live (кроме off) или StatusLine целиком */
const LIVE_ROLE = /\srole=(?:"(?:status|alert|log)"|\{'(?:status|alert|log)'\})/
const LIVE_ATTR = /\saria-live=(?!"off")/
const isLive = (name: string, tag: string) =>
  name === 'StatusLine' || LIVE_ROLE.test(tag) || LIVE_ATTR.test(tag)

/**
 * Код перед тегом кончается ветвлением; скобки и пробелы между ними — не в
 * счёт. Смотрим хвост до первого значащего знака, а не окно фиксированной
 * длины: комментарий «почему» между `&& (` и тегом strip гасит пробелами, и в
 * окне из двухсот знаков от условия остались бы одни пробелы — сторож слеп
 * бы ровно там, где автор объяснял своё условие.
 */
const BRANCH = /(?:&&|\|\||\?\?|\?|:)$/
function onBranch(code: string, i: number): boolean {
  let j = i
  while (j > 0 && /[\s(]/.test(code[j - 1])) j--
  return BRANCH.test(code.slice(Math.max(0, j - 2), j))
}

type Region = { at: string; tag: string; branch: boolean }

/** Живые области в исходнике одного файла: где стоят и не ветвь ли они условия */
function regions(src: string, rel: string): Region[] {
  const code = strip(src)
  const out: Region[] = []
  for (const m of code.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    const end = tagEnd(code, m.index)
    if (end < 0) continue
    const tag = code.slice(m.index, end + 1)
    if (!isLive(m[1], tag)) continue
    out.push({
      at: `${rel}:${code.slice(0, m.index).split('\n').length}`,
      tag: tag.replace(/\s+/g, ' '),
      branch: onBranch(code, m.index),
    })
  }
  return out
}

function scan(): Region[] {
  const out: Region[] = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx')) {
        out.push(...regions(fs.readFileSync(p, 'utf8'), path.relative(ROOT, p).split(path.sep).join('/')))
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

/**
 * Области, которые стоят на условии и всё же живут всё время компонента:
 * условие — из пропсов, и за жизнь компонента оно не меняется. Опознаются по
 * файлу и тексту тега, а не по номеру строки — номер уезжает от любой правки
 * выше (тот же урок, что в tap.test.ts). У каждой строки причина.
 */
const LIFELONG: Array<{ file: string; tag: string; why: string }> = [
  {
    file: 'components/morph/MorphSlider.tsx',
    tag: '<div className={styles.caption} aria-live="polite">',
    why: 'showCaptions && hasCaptions — проп и подписи из пропа items: область есть с первого кадра слайдера, а меняется в ней подпись активного кадра',
  },
]

const lifelong = (r: Region) => LIFELONG.some((x) => r.at.startsWith(`${x.file}:`) && r.tag === x.tag)

describe('живая область стоит раньше своего текста', () => {
  const all = scan()

  test('скан видит живые области продукта', () => {
    // без этого тесты ниже зеленели бы и тогда, когда поиск сломался
    const files = new Set(all.map((r) => r.at.split(':')[0]))
    for (const f of ['components/landing/ConnectCard.tsx', 'components/SwipeDeck.tsx', 'app/play/page.tsx']) {
      expect(files, f).toContain(f)
    }
    expect(all.length).toBeGreaterThan(20)
  })

  test('ни одна живая область не рождается ветвью условия', () => {
    const offenders = all.filter((r) => r.branch && !lifelong(r)).map((r) => `${r.at} — ${r.tag}`)
    expect(
      offenders,
      'область, вставленная вместе с текстом, звучит не везде — поставь <StatusLine text={…}> и перенеси условие на текст',
    ).toEqual([])
  })

  /**
   * Строка, на которую переезжает фокус (tabIndex={-1}: «всё вернулось» у
   * полок /library, «с полки всё убрано» на /explore), живой областью не
   * бывает. Её объявляет сам фокус; роль поверх — второй голос той же
   * строки. А рождается такая строка вместе со своим текстом, так что роль
   * её и не спасла бы.
   */
  test('цель фокуса — не живая область', () => {
    const offenders = all.filter((r) => /\stabIndex=\{-1\}/.test(r.tag)).map((r) => `${r.at} — ${r.tag}`)
    expect(offenders, 'строку, которая получает фокус, объявляет фокус — сними с неё role/aria-live').toEqual([])
  })

  /** Исключение, которое перестало существовать, — комментарий про несуществующий код */
  test('в списке пожизненных нет протухших строк', () => {
    const stale = LIFELONG.filter(
      (x) => !all.some((r) => r.branch && r.at.startsWith(`${x.file}:`) && r.tag === x.tag),
    ).map((x) => `${x.file} — ${x.tag}`)
    expect(stale, 'эта область больше не стоит на условии — вычеркни её из LIFELONG').toEqual([])
  })
})

const read = (file: string) => strip(fs.readFileSync(path.join(ROOT, file), 'utf8'))

/**
 * Отказы, которые повторяются. Область объявляет изменение текста, а тот же
 * отказ второй раз подряд — тот же текст (components/StatusLine): второй
 * «Голос не ушёл» после свайпа той же вернувшейся карты, второй потолок
 * частоты на «Как «X», но…» молчали, и нажатие оставалось без отклика. Лечение
 * одно на всех: прежний отказ гаснет в начале новой попытки, до первого
 * await — пока ответа ещё нет, — и повтор приходит изменением текста.
 *
 * Место опознаётся по началу попытки (start), а не по номеру строки; от него
 * до первого await обязан стоять каждый сброс из reset.
 *
 * Половина правды, если отказ бывает и без await: сброс и новый отказ в одном
 * обработчике React склеивает в одно обновление, и текст снова не меняется.
 * Так было у «Сообщить, когда сойдёмся»: после первого отказа браузер помнит
 * 'denied', запрос не шёл, и второй отказ ставился синхронно. Для таких мест
 * fail — новый отказ, который обязан стоять ПОСЛЕ первого await.
 */
const REPEAT: Array<{ file: string; start: string; reset: string[]; fail?: string[] }> = [
  // голос колоды: отказ возвращает карту в голову, и следующий свайп — повтор
  { file: 'app/room/[id]/page.tsx', start: 'async function vote(', reset: ['setVoteFailed(false)'] },
  { file: 'app/room/[id]/page.tsx', start: 'async function join()', reset: ['setJoinError(null)'] },
  { file: 'app/room/[id]/page.tsx', start: 'async function joinAsDemoFriend()', reset: ['setJoinError(null)'] },
  { file: 'app/room/[id]/page.tsx', start: 'async function takeLeader()', reset: ['setLeaderMiss(null)'] },
  // выход и ✕ хоста, переключатель доски, добор раунда: на моргнувшей связи
  // второй тап — тот же отказ тем же текстом
  { file: 'app/room/[id]/page.tsx', start: 'async function removeMember(', reset: ['setLeaveMiss(null)'] },
  { file: 'app/room/[id]/page.tsx', start: 'async function togglePublic()', reset: ['setPublicMiss(null)'] },
  { file: 'app/room/[id]/page.tsx', start: 'async function pullMore()', reset: ['setPullFailed(false)'] },
  // повторное нажатие после отказа в разрешении — тот же отказ тем же текстом;
  // браузер помнит отказ, и без await между ними повтор склеился бы со сбросом
  {
    file: 'components/room/MatchNotify.tsx',
    start: 'async function toggle()',
    reset: ['setMiss(null)'],
    fail: ['setMiss(permission)'],
  },
  // переключатели и кнопки под героем — один путь, отказ говорит то место, откуда нажали
  {
    file: 'app/play/page.tsx',
    start: 'const reshape = useCallback(',
    reset: ['setHeroMiss(null)', 'setSwitchMiss(null)'],
  },
  { file: 'app/play/page.tsx', start: 'if (banning) return', reset: ['setBanFailed(null)'] },
  // «Обновить выдачу» говорит отказ той же строкой под героем, что и кнопки под ним
  { file: 'app/play/page.tsx', start: 'onRefresh={async () => {', reset: ['setHeroMiss(null)'] },
  { file: 'app/daily/page.tsx', start: 'const notToday = async', reset: ['setRerollMiss(null)'] },
  { file: 'app/explore/page.tsx', start: 'const unlike = async', reset: ['setUnlikeMiss(null)'] },
  // «Ещё колоду» под потолком частоты: второй 429 — тот же текст под кнопкой
  { file: 'app/explore/page.tsx', start: 'const redeal = async', reset: ['setRedealMiss(null)'] },
  // «Попробовать снова» на экране отказа: строка экрана гаснет на время попытки
  { file: 'app/explore/page.tsx', start: 'const retry = async', reset: ['setRetrying(true)'] },
  { file: 'components/BannedShelf.tsx', start: 'async function unban(', reset: ['setFailed(null)'] },
  { file: 'components/LikedShelf.tsx', start: 'async function unlike(', reset: ['setFailed(null)'] },
  { file: 'components/Evenings.tsx', start: 'async function answer(', reset: ['setFailed(null)'] },
  // здесь отказ — фаза состояния, и гасит его фаза «делаю»
  { file: 'components/SharePick.tsx', start: 'async function create()', reset: ["setState({ at, phase: 'busy' })"] },
  // RSS по секретной ссылке: второй 429 на «Выпустить новую» — тот же текст;
  // удача («Ссылка готова», «Ссылка отключена») гаснет тем же порядком
  { file: 'components/whatsnew/FeedLink.tsx', start: 'async function issue()', reset: ['setMiss(null)', "setSaid('')"] },
  { file: 'components/whatsnew/FeedLink.tsx', start: 'async function disable()', reset: ['setMiss(null)', "setSaid('')"] },
]

describe('повтор отказа звучит', () => {
  test('отказ, который повторяется, гаснет в начале попытки — до первого await', () => {
    for (const { file, start, reset, fail = [] } of REPEAT) {
      const code = read(file)
      const at = code.indexOf(start)
      expect(at, `${file}: «${start}» не найдено — сторож ослеп`).toBeGreaterThan(-1)
      expect(code.indexOf(start, at + 1), `${file}: «${start}» встречается не раз`).toBe(-1)
      const until = code.indexOf('await ', at)
      expect(until, `${file}: после «${start}» нет await`).toBeGreaterThan(at)
      const head = code.slice(at, until)
      for (const r of reset) {
        expect(head, `${file} — ${start}: ${r} до первого await, иначе второй такой же отказ промолчит`).toContain(r)
      }
      for (const f of fail) {
        expect(head, `${file} — ${start}: ${f} до первого await склеится со сбросом`).not.toContain(f)
        expect(code.indexOf(f, until), `${file} — ${start}: ${f} не найдено — сторож ослеп`).toBeGreaterThan(until)
      }
    }
  })
})

/**
 * Строка отказа полок /library (BannedShelf, LikedShelf) — одним узлом.
 *
 * Разметок у полки две: «всё вернулось» и сами полки. Последняя плитка
 * уходит сразу — полка переходит на первую, отказ возвращает плитку — снова
 * на вторую. Строка переживает этот переход только потому, что стоит первым
 * ребёнком фрагмента в обеих: React сверяет детей по месту. Поставь над ней
 * что-нибудь в одном из return (NeedSteam над полками) — и область
 * смонтируется заново вместе с текстом отказа. Правило выше этого не видит:
 * условия на ней нет, есть смена места.
 */
describe('строка отказа полок /library — одним узлом', () => {
  test('в каждом return полки фрагмент начинается с {miss}', () => {
    for (const file of ['components/BannedShelf.tsx', 'components/LikedShelf.tsx']) {
      const code = read(file)
      expect(code, `${file}: miss — это StatusLine`).toMatch(/const miss = \(\s*<StatusLine\b/)
      const returns = [...code.matchAll(/\breturn \(/g)]
      // «всё вернулось» и полки; меньше — разбор ослеп или разметка стала одной
      expect(returns.length, file).toBeGreaterThanOrEqual(2)
      for (const r of returns) {
        const at = `${file}:${code.slice(0, r.index).split('\n').length}`
        expect(code.slice(r.index), at).toMatch(/^return \(\s*<>\s*\{miss\}/)
      }
    }
  })
})

/**
 * Экран отказа /explore — одним узлом через смену фазы.
 *
 * Фаза отказа подменяет экран целиком: WarmupScreen уходит вместе со своей
 * живой строкой прогресса, и «Библиотека не доехала» вставала молча — ни
 * одна область в DOM не меняла текст. Строка статуса стоит первым ребёнком
 * фрагмента во всех трёх return (прогрев, отказ, колода) и переживает
 * подмену по той же причине, что строка полок выше: React сверяет детей по
 * месту.
 */
describe('экран отказа /explore объявляется', () => {
  test('строка статуса стоит первой в каждом return страницы', () => {
    const code = read('app/explore/page.tsx')
    expect(code, 'status — это StatusLine').toMatch(/const status = \(\s*<StatusLine\b/)
    // return разметки, а не `return () => ac.abort()` эффекта
    const returns = [...code.matchAll(/\breturn \((?=\s*<)/g)]
    // прогрев, отказ, колода; меньше — разбор ослеп или фаз стало меньше
    expect(returns.length).toBeGreaterThanOrEqual(3)
    for (const r of returns) {
      const at = `app/explore/page.tsx:${code.slice(0, r.index).split('\n').length}`
      expect(code.slice(r.index), at).toMatch(/^return \(\s*<>\s*\{status\}/)
    }
  })

  /**
   * Вторая половина REPEAT для «Попробовать снова». Там стережётся только
   * место: setRetrying(true) до первого await. Но гасит строку не он, а
   * `&& !retrying` в её тексте — без него повтор того же отказа снова
   * молчал бы, а место в REPEAT оставалось бы верным.
   */
  test('на время повтора строка статуса гаснет', () => {
    const code = read('app/explore/page.tsx')
    expect(code).toMatch(/const status = \(\s*<StatusLine text=\{phase === 'error' && !retrying \?/)
  })
})

/**
 * «Вопрос N из 3» в квизе — в заголовке шага, а не в живой области под ним.
 *
 * Строка role="status" стояла внутри <m.div key={step.key}>: каждый шаг
 * монтировал новую область уже с текстом «Вопрос 2 из 3» — случай «key у
 * предка» из ГРАНИЦЫ выше, который правило не видит. Звучал только первый
 * шаг, а видимая подпись над шагом aria-hidden. Заголовок шага и так
 * получает фокус при смене шага (stepHeadRef), и номер в его имени слышен
 * везде, без гонки живой строки с переездом фокуса.
 */
describe('квиз: номер вопроса звучит', () => {
  const code = read('app/quiz/page.tsx')
  const at = code.indexOf('key={step.key}')
  const step = code.slice(at, code.indexOf('</m.div>', at))

  test('под ключом шага нет живой области', () => {
    expect(at, 'шаг квиза не найден — сторож ослеп').toBeGreaterThan(-1)
    expect(regions(step, 'app/quiz/page.tsx').map((r) => r.tag)).toEqual([])
  })

  test('номер вопроса — в имени заголовка, на который переезжает фокус', () => {
    expect(step).toMatch(
      /<m\.h1\s+ref=\{stepHeadRef\}[^>]*>\s*<span className="sr-only">\s*Вопрос \{stepIndex \+ 1\} из \{STEPS\.length\}\.(?:\s|\{' '\})*<\/span>\s*\{step\.question\}\s*<\/m\.h1>/,
    )
  })
})

/**
 * Отказ игры дня — одним узлом с экрана прогрева.
 *
 * Отказ на /daily — не строка рядом с кнопкой, а ЦЕЛЫЙ ЭКРАН вместо экрана
 * прогрева: WarmupScreen уходит, и вместе с ним единственная говорившая
 * область — его строка прогресса. «Библиотека не доехала», «Слишком часто»
 * появлялись в тишине: человек со скринридером слышал прогрев, а потом
 * ничего. Область, рождённая вместе с экраном отказа, не спасла бы (правило
 * выше), поэтому у прогрева и отказа она стоит первым ребёнком фрагмента, и
 * React сверяет её по месту как один узел — тот же приём, что у полок
 * /library выше. Герой несёт ту же строку в своей разметке: к нему приходят
 * только с прогрева, и строка рождается пустой.
 */
describe('/daily: отказ объявляет строка, которая стоит с прогрева', () => {
  const code = read('app/daily/page.tsx')
  const page = code.slice(code.indexOf('export default function DailyPage'))

  test('в строке — отказ, а на герое — смена героя', () => {
    expect(code).toMatch(
      /const status = \(\s*<StatusLine\s+text=\{failed \? `\$\{fail\.title\}\. \$\{fail\.text\}` : said\}/,
    )
  })

  test('прогрев и отказ начинаются с {status} — один узел на смену экрана', () => {
    const loading = page.indexOf("if (phase === 'loading') {")
    const failing = page.indexOf('if (failed || !pick) {')
    expect(loading, 'ветка прогрева не найдена — сторож ослеп').toBeGreaterThan(-1)
    expect(failing, 'ветка отказа не найдена — сторож ослеп').toBeGreaterThan(loading)
    for (const at of [loading, failing]) {
      const branch = page.slice(at, page.indexOf('\n  }\n', at))
      expect(branch).toMatch(/\breturn \(\s*<>\s*\{status\}/)
    }
    // ранний return без скобок (`return <WarmupScreen …/>`) обошёл бы правило
    expect(page).not.toMatch(/\breturn </)
  })

  test('у героя — та же строка, а не вторая область рядом', () => {
    expect([...page.matchAll(/\{status\}/g)]).toHaveLength(3)
    expect(page).not.toMatch(/role="status"/)
  })
})

/**
 * Само правило — на примерах. Сторож выше зелёный и тогда, когда разбор
 * ослеп: здесь видно, что он ловит каждую форму условия и не трогает
 * законные.
 */
describe('правило сторожа', () => {
  const branch = (jsx: string) => regions(jsx, 'x.tsx').map((r) => r.branch)

  test('ветвь условия ловится в любой записи', () => {
    for (const jsx of [
      '{miss && (\n  <p role="status">{miss}</p>\n)}',
      '{miss && <p role="status">x</p>}',
      // условие в две строки — случай RoomWaiting
      '{pending.length === 0 &&\n  leaderMiss === \'stale\' && (\n    <p role="status" className="a">x</p>\n  )}',
      'const badge = stale ? (\n  <div role="status" aria-live="polite">x</div>\n) : null',
      '{a ? null : (\n  <p role="alert">x</p>\n)}',
      '{a ?? <span aria-live="assertive">x</span>}',
      '{a || <p role={\'status\'}>x</p>}',
      // StatusLine под условием — та же ошибка другими словами
      '{open && <StatusLine text="x" className="a" />}',
      // комментарий «почему» между условием и тегом — длиннее любого окна
      `{miss && (\n  // ${'объясняю условие '.repeat(15)}\n  <p role="status">x</p>\n)}`,
      `{miss ? (\n  /* ${'объясняю условие '.repeat(15)}\n     ${'и ещё строка '.repeat(10)} */\n  <StatusLine text="x" className="a" />\n) : null}`,
    ]) {
      expect(branch(jsx), jsx).toEqual([true])
    }
  })

  test('область, которая стоит всегда, не ловится', () => {
    for (const jsx of [
      '<p role="status" className={bad ? \'text-danger\' : \'sr-only\'}>{bad ? \'x\' : \'\'}</p>',
      '<StatusLine text={miss ? \'x\' : null} className="a" />',
      'const status = (\n  <span role="status" className="sr-only">{x}</span>\n)',
      'return (\n  <p role="status" aria-live="polite">{line}</p>\n)',
      // условный потомок внутри области — это и есть приём «меняется только текст»
      '<p role="status" className="a">\n  {miss && <span className="block">{miss}</span>}\n</p>',
      // JSX-комментарий перед областью: хвост кончается его `}`, а не условием
      `{a && <b />}\n{/* ${'объясняю строку '.repeat(15)} */}\n<StatusLine text={x} className="a" />`,
    ]) {
      expect(branch(jsx), jsx).toEqual([false])
    }
  })

  test('комментарии и не-живые элементы не в счёт', () => {
    expect(regions('{/* {x && <p role="status">} */}\n// {y && <p aria-live="polite">}', 'x.tsx')).toEqual([])
    expect(regions('{x && <p className="a">x</p>}', 'x.tsx')).toEqual([])
    expect(regions('<div aria-live="off">x</div>', 'x.tsx')).toEqual([])
  })
})

describe('StatusLine', () => {
  const html = (text: Parameters<typeof StatusLine>[0]['text'], className = 'text-sm text-danger') =>
    renderToStaticMarkup(StatusLine({ text, className }))

  test('без текста — пустая область, невидимая и вне раскладки', () => {
    for (const empty of [null, undefined, false, true, '']) {
      expect(html(empty), String(empty)).toBe('<p role="status" class="sr-only"></p>')
    }
  })

  test('с текстом — тот же элемент с той же ролью, текст и видимые классы', () => {
    expect(html('Голос не ушёл')).toBe('<p role="status" class="text-sm text-danger">Голос не ушёл</p>')
    expect(html(0)).toBe('<p role="status" class="text-sm text-danger">0</p>')
  })

  test('объявление без видимой копии остаётся sr-only и с текстом', () => {
    expect(html('Не вышло', 'sr-only')).toBe('<p role="status" class="sr-only">Не вышло</p>')
  })
})
