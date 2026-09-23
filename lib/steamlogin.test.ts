import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { GET as startLogin } from '../app/api/auth/steam/route'
import { GET as steamReturn } from '../app/api/auth/steam/return/route'

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
let owned: unknown = { response: { games: [{ appid: 620, name: 'Portal 2', playtime_forever: 30 }] } }

beforeEach(() => {
  process.env = { ...ENV, APP_BASE_URL: BASE, STEAM_API_KEY: 'k' }
  asked = []
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
    if (url.includes('GetOwnedGames')) return Response.json(owned)
    return new Response('нет такого', { status: 404 })
  })
})

afterEach(() => {
  process.env = { ...ENV }
  vi.unstubAllGlobals()
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
