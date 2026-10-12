import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { Cover } from '../components/whatsnew/Cover'
import type { FeedItem } from './db'

/**
 * «Уменьшить движение» не меняет разметку, которую гидратирует клиент.
 *
 * useReducedMotion на сервере — null (окна нет), а у читателя с
 * prefers-reduced-motion: reduce — true уже на первом, гидратирующем рендере:
 * framer читает настройку один раз, в useState. Обложка /whatsnew рисовала
 * style={reduced ? undefined : {…}} — сервер отдавал style="transform:none",
 * клиент не отдавал style вовсе, и React на каждом таком заходе писал в консоль
 * «A tree hydrated but some attributes … didn't match» и оставлял атрибут
 * несогласованным. Без «уменьшить движение» расхождения нет — поэтому оно и
 * не попадалось.
 *
 * Правка — тот же объект style с теми же ключами, только значения при reduced
 * статические (y: 0, scale: 1, opacity: 1): их framer печатает ровно так же,
 * как начальную точку параллакса, а двигать статические числа нечему.
 *
 * Здесь не браузер, а два серверных рендера: «как на сервере» (null) и «как
 * первый рендер у читателя с reduce» (true). Разметка обязана совпасть.
 */

const reduced = vi.hoisted(() => ({ value: null as boolean | null }))

vi.mock('framer-motion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('framer-motion')>()),
  useReducedMotion: () => reduced.value,
}))

afterEach(() => {
  reduced.value = null
})

const item: FeedItem = {
  appid: 1245620,
  gid: '667248424192575311',
  title: 'Patch Notes Version 1.16',
  url: 'https://store.steampowered.com/news/app/1245620/view/667248424192575311',
  publishedAt: 1_754_000_000,
  kind: 'patch',
  scale: 'major',
  bodyHash: 'h',
  rank: 900_000,
  tldr: 'Поправили баланс оружия.',
  // кадр патча — третий слой параллакса, без него его разметки нет вовсе
  imageUrl: 'https://cdn.example/patch.jpg',
}

function render(value: boolean | null): string {
  reduced.value = value
  return renderToString(
    createElement(Cover, { item, meta: { name: 'ELDEN RING', ccu: 1000 }, nowSec: 1_754_100_000, changes: 12 }),
  )
}

describe('обложка /whatsnew под «уменьшить движение»', () => {
  test('разметка читателя с reduce совпадает с серверной', () => {
    const server = render(null)
    expect(render(true)).toBe(server)
  })

  test('сторож не слепой: все три слоя параллакса в разметке есть', () => {
    // фон, текст и кадр патча — три m.* со style; пропади хоть один из
    // разметки, сравнение выше прошло бы, ничего не проверив
    const html = render(null)
    expect(html.match(/style="[^"]*transform:none[^"]*"/g)).toHaveLength(3)
  })
})
