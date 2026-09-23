import * as nextHeaders from 'next/headers'
import { createDb, createSession, type Db } from '../db'
import { resetRateMemory } from '../ratelimit'
import { SESSION_COOKIE, nowSec, sessionSecret } from '../server'
import { forgetSessionCache, mintSession } from '../sessions'
import { resetTestRequest, setTestCookie, setTestHeaders } from './headers'

/**
 * Обвязка роут-тестов: настоящий роут, база в памяти, подписанная сессия.
 *
 * Роуты app/api жили без единого теста, хотя в них и сидит склейка, которую
 * не покрыть из lib/: порядок проверок, коды отказов, кто вообще имеет право
 * писать. Всё нужное для подмены уже было — getDb() кэширует соединение в
 * globalThis, сессию подписывает mintSession, — не хватало одного места, где
 * это собрано.
 *
 * Подменяется минимум:
 *   • соединение с базой — на свежую базу в памяти (createDb(':memory:')
 *     прогоняет те же миграции, что и прод);
 *   • next/headers — на lib/testing/headers, иначе cookies() не работает вне
 *     сервера Next.
 * Подпись куки, отзыв по базе, лимиты частоты и сам роут — настоящие.
 *
 * Тестовому файлу нужна одна строка до импортов:
 *
 *     vi.mock('next/headers', () => import('@/lib/testing/headers'))
 *
 * Модуль только для тестов: продукт его не импортирует.
 */

const globalStore = globalThis as typeof globalThis & { __imboredDb?: Promise<Db> }

/**
 * Свежая база и чистый «запрос» — зовётся в beforeEach.
 *
 * Промис кладётся туда же, куда его кладёт getDb(), поэтому роут получает
 * именно эту базу и до переменных окружения не доходит. Кэш сессий и
 * префильтр лимитов живут на модуле — их тоже сбрасываем, иначе они текли бы
 * из теста в тест.
 */
export async function freshDb(): Promise<Db> {
  if (!('IS_TEST_HEADERS' in nextHeaders)) {
    throw new Error(
      "next/headers не подменён: добавь в тестовый файл vi.mock('next/headers', () => import('@/lib/testing/headers'))",
    )
  }
  const db = createDb(':memory:')
  globalStore.__imboredDb = db
  resetTestRequest()
  forgetSessionCache()
  resetRateMemory()
  return db
}

/**
 * Войти: строка сессии в базе и подписанная кука в «запросе».
 *
 * verified — так сессию выдаёт только возврат из Steam OpenID; без него это
 * сессия по вставленной ссылке на профиль (см. Resolved.verified).
 */
export async function signIn(
  db: Db,
  steamid: string,
  opts: { verified?: boolean } = {},
): Promise<{ sid: string; token: string }> {
  const now = nowSec()
  const minted = mintSession(steamid, sessionSecret(), now)
  await createSession(db, { sid: minted.sid, steamid, device: null, verified: opts.verified }, now)
  setTestCookie(SESSION_COOKIE, minted.token)
  forgetSessionCache()
  return minted
}

/** Выйти: «запрос» снова без куки. */
export function signOut(): void {
  resetTestRequest()
}

/**
 * POST с JSON-телом. Строка уходит как есть — так проверяется тело, которое
 * даже не JSON. Заголовки попадают и в сам запрос, и в headers() из
 * next/headers: роут может читать их любым из двух путей.
 */
export function post(path: string, body: unknown = {}, headers: Record<string, string> = {}): Request {
  const all = { 'content-type': 'application/json', ...headers }
  setTestHeaders(all)
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: all,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

/** Контекст динамического сегмента, как его передаёт Next: params — промис. */
export function params<T extends Record<string, string>>(p: T): { params: Promise<T> } {
  return { params: Promise.resolve(p) }
}
