import { createHmac, timingSafeEqual } from 'node:crypto'

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

export function signSession(steamid: string, secret: string): string {
  return `${steamid}.${hmac(steamid, secret)}`
}

export function verifySession(token: string, secret: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const steamid = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = hmac(steamid, secret)
  if (sig.length !== expected.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null
  } catch {
    return null
  }
  return /^\d{17}$/.test(steamid) ? steamid : null
}
