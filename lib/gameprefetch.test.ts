import fs from 'node:fs'
import path from 'node:path'
import { isValidElement, type ReactElement } from 'react'
import { describe, expect, test } from 'vitest'
import { GameLink } from '../components/GameLink'

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
  'app/explore/page.tsx': {
    links: 1,
    why: 'полка «Приглянулось» одного человека, свёрнута до EXPLORE_SHELF_FOLD; в правку GameLink не входила',
  },
}

/** Код без комментариев: докблоки цитируют то, что здесь ищется */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/** Конец открывающего тега — с учётом {} и строк внутри атрибутов */
function tagEnd(src: string, i: number): number {
  let depth = 0
  let q: string | null = null
  for (let j = i; j < src.length; j++) {
    const c = src[j]
    if (q) {
      if (c === q) q = null
      continue
    }
    if (depth > 0 && (c === '"' || c === "'" || c === '`')) q = c
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

/** Ссылка на саму карточку: /game/${…} и ничего после — страницы патчей не в счёт */
const CARD_HREF = /\bhref=\{`\/game\/\$\{[^}`]+\}`\}/

type Found = { file: string; tag: string; prefetch: boolean }

function cardLinks(): Found[] {
  const found: Found[] = []
  for (const file of [...sources('app'), ...sources('components')]) {
    const src = code(fs.readFileSync(path.join(ROOT, file), 'utf8'))
    for (const m of src.matchAll(/<Link\b/g)) {
      const tag = src.slice(m.index, tagEnd(src, m.index) + 1)
      if (!CARD_HREF.test(tag)) continue
      found.push({ file, tag: tag.replace(/\s+/g, ' ').slice(0, 90), prefetch: /\bprefetch=/.test(tag) })
    }
  }
  return found
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
