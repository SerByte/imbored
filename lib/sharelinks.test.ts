import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CardDownload } from '../components/CardDownload'
import { ShareLinkField, useShareLink, type ShareLink } from '../components/ShareLink'
import { parseTrackEvent, SHARE_KINDS, stepKey, TRACK_PATH, type ShareKind } from './track'

/**
 * Сторож ссылок, которыми делятся.
 *
 * 1. У каждой — метка ?ref= (lib/track, withRef): без неё приход по ссылке
 *    не отличить от прихода с поиска, и воронка «поделился → пришли»
 *    слепнет. Строится ссылка через withRef или готовый строитель
 *    (roomShareUrl и ему подобные *ShareUrl), и файл, который делится,
 *    обязан звать один из них.
 * 2. «Скопировано» — одно на весь сайт, в components/ShareLink.tsx. Отклик
 *    был свой в каждом месте: текст, текст с галочкой, галочка вместо иконки.
 */

const ROOT = path.join(__dirname, '..')

function sources(): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.tsx?$/.test(e.name) && !/\.test\./.test(e.name)) {
        out.push([path.relative(ROOT, p).split(path.sep).join('/'), fs.readFileSync(p, 'utf8')])
      }
    }
  }
  for (const dir of ['app', 'components']) walk(path.join(ROOT, dir))
  return out
}

const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

describe('ссылки, которыми делятся', () => {
  test('каждое место, которое делится, ставит метку ref', () => {
    const offenders: string[] = []
    let sharing = 0
    for (const [file, src] of sources()) {
      if (file === 'components/ShareLink.tsx') continue
      const code = withoutComments(src)
      if (!/useShareLink\(|<ShareLinkField\b/.test(code)) continue
      // useShareLink(null, …) — ссылка, которую кладут к себе, а не отправляют
      // людям: секретная RSS-лента (components/whatsnew/FeedLink). ref у ключа
      // был бы неправдой — с ним ходил бы ридер на каждом опросе, а не человек,
      // пришедший по приглашению
      if (/useShareLink\(\s*null\b/.test(code)) continue
      sharing++
      if (!/withRef\(|\w+ShareUrl\(/.test(code)) offenders.push(file)
    }
    expect(sharing, 'мест, которые делятся, не найдено — сторож ослеп').toBeGreaterThanOrEqual(5)
    expect(offenders, 'ссылка без ?ref= — приход по ней не отличить от поиска').toEqual([])
  })

  test('«Скопировано» — только в components/ShareLink.tsx', () => {
    const offenders = sources()
      .filter(([file, src]) => file !== 'components/ShareLink.tsx' && withoutComments(src).includes('Скопировано'))
      .map(([file]) => file)
    expect(offenders, 'свой отклик «Скопировано» — возьми share.label из useShareLink').toEqual([])
  })
})

/**
 * Чем поделились (lib/track, share и card_download).
 *
 * Кнопка слала share_click с одним источником вкладки, и все кнопки сайта —
 * комната, сравнение, портрет, итоги года, выбор, патч — ложились одной
 * строкой. Здесь — что нажатие уходит с тем «что», которое дала кнопка, что
 * кнопка даёт своё «что», а не соседское, что скачивание карточки тоже доходит
 * до счётчика и что политика называет каждое «что».
 */
describe('телеметрия шаринга', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  /** Перехват маяков; буфер открыт, чтобы нажатие дошло до конца, как у людей */
  function beacons() {
    const sent: Array<{ path: string; body: Blob }> = []
    vi.stubGlobal('navigator', {
      sendBeacon: (p: string, body: Blob) => {
        sent.push({ path: p, body })
        return true
      },
      clipboard: { writeText: async () => {} },
    })
    return async () => {
      expect(sent.every((s) => s.path === TRACK_PATH)).toBe(true)
      return Promise.all(sent.map(async (s) => stepKey(parseTrackEvent(JSON.parse(await s.body.text()))!)))
    }
  }

  /**
   * Хук кнопки, снятый с серверного рендера: там нет ни matchMedia, ни
   * панели (серверный снимок — буфер), а смена состояния после рендера —
   * пустая операция, так что run() идёт тем же путём, что на десктопе.
   */
  function shareOf(what: ShareKind): ShareLink {
    let share: ShareLink | undefined
    function Probe() {
      share = useShareLink(what, () => 'https://imbored.cc/room/ABC234?ref=room', 'Пати', 'Вечер')
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    return share!
  }

  test('нажатие «Поделиться» уходит с тем, чем делятся', async () => {
    vi.useFakeTimers()
    const keys = beacons()
    for (const what of SHARE_KINDS) await shareOf(what).run()
    expect(await keys()).toEqual(SHARE_KINDS.map((what) => `share:${what}.direct`))
  })

  /**
   * Поле со ссылкой, снятое с серверного рендера (как shareOf): вызов
   * ShareLinkField внутри пробы даёт дерево с живым обработчиком кнопки.
   */
  function pressField(props: { counted?: boolean }): () => Promise<void> {
    let tree: ReactElement<{ children: ReactElement[] }> | undefined
    function Probe() {
      tree = ShareLinkField({
        what: 'pick',
        url: 'https://imbored.cc/pick/abc?ref=pick',
        label: 'Ссылка на выбор',
        title: 'Выбор',
        text: 'Вечер',
        ...props,
      }) as ReactElement<{ children: ReactElement[] }>
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    const button = tree!.props.children.find((c) => c?.type === 'button') as ReactElement<{
      onClick: () => void
    }>
    return async () => {
      button.props.onClick()
      // run() асинхронный: даём ему дойти до буфера
      await vi.runAllTimersAsync()
    }
  }

  /*
   * «Отправить другу» сам делает ссылку и сам же пробует поделиться — это
   * нажатие и посчитано. Поле со своей кнопкой под героем — второй шаг того
   * же намерения: на iOS попытка после await не проходит, и без второго
   * нажатия ссылка не уйдёт. Считалось оно вторым share:pick — и на iOS
   * каждая отправка выбора лежала в счётчике дважды.
   */
  test('первое нажатие поля, чья ссылка уже посчитана, маяка не шлёт — следующие шлют', async () => {
    vi.useFakeTimers()
    const keys = beacons()
    const press = pressField({ counted: true })
    await press()
    await press()
    expect(await keys()).toEqual(['share:pick.direct'])
  })

  test('без counted каждое нажатие поля — своё «поделился»', async () => {
    vi.useFakeTimers()
    const keys = beacons()
    const press = pressField({})
    await press()
    await press()
    expect(await keys()).toEqual(['share:pick.direct', 'share:pick.direct'])
  })

  /*
   * Поле выбора — с key по адресу: без него React оставил бы тот же экземпляр,
   * когда у героя появилась новая ссылка, и «первое нажатие» досталось бы ей
   * уже израсходованным. counted — только если «Отправить другу» сам
   * попробовал поделиться: ответ, пришедший после смены героя, в буфер не
   * идёт и не считается, и первое нажатие поля тогда — первое и есть.
   */
  test('SharePick отдаёт полю counted той попытки и key ссылки', () => {
    const src = withoutComments(fs.readFileSync(path.join(ROOT, 'components', 'SharePick.tsx'), 'utf8'))
    const field = src.slice(src.indexOf('<ShareLinkField'), src.indexOf('/>', src.indexOf('<ShareLinkField')))
    expect(field).toContain('key={current.url}')
    expect(field).toContain('counted={current.counted}')
    expect(src).toMatch(/settle\(\{ at, phase: 'ready', url, counted: shown \}\)/)
    expect(src).toMatch(/const shown = shownRef\.current === at/)
    expect(src).toMatch(/if \(!shown\) return\s*urlRef\.current = url\s*void share\.run\(\)/)
  })

  test('без адреса — ни маяка, ни буфера', async () => {
    const keys = beacons()
    let share: ShareLink | undefined
    function Probe() {
      share = useShareLink('room', () => '', 'Пати', 'Вечер')
      return null
    }
    renderToStaticMarkup(createElement(Probe))
    await share!.run()
    expect(await keys()).toEqual([])
  })

  test('«Скачать карточку» — та же ссылка с download и маяк card_download по нажатию', async () => {
    const props = {
      href: '/portrait/76561197960287930/year/card.png',
      download: 'imbored-76561197960287930-2026.png',
      className: 'game-card block w-56',
      children: 'Скачать карточку',
    }
    // Разметка — ровно прежний <a>: островок добавляет обработчик, а не узлы
    expect(renderToStaticMarkup(createElement(CardDownload, { what: 'year', ...props }))).toBe(
      '<a href="/portrait/76561197960287930/year/card.png" download="imbored-76561197960287930-2026.png"' +
        ' class="game-card block w-56">Скачать карточку</a>',
    )
    const keys = beacons()
    for (const what of ['portrait', 'year'] as const) {
      const link = CardDownload({ what, ...props }) as ReactElement<{ onClick: () => void }>
      link.props.onClick()
    }
    expect(await keys()).toEqual(['card_download:portrait.direct', 'card_download:year.direct'])
  })

  /*
   * Политика перечисляет считаемые шаги поимённо (как «Где взять?» в
   * lib/linkhelp.test.ts): новый счётчик, которого в ней нет, делает её
   * неправдой. И «что» здесь — тоже новое знание о нажатии, его надо назвать,
   * причём каждое: share:match.* считается, даже если кнопки матча ещё нет, и
   * общая фраза «вместе с тем, чем поделились» с неполным списком после неё
   * врала бы так же, как молчание. Слова — Record по ShareKind: новое «что» не
   * соберётся (tsc), пока ему не дали слово, а без слова в политике упадёт
   * здесь.
   */
  const SHARE_WORDS: Record<ShareKind, string> = {
    room: 'пати',
    compat: 'сравнением',
    portrait: 'портретом',
    year: 'итогами года',
    pick: 'выбором',
    patch: 'патчем',
    match: 'матчем',
  }

  test('/privacy называет, что «Поделиться» считается с тем, чем, и «Скачать карточку»', () => {
    const policy = fs.readFileSync(path.join(ROOT, 'app', '[lang]', 'privacy', 'page.tsx'), 'utf8').replace(/\s+/g, ' ')
    const steps = policy.match(/Ещё мы считаем несколько шагов:[^.]*/)?.[0] ?? ''
    expect(steps).toMatch(/«Скачать карточку»/)
    // Только сам список после двоеточия: «пати» есть в абзаце и у приглашения
    const shared = steps.match(/«Поделиться» — вместе с тем, чем поделились:([^—]*)—/)?.[1] ?? ''
    expect(shared, 'список «чем поделились» не нашёлся — сторож ослеп').not.toBe('')
    expect(SHARE_KINDS.filter((what) => !shared.includes(SHARE_WORDS[what]))).toEqual([])
  })

  /*
   * Новая ссылка «скачать» мимо CardDownload снова не считалась бы — ровно
   * то, что было с обеими карточками.
   */
  test('каждая ссылка с download — через CardDownload', () => {
    const tags = sources().flatMap(([file, src]) => downloadTags(file, src).map((tag) => `${file}: ${tag}`))
    expect(tags.length, 'ни одной ссылки «скачать» не найдено — сторож ослеп').toBeGreaterThanOrEqual(2)
    expect(tags.filter((t) => !t.endsWith(': CardDownload'))).toEqual([])
  })

  // Сторож выше слеп ровно настолько, насколько слеп его разбор: булев
  // download перед «>» — та самая несчитанная ссылка, а одноимённая
  // переменная — не ссылка вовсе и не должна валить прогон чужим тегом
  test('download видится атрибутом любого вида и только атрибутом', () => {
    const src = [
      'const download = true',
      'const a = <a href="/x.png" download>x</a>',
      'const b = <a href="/y.png" download/>',
      'const c = <m.a download={name} />',
      'save({ download })',
    ].join('\n')
    expect(downloadTags('x.tsx', src)).toEqual(['a', 'a', 'm.a'])
  })

  /*
   * Кто чем делится. tsc требует «что» у каждой кнопки, но не проверяет, то
   * ли оно: PatchShare с 'pick' собрался бы, тесты выше прошли бы, а строки,
   * ради которых счётчик и разделён, снова смешались бы — молча и под чужими
   * именами. Поэтому у каждого файла, который делится или отдаёт карточку,
   * здесь записано его «что»; новый файл (экран матча — с 'match') попадает
   * в список руками, и всё, что он передаёт, обязано быть строкой-литералом:
   * переменную текстом не проверить.
   */
  const SHARERS: Record<string, ShareKind> = {
    'app/[lang]/room/[id]/page.tsx': 'room',
    'app/[lang]/compat/CopyCompatLink.tsx': 'compat',
    'app/[lang]/compat/page.tsx': 'compat',
    'app/[lang]/portrait/[steamid]/page.tsx': 'portrait',
    'app/[lang]/portrait/[steamid]/year/page.tsx': 'year',
    'components/SharePick.tsx': 'pick',
    'components/PatchShare.tsx': 'patch',
    'components/room/MatchShare.tsx': 'match',
  }

  test('каждая кнопка передаёт своё «что», а не соседское', () => {
    const found: Record<string, string[]> = {}
    for (const [file, src] of sources()) {
      // Там сами useShareLink и ShareLinkField: «что» они только передают дальше
      if (file === 'components/ShareLink.tsx') continue
      const kinds = shareKinds(file, src)
      if (kinds.length) found[file] = kinds
    }
    const wrong = Object.entries(found).flatMap(([file, kinds]) =>
      kinds.filter((what) => what !== SHARERS[file]).map((what) => `${file}: ${what}`),
    )
    expect(wrong, 'чужое «что», не литерал или файл не записан в SHARERS').toEqual([])
    expect(Object.keys(found).sort(), 'запись в SHARERS без кнопки — сторож смотрит мимо').toEqual(
      Object.keys(SHARERS).sort(),
    )
  })

  test('«что» снимается со всех трёх мест и только литералом', () => {
    const src = [
      "const a = useShareLink('room', url, t, x)",
      "const b = useShareLink(kind, url, t, x)",
      'const c = <ShareLinkField what="compat" url={u} label="" title="" text="" />',
      "const d = <CardDownload what={'year'} href={h} />",
      'const e = <CardDownload what={kind} href={h} />',
    ].join('\n')
    expect(shareKinds('x.tsx', src)).toEqual(['room', '?', 'compat', 'year', '?'])
  })
})

/**
 * Дерево файла для сторожей, которым мало регулярки: атрибут JSX надо
 * отличать от одноимённой переменной, а булев download без значения — видеть.
 * Комментарии в дерево не попадают сами.
 */
function nodesOf(file: string, src: string): ts.Node[] {
  const kind = file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const out: ts.Node[] = []
  const walk = (node: ts.Node) => {
    out.push(node)
    ts.forEachChild(node, walk)
  }
  walk(ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind))
  return out
}

/** Теги, у которых стоит атрибут download, — в порядке файла */
function downloadTags(file: string, src: string): string[] {
  if (!src.includes('download')) return []
  return nodesOf(file, src)
    .filter((n): n is ts.JsxAttribute => ts.isJsxAttribute(n) && n.name.getText() === 'download')
    .map((attr) => attr.parent.parent.tagName.getText())
}

/**
 * «Что» каждой кнопки файла: первый аргумент useShareLink и атрибут what у
 * ShareLinkField и CardDownload. Не строка-литерал — '?'.
 */
function shareKinds(file: string, src: string): string[] {
  if (!/useShareLink|ShareLinkField|CardDownload/.test(src)) return []
  const literal = (expr: ts.Node | undefined): string => {
    if (expr && ts.isJsxExpression(expr)) return literal(expr.expression)
    return expr && ts.isStringLiteralLike(expr) ? expr.text : '?'
  }
  const kinds: string[] = []
  for (const n of nodesOf(file, src)) {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'useShareLink') {
      // null — ссылку кладут к себе, а не отправляют (FeedLink): это не шаринг
      if (n.arguments[0]?.kind === ts.SyntaxKind.NullKeyword) continue
      kinds.push(literal(n.arguments[0]))
    } else if (
      (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
      ['ShareLinkField', 'CardDownload'].includes(n.tagName.getText())
    ) {
      const what = n.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === 'what')
      kinds.push(literal(what && ts.isJsxAttribute(what) ? what.initializer : undefined))
    }
  }
  return kinds
}
