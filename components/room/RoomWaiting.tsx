'use client'

import type { ShareLink } from '@/components/ShareLink'
import { type ReactNode, useEffect, useRef } from 'react'
import { Ambient } from '@/components/Ambient'
import { useLocale } from '@/components/LocaleProvider'
import { StatusLine } from '@/components/StatusLine'
import { focusAdrift } from '@/lib/focushandoff'
import { tr } from '@/lib/i18n'
import { plural } from '@/lib/plural'
import { type RoomMemberView, rosterHint, waitingMode } from '@/lib/room'
import type { LeaderOffer, NearMiss } from '@/lib/roomlikes'
import { AloneInvite, RoomEscapeHatch } from './AloneInvite'
import { LeaderPick } from './LeaderPick'
import { MatchNotifyToggle } from './MatchNotify'
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
  leader,
  takingLeader,
  leaderMiss,
  onTakeLeader,
  hasMore,
  pulling,
  pullFailed,
  onPullMore,
  share,
  cameFromDeck,
  onTogglePublic,
  onRemoveMember,
  onLeave,
  kickUndo = null,
  leaving,
  leaveMiss,
  missedMember,
  publicBusy,
  publicMiss,
}: {
  roomId: string
  isHost: boolean
  isPublic: boolean
  members: RoomMemberView[]
  deckSize: number | null
  deckTotal: number
  near: NearMiss[]
  myLikes: LikedGame[]
  /** лидер голосов, когда все отсвайпали и не совпали (pickLeader); иначе null */
  leader: LeaderOffer | null
  takingLeader: boolean
  leaderMiss: 'stale' | 'failed' | null
  onTakeLeader: () => void
  hasMore: boolean
  pulling: boolean
  /** добор раунда не дошёл — см. pullMore в app/room/[id]/page */
  pullFailed: boolean
  onPullMore: () => void
  /** ссылка на комнату — общая с кнопкой в шапке (useShareLink) */
  share: ShareLink
  /** пришли сюда, домахав колоду, — тогда переносим фокус */
  cameFromDeck: boolean
  onTogglePublic: () => void
  /** убрать участника (хост) или выйти самому — см. app/api/room/[id]/leave */
  onRemoveMember: (memberId: string) => void
  onLeave: () => void
  /**
   * «Пустить обратно» после ✕ — строка от страницы (app/room/[id]/page).
   * Стоит под ростером, а если ✕ убрал последнего, кроме хоста, и экран
   * сменился приглашением, — под приглашением: в пати на двоих случайное
   * касание ✕ уводит весь ростер, и отмена не должна уходить вместе с ним.
   * Уходит и весь этот экран — меньший состав приносит новую колоду, — тогда
   * строку над колодой ставит страница (waitingShown там).
   */
  kickUndo?: ReactNode
  /** выход или удаление в пути — см. removeMember на странице */
  leaving: boolean
  /** почему не вышло выйти или убрать; null — отказа нет или он уже неправда */
  leaveMiss: string | null
  /** чья ✕ отказала последней — ростер забывает перенос фокуса с неё */
  missedMember: string | null
  /** переключение доски в пути — см. togglePublic на странице */
  publicBusy: boolean
  /** почему доска не переключилась; null — отказа нет (строка — в AloneInvite) */
  publicMiss: string | null
}) {
  const headRef = useRef<HTMLHeadingElement>(null)
  const locale = useLocale()
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
   *
   * Цель — заголовок режима, у каждого свой h2. Прежде ею был div с
   * display: contents вокруг всех трёх: без бокса кольцо не рисовалось, имени
   * у обёртки нет, и скринридеру нечего было объявить, а в части движков
   * такой элемент фокус не принимает вовсе. Заголовок назовёт экран сам —
   * «Колода пройдена — ждём ещё одного».
   */
  useEffect(() => {
    if (!cameFromDeck) return
    headRef.current?.focus()
  }, [cameFromDeck])

  /*
   * Смена режима под фокусом. Хост убрал последнего, кроме себя, — ростер
   * уходит вместе с режимом 'others', и ✕ в фокусе падал в body; зашёл
   * первый гость — AloneInvite уходит вместе с нажатой «Позвать своих».
   * Заголовок нового режима забирает фокус, только потерянный: стоящего в
   * шапке смена режима не трогает. Первый рендер — не смена.
   */
  const modeShown = useRef(mode)
  useEffect(() => {
    if (modeShown.current === mode) return
    modeShown.current = mode
    if (focusAdrift(document)) headRef.current?.focus()
  }, [mode])

  const pending = members.filter((m) => !m.done && !m.me)
  const doneCount = members.filter((m) => m.done).length
  // Сервер отдаёт лидера только при «все отсвайпали», но опрос ростера и
  // запрос лайков живут отдельно: пока ростер показывает кого-то свайпающим,
  // «берём X?» над ним читалось бы спойлером для него же
  const offer = pending.length === 0 ? leader : null

  /*
   * Живой регион держит ТОЛЬКО осмысленные факты и ни одного счётчика: опрос
   * идёт раз в 2.5 секунды, и регион с «Дима 12 из 20» зачитывался бы вслух
   * круглосуточно. Строка меняется, лишь когда меняется одно из двух чисел, —
   * React не тронет DOM, а скринридер промолчит.
   */
  const liveSummary =
    locale === 'en'
      ? mode === 'alone'
        ? "It's just you in the room."
        : `There are ${members.length} of you. Done swiping: ${doneCount} of ${members.length}.` +
          (near.length ? ` Near misses: ${near.length}.` : '') +
          (offer ? ` Top pick: “${offer.name}”, ${offer.forCount} of ${offer.memberCount} said yes.` : '')
      : mode === 'alone'
        ? 'В комнате только ты.'
        : `Вас ${members.length}. Отсвайпали: ${doneCount} из ${members.length}.` +
          (near.length
            ? ` Почти совпали: ${near.length} ${plural(near.length, 'расклад', 'расклада', 'раскладов')}.`
            : '') +
          (offer ? ` Лидер голосов: «${offer.name}», ${offer.forCount} из ${offer.memberCount} за.` : '')

  return (
    <section className="relative flex-1 flex flex-col gap-5">
      <Ambient className={mode === 'alone' ? 'anim-breathe' : ''} />
      <div aria-hidden className="grain absolute inset-0" />

      <p role="status" aria-live="polite" className="sr-only">
        {liveSummary}
      </p>

      {mode === 'alone' && (
        <AloneInvite
          roomId={roomId}
          isHost={isHost}
          isPublic={isPublic}
          share={share}
          onTogglePublic={onTogglePublic}
          headRef={headRef}
          publicBusy={publicBusy}
          publicMiss={publicMiss}
        />
      )}
      {mode === 'alone' && kickUndo}

      {/* Свои лайки нужны и в одиночестве: они и есть ответ на «а не зря ли
          я всё это листал» — голоса записаны и ждут второго человека */}
      {mode === 'alone' && <MyLikesRail games={myLikes} locale={locale} />}

      {mode === 'others' && (
        <>
          <div className="relative panel-lift p-6 sm:p-8 flex flex-col gap-2 text-center">
            {/*
              Имя тут намеренно не подставляется. «Ждём Демо-друг» — не
              по-русски, а склонять произвольный ник из Steam нельзя: винительный
              падеж от «xX_Sniper_Xx» не существует. Кто именно держит комнату,
              видно строчкой ниже, в ростере, вместе с его прогрессом.

              «Колода пройдена», а не «ты всё отсвайпал»: род того, кто
              смотрит на экран, нам неизвестен так же, как род ника.
            */}
            <h2 ref={headRef} tabIndex={-1} className="font-display text-display-sm">
              {pending.length === 0
                ? tr(locale, {
                    ru: 'Все отсвайпали — и ни разу не совпали',
                    en: "Everyone's done swiping — and not a single match",
                  })
                : pending.length === 1
                  ? tr(locale, { ru: 'Колода пройдена — ждём ещё одного', en: 'Deck done — waiting for one more' })
                  : tr(locale, {
                      ru: `Колода пройдена — ждём ещё ${pending.length} ${plural(
                        pending.length,
                        'человека',
                        'человека',
                        'человек',
                      )}`,
                      en: `Deck done — waiting for ${pending.length} more`,
                    })}
            </h2>
            {pending.length === 0 && (
              <p className="text-dim text-sm">
                {offer
                  ? tr(locale, {
                      ru: 'Единогласия нет — но одна игра набрала большинство.',
                      en: 'Not unanimous — but one game got a majority.',
                    })
                  : tr(locale, {
                      ru: 'Вкусы разошлись полностью. Бывает — и это тоже нормальный вечер.',
                      en: "Your tastes split completely. It happens — and that's a fine evening too.",
                    })}
              </p>
            )}
          </div>
          {offer && (
            <LeaderPick
              leader={offer}
              taking={takingLeader}
              miss={leaderMiss}
              onTake={onTakeLeader}
            />
          )}
          {/*
            Предложение пропало после отказа «noleader» — сказать об этом, а
            не погасить блок молча. Строка стоит рядом с предложением, а не
            вместо него: на его месте она рождалась бы тем же рендером, что
            и свой текст, — такую живую область скринридер объявляет не везде.
          */}
          <StatusLine
            text={
              !offer && pending.length === 0 && leaderMiss === 'stale'
                ? tr(locale, {
                    ru: 'Голоса сдвинулись — брать пока нечего.',
                    en: 'The votes shifted — nothing to go with yet.',
                  })
                : null
            }
            className="text-sm text-dim text-center"
          />
          <MemberRoster
            members={members}
            deckSize={deckSize}
            hint={rosterHint(
              {
                swiping: members.filter((m) => !m.done).length,
                hasMore,
              },
              locale,
            )}
            isHost={isHost}
            onRemove={onRemoveMember}
            removing={leaving}
            missed={missedMember}
          />
          {kickUndo}
          {/*
            Под ростером: он отвечает «кого ждём», переключатель — «а если я
            отойду». Только в этом режиме: в комнате на одного матча не будет,
            а при пустой колоде — не из чего. И только пока матч ещё может
            прийти без этого человека: кто-то свайпает или есть лидер, которого
            возьмёт сосед. Когда все отсвайпали и лидера нет, голоса записаны и
            не сошлись — «сообщим» обещало бы сигнал, которого не будет (то же
            враньё, что rosterHint убрал из-под ростера). Сам прячется там, где
            уведомление со страницы не работает (телефоны, pageNotices в lib/room).
          */}
          {(pending.length > 0 || offer) && <MatchNotifyToggle />}
          <NearMissList near={near} locale={locale} />
          <MyLikesRail games={myLikes} locale={locale} />
        </>
      )}

      {mode === 'empty' && (
        <>
          <div className="relative panel-lift p-6 sm:p-8 flex flex-col gap-3 text-center">
            <h2 ref={headRef} tabIndex={-1} className="font-display text-display-sm">
              {tr(locale, { ru: 'Выбирать не из чего', en: 'Nothing to choose from' })}
            </h2>
            <p className="text-dim text-sm leading-relaxed max-w-md mx-auto">
              {tr(locale, {
                ru: 'Колода пустая — в ваших библиотеках не нашлось ничего сетевого. Тут дело не в тебе: подключи библиотеку или позови кого-то, у кого есть во что играть вместе.',
                en: "The deck is empty — your libraries have nothing multiplayer. It's not you: connect your library or invite someone who has games to play together.",
              })}
            </p>
          </div>
          {/* Без строки под списком: колоды не было, и матчу неоткуда взяться */}
          <MemberRoster members={members} deckSize={deckSize} />
        </>
      )}

      {/*
        Викторина — самый тихий блок и единственный свёрнутый. Ключ прерывания
        собран из того, что на этом экране считается настоящим: состав комнаты,
        прогресс людей и появление почти-совпадений. Любое изменение сворачивает
        панель обратно.
      */}
      <PartyTrivia
        roomId={roomId}
        interruptKey={`${members.length}:${doneCount}:${near.length}:${offer?.appid ?? ''}`}
        interruptNote={tr(locale, {
          ru: 'В комнате что-то произошло — викторина подождёт.',
          en: 'Something happened in the room — trivia can wait.',
        })}
      />

      <div className="relative flex flex-wrap items-center justify-between gap-3 pt-2">
        {/* aria-disabled, а не disabled: отказ добора оставляет кнопку и
            пишет в ней «нажми ещё раз» — фокус обязан остаться на ней.
            Повтор гасит onPullMore (pullMore — по pulling) */}
        {hasMore ? (
          <button
            onClick={onPullMore}
            aria-disabled={pulling}
            className="btn-glass justify-start py-3 text-sm text-left aria-disabled:opacity-40"
          >
            <span className="block">
              {pulling
                ? tr(locale, { ru: 'Добираю…', en: 'Dealing more…' })
                : tr(locale, { ru: 'Ещё 20 игр', en: '20 more games' })}
            </span>
            {/*
              Карты за первой двадцаткой — заведомо худшие по близости к вкусу
              пати: колода отсортирована, и добор достаёт её хвост. Кнопка,
              которая делает вид, что дальше будет лучше, — то же враньё, что мы
              отсюда убрали. Плюс раунд общий: жмёт один, приходит всем.
            */}
            <span className="block text-xs text-faint mt-0.5">
              {pullFailed
                ? tr(locale, {
                    ru: 'Не дошло — проверь связь и нажми ещё раз',
                    en: "Didn't go through — check your connection and tap again",
                  })
                : tr(locale, {
                    ru: 'Дальше пойдёт то, что мы отложили. И придёт всем сразу',
                    en: 'Next up is what we set aside. Everyone gets it at once',
                  })}
            </span>
          </button>
        ) : (
          <span className="text-xs text-faint">
            {tr(locale, {
              ru: 'Игры кончились — мы честно перебрали всё, что нашли у вас и рядом.',
              en: "That's every game — we really went through everything we found in your libraries and nearby.",
            })}
          </span>
        )}
        <RoomEscapeHatch />
        {/*
          Выход из пати. Раньше уйти было нельзя вовсе: DELETE из room_members
          не существовало, и человек, зашедший «посмотреть», навсегда
          оставался в знаменателе единогласия — то есть запирал матч для
          остальных.

          Рядом с «подсесть к другим» намеренно: это одно и то же движение —
          «мне тут не сюда».
        */}
        {/* aria-disabled, а не disabled: на отказе фокус обязан остаться на
            кнопке. Повтор гасит onLeave (removeMember — по leaving) */}
        <button
          type="button"
          onClick={onLeave}
          aria-disabled={leaving}
          className="tap text-sm text-faint hover:text-danger transition-colors cursor-pointer aria-disabled:opacity-40"
        >
          {tr(locale, { ru: 'Выйти из пати', en: 'Leave party' })}
        </button>
        {/*
          Отказ выхода и ✕ хоста. Раньше оба молчали: на моргнувшей связи
          «Выйти из пати» не меняло на экране ничего, и человек, уверенный,
          что вышел, оставался в знаменателе единогласия. Строка стоит всегда,
          пустая — вне раскладки (sr-only), с текстом — отдельной строкой ряда:
          живая область, вставленная вместе с отказом, звучит не везде.
        */}
        <StatusLine text={leaveMiss} className="basis-full text-sm text-danger text-right" />
      </div>
    </section>
  )
}
