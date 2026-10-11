import fs from 'node:fs'
import path from 'node:path'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { CardDownload } from '../components/CardDownload'
import { useShareLink, type ShareLink } from '../components/ShareLink'
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
 * строкой. Здесь — что нажатие уходит с тем «что», которое дала кнопка, и что
 * скачивание карточки тоже доходит до счётчика.
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
   * неправдой. И «что» здесь — тоже новое знание о нажатии, его надо назвать.
   */
  test('/privacy называет, что «Поделиться» считается с тем, чем, и «Скачать карточку»', () => {
    const policy = fs.readFileSync(path.join(ROOT, 'app', 'privacy', 'page.tsx'), 'utf8').replace(/\s+/g, ' ')
    expect(policy).toMatch(/Ещё мы считаем несколько шагов:[^.]*«Поделиться» — вместе с тем, чем поделились/)
    expect(policy).toMatch(/Ещё мы считаем несколько шагов:[^.]*«Скачать карточку»/)
  })

  /*
   * Новая ссылка «скачать» мимо CardDownload снова не считалась бы — ровно
   * то, что было с обеими карточками. Проверка текстовая: тег, к которому
   * относится атрибут download.
   */
  test('каждая ссылка с download — через CardDownload', () => {
    const tags: string[] = []
    for (const [file, src] of sources()) {
      const code = withoutComments(src)
      for (const hit of code.matchAll(/\sdownload[=\s]/g)) {
        const open = code.lastIndexOf('<', hit.index)
        tags.push(`${file}: ${code.slice(open + 1).match(/^[\w.]+/)?.[0] ?? '?'}`)
      }
    }
    expect(tags.length, 'ни одной ссылки «скачать» не найдено — сторож ослеп').toBeGreaterThanOrEqual(2)
    expect(tags.filter((t) => !t.endsWith(': CardDownload'))).toEqual([])
  })
})
