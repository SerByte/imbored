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
