import { checkRate, clientIp, rateLimitedResponse } from './ratelimit'
import { nowSec } from './server'

/*
 * Потолок на «не-участника» комнаты — общий для всех /api/room/[id]/*.
 *
 * Код комнаты — шесть символов, и любой роут, отвечающий по-разному на
 * «комнаты нет» (404) и «комната есть, но ты не участник» (403, 409), — это
 * проверка существования кода. GET /api/room/[id] и /join ограничивали
 * перебор, а голос, лидер, колода, лайки, раунд, викторина, выход и доска
 * отвечали без всякого потолка: перебор просто переезжал на соседний адрес.
 *
 * Участники потолок не платят вовсе — их опрос и голоса и есть горячий путь.
 * Не-участник платит тем же счётчиком room-peek по адресу, что и просмотр:
 * промах и попадание стоят одинаково, а честный гость с открытой ссылкой
 * укладывается с запасом (обоснование чисел — в app/api/room/[id]/route.ts).
 */
export const PEEK_LIMIT = 300
export const PEEK_WINDOW_SEC = 600

/** Отказ 429, если адрес исчерпал потолок просмотра; иначе null */
export async function peekGate(
  db: Parameters<typeof checkRate>[0],
  req: Request,
): Promise<Response | null> {
  const gate = await checkRate(db, {
    bucket: 'room-peek',
    id: clientIp(req.headers),
    limit: PEEK_LIMIT,
    windowSec: PEEK_WINDOW_SEC,
    nowSec: nowSec(),
  })
  return gate.ok ? null : rateLimitedResponse(gate.retryAfterSec)
}
