import fs from 'node:fs'
import path from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { DemoBar } from '../components/DemoBar'
import { demoDoors } from './demodoor'
import { destinationUrl, loginTarget } from './destination'
import { presetHref, VIBE_PRESETS } from './presets'
import { CLIENT_EVENTS, TRACK_PATH } from './track'

/**
 * Дверь из демо к своей библиотеке (components/DemoBar, lib/demodoor).
 *
 * Демо называло себя только на карточке главной: на /play, /daily и
 * /library — ни слова, и в момент ценности сделать то же по своей было
 * негде. Сторожим три вещи: обе двери возвращают туда, где нажали; полоса
 * стоит на всех трёх страницах и не двигает героя; показ и нажатия
 * считаются, а показ — не на каждую новую игру.
 */

const ROOT = path.join(__dirname, '..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const PLAY = presetHref(VIBE_PRESETS[0])

describe('двери полосы демо', () => {
  const query = (href: string) => new URLSearchParams(href.split('?')[1] ?? '')

  test.each([PLAY, '/daily', '/library'])('%s: вход через Steam возвращает сюда же', (from) => {
    const { steam } = demoDoors(from)
    expect(steam.startsWith('/api/auth/steam?')).toBe(true)
    // тот же разбор, что у возврата из Steam (auth/steam/return)
    expect(loginTarget(query(steam))).toBe(from)
  })

  test.each([PLAY, '/daily', '/library'])('%s: ссылка ведёт к полю и обратно сюда', (from) => {
    const { link } = demoDoors(from)
    const q = query(link)
    expect(link.startsWith('/?')).toBe(true)
    // reconnect=1 раскрывает поле и у того, кто не в демо (ConnectCard)
    expect(q.get('reconnect')).toBe('1')
    // тот же разбор, что у карточки: next = destinationUrl(search.get('next'))
    expect(destinationUrl(q.get('next'))).toBe(from)
  })

  test('настроение выдачи едет через обе двери', () => {
    expect(PLAY).toMatch(/^\/play\?time=/)
    const { steam, link } = demoDoors(PLAY)
    expect(loginTarget(query(steam))).toContain('time=')
    expect(query(link).get('next')).toContain('time=')
  })
})

describe('полоса', () => {
  const html = (props: { from: string; overlay?: boolean; className?: string }) =>
    renderToStaticMarkup(createElement(DemoBar, props))

  test('говорит, чья библиотека, и даёт обе двери', () => {
    const out = html({ from: '/daily' })
    const { steam, link } = demoDoors('/daily')
    expect(out).toContain('Это чужая демо-библиотека.')
    expect(out).toContain('Подбор по твоей —')
    expect(out).toContain(`href="${steam.replace(/&/g, '&amp;')}"`)
    expect(out).toContain(`href="${link.replace(/&/g, '&amp;')}"`)
    expect(out).toMatch(/>Войти через Steam<\/a>/)
    expect(out).toMatch(/>вставить ссылку<\/a>/)
  })

  /*
   * Героя полоса не двигает: на /play и /daily признак демо клиентский
   * (подсказка о входе), и полоса в потоке после гидратации сдвинула бы кадр.
   * Поверх героя — абсолютом, и слой не ловит нажатия мимо самой полосы.
   */
  test('поверх героя — вне потока, нажатия ловит только сама полоса', () => {
    const out = html({ from: '/daily', overlay: true })
    const outer = out.match(/^<div class="([^"]*)"/)?.[1] ?? ''
    expect(outer).toMatch(/\babsolute\b/)
    expect(outer).toMatch(/\bpointer-events-none\b/)
    expect(out).toMatch(/<p class="[^"]*\bpointer-events-auto\b/)
    // поле как у текста героя — под вырез в ландшафте (lib/landmarks.test.ts)
    expect(out).toContain('max-w-6xl px-safe')
  })

  test('в потоке — только сама строка, без слоя', () => {
    expect(html({ from: '/library', className: 'mb-6' })).toMatch(/^<p class="[^"]*\bmb-6\b/)
  })
})

describe('полоса стоит там, где демо в момент ценности', () => {
  test('/play: в герое, поверх кадра, по подсказке о входе', () => {
    const src = code(read('app/play/page.tsx'))
    expect(src).toContain('const demo = useDemoSession()')
    const hero = src.indexOf('media-dark relative min-h-[78vh]')
    const bar = src.indexOf('{demo && <DemoBar from={`/play?${search}`} overlay />}')
    const ladder = src.indexOf('variants={LADDER}', hero)
    expect(hero).toBeGreaterThan(-1)
    expect(bar, 'полоса ушла из героя выдачи').toBeGreaterThan(hero)
    expect(bar).toBeLessThan(ladder)
  })

  test('/daily: в герое, поверх кадра, по подсказке о входе', () => {
    const src = code(read('app/daily/page.tsx'))
    expect(src).toContain('const demo = useDemoSession()')
    const hero = src.indexOf('media-dark relative flex-1 min-h-[92vh]')
    const bar = src.indexOf('{demo && <DemoBar from="/daily" overlay />}')
    const text = src.indexOf('pb-16 pt-40', hero)
    expect(hero).toBeGreaterThan(-1)
    expect(bar, 'полоса ушла из героя игры дня').toBeGreaterThan(hero)
    expect(bar).toBeLessThan(text)
  })

  test('/library: признак серверный — полоса в потоке героя, из первого HTML', () => {
    const src = code(read('app/library/page.tsx'))
    const hero = src.indexOf('lib-hero')
    const bar = src.indexOf('{isDemoId(steamid) && <DemoBar from="/library" className="mb-6" />}')
    expect(hero).toBeGreaterThan(-1)
    expect(bar, 'полоса ушла из героя библиотеки').toBeGreaterThan(hero)
    expect(bar).toBeLessThan(src.indexOf('<Eyebrow', hero))
  })

  test('клиентские страницы ставят полосу только поверх героя', () => {
    for (const file of ['app/play/page.tsx', 'app/daily/page.tsx']) {
      const tags = [...code(read(file)).matchAll(/<DemoBar\b[^>]*\/>/g)].map((m) => m[0])
      expect(tags.length, file).toBe(1)
      expect(tags[0], `${file}: без overlay полоса сдвинет героя после гидратации`).toMatch(/\boverlay\b/)
    }
  })
})

describe('счёт показов и нажатий', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  test('события полосы — в списке, который принимает /api/event', () => {
    for (const e of ['demo_door_shown', 'demo_door_steam', 'demo_door_link']) {
      expect(CLIENT_EVENTS as readonly string[]).toContain(e)
    }
  })

  test('нажатия считаются у самих дверей', () => {
    const src = code(read('components/DemoBar.tsx'))
    expect(src).toMatch(/href=\{doors\.steam\}\s*onClick=\{\(\) => track\('demo_door_steam'\)\}/)
    expect(src).toMatch(/href=\{doors\.link\}\s*onClick=\{\(\) => track\('demo_door_link'\)\}/)
    expect(src).toMatch(/useEffect\(\(\) => \{\s*noteDemoDoorShown\(from\)/)
  })

  /*
   * Герой /play и /daily пересоздаётся с каждой новой игрой, и полоса вместе
   * с ним. Показ — раз на страницу за документ, иначе листание демо
   * выглядело бы в воронке десятками показов.
   */
  test('показ — раз на страницу за документ, настроение не в счёт', async () => {
    const sent: string[] = []
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {} })
    vi.stubGlobal('navigator', {
      sendBeacon: (p: string, blob: Blob) => {
        void blob.text().then((t) => sent.push(`${p} ${(JSON.parse(t) as { event: string }).event}`))
        return true
      },
    })
    vi.resetModules()
    const { noteDemoDoorShown } = await import('./demodoor')
    noteDemoDoorShown('/play?time=short&vibe=chill&social=solo')
    noteDemoDoorShown('/play?time=long&vibe=story&social=solo')
    noteDemoDoorShown('/play')
    noteDemoDoorShown('/daily')
    noteDemoDoorShown('/daily')
    await new Promise((r) => setTimeout(r, 0))
    expect(sent).toEqual([`${TRACK_PATH} demo_door_shown`, `${TRACK_PATH} demo_door_shown`])
  })
})
