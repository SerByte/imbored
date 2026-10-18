import { describe, expect, test } from 'vitest'
import { DESCRIPTION_MAX } from './clip'
import type { StoredNews } from './db'
import { NEWS_KEEP } from './newsjob'
import {
  archiveDescription,
  archiveIndexable,
  archiveItems,
  archiveMonths,
  archiveTitle,
  PATCH_ARCHIVE_LIMIT,
  PATCH_ARCHIVE_MIN,
  patchArchivePath,
} from './patcharchive'

const DAY = 86_400
/** 12 октября 2026, полдень UTC */
const OCT_12 = Date.UTC(2026, 9, 12, 12) / 1000

/** Патч из базы — как его отдаёт getGameNews */
function head(gid: string, over: Partial<StoredNews> = {}): StoredNews {
  return {
    appid: 730,
    gid,
    title: 'Обновление Counter-Strike 2',
    url: `https://store.steampowered.com/news/app/730/view/${gid}`,
    publishedAt: OCT_12,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Починили сеть' }] }],
    bodyHash: `h${gid}`,
    rank: 9000,
    tldr: 'Починили сеть и поправили баланс.',
    ...over,
  }
}

describe('архив обновлений игры', () => {
  test('адрес — под карточкой игры, рядом со страницами патчей', () => {
    expect(patchArchivePath(730)).toBe('/game/730/news')
  })

  /*
   * Архив показывает всё, что держит ретенция: NEWS_KEEP постов на игру
   * (lib/newsjob). Меньше — часть сохранённых патчей снова ниоткуда не видна;
   * больше — читать нечего.
   */
  test('держит столько патчей, сколько их хранится', () => {
    expect(PATCH_ARCHIVE_LIMIT).toBe(NEWS_KEEP)
  })

  test('заголовок — ссылкой только у патча, страница которого в поиске (indexedNewsPath)', () => {
    const items = archiveItems([
      head('1'),
      head('2', { scale: 'hotfix', tldr: undefined }),
      head('3', { rank: 0 }),
      head('4', { tldr: '  ' }),
    ])
    expect(items.map((i) => i.href)).toEqual(['/game/730/news/1', null, null, null])
  })

  test('в поиск — от трёх пересказанных патчей и только у живой игры каталога', () => {
    const three = archiveItems([head('1'), head('2'), head('3'), head('4', { tldr: undefined })])
    const two = archiveItems([head('1'), head('2'), head('3', { tldr: undefined }), head('4', { tldr: undefined })])
    expect(PATCH_ARCHIVE_MIN).toBe(3)
    expect(archiveIndexable(three, true)).toBe(true)
    expect(archiveIndexable(three, false)).toBe(false)
    expect(archiveIndexable(two, true)).toBe(false)
  })

  test('по месяцам, свежие первыми; граница месяца — по UTC, как у даты строки', () => {
    const items = archiveItems([
      head('1', { publishedAt: OCT_12 }),
      head('2', { publishedAt: Date.UTC(2026, 9, 1, 0, 30) / 1000 }),
      head('3', { publishedAt: Date.UTC(2026, 8, 30, 23, 30) / 1000 }),
      head('4', { publishedAt: Date.UTC(2025, 11, 31) / 1000 }),
    ])
    expect(archiveMonths(items).map((m) => [m.label, m.items.map((i) => i.gid)])).toEqual([
      ['Октябрь 2026', ['1', '2']],
      ['Сентябрь 2026', ['3']],
      ['Декабрь 2025', ['4']],
    ])
  })

  test('<title> — с названием игры и вопросом, ради которого ищут', () => {
    expect(archiveTitle('Counter-Strike 2')).toBe('Обновления «Counter-Strike 2» — что изменилось в патчах')
  })

  /*
   * Описание ведёт пересказом, а не заголовком Steam: у CS2 все патчи
   * называются «Обновление Counter-Strike 2» (F78 аудита), и заголовок о
   * содержании не говорит ничего.
   */
  test('описание: сколько патчей, за какой срок и последний пересказ', () => {
    const items = archiveItems([
      head('1', { publishedAt: OCT_12, tldr: undefined, scale: 'hotfix' }),
      head('2', { publishedAt: OCT_12 - 10 * DAY }),
      head('3', { publishedAt: OCT_12 - 70 * DAY }),
    ])
    const d = archiveDescription('Counter-Strike 2', items)
    expect(d).toContain('3 патча')
    expect(d).toContain('Починили сеть')
    expect(d).not.toContain('Обновление Counter-Strike 2')
    expect(d.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
  })

  test('описание без единого пересказа — без пустого хвоста', () => {
    const d = archiveDescription('Portal 2', archiveItems([head('1', { tldr: undefined })]))
    expect(d).toMatch(/^1 патч «Portal 2»/)
    expect(d).not.toMatch(/:\s*$/)
  })
})
