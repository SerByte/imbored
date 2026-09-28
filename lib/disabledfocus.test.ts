import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { LeaderPick } from '../components/room/LeaderPick'

/**
 * Сторож фокуса нажатой кнопки: на время запроса — aria-disabled, а не disabled.
 *
 * Элемент, ставший disabled, теряет фокус (focus fixup в HTML), и браузер
 * отдаёт его body. Кнопка, выключавшая себя на время своего запроса, роняла
 * фокус ровно в ту секунду, когда на неё нажали: после ответа клавиатура и
 * скринридер начинали со страницы сверху. Больнее всего это на отказе:
 * строка «не дошло — нажми ещё раз» звучит, а нажимать уже не с чего.
 *
 * Правило было записано словами на /play («aria-disabled, а не disabled») и
 * держалось на памяти: его соблюдали восемь кнопок, а нарушали семнадцать.
 * Бан и «Уже прошёл» на /play, «Попробовать снова», «Берём», «Ещё 20 игр»,
 * вход в комнату, «Ещё колоду», четыре кнопки выхода, вход и демо на главной,
 * плашка ленты обновлений — и варианты викторины, которые выключал уже не
 * запрос, а сам ответ.
 *
 * Лечение одно: aria-disabled={…}. Кнопка остаётся в фокусе и объявлена
 * недоступной, повтор нажатия гасит обработчик, а вид даёт [aria-disabled=
 * 'true'] — утилитой aria-disabled:opacity-… или правилом компонента в
 * globals.css (.btn-ember, .btn-glass, .btn-circle).
 *
 * ПРАВИЛО. disabled в разметке продукта запрещён в любой записи: {busy},
 * {pending}, {busy !== null}, {revealed}, голое disabled. По имени флага
 * (-ing, busy, pending) его не опознать: вариант викторины выключался флагом
 * revealed, и фокус с только что выбранного ответа падал точно так же.
 *
 * ГРАНИЦА — пустое поле. disabled={!value} у кнопки отправки законен: он
 * включается, когда поле стирают, а фокус в этот момент в поле, не на кнопке.
 * И кнопке, которой нечего отправить, правильно выпасть из обхода. Сторож
 * опознаёт этот случай строго: отрицание переменной (можно с .trim()), которая
 * в том же файле стоит в value={…} у поля ввода. Смешанное
 * disabled={!value || busy !== null} — нарушение: запрос в нём тот же самый.
 * Оно делится на disabled={!value} и aria-disabled={busy !== null}, как в
 * ConnectCard.
 *
 * Второе обещание — ниже: aria-disabled не выключает ничего. Браузер такую
 * кнопку нажимает, и второй запрос обязан погасить обработчик. У каждой
 * кнопки с aria-disabled записано, где это сделано (GUARDED), и новая кнопка
 * без записи роняет тест.
 */

const ROOT = path.join(__dirname, '..')

/** Комментарии гасятся пробелами: докблоки цитируют само правило. Номера строк остаются настоящими. */
const strip = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])(\/\/[^\n]*)/g, (_, pre: string, c: string) => pre + ' '.repeat(c.length))

const read = (rel: string) => strip(fs.readFileSync(path.join(ROOT, rel), 'utf8'))

/**
 * Индекс сразу за значением, которое начинается в i: строка в кавычках или
 * {…} — с вложенными {} и строками внутри (как tagEnd в tap.test.ts).
 */
function skip(src: string, i: number): number {
  const open = src[i]
  if (open === '"' || open === "'") {
    const end = src.indexOf(open, i + 1)
    return end < 0 ? src.length : end + 1
  }
  let depth = 0
  let q: string | null = null
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (q) {
      if (c === q && src.charCodeAt(j - 1) !== 92) q = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return j + 1
  }
  return src.length
}

type Attr = { name: string; value: string | null }
type Tag = { name: string; line: number; attrs: Attr[] }

/**
 * Атрибуты открывающего тега: имя и сырое значение ({…} или "…"), null у
 * голого. Разбором, а не поиском `disabled=` по тексту тега: иначе его
 * находило бы в className (`disabled:opacity-40`), в title и в стрелке
 * обработчика, а голое `disabled` не находило бы вовсе.
 */
function attrs(tag: string): Attr[] {
  const out: Attr[] = []
  let i = tag.search(/[\s/>]/)
  while (i >= 0 && i < tag.length) {
    const c = tag[i]
    if (/\s/.test(c)) i++
    else if (c === '>' || c === '/') break
    else if (c === '{') i = skip(tag, i) // {...props}
    else {
      const name = /^[A-Za-z_][\w:.-]*/.exec(tag.slice(i))?.[0]
      if (!name) {
        i++
        continue
      }
      i += name.length
      let j = i
      while (/\s/.test(tag[j] ?? '')) j++
      if (tag[j] !== '=') {
        out.push({ name, value: null })
        continue
      }
      j++
      while (/\s/.test(tag[j] ?? '')) j++
      i = skip(tag, j)
      out.push({ name, value: tag.slice(j, i).replace(/\s+/g, ' ') })
    }
  }
  return out
}

/** Открывающие теги в коде без комментариев — до `>` вне {} и строк */
function tags(code: string): Tag[] {
  const out: Tag[] = []
  for (const m of code.matchAll(/<([A-Za-z][\w.]*)(?=[\s/>])/g)) {
    let depth = 0
    let q: string | null = null
    for (let j = m.index; j < code.length; j++) {
      const c = code[j]
      if (q) {
        if (c === q && code.charCodeAt(j - 1) !== 92) q = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') q = c
      else if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) {
        out.push({
          name: m[1],
          line: code.slice(0, m.index).split('\n').length,
          attrs: attrs(code.slice(m.index, j + 1)),
        })
        break
      }
    }
  }
  return out
}

const attr = (t: Tag, name: string) => t.attrs.find((a) => a.name === name)

/** Пустое поле: {!x} или {!x.trim()} */
const EMPTY_FIELD = /^\{\s*!\s*([A-Za-z_$][\w$]*)(?:\.trim\(\))?\s*\}$/

/** Переменные, которые в этом файле — значение поля ввода: value={x} у input, textarea, select */
function fieldValues(all: Tag[]): Set<string> {
  const out = new Set<string>()
  for (const t of all) {
    if (!/^(?:input|textarea|select)$/.test(t.name)) continue
    const m = attr(t, 'value')?.value?.match(/^\{\s*([A-Za-z_$][\w$]*)\s*\}$/)
    if (m) out.add(m[1])
  }
  return out
}

type Hit = { at: string; tag: string; value: string | null }

/** disabled в исходнике одного файла: законные (пустое поле) и все остальные */
function disabledIn(src: string, rel: string): { ok: Hit[]; bad: Hit[] } {
  const all = tags(strip(src))
  const fields = fieldValues(all)
  const ok: Hit[] = []
  const bad: Hit[] = []
  for (const t of all) {
    const d = attr(t, 'disabled')
    if (!d) continue
    const hit = { at: `${rel}:${t.line}`, tag: t.name, value: d.value }
    const m = d.value?.match(EMPTY_FIELD)
    ;(m && fields.has(m[1]) ? ok : bad).push(hit)
  }
  return { ok, bad }
}

/** Все .tsx продукта: [путь от корня, исходник] */
function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.tsx'))
        out.push([path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')])
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

describe('disabled не выключает кнопку на время запроса', () => {
  const files = sources()
  const scan = files.map(([rel, src]) => disabledIn(src, rel))
  const ok = scan.flatMap((s) => s.ok)
  const bad = scan.flatMap((s) => s.bad)

  test('скан видит законные disabled — пустые поля', () => {
    // без этого тест ниже зеленел бы и тогда, когда разбор тегов ослеп
    expect(ok.map((h) => h.at.split(':')[0])).toContain('components/room/RoomCodeForm.tsx')
    expect(ok.map((h) => h.value)).toContain('{!raw.trim()}')
  })

  test('disabled — только у пустого поля', () => {
    expect(
      bad.map((h) => `${h.at} — <${h.tag} disabled${h.value === null ? '' : `=${h.value}`}>`),
      'disabled роняет фокус нажатой кнопки в body — поставь aria-disabled={…} и погаси повтор в обработчике',
    ).toEqual([])
  })

  /**
   * Утилита disabled: у элемента без disabled — мёртвый вид. Так выглядит
   * недоделанный перевод: атрибут сменили на aria-disabled, а приглушение
   * осталось висеть на :disabled, которого у кнопки больше не бывает.
   */
  test('вид disabled: — только у того, что бывает disabled', () => {
    const dead: string[] = []
    for (const [rel, src] of files) {
      for (const t of tags(strip(src))) {
        const cls = attr(t, 'className')?.value ?? ''
        if (/(?<![\w-])disabled:/.test(cls) && !attr(t, 'disabled')) dead.push(`${rel}:${t.line} — ${cls}`)
      }
    }
    expect(dead, 'кнопка на aria-disabled — и вид по aria-disabled:').toEqual([])
  })
})

/**
 * Кто гасит повтор у каждой кнопки с aria-disabled.
 *
 * Кнопка опознаётся по файлу и выражению, а не по номеру строки (тот же урок,
 * что в tap.test.ts). Проверка — выражение, которое находит сам обработчик и
 * проверку в его голове, до первого запроса. Обработчик бывает в другом
 * файле: у LeaderPick и RoomWaiting он на странице комнаты, у PrivacyHelp —
 * в карточке подключения (onRetry приходит только оттуда, см.
 * lib/privacyhelp.test.ts).
 */
const GUARDED: Array<{ file: string; expr: string; guards: Array<[string, RegExp]> }> = [
  {
    file: 'app/daily/page.tsx',
    expr: 'rerolling',
    guards: [['app/daily/page.tsx', /const notToday = async \(intent\?: CtxIntent\) => \{\s*if \(rerolling\) return/]],
  },
  {
    // все переключатели выдачи и подталкивания идут через reshape
    file: 'app/play/page.tsx',
    expr: 'switching',
    guards: [['app/play/page.tsx', /next\.nudge !== 'different'\s+if \(same \|\| switching\) return/]],
  },
  {
    file: 'app/play/page.tsx',
    expr: 'retrying',
    guards: [['app/play/page.tsx', /const retry = useCallback\(async \(\) => \{\s*if \(retrying\) return/]],
  },
  {
    file: 'app/play/page.tsx',
    expr: 'banning',
    guards: [['app/play/page.tsx', /onClick=\{async \(\) => \{\s*if \(banning\) return/]],
  },
  {
    file: 'app/explore/page.tsx',
    expr: 'dealing',
    guards: [['app/explore/page.tsx', /const redeal = async \(keyboard: boolean\) => \{\s*if \(dealing\) return/]],
  },
  {
    // «Войти в комнату» и «Демо-друг»
    file: 'app/room/[id]/page.tsx',
    expr: 'busy',
    guards: [
      ['app/room/[id]/page.tsx', /async function join\(\) \{\s*if \(busy\) return/],
      ['app/room/[id]/page.tsx', /async function joinAsDemoFriend\(\) \{\s*if \(busy\) return/],
    ],
  },
  {
    file: 'components/room/LeaderPick.tsx',
    expr: 'taking',
    guards: [
      [
        'app/room/[id]/page.tsx',
        /async function takeLeader\(\) \{\s*const leader = likes\.leader\s*if \(!leader \|\| takingLeader\) return/,
      ],
    ],
  },
  {
    file: 'components/room/RoomWaiting.tsx',
    expr: 'pulling',
    guards: [['app/room/[id]/page.tsx', /async function pullMore\(\) \{\s*if \(pulling\) return/]],
  },
  {
    // главная кнопка вошедшего, демо без Steam и обе кнопки формы
    file: 'components/landing/ConnectCard.tsx',
    expr: 'busy !== null',
    guards: [
      ['components/landing/ConnectCard.tsx', /onClick=\{\(\) => \{\s*if \(busy !== null\) return\s*setBusy\('go'\)/],
      ['components/landing/ConnectCard.tsx', /onClick=\{\(\) => \{\s*if \(busy !== null\) return\s*void connect\(true\)/],
      ['components/landing/ConnectCard.tsx', /function submitProfile\(\) \{\s*if \(input && busy === null\) void connect\(false\)/],
    ],
  },
  {
    file: 'components/PrivacyHelp.tsx',
    expr: 'retrying',
    guards: [['components/landing/ConnectCard.tsx', /function recheckProfile\(\) \{\s*if \(!input \|\| busy !== null\) return/]],
  },
  {
    file: 'components/SharePick.tsx',
    expr: 'busy',
    guards: [['components/SharePick.tsx', /async function create\(\) \{\s*if \(current\?\.phase === 'busy'\) return/]],
  },
  {
    // «Выйти», «Да, везде», «Отмена» и «Выйти на всех устройствах»
    file: 'components/SignOut.tsx',
    expr: 'busy !== null',
    guards: [
      ['components/SignOut.tsx', /async function out\(all: boolean\) \{\s*if \(busy !== null\) return/],
      ['components/SignOut.tsx', /onClick=\{\(\) => \{\s*if \(busy !== null\) return\s*setConfirmAll\(false\)/],
      ['components/SignOut.tsx', /onClick=\{\(\) => \{\s*if \(busy !== null\) return\s*setConfirmAll\(true\)/],
    ],
  },
  {
    file: 'components/whatsnew/FeedWatch.tsx',
    expr: 'pending',
    guards: [['components/whatsnew/FeedWatch.tsx', /onClick=\{\(\) => \{\s*if \(pending\) return/]],
  },
  {
    file: 'components/room/PartyTrivia.tsx',
    expr: 'revealed',
    guards: [['components/room/PartyTrivia.tsx', /onClick=\{\(\) => \{\s*if \(revealed\) return\s*setChosen\(i\)/]],
  },
]

describe('aria-disabled — не декорация: повтор гасит обработчик', () => {
  /** Кнопки с aria-disabled={…}: файл и выражение */
  const found = sources().flatMap(([rel, src]) =>
    tags(strip(src)).flatMap((t) => {
      const v = attr(t, 'aria-disabled')?.value?.match(/^\{\s*([\s\S]*?)\s*\}$/)
      return v ? [{ file: rel, expr: v[1], at: `${rel}:${t.line}` }] : []
    }),
  )
  const known = (f: { file: string; expr: string }) => GUARDED.some((g) => g.file === f.file && g.expr === f.expr)

  test('скан видит кнопки с aria-disabled', () => {
    const files = new Set(found.map((f) => f.file))
    for (const f of ['app/play/page.tsx', 'components/SignOut.tsx', 'components/room/PartyTrivia.tsx']) {
      expect(files, f).toContain(f)
    }
  })

  test('у каждой кнопки записано, кто гасит повтор', () => {
    expect(
      found.filter((f) => !known(f)).map((f) => `${f.at} — aria-disabled={${f.expr}}`),
      'браузер нажимает кнопку с aria-disabled — погаси повтор в обработчике и впиши его в GUARDED',
    ).toEqual([])
  })

  test.each(GUARDED.map((g) => [`${g.file} — ${g.expr}`, g] as const))('%s: проверка в голове обработчика', (_, g) => {
    for (const [file, re] of g.guards) expect(read(file), `${file}: ${re}`).toMatch(re)
  })

  /** Запись о кнопке, которой больше нет, — комментарий про несуществующий код */
  test('в GUARDED нет протухших строк', () => {
    const stale = GUARDED.filter((g) => !found.some((f) => f.file === g.file && f.expr === g.expr))
    expect(stale.map((g) => `${g.file} — ${g.expr}`), 'такой кнопки больше нет — вычеркни её из GUARDED').toEqual([])
  })
})

/**
 * То же на разметке: «Берём» в тупике пати. Отказ оставляет кнопку на месте
 * и зовёт «нажми ещё раз» строкой под ней — фокус обязан дождаться ответа на
 * кнопке, а не в body.
 */
describe('«Берём» пока идёт запрос', () => {
  const leader = { appid: 620, name: 'Portal 2', headerImage: null, art: null, forCount: 3, memberCount: 4 }
  const html = (taking: boolean) =>
    renderToStaticMarkup(createElement(LeaderPick, { leader, taking, miss: null, onTake: () => {} }))

  test('выключена для скринридера и вида, но не для фокуса', () => {
    const busy = html(true)
    expect(busy).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Берём…<\/button>/)
    expect(busy, 'disabled уводит фокус в body').not.toMatch(/<button[^>]*\sdisabled[=\s>]/)
    // вид «выключена» у .btn-ember — правилом по [aria-disabled] в globals.css
    expect(busy).toMatch(/<button[^>]*class="btn-ember /)

    const idle = html(false)
    expect(idle).toMatch(/<button[^>]*aria-disabled="false"[^>]*>Берём<\/button>/)
    expect(idle).not.toMatch(/<button[^>]*\sdisabled[=\s>]/)
  })
})

/**
 * Вид выключенной — одинаковый у обеих записей. Кнопка на aria-disabled,
 * которая откликается на наведение и нажатие, выглядит живой и не делает
 * ничего; у .btn-ember без правила по [aria-disabled] и вовсе нет вида
 * «выключена», только заливка.
 */
describe('globals.css: [aria-disabled=true] выглядит как :disabled', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

  /** Селекторы списка через запятую — без запятых внутри :not(…) и :is(…) */
  function split(list: string): string[] {
    const out: string[] = []
    let depth = 0
    let from = 0
    for (let i = 0; i < list.length; i++) {
      if (list[i] === '(') depth++
      else if (list[i] === ')') depth--
      else if (list[i] === ',' && depth === 0) {
        out.push(list.slice(from, i).trim())
        from = i + 1
      }
    }
    out.push(list.slice(from).trim())
    return out
  }
  const lists = [...css.matchAll(/([^{};]+)\{/g)].map((m) => split(m[1].trim()))
  const ARIA = "[aria-disabled='true']"

  test('наведение и нажатие не откликаются и на aria-disabled', () => {
    const bare = lists.flat().filter((s) => /:not\(:disabled\)/.test(s))
    expect(bare, `:not(:disabled) — допиши ${ARIA} в тот же :not(…)`).toEqual([])
  })

  test('правило для :disabled держит и [aria-disabled=true]', () => {
    const missing: string[] = []
    let seen = 0
    for (const list of lists) {
      for (const s of list) {
        // :disabled вне :not(…)
        if (!/:disabled/.test(s.replace(/:not\([^)]*\)/g, ''))) continue
        seen++
        const twin = s.replace(':disabled', ARIA)
        if (!list.includes(twin)) missing.push(`${s} — нет ${twin}`)
      }
    }
    expect(seen, 'разбор стилей ослеп — правил для :disabled не нашлось').toBeGreaterThanOrEqual(3)
    expect(missing).toEqual([])
  })
})

/**
 * Само правило — на примерах. Сторожа выше зелёные и тогда, когда разбор
 * ослеп: здесь видно, что он ловит каждую форму и не трогает законные.
 */
describe('правило сторожа', () => {
  const flagged = (jsx: string) => disabledIn(jsx, 'x.tsx').bad.length

  test('disabled ловится в любой записи', () => {
    for (const jsx of [
      '<button disabled={busy}>x</button>',
      '<button onClick={() => void go()} disabled={pending} className="a">x</button>',
      // флаг без -ing и busy — случай PartyTrivia
      '<button key={o.label} disabled={revealed} onClick={() => pick(i)}>x</button>',
      '<m.button type="button" disabled={busy !== null}>x</m.button>',
      '<button disabled>x</button>',
      '<button type="submit" disabled />',
      '<Button disabled={taking} />',
      // смешанное: пустое поле плюс запрос — запрос тот же
      '<input value={value} /><button disabled={!value || busy !== null}>x</button>',
      // отрицание — но не значения поля
      '<button disabled={!ready}>x</button>',
      '<input value={draft} /><button disabled={!ready}>x</button>',
      // поле, выключенное на время отправки, роняет фокус так же
      '<input value={v} disabled={saving} />',
      // многострочный тег с обработчиком перед атрибутом
      '<button\n  onClick={() => {\n    if (x > 1) return\n    go()\n  }}\n  disabled={x > 1}\n>\n  x\n</button>',
    ]) {
      expect(flagged(jsx), jsx).toBe(1)
    }
  })

  test('пустое поле и aria-disabled не ловятся', () => {
    for (const jsx of [
      '<input value={value} /><button type="submit" disabled={!value}>x</button>',
      '<input value={raw} /><button type="submit" disabled={!raw.trim()}>x</button>',
      '<textarea value={text} /><button disabled={ !text }>x</button>',
      '<button aria-disabled={busy} className="btn-glass aria-disabled:opacity-60">x</button>',
      // слово в классах, подписи и коде обработчика — не атрибут
      '<button className="disabled:opacity-40" title="disabled" onClick={() => setDisabled(true)}>x</button>',
      '<Row {...props} data-disabled="1">x</Row>',
    ]) {
      expect(flagged(jsx), jsx).toBe(0)
    }
  })
})
