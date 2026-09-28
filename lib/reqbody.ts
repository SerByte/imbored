/**
 * Тело POST-запроса как простой объект — или пустой объект.
 *
 * Все POST-роуты разбирали тело одной идиомой:
 * `(await req.json().catch(() => ({}))) as {...}`. Она ловит только битый
 * JSON. Но `null` — валидный JSON: .catch не срабатывал, тело становилось
 * null, первое же `body.x` бросало TypeError, и роут отвечал 500 со строкой
 * server-error в логе — на любой запрос с телом `null`, `7` или `[]`.
 *
 * Здесь всё, что не простой объект (null, массив, примитив, битый JSON),
 * превращается в {} — ровно то, что роуты и так ждали от пустого тела.
 * Проверку типов полей это не отменяет: каждый роут проверяет свои поля сам.
 * Сторож lib/reqbody.test.ts не пускает `req.json()` в app/api мимо помощника.
 */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  const body: unknown = await req.json().catch(() => null)
  return body !== null && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}
