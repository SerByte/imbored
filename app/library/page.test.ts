import { isValidElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BannedShelf } from '@/components/BannedShelf'
import { Evenings } from '@/components/Evenings'
import { GameCardBody } from '@/components/GameCard'
import { LikedShelf } from '@/components/LikedShelf'
import { NeedSteam } from '@/components/NeedSteam'
import { logFeedback, recordOutcome, saveLibrarySnapshot, upsertGamesMeta, type Db } from '@/lib/db'
import { nowSec } from '@/lib/server'
import { freshDb, signInAs, type SessionKind } from '@/lib/testing/route'
import LibraryPage from './page'

vi.mock('next/headers', () => import('@/lib/testing/headers'))

/**
 * /library настоящей страницей на базе в памяти: что уходит в разметку и в
 * пропсы клиентских полок при каждом из трёх происхождений сессии.
 *
 * Оценки, скрытое и вечера пишет только сессия, доказавшая владение профилем
 * (или демо), а сессию по вставленной ссылке выдают на любой публичный
 * профиль. Прежде такая сессия получала всё это целиком и только без кнопок —
 * то есть чужой человек со ссылкой видел, что владелец скрыл, что ему
 * «зашло» и во что он играл после советов.
 *
 * Страница не рендерится: полки — клиентские островки с useRouter, им нужен
 * живой роутер Next. Проверяется дерево, которое страница отдаёт, — ровно то,
 * что сериализуется в первый HTML и в пропсы островков.
 */

/** Своё, сыгранное — для мозаики и стены */
const PLAYED = 1
/** Своё, ни разу не запускалось — кандидаты полки «Запечатанное» */
const SEALED = [2, 3]
/** Скрыто владельцем, хотя лежит в библиотеке: полке забытого его не видать никому */
const SEALED_BANNED = 4
/** Не из библиотеки: по ним и видно, утекло ли личное */
const BANNED = 900
const LIKED = 901
const EVENING = 902
const SKIPPED = 903

const NAMES: Record<number, string> = {
  [PLAYED]: 'Альфа',
  2: 'Бета',
  3: 'Гамма',
  [SEALED_BANNED]: 'Дельта',
  [BANNED]: 'Скрытая владельцем',
  [LIKED]: 'Зашедшая владельцу',
  [EVENING]: 'Вечер владельца',
  [SKIPPED]: 'Не то для владельца',
}
const PRIVATE = [NAMES[BANNED], NAMES[LIKED], NAMES[EVENING], NAMES[SKIPPED]]

let db: Db

beforeEach(async () => {
  db = await freshDb()
})

/** Всё, что оставил владелец: бан, «зашло», «не то» и совет, который он запустил */
async function seed(steamid: string): Promise<void> {
  const now = nowSec()
  await upsertGamesMeta(
    db,
    Object.entries(NAMES).map(([appid, name]) => ({
      appid: Number(appid),
      name,
      tags: { Puzzle: 100 },
      genres: [],
      categories: [2],
      headerImage: `https://cdn.example/${appid}.jpg`,
    })),
    now,
  )
  await saveLibrarySnapshot(
    db,
    steamid,
    [PLAYED, ...SEALED, SEALED_BANNED].map((appid) => ({
      appid,
      name: NAMES[appid],
      playtimeForever: appid === PLAYED ? 600 : 0,
      playtime2Weeks: 0,
    })),
    now - 3600,
  )
  await logFeedback(db, { steamid, appid: BANNED, action: 'banned' }, now - 300)
  await logFeedback(db, { steamid, appid: SEALED_BANNED, action: 'banned' }, now - 290)
  await logFeedback(db, { steamid, appid: LIKED, action: 'liked' }, now - 200)
  await logFeedback(db, { steamid, appid: SKIPPED, action: 'skipped' }, now - 100)
  await recordOutcome(db, { steamid, appid: EVENING, source: null, launched: true }, now - 60)
}

async function render(kind: SessionKind): Promise<ReactElement> {
  const steamid = await signInAs(db, kind)
  await seed(steamid)
  return LibraryPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({}),
  } as PageProps<'/library'>)
}

/** Все элементы дерева — и в children, и в пропсах вроде corner и meta */
function elements(root: unknown): ReactElement<Record<string, unknown>>[] {
  const out: ReactElement<Record<string, unknown>>[] = []
  const seen = new Set<unknown>()
  const walk = (n: unknown) => {
    if (n === null || typeof n !== 'object' || seen.has(n)) return
    seen.add(n)
    if (isValidElement<Record<string, unknown>>(n)) {
      out.push(n)
      for (const v of Object.values(n.props)) walk(v)
    } else if (Array.isArray(n)) n.forEach(walk)
  }
  walk(root)
  return out
}

/** Каждая строка, до которой дотянется сериализация: текст разметки и пропсы островков */
function strings(root: unknown): string[] {
  const out: string[] = []
  const seen = new Set<unknown>()
  const walk = (n: unknown) => {
    if (typeof n === 'string') return void out.push(n)
    if (n === null || typeof n !== 'object' || seen.has(n)) return
    seen.add(n)
    if (isValidElement<Record<string, unknown>>(n)) walk(n.props)
    else Object.values(n).forEach(walk)
  }
  walk(root)
  return out
}

const propsOf = (tree: ReactElement, type: unknown) =>
  elements(tree)
    .filter((e) => e.type === type)
    .map((e) => e.props)

/** Что стоит на полке «Запечатанное»: у её карточек, и только у них, есть corner */
const sealedShelf = (tree: ReactElement) =>
  propsOf(tree, GameCardBody)
    .filter((p) => p.corner)
    .map((p) => p.appid)

describe('/library: личное владельца — только тому, кто вправе его писать', () => {
  test.each<SessionKind>(['openid', 'demo'])('%s — полки, вечера и доля попаданий на месте', async (kind) => {
    const tree = await render(kind)

    const [banned] = propsOf(tree, BannedShelf)
    expect((banned.games as Array<{ appid: number }>).map((g) => g.appid)).toEqual([SEALED_BANNED, BANNED])
    expect(banned.writer).toBe(true)

    const [liked] = propsOf(tree, LikedShelf)
    expect((liked.games as Array<{ appid: number }>).map((g) => g.appid)).toEqual([LIKED])
    expect(liked.total).toBe(1)

    const [evenings] = propsOf(tree, Evenings)
    expect((evenings.items as Array<{ appid: number }>).map((i) => i.appid)).toEqual([EVENING])

    const text = strings(tree).join(' ')
    expect(text).toContain('Подбор попадает в')
    expect(text).toContain('«зашло» против')
    expect(propsOf(tree, NeedSteam).filter((p) => p.why === 'see')).toEqual([])
  })

  test('сессия по ссылке — ни полок, ни вечеров, ни доли; вместо них строка о входе', async () => {
    const tree = await render('claimed')

    // Полки получают пустое, а не прячут кнопки над полным списком
    const [banned] = propsOf(tree, BannedShelf)
    expect(banned.games).toEqual([])
    const [liked] = propsOf(tree, LikedShelf)
    expect(liked.games).toEqual([])
    expect(liked.total).toBe(0)
    expect(propsOf(tree, Evenings)).toEqual([])

    const all = strings(tree)
    for (const name of PRIVATE) {
      expect(all.filter((s) => s.includes(name)), `«${name}» ушло сессии по ссылке`).toEqual([])
    }
    const text = all.join(' ')
    expect(text).not.toContain('Подбор попадает в')
    expect(text).not.toContain('Сыграно всерьёз')

    const lines = propsOf(tree, NeedSteam)
    expect(lines).toEqual([expect.objectContaining({ from: '/library', why: 'see' })])
    // Строка говорит, чего нет и почему, и ведёт входом обратно сюда
    const html = renderToStaticMarkup(NeedSteam(lines[0] as Parameters<typeof NeedSteam>[0]))
    expect(html).toContain('Оценки, скрытые игры и «Твои вечера» видит только вошедший через Steam')
    expect(html).toMatch(/<a href="\/api\/auth\/steam\?next=%2Flibrary"[^>]*>Войди через Steam<\/a> — и они будут здесь/)
  })

  /*
   * Пустая библиотека: у сессии по ссылке строка о входе теперь стоит всегда,
   * а сетка карточек со своим mb-10 здесь не рисуется. Без отступа у блока
   * «Steam не отдал ни одной игры» строка ложилась вплотную под кнопку
   * «Подключить заново».
   */
  test('сессия по ссылке, пустая библиотека: блок «Steam не отдал» с отступом, строка о входе под ним', async () => {
    const steamid = await signInAs(db, 'claimed')
    await saveLibrarySnapshot(db, steamid, [], nowSec() - 3600)
    const tree = await LibraryPage({
      params: Promise.resolve({}),
      searchParams: Promise.resolve({}),
    } as PageProps<'/library'>)

    const [empty, ...rest] = elements(tree).filter(
      (e) => e.type === 'section' && strings(e).includes('Steam не отдал ни одной игры'),
    )
    expect(rest).toEqual([])
    expect(empty.props.className).toMatch(/\bmb-\d+\b/)
    expect(propsOf(tree, NeedSteam)).toEqual([expect.objectContaining({ why: 'see' })])
  })

  // bannedAppids читается всем — только для отсева, и наружу из него ничего не идёт
  test.each<SessionKind>(['openid', 'claimed'])('%s: скрытое владельцем не всплывает в «Запечатанном»', async (kind) => {
    const shelf = sealedShelf(await render(kind))
    expect(shelf.sort()).toEqual(SEALED)
    expect(shelf).not.toContain(SEALED_BANNED)
  })
})
