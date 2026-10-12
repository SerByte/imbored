/**
 * Ответы /api/forget — как их читает «Удалить всё обо мне»
 * (components/ForgetMe).
 *
 * Отдельным модулем без импортов, как lib/signoutreply: компонент тестом не
 * нажать, а от разбора здесь зависит, уйдёт ли человек с экрана со словами
 * «всё удалено». Уходить так можно только по ответу самого роута — { ok:
 * true }. Обрыв, чужая страница ошибки, пятисотка платформы — «не получилось»,
 * и кнопка остаётся на месте.
 */

/**
 * Слово подтверждения в теле удаления. Без него роут отвечает 400 и ничего
 * не трогает: случайный POST — повтор из истории, чужой скрипт на той же
 * странице, промах в коде — данных не сотрёт.
 */
export const FORGET_CONFIRM = 'delete'

/**
 * Чем кончился запрос:
 *   needsteam   — сессия не доказала владение профилем (вход по ссылке);
 *   ratelimited — потолок попыток с адреса;
 *   gone        — входа уже нет: вышел на другом устройстве или удаление,
 *                 ответ на которое потерялся, уже прошло;
 *   failed      — всё остальное, повтор уместен.
 */
export type ForgetMiss = 'needsteam' | 'ratelimited' | 'gone' | 'failed'

export type ForgetPreview = { kind: 'ok'; items: string[]; effects: string[] } | { kind: ForgetMiss }

/** Код отказа роута по статусу и телу; не его ответ — failed */
async function missOf(res: Response): Promise<ForgetMiss> {
  const body: unknown = await res.json().catch(() => null)
  const error = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined
  if (res.status === 403 && error === 'needsteam') return 'needsteam'
  if (res.status === 429 && error === 'ratelimited') return 'ratelimited'
  if (res.status === 401 && error === 'nosession') return 'gone'
  return 'failed'
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** GET: что хранится и что случится вместе с удалением */
export async function forgetPreviewReply(res: Response): Promise<ForgetPreview> {
  if (!res.ok) return { kind: await missOf(res) }
  const body: unknown = await res.json().catch(() => null)
  const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (!strings(o.items) || !strings(o.effects)) return { kind: 'failed' }
  return { kind: 'ok', items: o.items, effects: o.effects }
}

/** POST: удалено — 'done', иначе почему нет */
export async function forgetReply(res: Response): Promise<'done' | ForgetMiss> {
  if (!res.ok) return missOf(res)
  const body: unknown = await res.json().catch(() => null)
  return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true ? 'done' : 'failed'
}
