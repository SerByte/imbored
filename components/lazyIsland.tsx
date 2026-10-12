'use client'

import { useEffect, useState, type ComponentType } from 'react'

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
 * bundle-budget.json. Комната (app/room/[id]) и страница игры (GameShots)
 * остаются на next/dynamic: там у куска своя граница отказа и предзагрузка.
 *
 * Ведёт себя как next/dynamic с ssr: false:
 *  - на сервере и пока чанк в пути — пусто, разметка гидратации совпадает;
 *  - чанк просит первый смонтированный островок, сразу после монтирования;
 *  - модуль один на вкладку: островок, смонтированный после его прихода
 *    (следующий герой, «назад» на страницу), встаёт сразу, без пустого кадра.
 *
 * Отличие одно — отказ. Чанк не пришёл (моргнула сеть, деплой сменил хеш) —
 * островка нет, а страница цела: у next/dynamic отказ React.lazy без своей
 * границы уводил всю страницу в app/error.tsx (components/TonightLazy).
 * Следующий смонтированный островок попросит чанк снова; кому отказ нужно
 * помнить до перезагрузки, ловит его сам в load.
 */
export function lazyIsland<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  let loaded: ComponentType<P> | null = null
  let loading: Promise<ComponentType<P>> | null = null

  function get(): Promise<ComponentType<P>> {
    loading ??= load().then(
      (C) => (loaded = C),
      (err: unknown) => {
        loading = null
        throw err
      },
    )
    return loading
  }

  function LazyIsland(props: P) {
    const [Island, setIsland] = useState<ComponentType<P> | null>(() => loaded)
    useEffect(() => {
      if (Island) return
      let live = true
      get().then(
        (C) => {
          if (live) setIsland(() => C)
        },
        () => {},
      )
      return () => {
        live = false
      }
    }, [Island])
    return Island ? <Island {...props} /> : null
  }
  return LazyIsland
}
