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
        {near.map((n, i) => (
          <li
            key={`${n.forNames.join()}|${n.pendingNames.join()}`}
            className="glass rounded-[14px] px-4 py-3 text-sm flex flex-wrap items-baseline gap-x-1.5 gap-y-1"
          >
            <span className={i === 0 ? 'text-ink' : 'text-dim'}>
              {n.forNames.join(' и ')} {n.forNames.length > 1 ? 'сошлись' : 'сошёлся'} на
            </span>
            <span className="font-mono tabular-nums text-ember-text">{n.games}</span>
            <span className={i === 0 ? 'text-ink' : 'text-dim'}>
              {plural(n.games, 'игре', 'играх', 'играх')}.
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

/** Свои же «играем» — тут скрывать нечего, это твоя собственная история */
export function MyLikesRail({ games }: { games: LikedGame[] }) {
  if (!games.length) return null

  return (
    <ScrollRail
      label={
        <>
          Ты выбрал <span className="font-mono tabular-nums text-ember-text">{games.length}</span>{' '}
          {plural(games.length, 'игру', 'игры', 'игр')}
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
            className="w-full aspect-[460/215] object-cover rounded-[14px] border border-edge"
          />
          {/* GameArt отдаёт alt="", поэтому подпись обязательна — иначе рельс
              для скринридера превращается в список безымянных картинок */}
          <span className="text-[10px] text-faint truncate leading-tight">{g.name}</span>
        </li>
      ))}
    </ScrollRail>
  )
}
