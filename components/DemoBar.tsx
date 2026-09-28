'use client'

import Link from 'next/link'
import { useEffect, useSyncExternalStore } from 'react'
import { demoDoors, noteDemoDoorShown } from '@/lib/demodoor'
import { getServerSessionHint, getSessionHint, subscribeSessionHint } from '@/lib/sessionhint'
import { track } from '@/lib/track'

/**
 * ПОЛОСА «ЭТО ЧУЖАЯ ДЕМО-БИБЛИОТЕКА» — /play, /daily и /library.
 *
 * Причины выдачи говорят «ты не запускал…» про чужую витрину, и без этой
 * строки демо на странице ничем себя не выдавало. Полоса говорит, чья это
 * библиотека, и тут же даёт обе двери к своей — вход через Steam и ссылку
 * (адреса и счёт показов — lib/demodoor).
 *
 * overlay — для героя /play и /daily: полоса висит под шапкой, в верхнем поле
 * героя (pt-40), где текста нет — только арт, — и места в потоке не
 * занимает. Признак демо там клиентский: подсказка о входе, которую
 * SessionKeeper может поправить уже при герое на экране, — и полоса в потоке,
 * исчезнув, сдвинула бы кадр целиком. В библиотеке признак серверный: полоса
 * приходит в первом HTML и стоит в потоке.
 *
 * На телефоне кегль мельче не из вкуса: полоса начинается на 80 px, под
 * шапкой, а текст героя — со 160, и в три строки она легла бы на его бейдж.
 *
 * Цвета — токены кино-зоны героя (.media-dark): полоса стоит внутри неё и на
 * светлой теме остаётся тёмной, как всё поверх арта. Подложка своя, а не
 * .glass: стекло на 8% белого поверх светлого кадра не держит контраст
 * строки, а скрим героя сверху самый слабый.
 */
export function DemoBar({
  from,
  overlay = false,
  className = '',
}: {
  /** Где стоит полоса: туда же вернут обе двери */
  from: string
  overlay?: boolean
  className?: string
}) {
  const doors = demoDoors(from)

  useEffect(() => {
    noteDemoDoorShown(from)
  }, [from])

  const bar = (
    <p
      className={`pointer-events-auto max-w-xl rounded-(--radius-card) border border-edge bg-bg/70 px-4 py-2 text-xs leading-relaxed text-ink backdrop-blur sm:py-2.5 sm:text-sm ${className}`}
    >
      <span className="font-semibold">Это чужая демо-библиотека.</span>{' '}
      <span className="text-dim">Подбор по твоей —</span>{' '}
      {/* Обычная ссылка: вход через Steam — переход на чужой сайт через наш роут */}
      <a
        href={doors.steam}
        onClick={() => track('demo_door_steam')}
        className="tap tap-tight font-semibold text-ember-text hover:underline"
      >
        Войти через Steam
      </a>
      <span aria-hidden className="text-faint">
        {' · '}
      </span>
      <Link
        href={doors.link}
        onClick={() => track('demo_door_link')}
        className="tap tap-tight font-semibold text-ember-text hover:underline"
      >
        вставить ссылку
      </Link>
    </p>
  )

  if (!overlay) return bar
  return (
    // Внутри героя (position: relative): z-10 — выше поля текста героя, чей
    // верхний отступ иначе перехватывал бы нажатия по полосе
    <div className="pointer-events-none absolute inset-x-0 top-20 z-10">
      <div className="mx-auto w-full max-w-6xl px-safe">{bar}</div>
    </div>
  )
}

/**
 * Демо ли эта сессия — для клиентских страниц, у которых сервер ответа о
 * сессии не отдаёт: по подсказке о входе (lib/sessionhint). Подсказку пишет
 * главная и сверяет SessionKeeper на каждой странице, так что вошедший через
 * Steam из самой полосы её больше не увидит. На сервере — «не демо»: полоса
 * живёт только в клиентском рендере героя, которого до ответа нет.
 */
export function useDemoSession(): boolean {
  return useSyncExternalStore(subscribeSessionHint, getSessionHint, getServerSessionHint)?.demo === true
}
