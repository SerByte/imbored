'use client'

import { useSearchParams } from 'next/navigation'
import { DESTINATIONS, destinationPath } from '@/lib/destination'

/**
 * Строка намерения над заголовком: почему ты здесь, если пришёл не сам.
 *
 * ДОБАВКА, А НЕ ПОДМЕНА — и это важнее, чем кажется. Соблазн был подменять
 * сам h1 («Тебя зовут в пати ABC123» вместо истории про вечер), но тогда
 * заголовок страницы уезжает за границу Suspense: по документации Next 16 всё
 * дерево до ближайшей границы на предрендеренном маршруте уходит в клиентский
 * рендер, а в статическую разметку попадает fallback. Заголовок главной обязан
 * лежать в HTML — его читают краулер, читалка и первый кадр. Поэтому h1
 * серверный и всегда один, а сюда приезжает только строка сверху.
 *
 * Гостю, пришедшему сам, здесь пусто — и место под строку не резервируется:
 * пустой блок в 44 px над заголовком двигал бы первый экран у всех ради
 * меньшинства. Появление строки сдвигает заголовок вниз ровно в тех случаях,
 * когда человеку и правда есть что сказать.
 *
 * Тексты обещаний берутся ТОЛЬКО из lib/destination.ts. Второй копии этих
 * фраз в проекте быть не должно: они уже разъезжались с адресами один раз.
 *
 * ЧЕГО ЗДЕСЬ БОЛЬШЕ НЕТ — и то, и другое ушло вместе с переездом карточки в
 * герой. Ссылки «Подключить →» на якорь #connect: карточка теперь стоит
 * рядом, в том же экране, и отправлять к ней прокруткой стало нечестно.
 * Строки «С возвращением, N» для вошедшего: её печатает сама карточка, и две
 * копии приветствия в одном экране читались бы как сбой, а не как забота.
 */
export function HeroNotice() {
  const search = useSearchParams()

  const join = search.get('join')
  const joinTarget = join && /^[A-Z0-9]{6}$/.test(join.toUpperCase()) ? join.toUpperCase() : null
  const compat = search.get('compat')
  const compatTarget = compat && /^\d{17}$/.test(compat) ? compat : null
  const next = destinationPath(search.get('next'))
  const dest = next ? DESTINATIONS[next] : null

  const promise = joinTarget
    ? `Тебя зовут в пати ${joinTarget} — подключи библиотеку, чтобы войти.`
    : compatTarget
      ? 'Подключи библиотеку — и увидишь ваш процент совместимости.'
      : (dest?.promise ?? null)

  if (!promise) return null

  return (
    <p className="glass mb-6 max-w-md rounded-[14px] px-4 py-3 text-sm leading-relaxed text-ink">
      {promise}
    </p>
  )
}
