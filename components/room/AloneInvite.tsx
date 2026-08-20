'use client'

import Link from 'next/link'
import { FlapCode } from '@/components/FlapCode'

/**
 * «Ты тут один».
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
  copied,
  copyFailed,
  native = false,
  onCopyLink,
  onTogglePublic,
}: {
  roomId: string
  isHost: boolean
  isPublic: boolean
  copied: boolean
  copyFailed: boolean
  /** на телефоне откроется системная панель, а не буфер */
  native?: boolean
  onCopyLink: () => void
  onTogglePublic: () => void
}) {
  return (
    <>
      <div className="relative glass rounded-[20px] p-6 sm:p-8 flex flex-col items-center gap-5 text-center">
        <h2 className="font-display text-display-sm">
          Ты тут один — матчиться не с кем
        </h2>
        <p className="text-dim text-sm leading-relaxed max-w-sm">
          Матч — это договорённость, а договариваться пока не с кем. Твои «играем» уже записаны
          и никуда не денутся: как только кто-то зайдёт — сравнитесь сразу.
        </p>

        <div className="flex flex-col items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.18em] text-faint">код комнаты</span>
          <div className="text-5xl sm:text-6xl tracking-[0.06em]">
            <FlapCode code={roomId} />
          </div>
        </div>
      </div>

      <div className="relative grid gap-3 sm:grid-cols-2">
        <button
          onClick={onCopyLink}
          className="rounded-[20px] bg-ember text-on-ember px-5 py-4 text-left hover:brightness-110 active:scale-[0.98] transition cursor-pointer"
        >
          <span className="block font-semibold">{copied ? 'Скопировано ✓' : 'Позвать своих'}</span>
          {/* Подпись обязана называть то, что произойдёт: на телефоне это не буфер */}
          <span className="block text-xs opacity-80 mt-0.5">
            {native ? 'Откроется «Поделиться»' : 'Ссылка в буфер — кидай в чат'}
          </span>
        </button>

        {isHost ? (
          <button
            onClick={onTogglePublic}
            aria-pressed={isPublic}
            className={`rounded-[20px] px-5 py-4 text-left transition cursor-pointer ${
              isPublic ? 'bg-ember/15 text-ember-text' : 'glass glass-hover'
            }`}
          >
            <span className="flex items-center gap-2 font-semibold">
              {isPublic && (
                <span aria-hidden className="h-2 w-2 rounded-full bg-ember anim-pulse-dot" />
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
          <div className="rounded-[20px] glass px-5 py-4 text-left">
            <span className="block text-sm text-dim">Комната не на доске</span>
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
      */}
      {copyFailed && (
        <div className="relative flex flex-col gap-1.5">
          <span className="text-xs text-faint">Не вышло скопировать. Вот ссылка — забирай:</span>
          <input
            readOnly
            value={typeof window === 'undefined' ? '' : window.location.href}
            onFocus={(e) => e.currentTarget.select()}
            className="rounded-[14px] bg-surface border border-edge px-4 py-2.5 text-sm font-mono text-dim w-full"
          />
        </div>
      )}
    </>
  )
}

/** Тихая строка «а можно и не тут» — одинаковая во всех режимах ожидания */
export function RoomEscapeHatch({ className = '' }: { className?: string }) {
  return (
    <Link href="/rooms" className={`text-sm text-dim hover:text-ink transition-colors ${className}`}>
      Подсесть к другим →
    </Link>
  )
}
