'use client'

import { useState } from 'react'
import { Icon } from '@/components/Icon'
import Link from 'next/link'
import { ShareLinkInput, type ShareLink } from '@/components/ShareLink'
import { FlapCode } from '@/components/FlapCode'
import { Eyebrow } from '@/components/Labels'
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
}: {
  roomId: string
  isHost: boolean
  isPublic: boolean
  /** ссылка на комнату — общая с кнопкой в шапке (useShareLink) */
  share: ShareLink
  onTogglePublic: () => void
}) {
  /*
   * Поле со ссылкой — после первого отказа буфера и насовсем. Раньше оно
   * держалось на state === 'manual', а тот через три секунды возвращается в
   * покой — и поле исчезало из-под пальцев, пока человек его выделял.
   */
  const [revealed, setRevealed] = useState(false)
  if (share.state === 'manual' && !revealed) setRevealed(true)

  return (
    <>
      <div className="relative panel-lift p-6 sm:p-8 flex flex-col items-center gap-5 text-center">
        {/* «В комнате только ты», а не «ты тут один»: род того, кто
            смотрит на экран, нам неизвестен — см. MemberRoster */}
        <h2 className="font-display text-display-sm">
          В комнате только ты — матчиться не с кем
        </h2>
        <p className="text-dim text-sm leading-relaxed max-w-sm">
          Матч — это договорённость, а договариваться пока не с кем. Твои «играем» уже записаны
          и никуда не денутся: как только кто-то зайдёт — сравнитесь сразу.
        </p>

        <div className="flex flex-col items-center gap-2">
          <Eyebrow as="span" tone="faint">
            код комнаты
          </Eyebrow>
          <div className="text-5xl sm:text-6xl tracking-[0.06em]">
            <FlapCode code={roomId} />
          </div>
          {/* Код диктуют — значит, тот, кто его слышит, должен знать, куда
              его набрать: поле «Есть код комнаты?» стоит на доске «Пати» */}
          <span className="text-xs text-faint">Друг вводит его на странице «Пати»</span>
        </div>
      </div>

      <div className="relative grid gap-3 sm:grid-cols-2">
        <button
          onClick={() => void share.run()}
          className="action-tile is-primary"
        >
          <span className="flex items-center gap-2 font-extrabold">
            {share.label('Позвать своих', { icon: 'link', iconSize: 18 })}
          </span>
          {/* Подпись обязана называть то, что произойдёт: на телефоне это не буфер */}
          <span className="block text-xs opacity-80 mt-0.5">
            {share.native ? 'Откроется «Поделиться»' : 'Ссылка в буфер — кидай в чат'}
          </span>
        </button>
        {/* Живая область — рядом с кнопкой: внутри она стала бы частью её
            имени. sr-only — вне потока, клетку сетки не занимает */}
        {share.status}

        {isHost ? (
          <button
            onClick={onTogglePublic}
            aria-pressed={isPublic}
            className="action-tile"
          >
            <span className="flex items-center gap-2 font-extrabold">
              {isPublic ? (
                <span aria-hidden className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
              ) : (
                <Icon name="users" size={18} />
              )}
              {isPublic ? 'Комната на доске' : 'Пустить чужих'}
            </span>
            <span className="block text-xs text-faint mt-0.5">
              {isPublic
                ? 'Висишь на «Пати» — могут зайти в любой момент'
                : 'Появишься на доске «Пати» — подсядут незнакомые'}
            </span>
          </button>
        ) : (
          <div className="action-tile is-static">
            <span className="block text-sm font-bold text-dim">Комната не на доске</span>
            <span className="block text-xs text-faint mt-0.5">
              Выложить может только тот, кто её создал
            </span>
          </div>
        )}
      </div>

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
            Не вышло скопировать. Вот ссылка — забирай:
          </span>
          <div className="join is-link">
            <ShareLinkInput
              url={typeof window === 'undefined' ? '' : roomShareUrl(window.location.origin, roomId)}
              label="Ссылка на комнату"
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
  return (
    <Link href="/rooms" className={`tap link-more ${className}`}>
      Подсесть к другим
      <Icon name="arrow" size={16} />
    </Link>
  )
}
