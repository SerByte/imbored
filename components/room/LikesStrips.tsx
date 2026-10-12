import { GameArt } from '@/components/GameArt'
import type { GameArtUrls } from '@/lib/art'
import { plural } from '@/lib/plural'
import type { NearMiss } from '@/lib/roomlikes'
import { ScrollRail } from './ScrollRail'
import { SectionLabel } from '@/components/Labels'

export type LikedGame = {
  appid: number
  name: string
  headerImage: string | null
  art: GameArtUrls | null
}

/**
 * «Вы почти совпали» — словами, без единой обложки.
 *
 * Ни названия, ни арта здесь нет по устройству данных: NearMiss не содержит
 * appid (см. lib/roomlikes.ts). Это не ограничение вёрстки, а защита развязки
 * и чужих голосов — поэтому и показывать нечего, кроме расклада.
 */
export function NearMissList({ near }: { near: NearMiss[] }) {
  if (!near.length) return null

  return (
    <section className="relative flex flex-col gap-2.5">
      <SectionLabel as="h3">Вы почти совпали</SectionLabel>
      <ul className="flex flex-col gap-2">
        {/*
          Ключ — место в списке, а не имена. Имена не уникальны: каждый
          «Демо-друг» зовётся одинаково (см. ростер в app/api/room/[id]/route.ts),
          и расклады {хост, Д1 | Д2} и {хост, Д2 | Д1} давали один ключ «Аня,
          Демо-друг|Демо-друг» — React на опросе ронял или дублировал строки.
          Группы сервер различает по steamid, но наружу их не отдаёт (lib/roomkey),
          а у строки нет ни состояния, ни анимации: позиционный ключ здесь верен.
        */}
        {near.map((n, i) => (
          <li
            key={i}
            className="rounded-(--radius-card) bg-surface px-4 py-3 text-sm flex flex-wrap items-baseline gap-x-1.5 gap-y-1"
          >
            {/*
              БЕЗ РОДА У ГЛАГОЛА. Здесь стояло «{имя} сошёлся» — мужской род,
              выбранный за человека, которого мы не знаем: в комнате чужой ник
              из Steam, и «Аня сошёлся на трёх играх» это не стилистика, а
              ошибка рядом с именем.
              Тот же довод уже записан двумя файлами выше, в RoomWaiting, где
              имя намеренно не подставляется в «ждём»: произвольный ник нельзя
              ни склонять, ни согласовывать с ним глагол. Двоеточие снимает и
              то и другое — имя остаётся в именительном, а глагол согласуется
              с числом игр, которое мы как раз знаем.
            */}
            <span className={i === 0 ? 'text-ink' : 'text-dim'}>
              {n.forNames.join(' и ')}: {plural(n.games, 'совпала', 'совпало', 'совпало')}
            </span>
            <span className="tabular-nums text-ember-text">{n.games}</span>
            <span className={i === 0 ? 'text-ink' : 'text-dim'}>
              {plural(n.games, 'игра', 'игры', 'игр')}.
            </span>
            <span className="text-faint">
              {n.mePending
                ? 'Ждём тебя.'
                : `Ждём: ${n.pendingNames.join(', ')}.`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * Свои же «играем» — тут скрывать нечего, это твоя собственная история.
 *
 * «Твой выбор — 5 игр», а не «Ты выбрал 5 игр»: род того, кто смотрит на
 * экран, нам неизвестен так же, как род ника в «почти совпали» выше.
 */
export function MyLikesRail({ games }: { games: LikedGame[] }) {
  if (!games.length) return null

  return (
    <ScrollRail
      label={
        <>
          Твой выбор — <span className="tabular-nums text-ember-text">{games.length}</span>{' '}
          {plural(games.length, 'игра', 'игры', 'игр')}
        </>
      }
    >
      {games.map((g) => (
        <li key={g.appid} className="shrink-0 w-[136px] flex flex-col gap-1">
          <GameArt
            appid={g.appid}
            name={g.name}
            headerImage={g.headerImage}
            art={g.art}
            sizes="136px"
            className="w-full aspect-[460/215] object-cover rounded-(--radius-card) border border-edge"
          />
          {/* GameArt отдаёт alt="", поэтому подпись обязательна — иначе рельс
              для скринридера превращается в список безымянных картинок */}
          <span className="text-[10px] text-faint truncate leading-tight">{g.name}</span>
        </li>
      ))}
    </ScrollRail>
  )
}
