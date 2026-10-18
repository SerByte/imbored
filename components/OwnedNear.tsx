'use client'

import { useSyncExternalStore } from 'react'
import { GameLink } from '@/components/GameLink'
import { SectionLabel } from '@/components/Labels'
import { SteamLaunch } from '@/components/SteamLaunch'
import { nearPlayedLabel, ownedNearStore } from '@/lib/ownednear'
import { writerStore } from '@/lib/writer'

/**
 * «Похожее уже есть у тебя» — над «Похожими» на странице игры.
 *
 * Сам ничего не спрашивает: список кладёт OwnedLaunch из того же ответа
 * владения (near=1, см. lib/ownednear), поэтому лишнего запроса нет, а
 * разметка ISR одна на всех — на сервере и у гостя здесь пусто.
 *
 * Имя — ссылкой на её карточку (GameLink, без префетча: своё у человека — это
 * чаще всего хвост каталога, и холодный рендер ради ссылки, по которой,
 * может, и не пойдут, — та же цена, что у «Похожих»). Рядом — «Запустить»:
 * игра своя, и довод «сначала её» исполняется одним нажатием. На тач-
 * устройствах запуска нет (mobileLabel={null}, как у OwnedLaunch): steam://
 * там не работает, а карточка по ссылке рядом.
 *
 * Только при пишущей сессии (writerStore === true) — той единственной, которой
 * роут вообще отдаёт near. Хранилище модульное и переживает переход роутера,
 * а гостю OwnedLaunch ничего не спрашивает — значит, и список не перезапишет.
 * Выход и «Удалить всё обо мне» его стирают (SignOut, ForgetMe), а это —
 * второй замок на случай, который они не видят: сессия стала гостевой
 * (writer null) или только читающей (false — во второй вкладке вставили
 * ссылку на профиль, может быть, чужой). «Назад» на эту карточку тогда не
 * покажет прежнюю полку с наигранным и «Запустить» тому, кто сейчас смотрит.
 */
export function OwnedNear({ appid }: { appid: number }) {
  const near = useSyncExternalStore(ownedNearStore.subscribe, ownedNearStore.get, ownedNearStore.server)
  const writer = useSyncExternalStore(writerStore.subscribe, writerStore.get, writerStore.server)
  if (writer !== true || !near || near.appid !== appid || !near.games.length) return null
  return (
    <section>
      <SectionLabel className="mb-3">Похожее уже есть у тебя</SectionLabel>
      <ul className="flex flex-col gap-2">
        {near.games.map((g) => {
          const played = nearPlayedLabel(g.minutes)
          return (
            <li key={g.appid} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <GameLink appid={g.appid} transitionTypes={['nav-forward']} className="tap tap-tight link-more">
                {g.name}
              </GameLink>
              {played && <span className="text-sm text-faint">{played}</span>}
              <SteamLaunch appid={g.appid} label="Запустить" mobileLabel={null} className="tap tap-tight link-more" />
            </li>
          )
        })}
      </ul>
    </section>
  )
}
