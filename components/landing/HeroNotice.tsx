'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { destinationUrl } from '@/lib/destination'
import { destinationPromise } from '@/lib/destinationtext'
import { focusAdrift } from '@/lib/focushandoff'
import { forgotServer, subscribeForgot, takeForgot } from '@/lib/forgotnotice'
import { getServerSessionHint, getSessionHint, subscribeSessionHint } from '@/lib/sessionhint'

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
 * Тексты обещаний берутся ТОЛЬКО из lib/destinationtext.ts. Второй копии этих
 * фраз в проекте быть не должно: они уже разъезжались с адресами один раз.
 * Адрес — целиком, с хвостом (destinationUrl), а не один путь: гостю,
 * развёрнутому с квиза, строка повторяет его ответы (destinationPromise).
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
  // Сюда уводит «Удалить всё обо мне» (components/ForgetMe). Без строки
  // человек попадал бы на обычную главную гостя и не знал, сработало ли.
  // Зажигает её метка самого удаления, забранная на один заход (lib/forgotnotice),
  // а не адрес: адрес оставался в истории и звучал бы снова и снова. И
  // никогда — рядом с «С возвращением»: вошедшему «входы погашены» врёт
  const hint = useSyncExternalStore(subscribeSessionHint, getSessionHint, getServerSessionHint)
  const forgot = useSyncExternalStore(subscribeForgot, takeForgot, forgotServer) && hint?.authed !== true

  /*
   * Строка «удалено» — единственное подтверждение необратимого, и
   * скринридеру её никто не прочтёт сам: нажатая «Да, удалить всё» ушла
   * вместе с /library, фокус упал в body, а объявитель маршрутов Next
   * читает только заголовок вкладки. Поэтому строка забирает потерянный
   * фокус (focusAdrift) — читалка встаёт на неё и произносит. Только
   * потерянный: стоящего в шапке не дёргаем. Без прокрутки: наверх главную
   * уже поставил роутер. Живой областью строка не стала — область,
   * рождённая вместе с текстом, звучит не везде (докблок StatusLine).
   * Хук — до раннего return: порядок хуков не зависит от строки
   */
  const line = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (forgot && focusAdrift(document)) line.current?.focus({ preventScroll: true })
  }, [forgot])

  // Об отметке удаления (forget_marks в lib/db) — честно и теми же словами,
  // что в вопросе «Удалить всё?» (forgetSummary в lib/forget) и в /privacy:
  // без неё «всё удалено» спорило бы с SteamID, который остаётся
  const promise = forgot
    ? 'Готово — всё, что imbored о тебе хранил, удалено, а входы на всех устройствах погашены. ' +
      'Осталась только отметка — SteamID и время удаления: по ней старые входы больше не пускают. ' +
      'Через год и месяц она сотрётся сама.'
    : joinTarget
      ? `Тебя зовут в пати ${joinTarget} — подключи библиотеку, чтобы войти.`
      : compatTarget
        ? 'Подключи библиотеку — и увидишь ваш процент совместимости.'
        : destinationPromise(destinationUrl(search.get('next')))

  if (!promise) return null

  return (
    <p
      ref={line}
      tabIndex={-1}
      className="glass mb-6 max-w-md rounded-[14px] px-4 py-3 text-sm leading-relaxed text-ink"
    >
      {promise}
    </p>
  )
}
