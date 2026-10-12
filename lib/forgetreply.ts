/**
 * Ответы /api/forget — как их читает «Удалить всё обо мне»
 * (components/ForgetMe).
 *
 * Отдельным модулем без импортов, как lib/signoutreply: компонент тестом не
 * нажать, а от разбора здесь зависит, уйдёт ли человек с экрана со словами
 * «всё удалено». Уходить так можно только по ответу самого роута — { ok:
 * true }. Обрыв, чужая страница ошибки, пятисотка платформы — не «удалено»,
 * и кнопка остаётся на месте.
 *
 * НО И НЕ «НЕ ПОЛУЧИЛОСЬ». Определённо не удалено ничего только при отказе
 * самого роута: его пачка атомарна (app/api/forget). Ответ не роута —
 * обрыв, тайм-аут функции, страница прокси — говорит лишь, что ответа нет:
 * пачка могла и записаться. Раньше и такой ответ звучал «Не получилось
 * удалить — нажми ещё раз», повтор получал 401 («Вход уже не действует»), и
 * «удалено» человек не слышал ни разу — хотя всё уже было удалено.
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
 *   failed      — отказ самого роута (или, у вопроса, любой сбой), повтор уместен.
 */
export type ForgetMiss = 'needsteam' | 'ratelimited' | 'gone' | 'failed'

/**
 * Чем кончилось удаление (POST). unknown — ответил не роут или ответ не
 * дошёл вовсе: прошло ли удаление, неизвестно (см. шапку). У вопроса
 * «что хранится» такого нет: он ничего не меняет, и любой сбой там — failed.
 */
export type ForgetOutcome = 'done' | ForgetMiss | 'unknown'

export type ForgetPreview = { kind: 'ok'; items: string[]; effects: string[] } | { kind: ForgetMiss }

/** Код отказа из тела: { error: '…' } пишет только сам роут */
async function errorOf(res: Response): Promise<unknown> {
  const body: unknown = await res.json().catch(() => null)
  return typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined
}

/** Отказ по статусу и коду; незнакомый — failed */
function missOf(status: number, error: unknown): ForgetMiss {
  if (status === 403 && error === 'needsteam') return 'needsteam'
  if (status === 429 && error === 'ratelimited') return 'ratelimited'
  if (status === 401 && error === 'nosession') return 'gone'
  return 'failed'
}

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === 'string')

/** GET: что хранится и что случится вместе с удалением */
export async function forgetPreviewReply(res: Response): Promise<ForgetPreview> {
  if (!res.ok) return { kind: missOf(res.status, await errorOf(res)) }
  const body: unknown = await res.json().catch(() => null)
  const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (!strings(o.items) || !strings(o.effects)) return { kind: 'failed' }
  return { kind: 'ok', items: o.items, effects: o.effects }
}

/** POST: удалено — 'done', отказ роута — его код, не его ответ — unknown */
export async function forgetReply(res: Response): Promise<ForgetOutcome> {
  if (!res.ok) {
    const error = await errorOf(res)
    // Без кода — страница платформы или прокси: дошёл ли запрос до удаления, неизвестно
    return typeof error === 'string' ? missOf(res.status, error) : 'unknown'
  }
  const body: unknown = await res.json().catch(() => null)
  return typeof body === 'object' && body !== null && (body as { ok?: unknown }).ok === true ? 'done' : 'unknown'
}

/**
 * Отказ словами — всё, кроме needsteam: у того ссылка на вход, и его рисует
 * сам компонент.
 *
 * lost — ответ на прошлое «Да, удалить всё» в этом экране не дошёл (unknown),
 * и с тех пор роут не отвечал ничем, что доказало бы живой вход. Тогда «входа
 * нет» скорее всего значит, что то удаление прошло: так и говорим — с
 * оговоркой, а не «всё удалено». Уходить со словами «всё удалено» можно только
 * по { ok: true } (шапка), а «входа нет» бывает и после «Выйти на всех
 * устройствах», нажатого в другом месте.
 */
export function forgetMissLine(
  miss: Exclude<ForgetMiss, 'needsteam'> | 'unknown',
  step: 'ask' | 'erase',
  lost: boolean,
): string {
  if (miss === 'ratelimited') return 'Слишком много попыток с этого адреса — попробуй через час.'
  if (miss === 'gone') {
    if (lost) {
      return 'Похоже, удаление уже прошло: ответ на прошлое нажатие не дошёл, а вход больше не действует. Обнови страницу.'
    }
    return step === 'erase'
      ? 'Вход уже не действует: удаление уже прошло или ты вышел на всех устройствах. Обнови страницу.'
      : 'Вход уже не действует — обнови страницу.'
  }
  if (miss === 'unknown') return 'Не удалось узнать, прошло ли удаление, — нажми ещё раз.'
  return step === 'ask'
    ? 'Не получилось узнать, что хранится, — нажми ещё раз.'
    : 'Не получилось удалить — нажми ещё раз.'
}
