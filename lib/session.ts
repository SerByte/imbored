import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

function hmac(value: string, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex')
}

/**
 * Общий низ обоих форматов: отделить подпись и сверить её.
 *
 * Разделитель — ПОСЛЕДНЯЯ точка, и это работает для обоих форматов только
 * потому, что внутри полезной нагрузки точек нет ни у одного из них: у легаси
 * там 17 цифр, у v2 — поля через двоеточие, каждое под своей регуляркой.
 */
function unsign(token: string, secret: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const payload = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expected = hmac(payload, secret)
  // Длину сверяем до Buffer.from: timingSafeEqual на разной длине бросает, а
  // hex-строка нечётной длины молча теряет последний символ.
  if (sig.length !== expected.length) return null
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null
  } catch {
    return null
  }
  return payload
}

/* ---------- формат v1: только steamid ---------- */

export function signSession(steamid: string, secret: string): string {
  return `${steamid}.${hmac(steamid, secret)}`
}

/**
 * Старая кука: «<steamid>.<подпись>», без срока и без возможности отзыва.
 *
 * Остаётся ради тех, кто уже вошёл до перехода на v2: выкинуть их деплоем —
 * ровно та беда, которую эта задача и чинит. Новых таких кук не выдаётся,
 * а выданные умирают сами (maxAge был 30 суток, продления не существовало).
 */
export function verifySession(token: string, secret: string): string | null {
  const payload = unsign(token, secret)
  if (payload === null) return null
  return /^\d{17}$/.test(payload) ? payload : null
}

/* ---------- формат v2: сессия со сроком и идентификатором ---------- */

export type SessionToken = {
  /** идентификатор строки в таблице sessions — по нему гасят одно устройство */
  sid: string
  steamid: string
  /** выдан; по нему решается, пора ли продлевать */
  iat: number
  /** истекает; по нему решается, жив ли токен */
  exp: number
}

const SID_RE = /^[0-9a-f]{32}$/
const STEAMID_RE = /^\d{17}$/
// до 11 цифр: unix-секунды переваливают за 10 знаков в 2286 году
const TS_RE = /^\d{1,11}$/

/** Новый идентификатор сессии: 128 бит из crypto, не Math.random */
export function newSid(): string {
  return randomBytes(16).toString('hex')
}

/**
 * Почему в токене И iat, И exp, хотя одно выводится из другого через TTL:
 * iat отвечает на «пора ли продлевать», exp — на «мёртв ли токен». Храня оба,
 * мы не переопределяем задним числом уже выданные куки, когда завтра поменяется
 * константа TTL. Десять лишних байт.
 */
export function signSessionV2(t: SessionToken, secret: string): string {
  const payload = `v2:${t.sid}:${t.steamid}:${t.iat}:${t.exp}`
  return `${payload}.${hmac(payload, secret)}`
}

/**
 * Разбор v2. Форматы различаются СТРУКТУРНО, а не по договорённости: полезная
 * нагрузка v1 обязана быть 17 цифрами и с префиксом «v2:» не совпадёт никогда,
 * поэтому подсунуть одно вместо другого нельзя ни в какую сторону.
 *
 * Полей ровно пять — не «хотя бы пять»: иначе лишнее двоеточие в чужом поле
 * поехало бы в соседнее.
 */
export function verifySessionV2(token: string, secret: string): SessionToken | null {
  const payload = unsign(token, secret)
  if (payload === null) return null
  const parts = payload.split(':')
  if (parts.length !== 5 || parts[0] !== 'v2') return null
  const [, sid, steamid, iat, exp] = parts
  if (!SID_RE.test(sid) || !STEAMID_RE.test(steamid)) return null
  if (!TS_RE.test(iat) || !TS_RE.test(exp)) return null
  return { sid, steamid, iat: Number(iat), exp: Number(exp) }
}
