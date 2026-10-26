import fs from 'node:fs'
import path from 'node:path'
import Link from '@/components/Link'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GameArt } from '@/components/GameArt'
import { LinkPending } from '@/components/LinkPending'
import { PatchShare } from '@/components/PatchShare'
import { setNewsDigest, setNewsDigestEn, upsertGameMeta, upsertNewsItems, type Db, type StoredNews } from '@/lib/db'
import { ldScript, patchArticleLd, patchBreadcrumbLd } from '@/lib/jsonld'
import { newsHeading } from '@/lib/newspage'
import { appBaseUrl, nowSec } from '@/lib/server'
import { flight as flightOf, imageHints, islandsOf, textOf } from '@/lib/testing/flight'
import { freshDb } from '@/lib/testing/route'
import { loadPatch, patchHeading } from './load'
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
 * Страница при этом остаётся одной на всех: она в ISR на месяц, и мост не
 * знает, кто смотрит. Гостя /whatsnew не разворачивает — показывает общую
 * ленту и сам зовёт подключить Steam, — так что и сессии здесь читать
 * незачем. Сторож ниже держит это правило в исходнике: чтение куки сделало
 * бы страницу динамической, и месяц кэша молча кончился бы.
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
  [LinkPending, 'LinkPending'],
])

function patch(gid: string, publishedAt: number, extra: Partial<StoredNews> = {}): StoredNews {
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
    ...extra,
  }
}

async function render(extra: Partial<StoredNews> = {}): Promise<unknown> {
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
  await upsertNewsItems(db, [patch(GID, now - 3600, extra)], now)
  await setNewsDigest(db, APPID, GID, { tldr: 'Починили сеть.', scale: 'major' }, now)
  return flightOf(await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID }) }), ISLANDS)
}

describe('страница патча: мост к своей ленте', () => {
  test('ведёт в «Что нового» — по играм своей библиотеки', async () => {
    const links = islandsOf(await render(), 'Link').filter((l) => l.href === '/whatsnew')
    expect(links).toHaveLength(1)
    expect(textOf(links[0]?.children)).toBe('Что нового')
  })

  /*
   * /whatsnew — force-dynamic (lib/nav, DYNAMIC_SECTIONS), и префетч этой
   * ссылки будил функцию на каждом просмотре патча, докрученного до низа:
   * на проде MISS и private, no-store. Нажатие без префетча не выглядит
   * зависшим — подпись мерцает, пока едет сервер (LinkPending), как у той
   * же ссылки в шапке.
   */
  test('мост не префетчит динамическую ленту, а нажатие видно сразу', async () => {
    const [link] = islandsOf(await render(), 'Link').filter((l) => l.href === '/whatsnew')
    expect(link?.prefetch).toBe(false)
    expect(islandsOf(link?.children, 'LinkPending')).toHaveLength(1)
  })

  /*
   * Между игрой и патчем — архив обновлений игры (/game/<appid>/news): путь
   * над заголовком и разметка крошек (patchBreadcrumbLd) говорят одно.
   * Без префетча: архив на ISR, и рендерится он по первому заходу.
   */
  test('путь над заголовком — игра → «Обновления», архив без префетча', async () => {
    const links = islandsOf(await render(), 'Link')
    expect(links).toContainEqual(expect.objectContaining({ href: `/game/${APPID}` }))
    const archive = links.filter((l) => l.href === `/game/${APPID}/news`)
    expect(archive.length).toBeGreaterThanOrEqual(1)
    expect(archive.every((l) => l.prefetch === false)).toBe(true)
    expect(textOf(archive[0]?.children)).toBe('Обновления')
  })
})

/**
 * Внизу — патчи, вышедшие РАНЬШЕ этого, а не шесть свежих у игры. Свежие
 * менялись с каждым новым патчем, и каждая сохранённая страница патча игры
 * перерисовывалась и писалась в ISR заново; предыдущие у страницы уже не
 * меняются (OTHERS в page.tsx).
 */
describe('страница патча: предыдущие патчи', () => {
  const DAY = 86_400

  async function seeded(): Promise<unknown> {
    const now = nowSec()
    await render()
    await upsertNewsItems(
      db,
      [
        // вышел позже страницы — в её списке его нет
        patch('9001', now - 60),
        ...Array.from({ length: 8 }, (_, i) => patch(String(4000 + i), now - (i + 1) * DAY)),
        // не патч по вердикту модели — тоже мимо
        patch('4100', now - 2 * 3600, { title: 'Распродажа' }),
      ],
      now,
    )
    await setNewsDigest(db, APPID, '4100', { tldr: '', scale: 'none' }, now)
    return flightOf(await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID }) }), ISLANDS)
  }

  test('только вышедшие раньше, свежие первыми, шесть', async () => {
    const tree = await seeded()
    const hrefs = islandsOf(tree, 'Link')
      .map((l) => String(l.href))
      .filter((h) => /\/news\/\d+$/.test(h))
    expect(hrefs).toEqual(Array.from({ length: 6 }, (_, i) => `/game/${APPID}/news/${4000 + i}`))
    expect(textOf(tree)).toContain('Предыдущие патчи Counter-Strike 2')
    expect(textOf(tree)).not.toContain('Другие патчи')
  })

  test('новый патч игры списка старой страницы не меняет', async () => {
    const before = JSON.stringify(await seeded())
    await upsertNewsItems(db, [patch('9002', nowSec())], nowSec())
    const after = JSON.stringify(
      flightOf(await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID }) }), ISLANDS),
    )
    expect(after).toBe(before)
  })

  test('ссылки списка — без префетча: шесть страниц на ISR ради докрутки до низа', async () => {
    const links = islandsOf(await seeded(), 'Link').filter((l) => /\/news\/\d+$/.test(String(l.href)))
    expect(links.length).toBeGreaterThan(0)
    expect(links.every((l) => l.prefetch === false)).toBe(true)
  })
})

/**
 * Префетч страницы патча не тащит её кадр туда, где стоит ссылка.
 *
 * «Читать патч» на обложке /whatsnew префетчит эту страницу, а подсказку
 * предзагрузки кадра поста из её RSC-части браузер исполнял на самой
 * ленте: на телефоне 138 КБ вперёд героя обложки — и это при том, что
 * обложка нарочно не показывает кадр уже md (Cover.tsx).
 */
describe('страница патча: префетч', () => {
  test('кадр поста не уезжает подсказкой предзагрузки', async () => {
    const page = await render({ imageUrl: 'https://clan.akamai.steamstatic.com/images/1/patch.png' })
    expect(JSON.stringify(page), 'кадр поста не нарисован — тест ослеп').toContain('patch.png')
    expect(imageHints(page)).toEqual([])
  })

  test('мост не читает сессию: страница остаётся в ISR на месяц', () => {
    expect(revalidate).toBe(30 * 86_400)
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
    // Предыдущий патч с русским заголовком — для «Earlier … patches» внизу
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
    expect(text).toContain('Earlier Counter-Strike 2 patches')
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
    // и на /en без префетча, с мерцанием подписи
    expect(links[0]?.prefetch).toBe(false)
    expect(islandsOf(links[0]?.children, 'LinkPending')).toHaveLength(1)
  })

  test('путь над заголовком — игра → «Updates», и архив внизу — по-английски', async () => {
    const tree = await renderEn(true)
    const archive = islandsOf(tree, 'Link').filter((l) => l.href === `/game/${APPID}/news`)
    expect(archive).toHaveLength(2)
    expect(archive.every((l) => l.prefetch === false)).toBe(true)
    expect(textOf(archive[0]?.children)).toBe('Updates')
    expect(textOf(archive[1]?.children)).toBe('All Counter-Strike 2 updates')
  })

  /*
   * Название игры — данные, и на /en оно бывает русским (games.name у части
   * верха каталога, nameSql в lib/db). На проде i18n-audit нашёл на
   * /en/game/292030/news/… три места без пометки: крошку «Ведьмак 3: Дикая
   * Охота — Обновлённое издание», «More … patches» (теперь «Earlier …
   * patches») и «All … updates». Каждое русское название здесь — внутри
   * lang="ru"; русская страница — без пометок, как была.
   */
  test('русское название игры на /en — только внутри lang="ru": крошка, h1, «Earlier … patches», «All … updates»', async () => {
    const NAME = 'Ведьмак 3: Дикая Охота'
    await render()
    await upsertNewsItems(db, [patch('5123894512300', nowSec() - 3 * 86_400)], nowSec())
    // Прямо в name: апсерт русское к латинскому увёл бы во второе название
    await db.execute({ sql: 'UPDATE games SET name = ? WHERE appid = ?', args: [NAME, APPID] })
    const page = (lang?: string) =>
      PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID, ...(lang ? { lang } : {}) }) })
    const tree = flightOf(await page('en'), ISLANDS)

    /** Текст страницы без всего, что внутри lang="ru" (и тегов, и островков вроде Link) */
    const unmarked = (n: unknown): string => {
      if (typeof n === 'string' || typeof n === 'number') return String(n)
      if (Array.isArray(n)) return n.map(unmarked).join('')
      if (n && typeof n === 'object') {
        const props = (n as { props?: { lang?: unknown; children?: unknown } }).props
        if (props?.lang === 'ru') return ''
        return props ? unmarked(props.children) : ''
      }
      return ''
    }
    // сторож не слепой: название на странице есть, и не раз
    expect(textOf(tree).split(NAME).length - 1).toBeGreaterThanOrEqual(4)
    expect(unmarked(tree)).not.toMatch(/[А-Яа-яЁё]/)
    const crumb = islandsOf(tree, 'Link').find((l) => l.href === `/game/${APPID}`)
    expect(crumb).toMatchObject({ lang: 'ru', children: NAME })
    expect(textOf(tree)).toContain(`Earlier ${NAME} patches`)
    expect(textOf(tree)).toContain(`All ${NAME} updates`)

    // Русская страница — без пометок: ни одного lang="ru", и у крошки нет
    // пропса lang вовсе — RSC-часть сериализовала бы и undefined (langAttr)
    const ru = flightOf(await page(), ISLANDS)
    expect(JSON.stringify(ru)).not.toContain('"lang":"ru"')
    const ruCrumb = islandsOf(ru, 'Link').find((l) => l.href === `/game/${APPID}`)
    expect(ruCrumb && 'lang' in ruCrumb).toBe(false)
  })

  test('метаданные: английский заголовок и описание, noindex без английского пересказа', async () => {
    await render()
    const en = { params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }
    const ru = { params: Promise.resolve({ appid: String(APPID), gid: GID }) }
    const without = await generateMetadata(en)
    expect(without.robots).toEqual({ index: false, follow: true })
    expect(String(without.title)).toMatch(/^Counter-Strike 2 update \([A-Z][a-z]{2} \d{1,2}, \d{4}\) — what changed$/)
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

/**
 * hreflang патча — только на версии, что сами в поиске, как у адреса в карте
 * сайта (app/sitemap.ts): в поиск каждую версию пускает пересказ своего языка
 * (newsIndexable), и ссылка с русской на /en с noindex была бы пустым
 * сигналом. Связка одна на обе версии; обе в поиске — голова как была.
 */
describe('страница патча: hreflang', () => {
  const ru = { params: Promise.resolve({ appid: String(APPID), gid: GID }) }
  const en = { params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }
  const PATH = `/game/${APPID}/news/${GID}`

  /** Пост у живой игры каталога (теги есть) — с пересказами названных языков */
  async function seed(told: { ru?: boolean; en?: boolean }, listed = true): Promise<void> {
    const now = nowSec()
    await upsertGameMeta(
      db,
      {
        appid: APPID,
        name: 'Counter-Strike 2',
        tags: listed ? { FPS: 1000 } : {},
        genres: [],
        categories: [1],
        reviewsTotal: 1000,
        reviewsPercent: 80,
      },
      now,
    )
    await upsertNewsItems(db, [patch(GID, now - 3600)], now)
    if (told.ru) await setNewsDigest(db, APPID, GID, { tldr: 'Починили сеть.', scale: 'major' }, now)
    if (told.en) await setNewsDigestEn(db, APPID, GID, { tldrEn: 'Fixed the netcode.' }, now)
  }

  test('пересказ только русский — hreflang и x-default только на русскую, и с /en тоже', async () => {
    await seed({ ru: true })
    const ruMeta = await generateMetadata(ru)
    const enMeta = await generateMetadata(en)
    expect(ruMeta.robots).toBeUndefined()
    expect(enMeta.robots).toEqual({ index: false, follow: true })
    const languages = { ru: PATH, 'x-default': PATH }
    expect(ruMeta.alternates).toEqual({ canonical: PATH, languages })
    expect(enMeta.alternates).toEqual({ canonical: `/en${PATH}`, languages })
  })

  test('пересказ на обоих — обе версии и x-default на английскую', async () => {
    await seed({ ru: true, en: true })
    const languages = { ru: PATH, en: `/en${PATH}`, 'x-default': `/en${PATH}` }
    const ruMeta = await generateMetadata(ru)
    expect(ruMeta.alternates).toEqual({ canonical: PATH, languages })
    expect((await generateMetadata(en)).alternates).toEqual({ canonical: `/en${PATH}`, languages })
    // порядок ключей — тот же, что у localeAlternates: голова не сдвинулась
    expect(Object.keys(ruMeta.alternates?.languages ?? {})).toEqual(['ru', 'en', 'x-default'])
  })

  test('пересказ только английский — x-default на /en', async () => {
    await seed({ en: true })
    const ruMeta = await generateMetadata(ru)
    const enMeta = await generateMetadata(en)
    expect(ruMeta.robots).toEqual({ index: false, follow: true })
    expect(enMeta.robots).toBeUndefined()
    const languages = { en: `/en${PATH}`, 'x-default': `/en${PATH}` }
    expect(ruMeta.alternates).toEqual({ canonical: PATH, languages })
    expect(enMeta.alternates).toEqual({ canonical: `/en${PATH}`, languages })
  })

  test('игра не в каталоге — ни одна версия не в поиске, hreflang нет', async () => {
    await seed({ ru: true, en: true }, false)
    expect((await generateMetadata(ru)).alternates).toEqual({ canonical: PATH })
    expect((await generateMetadata(en)).alternates).toEqual({ canonical: `/en${PATH}` })
  })
})

describe('страница патча: путь над заголовком', () => {
  test('ориентир на /en — «Breadcrumb», как у страницы жанра; русский — как был', async () => {
    const tree = await render()
    expect(JSON.stringify(tree)).toContain('"aria-label":"Путь к патчу"')
    const enTree = flightOf(
      await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }),
      ISLANDS,
    )
    expect(JSON.stringify(enTree)).toContain('"aria-label":"Breadcrumb"')
  })
})

/** JSON-LD страницы, как он уходит в HTML */
function ldOf(tree: unknown): string {
  let html: string | undefined
  const walk = (node: unknown): void => {
    if (html !== undefined || !node || typeof node !== 'object') return
    const inner = (node as { dangerouslySetInnerHTML?: { __html?: unknown } }).dangerouslySetInnerHTML
    if (typeof inner?.__html === 'string') {
      html = inner.__html
      return
    }
    Object.values(node).forEach(walk)
  }
  walk(tree)
  expect(html, 'ld+json на странице не найден').toBeDefined()
  return html!
}

/** Текст первого элемента с этим тегом */
function tagText(tree: unknown, tag: string): string | undefined {
  let found: unknown
  const walk = (node: unknown): void => {
    if (found !== undefined || !node || typeof node !== 'object') return
    if ((node as { tag?: string }).tag === tag) {
      found = node
      return
    }
    Object.values(node).forEach(walk)
  }
  walk(tree)
  return found === undefined ? undefined : textOf(found)
}

/**
 * Общий «{Game} update» — заголовок поста без своего английского. newsHeading
 * срезал бы с него название игры и оставил голое «Update» — в h1, на
 * карточке в чате, в headline и крошках. Русский двойник, «Обновление
 * Counter-Strike 2», цел: название в конце.
 */
describe('заголовок патча: общий «{Game} update» — целиком', () => {
  test('patchHeading режет название только у настоящего заголовка', () => {
    const ru = { title: 'Обновление 7.41d' }
    const bare = { title: 'Обновление: летняя чистка' }
    expect(patchHeading(bare, 'Dota 2', 'en')).toBe('Dota 2 update')
    expect(patchHeading(bare, null, 'en')).toBe('Update')
    // с номером версии из заголовка издателя — уже не пустое слово, и режется
    expect(patchHeading(ru, 'Dota 2', 'en')).toBe('Update 7.41d')
    expect(patchHeading(ru, null, 'en')).toBe('Update 7.41d')
    // Свой английский заголовок с названием впереди режется, как на русской странице
    expect(patchHeading({ ...ru, titleEn: 'Dota 2 - Update 7.41d' }, 'Dota 2', 'en')).toBe('Update 7.41d')
    expect(patchHeading({ title: 'Portal 2 - Update' }, 'Portal 2', 'en')).toBe('Update')
    // Русская страница — ровно newsHeading, как было
    for (const title of ['Обновление Counter-Strike 2', 'Portal 2 - Update', 'Counter-Strike 2 update', '']) {
      expect(patchHeading({ title }, 'Counter-Strike 2'), title).toBe(newsHeading(title, 'Counter-Strike 2'))
    }
  })

  test('/en: h1, headline и последняя крошка — «Counter-Strike 2 update»', async () => {
    await render()
    const tree = flightOf(
      await PatchPage({ params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }),
      ISLANDS,
    )
    expect(tagText(tree, 'h1')).toBe('Counter-Strike 2 update')
    const [article, crumbs] = JSON.parse(ldOf(tree)) as [
      { headline: string },
      { itemListElement: Array<{ name: string }> },
    ]
    expect(article.headline).toBe('Counter-Strike 2 update')
    expect(crumbs.itemListElement.at(-1)?.name).toBe('Counter-Strike 2 update')
  })

  test('русская разметка — байт в байт то, что строит lib/jsonld', async () => {
    const tree = await render()
    const page = await loadPatch(String(APPID), GID)
    expect(page).not.toBeNull()
    const { item, game } = page!
    const baseUrl = appBaseUrl()
    expect(ldOf(tree)).toBe(
      ldScript([
        patchArticleLd({ item, game, baseUrl, locale: 'ru' }),
        patchBreadcrumbLd({ item, game, baseUrl, locale: 'ru' }),
      ]),
    )
    expect(tagText(tree, 'h1')).toBe(`Обновление ${GID}`)
  })
})

/**
 * Превью патча — шапка игры из Steam, та же, что у карточки игры (gameCard в
 * lib/site): своей PNG-карточки у патча больше нет — она стоила записи ISR и
 * рендера функции на каждый пост и язык. Что прислали патч, говорят og:title
 * и описание рядом с картинкой.
 */
describe('карточка патча в чате', () => {
  const en = { params: Promise.resolve({ appid: String(APPID), gid: GID, lang: 'en' }) }
  const ru = { params: Promise.resolve({ appid: String(APPID), gid: GID }) }
  const HEADER = `https://cdn.example/${APPID}/header_2x.jpg`

  async function withArt(): Promise<void> {
    await render()
    await db.execute({
      sql: 'UPDATE games SET art_json = ? WHERE appid = ?',
      args: [JSON.stringify({ header: `https://cdn.example/${APPID}/header.jpg`, header2x: HEADER }), APPID],
    })
  }

  test('на обоих языках — шапка игры с названием в alt; twitter берёт её из openGraph', async () => {
    await withArt()
    for (const p of [ru, en]) {
      const meta = await generateMetadata(p)
      expect(meta.openGraph?.images).toEqual([{ url: HEADER, width: 920, height: 430, alt: 'Counter-Strike 2' }])
      // Свои картинки у twitter отменили бы наследование от openGraph
      expect(meta.twitter).not.toHaveProperty('images')
    }
    expect(fs.existsSync(path.join(__dirname, 'opengraph-image.tsx'))).toBe(false)
  })

  test('игры нет в каталоге — корневая карточка от родителя', async () => {
    const now = nowSec()
    await upsertNewsItems(db, [patch(GID, now - 3600)], now)
    const ROOT = { url: 'https://imbored.cc/ru/opengraph-image?91b1f53ea01c02b3', width: 1200, height: 630, alt: 'imbored — во что поиграть' }
    // Родитель — корень: openGraph с одной корневой карточкой
    const rootOg = { images: [ROOT] }
    const parent = Promise.resolve({ openGraph: rootOg }) as never
    expect((await generateMetadata(ru, parent)).openGraph?.images).toEqual([ROOT])
    expect((await generateMetadata(en, parent)).openGraph?.images).toEqual([{ ...ROOT, alt: 'imbored — what to play' }])
  })

  /*
   * 404 (нет такого поста, не патч, кривой адрес): голова — корневая, с
   * подписью карточки на языке адреса. Своя запись была нужна, пока у патча
   * стояла файловая карточка с русским alt.
   */
  test('нет такого патча: пустой объект на обоих языках', async () => {
    await render()
    for (const [appid, gid] of [[String(APPID), '1'], [String(APPID), 'nope'], ['abc', GID]]) {
      expect(await generateMetadata({ params: Promise.resolve({ appid, gid, lang: 'en' }) }), gid).toEqual({})
      expect(await generateMetadata({ params: Promise.resolve({ appid, gid }) }), gid).toEqual({})
    }
  })
})

/*
 * Уже опубликованные «патчи», которые патчами не были: Battlefield 6 «Looking
 * Ahead To Season 5», Marathon «Дорожная карта обновлений» — h1 «Что
 * изменилось», бейдж «Крупное» и пересказ «добавлен режим…» о планах, в карте
 * сайта и с NewsArticle. Прогон по базе прода для них не нужен: страница
 * сверяет строку с нынешним правилом сама (isStoredPatch в lib/news) и
 * отдаёт 404, как распродаже, — Google выкинет её при следующем обходе.
 */
describe('страница патча: не патч — 404, даже если база думает иначе', () => {
  async function stored(item: StoredNews, verdict?: 'none') {
    const now = nowSec()
    await upsertNewsItems(db, [item], now)
    const digest = verdict
      ? { tldr: 'Планы на сезон.', scale: verdict }
      : { tldr: 'Добавлен режим Rapid Royale.', scale: 'major' as const }
    await setNewsDigest(db, APPID, item.gid, digest, now)
  }

  test('строка, записанная старым правилом как патч, по нынешнему — не патч', async () => {
    await stored({
      ...patch('703281025618281700', nowSec() - 3600),
      title: 'Battlefield 6/REDSEC: Looking Ahead To Season 5 And Beyond',
      blocks: [
        {
          kind: 'ul',
          items: [
            [{ text: 'Rapid Royale: added as a limited-time mode' }],
            [{ text: 'Vehicle balance: changed armor values' }],
            [{ text: 'Fixed spawn camping — currently exploring options' }],
          ],
        },
      ],
    })
    // kind в базе — 'patch': так его записал опрос до правки классификатора
    const row = await db.execute("SELECT kind FROM news_items WHERE gid = '703281025618281700'")
    expect(row.rows[0]?.kind).toBe('patch')
    expect(await loadPatch(String(APPID), '703281025618281700')).toBeNull()
    // правило одно на оба языка: английская страница того же поста — тоже 404
    expect(await loadPatch(String(APPID), '703281025618281700', 'en')).toBeNull()
  })

  test('вердикт модели «не патч» — тоже 404', async () => {
    await stored(patch('519725096071334702', nowSec() - 3600), 'none')
    expect(await loadPatch(String(APPID), '519725096071334702')).toBeNull()
    expect(await loadPatch(String(APPID), '519725096071334702', 'en')).toBeNull()
  })

  test('настоящий патч страницу не теряет', async () => {
    await stored(patch('42', nowSec() - 3600))
    expect((await loadPatch(String(APPID), '42'))?.item.gid).toBe('42')
    expect((await loadPatch(String(APPID), '42', 'en'))?.item.gid).toBe('42')
  })
})
