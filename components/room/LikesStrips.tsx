import { GameArt } from '@/components/GameArt'
import type { GameArtUrls } from '@/lib/art'
import { pl, tr, type Locale } from '@/lib/i18n'
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
 * Имена по-английски — списком «A, B and C», как «Already here» у экрана
 * приглашения (inviteDoor в lib/roominvite): « and » между каждой парой
 * («Mia and Leo and Sam») — не английский список. Двоеточие после «Waiting
 * for» не нужно тоже: русское «Ждём: …» прячет падеж ника, а у английского
 * предлога падежа нет.
 */
function namesEn(names: readonly string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '')
}

/**
 * «Вы почти совпали» — словами, без единой обложки.
 *
 * Ни названия, ни арта здесь нет по устройству данных: NearMiss не содержит
 * appid (см. lib/roomlikes.ts). Это не ограничение вёрстки, а защита развязки
 * и чужих голосов — поэтому и показывать нечего, кроме расклада.
 *
 * Язык — пропом, а не useLocale: оба списка рисует только экран ожидания
 * (RoomWaiting), а сторож ключей зовёт NearMissList прямо функцией, вне
 * рендера, где хуков нет. Без пропа — русский, как было.
 */
export function NearMissList({ near, locale = 'ru' }: { near: NearMiss[]; locale?: Locale }) {
  if (!near.length) return null

  return (
    <section className="relative flex flex-col gap-2.5">
      <SectionLabel as="h3">{tr(locale, { ru: 'Вы почти совпали', en: 'Almost a match' })}</SectionLabel>
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
            {/*
              По-английски глагола с родом нет вовсе, но порядок другой: число
              стоит после «yes on», а не после глагола, — ветка разметки целиком,
              а не перевод кусков вокруг числа.
            */}
            {locale === 'en' ? (
              <>
                <span className={i === 0 ? 'text-ink' : 'text-dim'}>
                  {namesEn(n.forNames)}: yes on
                </span>
                <span className="tabular-nums text-ember-text">{n.games}</span>
                <span className={i === 0 ? 'text-ink' : 'text-dim'}>
                  {pl(locale, n.games, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })}.
                </span>
              </>
            ) : (
              <>
                <span className={i === 0 ? 'text-ink' : 'text-dim'}>
                  {n.forNames.join(' и ')}: {plural(n.games, 'совпала', 'совпало', 'совпало')}
                </span>
                <span className="tabular-nums text-ember-text">{n.games}</span>
                <span className={i === 0 ? 'text-ink' : 'text-dim'}>
                  {plural(n.games, 'игра', 'игры', 'игр')}.
                </span>
              </>
            )}
            <span className="text-faint">
              {n.mePending
                ? tr(locale, { ru: 'Ждём тебя.', en: 'Waiting for you.' })
                : tr(locale, {
                    ru: `Ждём: ${n.pendingNames.join(', ')}.`,
                    en: `Waiting for ${namesEn(n.pendingNames)}.`,
                  })}
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
export function MyLikesRail({ games, locale = 'ru' }: { games: LikedGame[]; locale?: Locale }) {
  if (!games.length) return null

  return (
    <ScrollRail
      label={
        locale === 'en' ? (
          <>
            {"You're in on "}
            <span className="tabular-nums text-ember-text">{games.length}</span>{' '}
            {pl(locale, games.length, { ru: ['игра', 'игры', 'игр'], en: ['game', 'games'] })}
          </>
        ) : (
          <>
            Твой выбор — <span className="tabular-nums text-ember-text">{games.length}</span>{' '}
            {plural(games.length, 'игра', 'игры', 'игр')}
          </>
        )
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
