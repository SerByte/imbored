/**
 * Ответ на выпуск RSS-ссылки (POST /api/whatsnew/feedlink) — как его читает
 * строка «RSS по секретной ссылке» на /whatsnew (components/whatsnew/FeedLink).
 *
 * Отдельным модулем без импортов: lib/feedlink тянет node:crypto, и
 * клиентской строке его не взять. А разбор отказа «ссылка уже есть» обязан
 * проверяться тестом сам по себе: от того, узнает ли страница этот ответ,
 * зависит, спросит ли она подтверждение — или скажет «не получилось» тому,
 * чья ссылка цела и просто не видна этой вкладке.
 *
 * 409 exists отвечает сервер, когда ссылка у человека уже есть, а заменить
 * её не просили (replace в теле запроса): страница судила по старому кадру —
 * «назад» из роутерного кэша, вторая вкладка. Ничего при этом не записано, и
 * в ответе дата той ссылки, чтобы страница показала её и спросила по правде.
 */

export type IssueReply =
  /** Ссылка выпущена: путь с ключом, показывается один раз */
  | { kind: 'shown'; path: string }
  /** Ссылка уже есть, и она цела: нужна просьба заменить */
  | { kind: 'exists'; since: number }
  /** Остальное — отказ: его словами разбирает сама строка (needsteam, 401, 429, сбой) */
  | { kind: 'refused' }

export async function issueReply(res: Response): Promise<IssueReply> {
  // С копии: вызывающему тело ещё понадобится для разбора отказа (isNeedSteam)
  const body: unknown = await res
    .clone()
    .json()
    .catch(() => null)
  const o = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  if (res.status === 409 && o.error === 'exists' && typeof o.since === 'number') {
    return { kind: 'exists', since: o.since }
  }
  if (res.ok && typeof o.path === 'string') return { kind: 'shown', path: o.path }
  return { kind: 'refused' }
}
