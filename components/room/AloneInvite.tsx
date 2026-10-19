'use client'

import { type Ref, useState } from 'react'
import { Icon } from '@/components/Icon'
import Link from '@/components/Link'
import { useLocale } from '@/components/LocaleProvider'
import { ShareLinkInput, type ShareLink } from '@/components/ShareLink'
import { FlapCode } from '@/components/FlapCode'
import { Eyebrow } from '@/components/Labels'
import { StatusLine } from '@/components/StatusLine'
import { tr } from '@/lib/i18n'
import { roomShareUrl } from '@/lib/roomshare'

/**
 * «В комнате только ты».
 *
 * Прежде здесь стояло «Ждём остальных. Матч появится сам» — при том, что
 * findRoomMatch требует минимум двух участников, и комната на одного не могла
 * разрешиться никогда. Экран обещал то, чего сервер не сделает.
 *
 * Поэтому тут не «ожидание», а развилка: позвать своих или пустить чужих.
 * Код комнаты — самая функциональная строка экрана (её диктуют вслух и кидают
 * в чат), и здесь он наконец герой, а не подпись в шапке.
 */
export function AloneInvite({
  roomId,
  isHost,
  isPublic,
  share,
  onTogglePublic,
  headRef,
  publicBusy,
  publicMiss,
}: {
  roomId: string
  isHost: boolean
  isPublic: boolean
  /** ссылка на комнату — общая с кнопкой в шапке (useShareLink) */
  share: ShareLink
  onTogglePublic: () => void
  /** заголовок — цель фокуса, когда колода ушла из-под пальцев (RoomWaiting) */
  headRef: Ref<HTMLHeadingElement>
  /** переключение доски в пути — повтор гасит togglePublic на странице */
  publicBusy: boolean
  /** почему доска не переключилась; null — отказа нет */
  publicMiss: string | null
}) {
  /*
   * Поле со ссылкой — после первого отказа буфера и насовсем. Раньше оно
   * держалось на state === 'manual', а тот через три секунды возвращается в
   * покой — и поле исчезало из-под пальцев, пока человек его выделял.
   */
  const [revealed, setRevealed] = useState(false)
  if (share.state === 'manual' && !revealed) setRevealed(true)
  const locale = useLocale()

  return (
    <>
      <div className="relative panel-lift p-6 sm:p-8 flex flex-col items-center gap-5 text-center">
        {/* «В комнате только ты», а не «ты тут один»: род того, кто
            смотрит на экран, нам неизвестен — см. MemberRoster */}
        <h2 ref={headRef} tabIndex={-1} className="font-display text-display-sm">
          {tr(locale, {
            ru: 'В комнате только ты — матчиться не с кем',
            en: "It's just you here — no one to match with",
          })}
        </h2>
        <p className="text-dim text-sm leading-relaxed max-w-sm">
          {tr(locale, {
            ru: 'Матч — это договорённость, а договариваться пока не с кем. Твои «играем» уже записаны и никуда не денутся: как только кто-то зайдёт — сравнитесь сразу.',
            en: "A match is an agreement, and there's no one to agree with yet. Your “I'm in” votes are saved: the moment someone joins, your votes get compared.",
          })}
        </p>

        <div className="flex flex-col items-center gap-2">
          <Eyebrow as="span" tone="faint">
            {tr(locale, { ru: 'код комнаты', en: 'room code' })}
          </Eyebrow>
          <div className="text-5xl sm:text-6xl tracking-[0.06em]">
            <FlapCode code={roomId} />
          </div>
          {/* Код диктуют — значит, тот, кто его слышит, должен знать, куда
              его набрать: поле «Есть код комнаты?» стоит на доске «Пати» */}
          <span className="text-xs text-faint">
            {tr(locale, { ru: 'Друг вводит его на странице «Пати»', en: 'Your friend enters it on the Party page' })}
          </span>
        </div>
      </div>

      <div className="relative grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => void share.run()}
          className="action-tile is-primary"
        >
          <span className="flex items-center gap-2 font-extrabold">
            {share.label(tr(locale, { ru: 'Позвать своих', en: 'Invite friends' }), { icon: 'link', iconSize: 18 })}
          </span>
          {/* Подпись обязана называть то, что произойдёт: на телефоне это не буфер */}
          <span className="block text-xs opacity-80 mt-0.5">
            {share.native
              ? tr(locale, { ru: 'Откроется «Поделиться»', en: 'Opens the share sheet' })
              : tr(locale, { ru: 'Ссылка в буфер — кидай в чат', en: 'Copies the link — drop it in chat' })}
          </span>
        </button>
        {/* Живая область — рядом с кнопкой: внутри она стала бы частью её
            имени. sr-only — вне потока, клетку сетки не занимает */}
        {share.status}

        {isHost ? (
          <button
            onClick={onTogglePublic}
            aria-pressed={isPublic}
            aria-disabled={publicBusy}
            className="action-tile aria-disabled:opacity-40"
          >
            <span className="flex items-center gap-2 font-extrabold">
              {isPublic ? (
                <span aria-hidden className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
              ) : (
                <Icon name="users" size={18} />
              )}
              {isPublic
                ? tr(locale, { ru: 'Комната на доске', en: 'Room is on the board' })
                : tr(locale, { ru: 'Пустить чужих', en: 'Let others in' })}
            </span>
            <span className="block text-xs text-faint mt-0.5">
              {isPublic
                ? tr(locale, {
                    ru: 'Висишь на «Пати» — могут зайти в любой момент',
                    en: "You're on the Party board — anyone can join anytime",
                  })
                : tr(locale, {
                    ru: 'Появишься на доске «Пати» — подсядут незнакомые',
                    en: "You'll show up on the Party board — strangers can join",
                  })}
            </span>
          </button>
        ) : (
          <div className="action-tile is-static">
            <span className="block text-sm font-bold text-dim">
              {tr(locale, { ru: 'Комната не на доске', en: "Room isn't on the board" })}
            </span>
            <span className="block text-xs text-faint mt-0.5">
              {tr(locale, {
                ru: 'Выложить может только тот, кто её создал',
                en: 'Only the person who created it can put it there',
              })}
            </span>
          </div>
        )}
      </div>
      {/*
        Отказ переключателя доски — здесь, под плиткой: верхние кнопки шапки,
        у которых своя такая строка, при AloneInvite спрятаны. Стоит всегда,
        текст приходит изменением — см. components/StatusLine.
      */}
      <StatusLine text={publicMiss} className="relative text-center text-sm text-danger" />

      {/*
        Копирование в буфер может не сработать: небезопасный origin, отказ в
        разрешении, часть мобильных браузеров. Раньше «Скопировано ✓» загоралось
        безусловно — то же самое враньё, что и «ждём остальных», только в
        главном действии экрана. Здесь есть запасной ход.

        Имя у поля своё, а строка над ним — его описание. Без этого скринридер
        объявлял «текстовое поле, только чтение» и адрес — без слова о том,
        что это и зачем: подпись лежала соседним span и с полем связана не была.
      */}
      {revealed && (
        <div className="relative flex flex-col gap-1.5">
          <span id="room-link-note" className="text-xs text-faint">
            {tr(locale, {
              ru: 'Не вышло скопировать. Вот ссылка — забирай:',
              en: "Couldn't copy it. Here's the link — grab it:",
            })}
          </span>
          <div className="join is-link">
            <ShareLinkInput
              url={typeof window === 'undefined' ? '' : roomShareUrl(window.location.origin, roomId, locale)}
              label={tr(locale, { ru: 'Ссылка на комнату', en: 'Room link' })}
              describedBy="room-link-note"
            />
          </div>
        </div>
      )}
    </>
  )
}

/** Тихая строка «а можно и не тут» — одинаковая во всех режимах ожидания */
export function RoomEscapeHatch({ className = '' }: { className?: string }) {
  const locale = useLocale()
  return (
    <Link href="/rooms" className={`tap link-more ${className}`}>
      {tr(locale, { ru: 'Подсесть к другим', en: 'Join another party' })}
      <Icon name="arrow" size={16} />
    </Link>
  )
}
