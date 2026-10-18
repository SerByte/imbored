import fs from 'node:fs'
import path from 'node:path'
import { isValidElement, type ReactElement } from 'react'
import { describe, expect, test } from 'vitest'
import { GameLink } from '../components/GameLink'
import { TilePending } from '../components/TilePending'

/**
 * Сторож префетча ссылок на карточку игры.
 *
 * /game/[appid] — ISR, заранее собрана верхняя сотня, остальное рендерится на
 * первом запросе. Next в проде префетчит такой маршрут целиком, как только
 * ссылка въезжает в кадр, — то есть ссылка с префетчем по умолчанию на полке
 * из хвоста каталога будит холодный рендер и пишет ISR за каждую плитку, мимо
 * которой проскроллили (почему это дорого — lib/gamecache, components/GameLink).
 *
 * Правило ломается молча: новая полка рисуется так же, просто лимит тает. Так
 * его и пропустили портрет, итоги года, совместимость, «Приглянулось»,
 * «Скрытое», «Похожие» и строки /whatsnew — при том что стена /library и хаб
 * /games выключили префетч каждый своей строкой. Поэтому здесь разбор
 * исходников: у каждой <Link> на карточку решение о префетче записано явно,
 * либо это GameLink, либо место в списке ниже — с причиной.
 *
 * «На карточку» разбор узнаёт в трёх видах: адрес шаблоном прямо в href
 * (href={`/game/${appid}`}), вызовом gamePagePath(…) и переменной того же
 * файла, в которую положили одно из двух (const gameHref = `/game/${…}`).
 * Адрес, приехавший пропсом или из другого модуля, отсюда не виден — такой
 * Link и есть повод взять GameLink.
 */

const ROOT = path.join(__dirname, '..')

/**
 * Где префетч по умолчанию оставлен — и почему. Ключ — файл, значение —
 * сколько таких ссылок в нём ожидается: новая ссылка в том же файле не
 * проскочит под чужой причиной.
 */
const DEFAULT_PREFETCH: Record<string, { links: number; why: string }> = {
  'app/daily/page.tsx': {
    links: 1,
    why: 'ⓘ у героя «Игры дня» — одна ссылка, по которой и идут: префетч окупается кликом',
  },
  'app/play/page.tsx': { links: 1, why: 'ⓘ у героя выдачи — одна ссылка на экран' },
  'app/pick/[id]/page.tsx': { links: 1, why: '«Об игре» у выбора комнаты — одна ссылка' },
  'components/whatsnew/Cover.tsx': {
    links: 1,
    why: '«Что ещё меняли» у обложки ленты — одна ссылка на самую весомую игру недели',
  },
  'app/not-found.tsx': {
    links: 1,
    why: 'полка 404 — верх каталога (topCatalogGames), он пререндерен и лежит в кэше: записи ISR нет',
  },
  'app/game/[appid]/news/[gid]/page.tsx': {
    links: 2,
    why:
      'страница патча: «назад» в шапке и «Всё об игре» внизу — обе на карточку своей же игры, главный выход со страницы; адрес один, а клиентский кэш префетча ключуется адресом (docs: prefetching.md, Client cache) — запрос тоже один',
  },
  'app/game/[appid]/news/page.tsx': {
    links: 1,
    why: 'архив обновлений игры: путь над заголовком — назад на карточку своей же игры, главный выход со страницы, как у страницы патча; ссылка одна',
  },
  'app/explore/page.tsx': {
    links: 1,
    why:
      'полка «Приглянулось» в колоде /explore: её видит один человек, до разворота не больше EXPLORE_SHELF_FOLD плиток, и это игры, которые он только что сам отметил «Интересно» — по ним и идут',
  },
}

/**
 * Плитки-ссылки на карточку, где знака ожидания (TilePending) нет нарочно, —
 * и почему. Ключ — файл, значение — сколько таких плиток в нём.
 */
const WITHOUT_PENDING: Record<string, { tiles: number; why: string }> = {
  'app/not-found.tsx': {
    tiles: 1,
    why:
      'полка 404 — пререндеренный верх каталога с префетчем: переход мгновенный, и ожидания Next не показывает вовсе. ' +
      'А not-found корня входит в каждый маршрут — клиентский лист ожидания лёг бы в первую загрузку всех страниц (+0,3 КБ, замер сборкой)',
  },
}

/** Код без комментариев: докблоки цитируют то, что здесь ищется */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * Конец открывающего тега — с учётом {} и строк внутри атрибутов.
 *
 * Строка открывается на любой глубине, а не только внутри {}: значение
 * атрибута в кавычках лежит на нулевой, и `>` в нём — className="[&>svg]:…"
 * у Tailwind, aria-label="a > b" — иначе обрывал тег раньше href, и ссылка
 * молча выпадала из проверки. Апостроф и обратная кавычка на нулевой глубине
 * открывающего тега бывают только краями строки, так что ложных строк это
 * не заводит.
 */
function tagEnd(src: string, i: number): number {
  let depth = 0
  let q: string | null = null
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (q) {
      if (c === q) q = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') q = c
    else if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return j
  }
  return -1
}

function sources(dir: string): string[] {
  const out: string[] = []
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`
    if (e.isDirectory()) out.push(...sources(rel))
    else if (/\.tsx$/.test(e.name) && !/\.test\./.test(e.name)) out.push(rel)
  }
  return out
}

/**
 * Адрес самой карточки: /game/${…} и ничего после — страницы патчей не в
 * счёт. Шаблоном или через gamePagePath (lib/gamecache).
 */
const CARD_PATH = /`\/game\/\$\{[^}`]+\}`|gamePagePath\([^)]*\)/.source

/** href={…} прямо с адресом карточки */
const CARD_HREF = new RegExp(String.raw`\bhref=\{\s*(?:${CARD_PATH})\s*\}`)

/** const gameHref = `/game/${…}` — переменная, которую потом отдают в href */
const CARD_VAR = new RegExp(String.raw`\b(?:const|let)\s+(\w+)\s*(?::\s*string\s*)?=\s*(?:${CARD_PATH})`, 'g')

type Found = { file: string; tag: string; prefetch: boolean }

/** Ссылки на карточку в одном исходнике — уже без комментариев (см. code) */
function cardLinksIn(file: string, src: string): Found[] {
  const vars = new Set([...src.matchAll(CARD_VAR)].map((m) => m[1]))
  const found: Found[] = []
  for (const m of src.matchAll(/<Link\b/g)) {
    const tag = src.slice(m.index, tagEnd(src, m.index) + 1)
    const ref = /\bhref=\{\s*(\w+)\s*\}/.exec(tag)
    if (!CARD_HREF.test(tag) && !(ref && vars.has(ref[1]))) continue
    found.push({ file, tag: tag.replace(/\s+/g, ' ').slice(0, 90), prefetch: /\bprefetch=/.test(tag) })
  }
  return found
}

/**
 * Плитки-ссылки на карточку без знака ожидания (TilePending): <Link> с
 * классом game-card, в теле которой до </Link> нет <TilePending. Вложенных
 * ссылок не бывает (<a> в <a> невалиден), так что первый </Link> — свой.
 */
function tilesWithoutPendingIn(src: string): string[] {
  const vars = new Set([...src.matchAll(CARD_VAR)].map((v) => v[1]))
  const out: string[] = []
  for (const m of src.matchAll(/<Link\b/g)) {
    const end = tagEnd(src, m.index)
    const tag = src.slice(m.index, end + 1)
    const ref = /\bhref=\{\s*(\w+)\s*\}/.exec(tag)
    if (!CARD_HREF.test(tag) && !(ref && vars.has(ref[1]))) continue
    if (!/\bgame-card\b/.test(tag)) continue
    const body = src.slice(end + 1, src.indexOf('</Link>', end))
    if (!/<TilePending\b/.test(body)) out.push(tag.replace(/\s+/g, ' ').slice(0, 90))
  }
  return out
}

function cardLinks(): Found[] {
  return [...sources('app'), ...sources('components')].flatMap((file) =>
    cardLinksIn(file, code(fs.readFileSync(path.join(ROOT, file), 'utf8'))),
  )
}

describe('ссылки на карточку игры', () => {
  const links = cardLinks()

  test('без решения о префетче — только там, где причина записана', () => {
    const counted = new Map<string, number>()
    const offenders: string[] = []
    for (const l of links.filter((l) => !l.prefetch)) {
      counted.set(l.file, (counted.get(l.file) ?? 0) + 1)
      if (!DEFAULT_PREFETCH[l.file]) offenders.push(`${l.file}: ${l.tag}…`)
    }
    expect(
      offenders,
      'ссылка на /game/… с префетчем по умолчанию — возьми GameLink (components/GameLink) или запиши причину в DEFAULT_PREFETCH',
    ).toEqual([])
    for (const [file, { links: want }] of Object.entries(DEFAULT_PREFETCH)) {
      // Больше — новая ссылка проскочила под чужой причиной; меньше — место
      // перестало префетчить, и запись в списке устарела
      expect(counted.get(file) ?? 0, `${file}: ссылок с префетчем по умолчанию`).toBe(want)
    }
  })

  test('сторож не слепой: полки этой правки ходят через GameLink', () => {
    // Разбор видит ссылки вообще — иначе пустой список прошёл бы проверку выше
    expect(links.length).toBeGreaterThan(5)
    const uses = (file: string) =>
      (code(fs.readFileSync(path.join(ROOT, file), 'utf8')).match(/<GameLink\b/g) ?? []).length
    expect(uses('app/portrait/[steamid]/page.tsx')).toBe(5)
    expect(uses('app/portrait/[steamid]/year/page.tsx')).toBe(2)
    expect(uses('app/compat/[steamid]/page.tsx')).toBe(2)
    expect(uses('app/game/[appid]/page.tsx')).toBe(1)
    expect(uses('components/LikedShelf.tsx')).toBe(1)
    expect(uses('components/BannedShelf.tsx')).toBe(1)
    expect(uses('components/whatsnew/PatchRow.tsx')).toBe(2)
  })

  test('сторож не слепой: `>` в строке атрибута не обрывает тег, адрес из переменной узнаётся', () => {
    const src = [
      'const gameHref = `/game/${item.appid}`',
      'const patchHref = `/game/${item.appid}/news/${gid}`',
      '<Link className="[&>svg]:size-4" href={`/game/${id}`}>a</Link>',
      '<Link aria-label="a > b" href={`/game/${id}`} prefetch={false}>b</Link>',
      "<Link title='x > y' href={gamePagePath(id)}>c</Link>",
      '<Link href={gameHref} transitionTypes={["nav-back"]}>d</Link>',
      '<Link href={patchHref}>e</Link>',
      '<Link href={`/game/${id}/news/${gid}`}>f</Link>',
    ].join('\n')
    const found = cardLinksIn('x.tsx', src)
    // Страницы патчей — и шаблоном, и через переменную — не карточка
    expect(found.map((f) => f.prefetch)).toEqual([false, true, false, false])
    expect(found[0].tag).toContain('[&>svg]:size-4')
    expect(found[3].tag).toContain('href={gameHref}')
  })

  /**
   * У /game нет loading.tsx, и без префетча нажатая плитка ждёт сервер
   * немой — до секунды холодного рендера ISR. Знак ожидания (TilePending)
   * обязан стоять в каждой плитке-ссылке на карточку: GameLink кладёт его
   * сам, а Link с префетчем по умолчанию (полка /explore) — руками, потому
   * что префетч может не успеть. Плитка, собранная мимо обоих, снова
   * молчала бы под пальцем. Исключения — в WITHOUT_PENDING, с причиной.
   */
  test('каждая плитка-ссылка на карточку показывает ожидание', () => {
    const counted = new Map<string, number>()
    const offenders = [...sources('app'), ...sources('components')].flatMap((file) => {
      const tiles = tilesWithoutPendingIn(code(fs.readFileSync(path.join(ROOT, file), 'utf8')))
      if (tiles.length) counted.set(file, tiles.length)
      return WITHOUT_PENDING[file] ? [] : tiles.map((t) => `${file}: ${t}…`)
    })
    expect(
      offenders,
      'плитка game-card ведёт на /game/… без TilePending — возьми GameLink или положи <TilePending /> в ссылку',
    ).toEqual([])
    for (const [file, { tiles: want }] of Object.entries(WITHOUT_PENDING)) {
      // Как у DEFAULT_PREFETCH: новая плитка не проскочит под чужой причиной
      expect(counted.get(file) ?? 0, `${file}: плиток без знака ожидания`).toBe(want)
    }
  })

  test('сторож ожидания не слепой: видит плитку без знака и тело до своего </Link>', () => {
    const src = [
      '<Link href={`/game/${a}`} className="game-card block"><Body /></Link>',
      '<Link href={`/game/${b}`} className="game-card block"><Body /><TilePending /></Link>',
      // не плитка — текстовой ссылке на ту же карточку знак не нужен
      '<Link href={`/game/${c}`} className="tap link-more">Об игре</Link>',
      '<Link href={`/game/${d}`} className="game-card block"><Body /></Link>',
      '<p><TilePending /></p>',
    ].join('\n')
    const found = tilesWithoutPendingIn(src)
    expect(found).toHaveLength(2)
    expect(found[0]).toContain('${a}')
    expect(found[1]).toContain('${d}')
  })

  test('GameLink кладёт знак ожидания последним ребёнком — после содержимого плитки', () => {
    const el = GameLink({ appid: 730, className: 'game-card block', children: 'плитка' })
    const kids = (el as ReactElement<{ children: unknown[] }>).props.children
    expect(kids[0]).toBe('плитка')
    expect(isValidElement(kids[1]) && kids[1].type).toBe(TilePending)
  })

  test('GameLink — это Link на карточку с выключенным префетчем, остальное как есть', () => {
    const el = GameLink({ appid: 730, className: 'game-card block', transitionTypes: ['nav-forward'] })
    expect(isValidElement(el)).toBe(true)
    const { props } = el as ReactElement<Record<string, unknown>>
    expect(props).toMatchObject({
      href: '/game/730',
      prefetch: false,
      className: 'game-card block',
      transitionTypes: ['nav-forward'],
    })
  })
})
