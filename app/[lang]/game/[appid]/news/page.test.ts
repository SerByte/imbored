import fs from 'node:fs'
import path from 'node:path'
import Link from '@/components/Link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { LinkPending } from '@/components/LinkPending'
import { setNewsDigest, setNewsDigestEn, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { flight as flightOf, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import PatchArchivePage, { generateMetadata, revalidate } from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * Архив обновлений игры — /game/<appid>/news (lib/patcharchive).
 *
 * Карточка игры показывает восемь последних патчей, а хранится до тридцати
 * постов: всё старше восьмого раньше не было видно ниоткуда. Здесь — что
 * архив показывает их все, ведёт заголовком только на страницы патчей из
 * поиска и сам идёт в индекс, только когда в нём есть своё: пересказы.
 */

const APPID = 730
const DAY = 86_400

let db: Db
let now: number

beforeEach(async () => {
  db = await freshDb()
  now = nowSec()
  await upsertGameMeta(
    db,
    {
      appid: APPID,
      name: 'Counter-Strike 2',
      tags: { FPS: 1000 },
      genres: [],
      categories: [1],
      reviewsTotal: 1000,
      reviewsPercent: 80,
      art: { header: `https://cdn.example/${APPID}/header.jpg`, header2x: HEADER },
    },
    now,
  )
})

/** Шапка игры из Steam — она же превью архива в чате (gameCard в lib/site) */
const HEADER = `https://cdn.example/${APPID}/header_2x.jpg`

const ISLANDS = new Map<unknown, string>([
  [Link, 'Link'],
  [GameArt, 'GameArt'],
  [LinkPending, 'LinkPending'],
])

function patch(gid: string, daysAgo: number, over: Partial<StoredNews> = {}): StoredNews {
  return {
    appid: APPID,
    gid,
    title: 'Обновление Counter-Strike 2',
    url: `https://store.steampowered.com/news/app/${APPID}/view/${gid}`,
    publishedAt: now - daysAgo * DAY,
    kind: 'patch',
    scale: 'major',
    blocks: [{ kind: 'p', runs: [{ text: 'Починили сеть' }] }],
    bodyHash: `h${gid}`,
    rank: 9000,
    ...over,
  }
}

/** Патчи и пересказы к тем, чьи gid названы в told */
async function seed(items: StoredNews[], told: string[]): Promise<void> {
  await upsertNewsItems(db, items, now)
  for (const gid of told) await setNewsDigest(db, APPID, gid, { tldr: `Пересказ ${gid}.`, scale: 'major' }, now)
}

const params = (appid = String(APPID), lang?: string) => ({
  params: Promise.resolve(lang ? { appid, lang } : { appid }),
})
/**
 * Метаданные родителя: своих карточек у сегментов игры нет, и выше —
 * корневая карточка сайта. Архив берёт её, только если у игры нет шапки Steam
 */
const ROOT_CARD = { url: 'https://imbored.cc/ru/opengraph-image?91b1f53ea01c02b3', width: 1200, height: 630, alt: 'imbored — во что поиграть' }
const rootOg = { images: [ROOT_CARD] }
const parent = Promise.resolve({ openGraph: rootOg })
const meta = (appid?: string, lang?: string) => generateMetadata(params(appid, lang), parent as never)
const render = async (lang?: string) => flightOf(await PatchArchivePage(params(undefined, lang)), ISLANDS)

describe('архив обновлений игры', () => {
  test('все хранящиеся патчи, а не восемь, как на карточке; распродаж нет', async () => {
    const items = Array.from({ length: 12 }, (_, i) => patch(String(i + 1), i * 5))
    await seed([...items, patch('sale', 1, { kind: 'news', title: 'Weekend Deal' })], [])
    const page = await render()
    const text = textOf(page)
    // двенадцать строк — у каждой ссылка на оригинал в Steam (пересказов нет)
    expect(JSON.stringify(page).match(/news\/app\/730\/view\//g)).toHaveLength(12)
    expect(text).not.toContain('Weekend Deal')
    expect(text).toContain('12 патчей')
    // ни одного пересказа — и подписи про ИИ нет: подписывать нечего
    expect(text).not.toContain('Пересказы собраны ИИ')
  })

  /*
   * Патч ли запись — по нынешнему правилу классификатора, как у ленты
   * карточки и страницы патча (isStoredPatch в lib/news), а не по kind,
   * записанному опросом. Иначе дорожная карта, записанная патчем до правки
   * lib/news, стояла бы здесь строкой с пересказом и ссылкой на страницу,
   * которая отдаёт ей 404. Вердикт модели «не патч» (scale 'none') — тоже мимо.
   */
  test('дорожная карта, записанная патчем старым правилом, и вердикт «не патч» — не строки архива', async () => {
    await seed(
      [
        patch('real', 1),
        patch('roadmap', 2, {
          title: 'Looking Ahead To Season 5',
          blocks: [{ kind: 'p', runs: [{ text: 'Рассказываем, что готовим к следующему сезону.' }] }],
        }),
        patch('verdict', 3),
      ],
      ['real', 'roadmap'],
    )
    await setNewsDigest(db, APPID, 'verdict', { tldr: 'Планы на будущее.', scale: 'none' }, now)
    const page = await render()
    const text = textOf(page)
    expect(text).toContain('1 патч')
    expect(text).not.toContain('Looking Ahead')
    expect(text).not.toContain('Пересказ roadmap.')
    expect(islandsOf(page, 'Link').some((l) => String(l.href).endsWith('/roadmap'))).toBe(false)
    expect(JSON.stringify(page)).not.toContain('/view/verdict')
  })

  test('строка ведёт пересказом; заголовок — ссылкой только у патча из поиска', async () => {
    await seed([patch('told', 1), patch('hotfix', 2, { scale: 'hotfix' })], ['told'])
    const page = await render()
    const hrefs = islandsOf(page, 'Link').map((l) => ({ href: l.href, prefetch: l.prefetch }))
    expect(hrefs).toContainEqual({ href: `/game/${APPID}/news/told`, prefetch: false })
    // хотфикс без пересказа — страница с noindex: краулера туда не зовём
    expect(hrefs.some((l) => l.href === `/game/${APPID}/news/hotfix`)).toBe(false)
    const text = textOf(page)
    expect(text).toContain('Пересказ told.')
    expect(text).toContain('Пересказы собраны ИИ')
    // путь над заголовком — назад в карточку игры
    expect(hrefs).toContainEqual({ href: `/game/${APPID}`, prefetch: undefined })
  })

  test('по месяцам: заголовок месяца над его патчами', async () => {
    await seed([patch('1', 1), patch('2', 40), patch('3', 80)], [])
    const text = textOf(await render())
    const months = text.match(/(Январь|Февраль|Март|Апрель|Май|Июнь|Июль|Август|Сентябрь|Октябрь|Ноябрь|Декабрь) \d{4}/g)
    expect(new Set(months).size).toBeGreaterThanOrEqual(3)
  })

  test('в поиск — от трёх пересказов у живой игры; меньше — noindex, follow', async () => {
    await seed([patch('1', 1), patch('2', 2), patch('3', 3)], ['1', '2'])
    expect((await meta()).robots).toEqual({ index: false, follow: true })
    await setNewsDigest(db, APPID, '3', { tldr: 'Третий.', scale: 'major' }, now)
    const indexed = await meta()
    expect(indexed.robots).toBeUndefined()
    expect(indexed.alternates?.canonical).toBe(`/game/${APPID}/news`)
    expect(indexed.title).toBe('Обновления «Counter-Strike 2» — что изменилось в патчах')
    // карточка для чатов — шапка игры из Steam, как у самой карточки игры
    expect(indexed.openGraph?.images).toEqual([{ url: HEADER, width: 920, height: 430, alt: 'Counter-Strike 2' }])
  })

  test('у игры без шапки Steam превью — корневая карточка от родителя, а не пустота', async () => {
    await seed([patch('1', 1)], [])
    await db.execute({ sql: 'UPDATE games SET art_json = NULL, header_image = NULL WHERE appid = ?', args: [APPID] })
    expect((await meta()).openGraph?.images).toEqual([ROOT_CARD])
    expect((await meta(undefined, 'en')).openGraph?.images).toEqual([{ ...ROOT_CARD, alt: 'imbored — what to play' }])
  })

  test('игра, которую каталог считает мёртвой, — вне поиска при любых пересказах', async () => {
    await seed([patch('1', 1), patch('2', 2), patch('3', 3)], ['1', '2', '3'])
    // курация пишет вердикт вместе с отметкой проверки (promote-catalog, rowToMeta)
    await db.execute({ sql: 'UPDATE games SET alive = 0, signals_at = ? WHERE appid = ?', args: [now, APPID] })
    expect((await meta()).robots).toEqual({ index: false, follow: true })
  })

  test('нет патчей, нет игры или кривой адрес — 404, а не пустой архив', async () => {
    await seed([patch('sale', 1, { kind: 'news' })], [])
    await expect(PatchArchivePage(params())).rejects.toThrow()
    expect(await meta('570')).toEqual({})
    expect(await meta('abc')).toEqual({})
    expect(await meta('-730')).toEqual({})
  })

  /*
   * Мост «Что нового» внизу — тот же, что у страницы патча, и с тем же
   * правилом: /whatsnew динамическая (lib/nav, DYNAMIC_SECTIONS), префетч
   * будил бы функцию на каждом просмотре архива, а нажатие без него видно по
   * мерцанию подписи (LinkPending).
   */
  test('мост не префетчит динамическую ленту, а нажатие видно сразу', async () => {
    await seed([patch('1', 1)], [])
    const [link] = islandsOf(await render(), 'Link').filter((l) => l.href === '/whatsnew')
    expect(link?.prefetch).toBe(false)
    expect(islandsOf(link?.children, 'LinkPending')).toHaveLength(1)
  })

  test('месяц ISR, и страница не читает сессию', () => {
    expect(revalidate).toBe(30 * DAY)
    const src = fs
      .readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(src).not.toMatch(/next\/headers|currentSession|cookies\(|headers\(\)|searchParams/)
  })
})

/** Ни одной русской буквы: английская строка не должна протекать русским словом */
const CYRILLIC = /[А-Яа-яЁё]/

/**
 * Английский архив — /en/game/<appid>/news. Тот же список и те же правила,
 * только строки по-английски: заголовок поста — newsTitleOn (русский
 * заголовок издателя без перевода становится «{Game} update»), пересказ —
 * только английский, и ссылку на страницу патча и путь в индекс даёт только
 * он. Русский архив того же адреса — прежний (тесты выше).
 */
describe('архив обновлений игры на /en', () => {
  test('ни слова по-русски: шапка, месяцы, строки и мост', async () => {
    const items = Array.from({ length: 3 }, (_, i) => patch(String(i + 1), i * 40))
    await seed(items, ['1'])
    await setNewsDigestEn(db, APPID, '1', { tldrEn: 'Fixed the netcode.' }, now)
    const page = await render('en')
    const text = textOf(page)
    expect(text).toContain('Counter-Strike 2 updates')
    expect(text).toContain('What changed')
    expect(text).toMatch(/3 patches — [A-Z][a-z]+ \d{1,2}, \d{4} to [A-Z][a-z]+ \d{1,2}, \d{4}\. Anything older is in the game's news on Steam\./)
    expect(text).toContain('Summaries are written by AI from the patch notes.')
    expect(text).toContain('Fixed the netcode.')
    // месяц — заголовком по-английски
    expect(text).toMatch(/(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}/)
    // русского пересказа на /en нет — ни строкой, ни подставой
    expect(text).not.toContain('Пересказ 1.')
    expect(text).toContain("What changed in your games? What's new has the major patches from your library in one feed.")
    expect(text).not.toMatch(CYRILLIC)
  })

  test('заголовок — ссылкой только с английским пересказом; без него — «on Steam»', async () => {
    await seed([patch('told', 1), patch('ru', 2)], ['told', 'ru'])
    await setNewsDigestEn(db, APPID, 'told', { tldrEn: 'Fixed the netcode.' }, now)
    const page = await render('en')
    const hrefs = islandsOf(page, 'Link').map((l) => l.href)
    expect(hrefs).toContain(`/game/${APPID}/news/told`)
    // русский пересказ у поста есть, английского нет — страница патча на /en не в поиске
    expect(hrefs).not.toContain(`/game/${APPID}/news/ru`)
    expect(textOf(page)).toContain('on Steam')
  })

  test('мост: без префетча и с мерцанием подписи, как на русской странице', async () => {
    await seed([patch('1', 1)], [])
    const [link] = islandsOf(await render('en'), 'Link').filter((l) => l.href === '/whatsnew')
    expect(link?.prefetch).toBe(false)
    expect(textOf(link?.children)).toBe("What's new")
    expect(islandsOf(link?.children, 'LinkPending')).toHaveLength(1)
  })

  test('метаданные: английские title и description, в поиск — от трёх английских пересказов', async () => {
    await seed([patch('1', 1), patch('2', 2), patch('3', 3)], ['1', '2', '3'])
    // три русских пересказа русский архив в индекс пускают, английский — нет
    expect((await meta()).robots).toBeUndefined()
    const without = await meta(undefined, 'en')
    expect(without.robots).toEqual({ index: false, follow: true })
    expect(without.title).toBe('Counter-Strike 2 updates — what changed in each patch')
    // имя игры впереди, через двоеточие: число в названии не сливается со счётом
    expect(String(without.description)).toMatch(/^Counter-Strike 2: 3 patches — /)
    expect(String(without.description)).not.toMatch(CYRILLIC)

    for (const gid of ['1', '2', '3']) await setNewsDigestEn(db, APPID, gid, { tldrEn: `Summary ${gid}.` }, now)
    const indexed = await meta(undefined, 'en')
    expect(indexed.robots).toBeUndefined()
    expect(indexed.alternates?.canonical).toBe(`/en/game/${APPID}/news`)
    expect(indexed.openGraph?.url).toBe(`/en/game/${APPID}/news`)
    expect(String(indexed.description)).toContain('Latest summary')
    expect(String(indexed.description)).toContain('Summary 1.')
    // превью — та же шапка игры, что на русском
    expect(indexed.openGraph?.images).toEqual([{ url: HEADER, width: 920, height: 430, alt: 'Counter-Strike 2' }])
  })

  /*
   * 404 — пустой объект и на /en: голова корневая, с подписью карточки на
   * языке адреса (rootCardOn в app/[lang]/layout.tsx). Своя запись была
   * нужна, пока архив показывал файловую карточку игры с русским alt.
   */
  test('нет патчей — 404 и на английском, метаданные — пустой объект', async () => {
    await seed([patch('sale', 1, { kind: 'news' })], [])
    await expect(PatchArchivePage(params(undefined, 'en'))).rejects.toThrow()
    for (const appid of [String(APPID), '570', 'abc']) {
      expect(await meta(appid, 'en'), appid).toEqual({})
    }
  })

  test('путь над заголовком — ориентир «Breadcrumb», как у страницы жанра', async () => {
    await seed([patch('1', 1)], [])
    expect(JSON.stringify(await render('en'))).toContain('"aria-label":"Breadcrumb"')
    expect(JSON.stringify(await render())).toContain('"aria-label":"Путь к обновлениям"')
  })
})

/**
 * hreflang архива — только на версии, что сами в поиске, как у адреса в карте
 * сайта (app/sitemap.ts): в поиск каждую версию пускают пересказы своего
 * языка, и ссылка с русской на /en с noindex была бы пустым сигналом. Связка
 * одна на обе версии; обе в поиске — голова как была.
 */
describe('архив обновлений: hreflang', () => {
  const PATH = `/game/${APPID}/news`
  const three = () => [patch('1', 1), patch('2', 2), patch('3', 3)]
  const enDigests = async () => {
    for (const gid of ['1', '2', '3']) await setNewsDigestEn(db, APPID, gid, { tldrEn: `Summary ${gid}.` }, now)
  }

  test('в поиске только русская — hreflang и x-default только на неё, и с /en тоже', async () => {
    await seed(three(), ['1', '2', '3'])
    const languages = { ru: PATH, 'x-default': PATH }
    expect((await meta()).alternates).toEqual({ canonical: PATH, languages })
    expect((await meta(undefined, 'en')).alternates).toEqual({ canonical: `/en${PATH}`, languages })
  })

  test('в поиске обе — обе и x-default на английскую', async () => {
    await seed(three(), ['1', '2', '3'])
    await enDigests()
    const languages = { ru: PATH, en: `/en${PATH}`, 'x-default': `/en${PATH}` }
    expect((await meta()).alternates).toEqual({ canonical: PATH, languages })
    expect((await meta(undefined, 'en')).alternates).toEqual({ canonical: `/en${PATH}`, languages })
    // порядок ключей — тот же, что у localeAlternates: голова не сдвинулась
    expect(Object.keys((await meta()).alternates?.languages ?? {})).toEqual(['ru', 'en', 'x-default'])
  })

  test('в поиске только английская — x-default на неё', async () => {
    await seed(three(), [])
    await enDigests()
    const ru = await meta()
    expect(ru.robots).toEqual({ index: false, follow: true })
    const languages = { en: `/en${PATH}`, 'x-default': `/en${PATH}` }
    expect(ru.alternates).toEqual({ canonical: PATH, languages })
    expect((await meta(undefined, 'en')).alternates).toEqual({ canonical: `/en${PATH}`, languages })
  })

  test('ни одной версии в поиске — hreflang нет, canonical остаётся', async () => {
    await seed(three(), ['1', '2'])
    expect((await meta()).alternates).toEqual({ canonical: PATH })
    expect((await meta(undefined, 'en')).alternates).toEqual({ canonical: `/en${PATH}` })
  })
})
