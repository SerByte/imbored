'use client'

import { useSyncExternalStore, type ComponentType } from 'react'
import { clientErrorCode, reportClientError } from '@/lib/clienterr'

/**
 * Островок отдельным чанком — то, что next/dynamic с ssr: false, без его
 * рантайма.
 *
 * Рантайм next/dynamic (обёртка над React.lazy, предзагрузка чанков для SSR,
 * хранилища рендера) — ~4 КБ к первой загрузке маршрута (замер сборкой:
 * /library +4.0 КБ за одну кнопку «Уже прошёл»; /play и /daily с переходом
 * на островки — −3.7 КБ каждая, вместе с самим островком).
 * Островкам здесь от него нужно одно: не рисоваться до гидратации и догрузить
 * чанк сразу после, а /play, /daily и /library стоят у потолка
 * bundle-budget.json. Плавная прокрутка главной (components/SmoothScroll) —
 * тоже островок: её отказ уводил всю главную в экран ошибки. Комната
 * (app/room/[id]) остаётся на next/dynamic — там у куска своя граница отказа
 * (CeremonyBoundary) и предзагрузка; страница игры (GameShots) — тоже, но
 * своей границы у неё нет: её отказ ловит app/error.tsx и предлагает
 * перезагрузку (isChunkLoadError в lib/clienterr).
 *
 * Ведёт себя как next/dynamic с ssr: false:
 *  - на сервере и пока чанк в пути — пусто, разметка гидратации совпадает;
 *  - чанк просит первый смонтированный островок, сразу после монтирования;
 *  - модуль один на вкладку: островок, смонтированный после его прихода
 *    (следующий герой, «назад» на страницу), встаёт сразу, без пустого кадра.
 *
 * Модуль — внешнее хранилище для useSyncExternalStore, а не useState с
 * модулем в инициализаторе. Инициализатор читал модуль и в первом кадре
 * гидратации: островок, который гидратируется ПОСЛЕ прихода чанка к соседу
 * (граница Suspense, догидратированная позже), рисовал содержимое там, где
 * сервер не нарисовал ничего, — расхождение гидратации и перерисовка
 * границы целиком. У useSyncExternalStore первый кадр гидратации — серверный
 * снимок (пусто), а клиентский React сверяет сразу после неё; монтирование
 * без гидратации берёт клиентский снимок — без пустого кадра, как и было.
 * Чанк просит подписка: React подписывается сразу после монтирования, ровно
 * тогда, когда раньше это делал эффект.
 *
 * Отличие от next/dynamic одно — отказ. Чанк не пришёл (моргнула сеть,
 * деплой сменил хеш) — островка нет, а страница цела: у next/dynamic отказ
 * React.lazy без своей границы уводил всю страницу в app/error.tsx
 * (components/TonightLazy). Следующий смонтированный островок попросит чанк
 * снова; кому отказ нужно помнить до перезагрузки, ловит его сам в load — и
 * отчитывается сам же (reportIslandFailure).
 *
 * Но отказ не пропадает: прежде отчёт о нём слала app/error.tsx, теперь —
 * островок, тем же путём (lib/clienterr) и с тегом island. Иначе 404 чанков
 * после деплоя (старая вкладка, переход на /library) жил бы, пока кто-нибудь
 * не напишет, что кнопка «Уже прошёл» пропала. Тег — потому что текст отказа
 * называет чанк по хешу, а хеш меняется с каждым деплоем.
 */
export function lazyIsland<P extends object>(
  load: () => Promise<ComponentType<P>>,
  island: string,
): ComponentType<P> {
  let loaded: ComponentType<P> | null = null
  let loading: Promise<void> | null = null
  const listeners = new Set<() => void>()

  // островков одного чанка бывает много («Уже прошёл» у каждого вечера) —
  // запрос и отчёт об отказе у них один на попытку
  function subscribe(onChange: () => void) {
    listeners.add(onChange)
    loading ??= load().then(
      (C) => {
        loaded = C
        for (const l of listeners) l()
      },
      (err: unknown) => {
        loading = null
        reportIslandFailure(island, err)
      },
    )
    return () => {
      listeners.delete(onChange)
    }
  }
  const snapshot = () => loaded

  function LazyIsland(props: P) {
    const Island = useSyncExternalStore(subscribe, snapshot, empty)
    return Island ? <Island {...props} /> : null
  }
  return LazyIsland
}

/** Серверный снимок и первый кадр гидратации: островка нет */
const empty = () => null

/**
 * Отказ чанка островка — в отчёт, как от границы ошибок (kind boundary: до
 * window отказ не доходит, отчёт шлёт тот, кто его поймал). Зовёт сам
 * lazyIsland и загрузчик, который ловит отказ сам (components/TonightLazy).
 */
export function reportIslandFailure(island: string, error: unknown): void {
  reportClientError({ kind: 'boundary', error, island, href: window.location.href, code: clientErrorCode(error) })
}
