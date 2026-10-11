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
 *
 * Тем же счётчиком платит и заголовок страницы /room/<код> (loadRoomInviteForPage
 * в app/room/[id]/invite.ts): «Хост зовёт в пати КОД» против «Пати КОД» — та
 * же проверка существования, только без единого роута API, со скоростью
 * сервера и с ником хоста в придачу. Сверх потолка заголовок нейтральный, а не
 * 429: страница нужна и настоящему гостю.
 *
 * Карточка /room/<код>/opengraph-image — остаток, оставленный сознательно. Она
 * живёт в ISR (revalidate и generateStaticParams там не ради красоты), а
 * headers() сделал бы её динамической: каждое разворачивание ссылки в чате
 * рисовало бы картинку заново. Закрыть её можно только потолком в proxy.ts, а
 * прокси без базы (lib/origin). Цена перебора через неё — отрисовка PNG на
 * каждый код, секунда-две, то есть на порядки медленнее заголовка.
 */
export const PEEK_LIMIT = 300
export const PEEK_WINDOW_SEC = 600

/**
 * Списать один взгляд с адреса. false — адрес исчерпал потолок просмотра.
 *
 * Отдельно от peekGate — для того, кто отвечает не 429: заголовку страницы
 * отказ нужен как «показать нейтрально», а не как ответ роута.
 */
export async function peekAllowed(
  db: Parameters<typeof checkRate>[0],
  headers: Headers,
): Promise<{ ok: true } | { ok: false; retryAfterSec: number }> {
  const gate = await checkRate(db, {
    bucket: 'room-peek',
    id: clientIp(headers),
    limit: PEEK_LIMIT,
    windowSec: PEEK_WINDOW_SEC,
    nowSec: nowSec(),
  })
  return gate.ok ? { ok: true } : { ok: false, retryAfterSec: gate.retryAfterSec }
}

/** Отказ 429, если адрес исчерпал потолок просмотра; иначе null */
export async function peekGate(
  db: Parameters<typeof checkRate>[0],
  req: Request,
): Promise<Response | null> {
  const gate = await peekAllowed(db, req.headers)
  return gate.ok ? null : rateLimitedResponse(gate.retryAfterSec)
}
