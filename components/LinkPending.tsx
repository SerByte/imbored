'use client'

import { useLinkStatus } from 'next/link'

/**
 * Подпись ссылки, которая сама говорит «нажато, едем».
 *
 * Нужна там, где у маршрута нет loading.tsx, а сам он динамический: тогда
 * переход ждёт ответа сервера, и до него на экране не меняется ничего —
 * нажатие выглядит несработавшим. Каркас loading.tsx эту паузу закрывал, но
 * он же прятал страницу в первом ответе (см. lib/firstpaint.test.ts), так
 * что пауза закрывается здесь: мерцает подпись, по которой нажали.
 *
 * Обязан лежать ВНУТРИ <Link> — useLinkStatus читает ближайшую ссылку сверху
 * (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/
 * use-link-status.md).
 *
 * Мерцание прозрачностью, а не значок рядом: ширина подписи не меняется, и
 * ряд ссылок не прыгает. Задержка и «уменьшить движение» — в .link-pending.
 */
export function LinkPending({ children }: { children: React.ReactNode }) {
  const { pending } = useLinkStatus()
  return <span className={pending ? 'link-pending' : undefined}>{children}</span>
}
