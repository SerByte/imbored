/**
 * Подмена next/headers для роут-тестов.
 *
 * Настоящие cookies() и headers() читают хранилище запроса, которое Next
 * заводит только внутри своего сервера; вызванные из vitest, они бросают
 * «called outside a request scope». А сессию роуты узнают именно через
 * cookies() — lib/server.ts, currentSession. Поэтому подменяется ровно этот
 * модуль и ничего больше: подпись, отзыв по базе и сам роут остаются
 * настоящими.
 *
 * Подключается строкой в тестовом файле:
 *
 *     vi.mock('next/headers', () => import('@/lib/testing/headers'))
 *
 * Модуль без единого импорта, и это условие, а не вкус. Фабрика мока
 * выполняется в тот момент, когда lib/server впервые тянет next/headers, и
 * если бы отсюда тянулся lib/server, импорт замкнулся бы сам на себя.
 *
 * Модуль только для тестов: продукт его не импортирует.
 */

const jar = new Map<string, string>()
let requestHeaders = new Headers()

/** То же, что отдаёт next/headers: чтение куки текущего «запроса». */
export async function cookies() {
  return {
    get: (name: string) => {
      const value = jar.get(name)
      return value === undefined ? undefined : { name, value }
    },
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    has: (name: string) => jar.has(name),
  }
}

/** То же, что отдаёт next/headers: заголовки текущего «запроса». */
export async function headers() {
  return requestHeaders
}

/**
 * Метка подмены. lib/testing/route проверяет её перед каждым тестом: без
 * vi.mock роут дошёл бы до настоящего cookies() и упал бы с ошибкой, по
 * которой не понять, что забыта одна строка в тестовом файле.
 */
export const IS_TEST_HEADERS = true

export function setTestCookie(name: string, value: string): void {
  jar.set(name, value)
}

export function setTestHeaders(init: HeadersInit): void {
  requestHeaders = new Headers(init)
}

/** Чистый «запрос»: ни кук, ни заголовков. Зовётся перед каждым тестом. */
export function resetTestRequest(): void {
  jar.clear()
  requestHeaders = new Headers()
}
