'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { SteamLaunch } from '@/components/SteamLaunch'
import { writerStore } from '@/lib/writer'

/**
 * «Запустить» — только тому, у кого игра есть.
 *
 * Страница игры общая для всех и живёт на ISR, поэтому решить это в разметке
 * нельзя: сервер не знает, кто смотрит. Раньше кнопка стояла у каждого —
 * включая гостя из поиска и вошедшего, у которого игры нет, — и steam://run
 * открывал ему клиент Steam с окном покупки вместо игры. На странице,
 * которая отвечает на «стоит ли играть», это кнопка, которая врёт.
 *
 * Спрашиваем только вошедшего. Признак «сессия есть» уже лежит в памяти
 * страницы: /api/session/touch зовёт каждая страница (SessionKeeper), и
 * writer в его ответе — boolean у любой сессии и null у гостя. Гость из
 * поиска — основной читатель пяти тысяч карточек, и лишний запрос на каждый
 * его заход стоил бы вызова функции ни за что.
 *
 * Ошибиться островок может только в одну сторону: не показать кнопку тому,
 * у кого игра есть (нет снапшота, сбой сети). Рядом всегда стоит «Страница в
 * Steam», так что это потеря удобства, а не тупик.
 *
 * На тач-устройствах не рисуется вовсе: steam://run там не работает, а ссылка
 * на магазин уже рядом (mobileLabel={null}, см. SteamLaunch).
 */
export function OwnedLaunch({ appid, className = '' }: { appid: number; className?: string }) {
  const writer = useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server)
  const hasSession = writer !== null
  // appid рядом с ответом: при переходе на соседнюю карточку старое «да» не
  // должно мелькнуть у новой игры, пока едет её ответ
  const [owns, setOwns] = useState<{ appid: number; owned: boolean } | null>(null)

  useEffect(() => {
    if (!hasSession) return
    let live = true
    fetch(`/api/session/owns?appid=${appid}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ owned?: unknown }>) : null))
      .then((d) => {
        if (live && d) setOwns({ appid, owned: d.owned === true })
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [appid, hasSession])

  if (!owns || owns.appid !== appid || !owns.owned) return null
  return <SteamLaunch appid={appid} label="Запустить" mobileLabel={null} icon className={className} />
}
