import { timingSafeEqual } from 'node:crypto'

/**
 * Авторизация фоновых задач. Первый в проекте путь, не завязанный на куку
 * imbored_session: у крона сессии нет и быть не может.
 *
 * Vercel сам подставляет заголовок Authorization: Bearer $CRON_SECRET, когда
 * переменная задана в окружении проекта. x-cron-secret оставлен для ручного
 * curl и внешнего пингера.
 *
 * Без секрета в проде — закрыто наглухо: иначе публичный роут, дёргающий
 * Steam и Claude, становится бесплатным усилителем для любого желающего.
 * Локально без секрета открыто, чтобы не мешать разработке.
 */
export function cronAuthorized(headers: Headers): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return !process.env.VERCEL && process.env.NODE_ENV !== 'production'

  const given =
    headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? headers.get('x-cron-secret') ?? ''

  // сравнение длин до timingSafeEqual: на разной длине он бросает
  const a = Buffer.from(given)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Сколько крон пересказов может молчать, прежде чем его считают отвалившимся */
export const DIGEST_STALE_SEC = 3 * 3600

/**
 * Пора ли пнуть крон пересказов вручную.
 *
 * У новостей есть подстраховка — суточный крон в vercel.json, — а у пересказов
 * нет: на Hobby лимит два расписания на проект, и оба заняты. Значит пересказы
 * висят на одном GitHub Actions, а он глушит расписания после шестидесяти дней
 * тишины в репозитории и вообще ничего не обещает по срокам. Отвалиться это
 * может молча.
 *
 * Поэтому крон новостей, закончив цепочку, смотрит на возраст последнего среза
 * пересказов и при нужде пинает их сам. Три часа — с запасом на обычные
 * опоздания GitHub (10–15 минут) и на пропущенный слот-другой.
 *
 * Неразобранный JSON, отсутствующая запись и мусор в поле означают одно и то
 * же: подтверждения, что пересказы живы, у нас нет. Значит пинаем.
 */
export function digestLooksStale(
  raw: string | null,
  nowSec: number,
  maxAgeSec = DIGEST_STALE_SEC,
): boolean {
  if (!raw) return true
  try {
    const at = Number((JSON.parse(raw) as { at?: unknown }).at ?? 0)
    if (!Number.isFinite(at) || at <= 0) return true
    return nowSec - at >= maxAgeSec
  } catch {
    return true
  }
}
