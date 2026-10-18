import fs from 'node:fs'
import path from 'node:path'
import Link from '@/components/Link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { PatchShare } from '@/components/PatchShare'
import { setNewsDigest, setNewsDigestEn, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { flight as flightOf, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import PatchPage, { generateMetadata, revalidate } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Мост «а у меня?» со страницы патча.
 *
 * Пересказ патча — вторая по пересылаемости ссылка после выбора на вечер
 * (PatchShare делится ею с меткой ref), а нижняя строка страницы вела только
 * в игру, в Steam и к соседним патчам этой же игры. Пришедший по ссылке
 * прочитал, что изменилось в чужой игре, — и ниоткуда не узнавал, что то же
 * самое здесь собирают по его собственной библиотеке. Ссылка на «Что нового»
 * — одна строка, серверная, без скрипта.
 *
 * Страница при этом остаётся одной на всех: она в ISR на сутки, и мост не
 * знает, кто смотрит. Гостя /whatsnew не разворачивает — показывает общую
 * ленту и сам зовёт подключить Steam, — так что и сессии здесь читать
 * незачем. Сторож ниже держит это правило в исходнике: чтение куки сделало
 * бы страницу динамической, и сутки кэша молча кончились бы.
 */

const APPID = 730
const GID = '5123894512345'

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
  [PatchShare, 'PatchShare'],
])

function patch(gid: string, publishedAt: number): StoredNews {
  return {
    appid: APPID,
    gid,
    title: `Обновление ${gid}`,
    url: `https://store.steampowered.com/news/app/${APPID}/view/${gid}`,
    publishedAt,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Починили сеть' }] }],
    bodyHash: `h${gid}`,
    rank: 9000,
  }
}

async function render(): Promise<unknown> {
  const now = nowSec()
  await upsertGameMeta(
    db,
    {
      appid: APPID,
      name: 'Counter-Strike 2',
      tags: {},
      genres: [],
      categories: [],
      reviewsTotal: 1000,
      reviewsPercent: 80,
    },
    now,
  )
  await upsertNewsItems(db, [patch(GID, now - 3600)], now)
  await setNewsDigest(db, APPID, GID, { tldr: 'Починили сеть.', scale: 'major' }, now)
  return flightOf(await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID }) }), ISLANDS)
}

describe('страница патча: мост к своей ленте', () => {
  test('ведёт в «Что нового» — по играм своей библиотеки', async () => {
    const links = islandsOf(await render(), 'Link').filter((l) => l.href === '/whatsnew')
    expect(links).toHaveLength(1)
    expect(textOf(links[0]?.children)).toBe('Что нового')
  })

  test('мост не читает сессию: страница остаётся в ISR на сутки', () => {
    expect(revalidate).toBe(86_400)
    // Без комментариев: докблоки как раз объясняют, почему здесь нет cookies()
    const src = fs
      .readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(src).not.toMatch(/next\/headers|currentSession|cookies\(|headers\(\)|searchParams/)
  })
})

/**
 * Английская страница патча. Пересказ — только английский, тело — только
 * английское, русский заголовок издателя без перевода — «{Game} update»
 * (newsTitleOn); в индекс — только с английским пересказом. Русская страница
 * того же поста — прежняя.
 */
describe('страница патча на /en', () => {
  async function renderEn(withEnglish: boolean): Promise<unknown> {
    await render()
    // Соседний патч с русским заголовком — для «More … patches» внизу
    await upsertNewsItems(db, [patch('5123894512300', nowSec() - 3 * 86_400)], nowSec())
    if (withEnglish) await setNewsDigestEn(db, APPID, GID, { tldrEn: 'Fixed the netcode.' }, nowSec())
    return flightOf(
      await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }),
      ISLANDS,
    )
  }

  test('ни слова по-русски: «In short», запасной заголовок и строка вместо русского тела', async () => {
    const text = textOf(await renderEn(true))
    expect(text).toContain('In short')
    expect(text).toContain('Fixed the netcode.')
    expect(text).toContain('Update')
    expect(text).toContain("We don't have these patch notes in English")
    expect(text).toContain('More Counter-Strike 2 patches')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('без английского пересказа блока «In short» нет — русский не подставляется', async () => {
    const text = textOf(await renderEn(false))
    expect(text).not.toContain('In short')
    expect(text).not.toMatch(/[А-Яа-яЁё]/)
  })

  test('мост ведёт в «What\'s new» одной фразой', async () => {
    const tree = await renderEn(true)
    const links = islandsOf(tree, 'Link').filter((l) => l.href === '/whatsnew')
    expect(links).toHaveLength(1)
    expect(textOf(links[0]?.children)).toBe("What's new")
    expect(textOf(tree)).toContain("What changed in your games? What's new has the major patches from your library in one feed.")
  })

  test('метаданные: английский заголовок и описание, noindex без английского пересказа', async () => {
    await render()
    const en = { params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }
    const ru = { params: Promise.resolve({ appid: String(APPID), gid: GID }) }
    const without = await generateMetadata(en)
    expect(without.robots).toEqual({ index: false, follow: true })
    expect(String(without.title)).toMatch(/^Counter-Strike 2: Update \([A-Z][a-z]{2} \d{1,2}, \d{4}\) — what changed$/)
    expect(String(without.description)).not.toMatch(/[А-Яа-яЁё]/)
    // Русская страница того же поста — с русским пересказом, как была
    const ruMeta = await generateMetadata(ru)
    expect(ruMeta.description).toBe('Починили сеть.')
    expect(String(ruMeta.title)).toContain('— что изменилось')

    await setNewsDigestEn(db, APPID, GID, { tldrEn: 'Fixed the netcode.' }, nowSec())
    const withEn = await generateMetadata(en)
    expect(withEn.description).toBe('Fixed the netcode.')
    expect(withEn.robots).toEqual(ruMeta.robots)
    expect(withEn.alternates?.canonical).toBe(`/en/game/${APPID}/news/${GID}`)
  })
})
