import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as startLogin } from '../app/api/auth/steam/route'
import { GET as steamReturn } from '../app/api/auth/steam/return/route'
import { checkRate } from './ratelimit'

/**
 * Вход через Steam целиком: старт → Steam → возврат, настоящими роутами.
 *
 * Подменяются только база, лимит и сеть. Проверка ассерта, state, сборка
 * return_to и редиректы — настоящие: именно в их стыке и жила дыра, когда
 * возврат принимал ассерт, выписанный для чужого адреса и чужого браузера.
 */

vi.mock('./db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db')>()),
  createDb: vi.fn(),
  upsertUser: vi.fn(async () => {}),
  saveLibrarySnapshot: vi.fn(async () => {}),
}))

vi.mock('./server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./server')>()),
  getDb: vi.fn(async () => ({})),
  issueSession: vi.fn(async () => 'подписанная-сессия'),
}))

vi.mock('./ratelimit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./ratelimit')>()),
  checkRate: vi.fn(async () => ({ ok: true })),
}))

const BASE = 'https://imbored.test'
const STEAMID = '76561197960287930'
const ID = `https://steamcommunity.com/openid/id/${STEAMID}`
const ENV = { ...process.env }

/** Что спрашивали у Steam: check_authentication и Web API. */
let asked: string[] = []
let ownedStatus = 200
/** Сколько первых ответов GetOwnedGames будут 503 — разовый сбой Steam. */
let ownedHiccups = 0
let owned: unknown = { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 30 }] } }

beforeEach(() => {
  process.env = { ...ENV, APP_BASE_URL: BASE, STEAM_API_KEY: 'k' }
  asked = []
  ownedStatus = 200
  ownedHiccups = 0
  owned = { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 30 }] } }
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = String(input)
    asked.push(url)
    if (url.startsWith('https://steamcommunity.com/openid/login')) {
      return new Response('ns:http://specs.openid.net/auth/2.0\nis_valid:true\n')
    }
    if (url.includes('GetPlayerSummaries')) {
      return Response.json({ response: { players: [{ steamid: STEAMID, personaname: 'Гейб' }] } })
    }
    if (url.includes('GetOwnedGames')) {
      if (ownedHiccups > 0) {
        ownedHiccups -= 1
        return new Response('Service Unavailable', { status: 503 })
      }
      return Response.json(owned, { status: ownedStatus })
    }
    return new Response('нет такого', { status: 404 })
  })
})

afterEach(() => {
  process.env = { ...ENV }
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Старт входа: куда отправили в Steam и какой state положили в куку. */
async function start(query: string) {
  const res = await startLogin(new NextRequest(`${BASE}/api/auth/steam${query}`))
  const steam = new URL(res.headers.get('location') ?? '')
  return {
    returnTo: steam.searchParams.get('openid.return_to') ?? '',
    cookie: res.cookies.get('imbored_oidc'),
  }
}

/** Возврат из Steam так, как его собирает Steam: return_to + подписанный ассерт. */
function fromSteam(returnTo: string, cookie: string | null, over: Record<string, string> = {}) {
  const url = new URL(returnTo)
  const nonce = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  const openid: Record<string, string> = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': ID,
    'openid.identity': ID,
    'openid.return_to': returnTo,
    'openid.response_nonce': `${nonce}q1w2e3`,
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    ...over,
  }
  for (const [k, v] of Object.entries(openid)) url.searchParams.set(k, v)
  const headers: Record<string, string> = {}
  if (cookie !== null) headers.cookie = `imbored_oidc=${cookie}`
  return steamReturn(new NextRequest(url, { headers }))
}

describe('вход через Steam', () => {
  test('старт кладёт один и тот же state в return_to и в куку этого браузера', async () => {
    const { returnTo, cookie } = await start('?join=ABC123')
    const state = new URL(returnTo).searchParams.get('state')
    expect(state).toMatch(/^[0-9a-f]{32}$/)
    expect(cookie?.value).toBe(state)
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
    expect(cookie?.path).toBe('/api/auth/steam')
    expect(cookie?.maxAge).toBe(600)
    expect(new URL(returnTo).searchParams.get('join')).toBe('ABC123')
  })

  test('честный вход проходит, выдаёт сессию и гасит куку state', async () => {
    const { returnTo, cookie } = await start('?join=ABC123')
    const res = await fromSteam(returnTo, cookie?.value ?? '')
    expect(res.headers.get('location')).toBe(`${BASE}/room/ABC123`)
    expect(res.cookies.get('imbored_session')?.value).toBe('подписанная-сессия')
    expect(res.cookies.get('imbored_oidc')?.maxAge).toBe(0)
  })

  test('ассерт без куки state (подсунут ссылкой) не принимается и Steam не спрашивается', async () => {
    const { returnTo } = await start('')
    const res = await fromSteam(returnTo, null)
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('error')).toBe('auth')
    expect(res.cookies.get('imbored_session')).toBeUndefined()
    expect(asked).toEqual([])
  })

  test('ассерт чужого входа в этом браузере не принимается', async () => {
    const mine = await start('')
    const theirs = await start('')
    const res = await fromSteam(theirs.returnTo, mine.cookie?.value ?? '')
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('error')).toBe('auth')
    expect(asked).toEqual([])
  })

  test('ассерт, выписанный другому сайту, не принимается, хотя подпись у Steam сходится', async () => {
    const { returnTo, cookie } = await start('')
    const res = await fromSteam(returnTo, cookie?.value ?? '', {
      'openid.return_to': returnTo.replace(BASE, 'https://other-site.example'),
    })
    expect(new URL(res.headers.get('location') ?? '').searchParams.get('error')).toBe('auth')
    expect(res.cookies.get('imbored_session')).toBeUndefined()
    expect(res.cookies.get('imbored_oidc')?.maxAge).toBe(0)
    expect(asked).toEqual([])
  })
})

/**
 * Отказ входа не теряет, куда человек шёл.
 *
 * Друга зовут в пати, у него скрыта библиотека — частый случай. Раньше он
 * получал голый /?error=private, открывал доступ по инструкции, снова жал
 * «Войти через Steam» и попадал на /quiz: код комнаты остался только в чате.
 */
describe('отказ входа помнит пати и ?next', () => {
  /** Ответ роута с прокруткой таймеров: у Steam-клиента паузы между повторами. */
  async function settle<T>(res: Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    await vi.advanceTimersByTimeAsync(10_000)
    return res
  }
  const landing = (res: Response) => new URL(res.headers.get('location') ?? '')

  test('ассерт не подтвердился — error=auth, а join на месте', async () => {
    const { returnTo, cookie } = await start('?join=ABC123')
    const res = await fromSteam(returnTo, cookie?.value ?? '', {
      'openid.return_to': returnTo.replace(BASE, 'https://other-site.example'),
    })
    expect(landing(res).pathname).toBe('/')
    expect(landing(res).searchParams.get('error')).toBe('auth')
    expect(landing(res).searchParams.get('join')).toBe('ABC123')
  })

  test('кука state потерялась — join тоже на месте', async () => {
    const { returnTo } = await start('?join=ABC123')
    const res = await fromSteam(returnTo, null)
    expect(landing(res).searchParams.get('error')).toBe('auth')
    expect(landing(res).searchParams.get('join')).toBe('ABC123')
  })

  test('скрытая библиотека — error=private, а join на месте', async () => {
    owned = { response: {} }
    const { returnTo, cookie } = await start('?join=ABC123')
    const res = await settle(fromSteam(returnTo, cookie?.value ?? ''))
    expect(landing(res).searchParams.get('error')).toBe('private')
    expect(landing(res).searchParams.get('join')).toBe('ABC123')
    expect(res.cookies.get('imbored_session')).toBeUndefined()
  })

  test('Steam упал — error=steam, а совместимость на месте', async () => {
    ownedStatus = 500
    const { returnTo, cookie } = await start('?compat=76561197960287931')
    const res = await settle(fromSteam(returnTo, cookie?.value ?? ''))
    expect(landing(res).searchParams.get('error')).toBe('steam')
    expect(landing(res).searchParams.get('compat')).toBe('76561197960287931')
  })

  test('разовая 503 от Steam больше не выбрасывает из входа', async () => {
    ownedHiccups = 1
    const { returnTo, cookie } = await start('?join=ABC123')
    const res = await settle(fromSteam(returnTo, cookie?.value ?? ''))
    expect(res.headers.get('location')).toBe(`${BASE}/room/ABC123`)
    expect(res.cookies.get('imbored_session')?.value).toBe('подписанная-сессия')
  })

  test('потолок попыток — error=ratelimited, а ?next на месте', async () => {
    vi.mocked(checkRate).mockResolvedValueOnce({ ok: false, retryAfterSec: 60 })
    const { returnTo, cookie } = await start('?next=%2Fdaily')
    const res = await fromSteam(returnTo, cookie?.value ?? '')
    expect(landing(res).searchParams.get('error')).toBe('ratelimited')
    expect(landing(res).searchParams.get('next')).toBe('/daily')
  })

  test('без назначения отказ остаётся голым', async () => {
    const { returnTo } = await start('')
    const res = await fromSteam(returnTo, null)
    expect(res.headers.get('location')).toBe(`${BASE}/?error=auth`)
  })

  test('успех по ?next ведёт туда же', async () => {
    const { returnTo, cookie } = await start('?next=%2Fdaily')
    const res = await fromSteam(returnTo, cookie?.value ?? '')
    expect(res.headers.get('location')).toBe(`${BASE}/daily`)
  })
})
