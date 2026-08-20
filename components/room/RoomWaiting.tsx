'use client'

import { useEffect, useRef } from 'react'
import { Ambient } from '@/components/Ambient'
import { plural } from '@/lib/plural'
import { type RoomMemberView, waitingMode } from '@/lib/room'
import type { NearMiss } from '@/lib/roomlikes'
import { AloneInvite, RoomEscapeHatch } from './AloneInvite'
import { type LikedGame, MyLikesRail, NearMissList } from './LikesStrips'
import { MemberRoster } from './MemberRoster'
import { PartyTrivia } from './PartyTrivia'

/**
 * Экран «карточек больше нет».
 *
 * Раньше это была одна стеклянная коробка с текстом «Ты всё отсвайпал / Ждём
 * остальных» и семьсот пикселей пустоты под ней. Текст был неправдой в двух
 * случаях из трёх: в комнате на одного ждать некого в принципе, а при пустой
 * колоде человек не отсвайпал ничего.
 *
 * Пустота лечится не растягиванием коробки, а тем, что нижний блок уходит на
 * mt-auto: содержимое стоит там, где ему место, и расходится ровно тот зазор,
 * который должен.
 */
export function RoomWaiting({
  roomId,
  isHost,
  isPublic,
  members,
  deckSize,
  deckTotal,
  near,
  myLikes,
  hasMore,
  pulling,
  onPullMore,
  copied,
  copyFailed,
  cameFromDeck,
  onCopyLink,
  onTogglePublic,
}: {
  roomId: string
  isHost: boolean
  isPublic: boolean
  members: RoomMemberView[]
  deckSize: number | null
  deckTotal: number
  near: NearMiss[]
  myLikes: LikedGame[]
  hasMore: boolean
  pulling: boolean
  onPullMore: () => void
  copied: boolean
  copyFailed: boolean
  /** пришли сюда, домахав колоду, — тогда переносим фокус */
  cameFromDeck: boolean
  onCopyLink: () => void
  onTogglePublic: () => void
}) {
  const headRef = useRef<HTMLDivElement>(null)
  const me = members.find((m) => m.me)
  const mode = waitingMode({
    memberCount: members.length,
    deckTotal,
    myVotes: me?.votes ?? 0,
  })

  /*
   * Колода уносит фокус с собой: SwipeDeck размонтируется вместе с кнопками, в
   * которых он был, и фокус падает в body — клавиатурного человека молча
   * выкидывает в начало документа. Забираем его только при уходе колоды, иначе
   * воровали бы фокус при обычном заходе на страницу.
   */
  useEffect(() => {
    if (!cameFromDeck) return
    headRef.current?.focus()
  }, [cameFromDeck])

  const pending = members.filter((m) => !m.done && !m.me)
  const doneCount = members.filter((m) => m.done).length

  /*
   * Живой регион держит ТОЛЬКО осмысленные факты и ни одного счётчика: опрос
   * идёт раз в 2.5 секунды, и регион с «Дима 12 из 20» зачитывался бы вслух
   * круглосуточно. Строка меняется, лишь когда меняется одно из двух чисел, —
   * React не тронет DOM, а скринридер промолчит.
   */
  const liveSummary =
    mode === 'alone'
      ? 'В комнате только ты.'
      : `Вас ${members.length}. Отсвайпали: ${doneCount} из ${members.length}.` +
        (near.length
          ? ` Почти совпали: ${near.length} ${plural(near.length, 'расклад', 'расклада', 'раскладов')}.`
          : '')

  return (
    <section className="relative flex-1 flex flex-col gap-5">
      <Ambient className={mode === 'alone' ? 'anim-breathe' : ''} />
      <div aria-hidden className="grain absolute inset-0" />

      <p role="status" aria-live="polite" className="sr-only">
        {liveSummary}
      </p>

      <div ref={headRef} tabIndex={-1} className="outline-none contents">
        {mode === 'alone' && (
          <AloneInvite
            roomId={roomId}
            isHost={isHost}
            isPublic={isPublic}
            copied={copied}
            copyFailed={copyFailed}
            onCopyLink={onCopyLink}
            onTogglePublic={onTogglePublic}
          />
        )}

        {/* Свои лайки нужны и в одиночестве: они и есть ответ на «а не зря ли
            я всё это листал» — голоса записаны и ждут второго человека */}
        {mode === 'alone' && <MyLikesRail games={myLikes} />}

        {mode === 'others' && (
          <>
            <div className="relative glass rounded-[20px] p-6 sm:p-8 flex flex-col gap-2 text-center">
              {/*
                Имя тут намеренно не подставляется. «Ждём Демо-друг» — не
                по-русски, а склонять произвольный ник из Steam нельзя: винительный
                падеж от «xX_Sniper_Xx» не существует. Кто именно держит комнату,
                видно строчкой ниже, в ростере, вместе с его прогрессом.
              */}
              <h2 className="font-display text-display-sm">
                {pending.length === 0
                  ? 'Все отсвайпали — и ни разу не совпали'
                  : pending.length === 1
                    ? 'Ты всё отсвайпал — ждём ещё одного'
                    : `Ты всё отсвайпал — ждём ещё ${pending.length} ${plural(
                        pending.length,
                        'человека',
                        'человека',
                        'человек',
                      )}`}
              </h2>
              {pending.length === 0 && (
                <p className="text-dim text-sm">
                  Вкусы разошлись полностью. Бывает — и это тоже нормальный вечер.
                </p>
              )}
            </div>
            <MemberRoster members={members} deckSize={deckSize} />
            <NearMissList near={near} />
            <MyLikesRail games={myLikes} />
          </>
        )}

        {mode === 'empty' && (
          <>
            <div className="relative glass rounded-[20px] p-6 sm:p-8 flex flex-col gap-3 text-center">
              <h2 className="font-display text-display-sm">
                Выбирать не из чего
              </h2>
              <p className="text-dim text-sm leading-relaxed max-w-md mx-auto">
                Колода пустая — в ваших библиотеках не нашлось ничего сетевого. Тут дело не в
                тебе: подключи библиотеку или позови кого-то, у кого есть во что играть вместе.
              </p>
            </div>
            <MemberRoster members={members} deckSize={deckSize} />
          </>
        )}
      </div>

      {/*
        Викторина — самый тихий блок и единственный свёрнутый. Ключ прерывания
        собран из того, что на этом экране считается настоящим: состав комнаты,
        прогресс людей и появление почти-совпадений. Любое изменение сворачивает
        панель обратно.
      */}
      <PartyTrivia
        roomId={roomId}
        interruptKey={`${members.length}:${doneCount}:${near.length}`}
        interruptNote="В комнате что-то произошло — викторина подождёт."
      />

      <div className="relative flex flex-wrap items-center justify-between gap-3 pt-2">
        {hasMore ? (
          <button
            onClick={onPullMore}
            disabled={pulling}
            className="rounded-[14px] glass glass-hover px-5 py-3 text-sm cursor-pointer disabled:opacity-40 text-left"
          >
            <span className="block">{pulling ? 'Добираю…' : 'Ещё 20 игр'}</span>
            {/*
              Карты за первой двадцаткой — заведомо худшие по близости к вкусу
              пати: колода отсортирована, и добор достаёт её хвост. Кнопка,
              которая делает вид, что дальше будет лучше, — то же враньё, что мы
              отсюда убрали. Плюс раунд общий: жмёт один, приходит всем.
            */}
            <span className="block text-xs text-faint mt-0.5">
              Дальше пойдёт то, что мы отложили. И придёт всем сразу
            </span>
          </button>
        ) : (
          <span className="text-xs text-faint">
            Игры кончились — мы честно перебрали всё, что нашли у вас и рядом.
          </span>
        )}
        <RoomEscapeHatch />
      </div>
    </section>
  )
}
