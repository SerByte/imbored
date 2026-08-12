import fs from 'node:fs'
import path from 'node:path'
import { cookies } from 'next/headers'
import { createDb, type Db } from './db'
import { verifySession } from './session'

const globalStore = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }

/**
 * Соединение с БД. В проде — Turso (TURSO_DATABASE_URL), локально — файл.
 * Промис кэшируется на процесс: миграции выполняются один раз за холодный старт.
 */
export function getDb(): Promise<Db> {
  if (!globalStore.__imboredDb) {
    const remote = process.env.TURSO_DATABASE_URL
    if (remote) {
      globalStore.__imboredDb = createDb(remote, process.env.TURSO_AUTH_TOKEN)
    } else {
      // На serverless файловая база эфемерна: данные исчезали бы между запросами.
      // Падаем с внятной ошибкой вместо тихой потери данных.
      if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
        throw new Error(
          'TURSO_DATABASE_URL не задан. В продакшене файловая база не работает — ' +
            'укажи переменные TURSO_DATABASE_URL и TURSO_AUTH_TOKEN в настройках проекта.',
        )
      }
      const dir = path.join(process.cwd(), 'data')
      fs.mkdirSync(dir, { recursive: true })
      globalStore.__imboredDb = createDb(`file:${path.join(dir, 'imbored.db')}`)
    }
  }
  return globalStore.__imboredDb
}

export const SESSION_COOKIE = 'imbored_session'
export const DEMO_STEAMID = '00000000000000000'
export const DEMO2_STEAMID = '00000000000000001'

export function isDemoId(steamid: string): boolean {
  return steamid === DEMO_STEAMID || steamid === DEMO2_STEAMID
}

export function sessionSecret(): string {
  return process.env.SESSION_SECRET || 'imbored-dev-secret-change-in-prod'
}

export function steamApiKey(): string | null {
  return process.env.STEAM_API_KEY || null
}

export function appBaseUrl(): string {
  return process.env.APP_BASE_URL || 'http://localhost:3000'
}

/** SteamID64 текущего пользователя из подписанной куки, либо null */
export async function currentSteamId(): Promise<string | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  return verifySession(token, sessionSecret())
}

export function nowSec(): number {
  return Math.floor(Date.now() / 1000)
}
